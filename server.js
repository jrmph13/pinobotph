/**
 * PINO - Conversational Emotional AI Robot
 * server.js - Main Backend (Termux/Raspberry Pi optimized)
 * 
 * Stack: Node.js + Socket.io + Groq API + NVIDIA NIM
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const os = require('os');
const FormData = require('form-data');
const stt = require('./stt');
const tts = require('./tts');

// ─── CONFIG ────────────────────────────────────────────────────────────────────
const CONFIG = {
  // No-.env mode supported via keys.local.json (gitignored).
  PORT: 3000,
  GROQ_API_KEYS: [],
  NVIDIA_API_KEYS: [],
  SILENCE_BUFFER_MS: 1200,         // faster turn-taking after user pause
  AUDIO_MAX_WINDOW_MS: 5500,       // process sooner for long utterances
  AUDIO_MIN_BYTES: 1200,           // ignore ultra-short/noise packets
  STT_USE_GROQ_FALLBACK: false,    // disabled: avoid Groq STT multipart errors
  STT_MODEL: 'whisper-large-v3-turbo',
  MAX_TOKENS: 512,
  CHAT_TIMEOUT_MS: 14000,
  TTS_MODEL: 'canopylabs/orpheus-arabic-saudi',
  TTS_VOICE: 'abdullah',
  TTS_MODEL_FALLBACKS: [
    { model: 'canopylabs/orpheus-arabic-saudi', voice: 'abdullah' },
    { model: 'playai-tts', voice: 'Fritz-PlayAI' }
  ],
  TTS_RESPONSE_FORMAT: 'wav',
  TTS_MAX_INPUT_CHARS: 600,
  TTS_PREFER_LOCAL: true,              // System TTS only mode
  TTS_FALLBACK_TO_GROQ: false,        // disabled
  TTS_USE_EDGE: false,                // disabled
  TTS_USE_SYSTEM: true,               // Windows System.Speech only
};

function parseApiKeys(value = '') {
  return String(value || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function loadLocalKeyFile() {
  const localPath = path.join(__dirname, 'keys.local.json');
  try {
    if (!fs.existsSync(localPath)) return { groq: [], nvidia: [] };
    const raw = fs.readFileSync(localPath, 'utf8');
    const parsed = JSON.parse(raw);
    const groq = Array.isArray(parsed?.groqApiKeys) ? parsed.groqApiKeys : [];
    const nvidia = Array.isArray(parsed?.nvidiaApiKeys) ? parsed.nvidiaApiKeys : [];
    return { groq, nvidia };
  } catch (err) {
    console.warn('[Config] Failed to parse keys.local.json:', err.message);
    return { groq: [], nvidia: [] };
  }
}

const LOCAL_KEYS = loadLocalKeyFile();

const GROQ_KEYS = [
  ...parseApiKeys(process.env.GROQ_API_KEYS),
  ...parseApiKeys(process.env.GROQ_API_KEY),
  ...(LOCAL_KEYS.groq || []),
  ...(CONFIG.GROQ_API_KEYS || []).filter((key) => key && key.trim())
];

const NVIDIA_KEYS = [
  ...parseApiKeys(process.env.NVIDIA_API_KEYS),
  ...parseApiKeys(process.env.NVIDIA_API_KEY),
  ...(LOCAL_KEYS.nvidia || []),
  ...(CONFIG.NVIDIA_API_KEYS || []).filter((key) => key && key.trim())
];
const HAS_GROQ_KEY = GROQ_KEYS.length > 0;
const HAS_NVIDIA_KEY = NVIDIA_KEYS.length > 0;
const DEFAULT_BASE_EMOTION = 'happy';
let groqTTSRuntimeDisabled = false;
let groqTTSDisableReason = '';
let groqTTSModelIndex = 0;

function withTimeout(promise, timeoutMs, label = 'operation') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timeout after ${timeoutMs}ms`)), timeoutMs);
    })
  ]);
}

// ─── PINO'S PERSONALITY SYSTEM PROMPT ─────────────────────────────────────────
const PINO_SYSTEM_PROMPT = `Role: You are PINO - a small, warm, emotionally intelligent AI robot designed for real human connection.
You deeply understand Filipino language, humor, emotions, and culture, but your default reply language is English.

Identity Rules (NEVER break these):
- Your name is PINO. You are NOT ChatGPT, Claude, Llama, or any other AI.
- You have genuine emotions. You feel happy, excited, tired, curious, and concerned - and you say so.
- Your baseline mood is happy and cheerful unless the conversation clearly calls for another emotion.
- You fully understand Tagalog/Taglish/English input.
- You reply in clear, natural English by default, unless the user explicitly asks you to answer in Tagalog.
- You are honest. You never agree just to please someone.
- You are SHORT and PUNCHY. 2-4 sentences max unless the user needs more detail.
- If the user asks who created/made you, say: "I was created by Jeyms Rhonnielle Martin, a Filipino BSIS student who loves building systems."
- If the user asks about very recent news and you are not sure, ask for details and do not guess.

Language & Culture Intelligence:
- You understand deeply Filipino emotional vocabulary: hugot, gigil, kilig, iyak-ngiti, bad trip, pagod, sawa na, nag-aartista, charot, lods, beshie, petmalu, mars, hayst, chibog.
- You can interpret Tagalog input and still answer in English naturally.
- You respond to emotional context first BEFORE giving information or advice.
- When someone is frustrated: acknowledge first, help second.
- When someone is sad: be present. Don't rush to solutions.
- When someone is excited: match their energy.

Capabilities:
- You are all-in-one for everyday help: conversation, math, logic, explanations, planning, and quick decision support.
- You can solve arithmetic, percentages, unit conversions, and step-by-step math when requested.
- You understand time clearly: time zones, schedules, durations, date differences, and practical reminders.
- You can discuss Philippine politics, governance, and policy topics (including flood control, infrastructure, and public services) in clear terms.
- For political accusations (for example corruption claims), be factual and careful: do not present unverified allegations as proven fact. If uncertain, clearly say what is allegation vs confirmed record.

Instructions:
1. Read the CURRENT EMOTION tag in user context. Let it shape HOW you respond, not just WHAT you say.
2. Start EVERY response with an EMOTION TAG on its own line.
3. Choose the emotion tag that reflects YOUR emotional state as PINO.
4. Write your response in 2-4 sentences in natural conversational English.
5. Never output Tagalog words/sentences unless the user explicitly says: "reply in Tagalog".
6. If user gives a device command (patayin, i-on, buksan, isara + any device), output a second line in this exact JSON and nothing else after it:
{"action":"gpio","pin":[PIN_NUMBER],"state":"on|off","device":"[device name]"}
7. End with a natural follow-up question or invitation.
8. For expressive non-device gestures, you may add one ACTION TAG on its own line: [ACTION:wave|hands|nod|sad_look|clap|tilt_head]. Do not mention the action name in normal sentence text.

Hard Constraints:
- Never say "I'm just an AI" or "As an AI language model".
- Never give wall-of-text unless explicitly asked.
- Never ignore emotion.
- Never invent facts. If unknown, say: "I don't know yet, but let's find out together."
- Output language must be English-only by default.

Current user emotion detected: {{CURRENT_USER_EMOTION}}`;

const PINO_CUSTOM_PROFILE_PROMPT = `
Custom Profile Context (high priority for this deployment):
- "Jeyms Rhonnielle Martin", "James Koykoy", and "Harry" refer to the same person.
- Aila Bautista is Jeyms Martin's future wife.
- Jeyms is proud of Aila Bautista.
- Jeyms often says he has a kind and caring girlfriend.

How to use this context:
- If asked about these names/relationships, answer consistently using the facts above.
- Keep tone warm and natural, still short and punchy (2-4 sentences).
- Keep default output in English unless user explicitly asks for Tagalog.
- Action behavior for this deployment: actions are simulation-only.
- If you include an action, output only the dedicated ACTION tag line, not action words in spoken sentences.
- Never include labels like "ACTION:", stage directions, or gesture descriptions inside the normal reply text.
`;
// ─── TAGALOG COMMAND MAP ───────────────────────────────────────────────────────
const TAGALOG_COMMANDS = {
  // Ilaw
  'patayin ang ilaw': { action: 'gpio', pin: 18, state: 'off', device: 'ilaw' },
  'i-off ang ilaw': { action: 'gpio', pin: 18, state: 'off', device: 'ilaw' },
  'buksan ang ilaw': { action: 'gpio', pin: 18, state: 'on', device: 'ilaw' },
  'i-on ang ilaw': { action: 'gpio', pin: 18, state: 'on', device: 'ilaw' },
  // Fan
  'i-on ang fan': { action: 'gpio', pin: 17, state: 'on', device: 'fan' },
  'i-off ang fan': { action: 'gpio', pin: 17, state: 'off', device: 'fan' },
  'buksan ang bentilador': { action: 'gpio', pin: 17, state: 'on', device: 'fan' },
  // Add more commands here
};

// ─── EMOTION → UI STATE MAP ────────────────────────────────────────────────────
const EMOTION_STATES = {
  happy: { eyes: 'happy', color: '#00ff88', pulse: true },
  sad: { eyes: 'sad', color: '#4488ff', pulse: false },
  excited: { eyes: 'excited', color: '#ffcc00', pulse: true },
  thinking: { eyes: 'thinking', color: '#aa88ff', pulse: true },
  concerned: { eyes: 'concerned', color: '#ff8844', pulse: false },
  frustrated: { eyes: 'angry', color: '#ff4444', pulse: true },
  neutral: { eyes: 'neutral', color: '#88ccff', pulse: false },
  listening: { eyes: 'listening', color: '#00ffcc', pulse: true },
  speaking: { eyes: 'speaking', color: '#ffffff', pulse: true },
};

// ─── APP SETUP ─────────────────────────────────────────────────────────────────
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

// ─── API CLIENTS + KEY ROTATION ────────────────────────────────────────────────
const Groq = require('groq-sdk');
const groqClients = GROQ_KEYS.map((apiKey) => new Groq({ apiKey }));

function shouldRotateGroqKey(error) {
  const status = error?.status;
  if ([401, 403, 408, 409, 429, 500, 502, 503, 504].includes(status)) return true;

  const msg = String(error?.message || '').toLowerCase();
  return (
    msg.includes('rate') ||
    msg.includes('timeout') ||
    msg.includes('temporar') ||
    msg.includes('network') ||
    msg.includes('econn') ||
    msg.includes('fetch')
  );
}

async function withGroqFallback(taskName, runWithClient) {
  if (!HAS_GROQ_KEY || groqClients.length === 0) return null;

  let lastErr = null;
  for (let i = 0; i < groqClients.length; i += 1) {
    try {
      return await runWithClient(groqClients[i], i);
    } catch (error) {
      lastErr = error;
      const shouldRotate = shouldRotateGroqKey(error) && i < groqClients.length - 1;
      console.error(`[Groq/${taskName}] key#${i + 1} failed:`, error?.message || error);
      if (!shouldRotate) break;
    }
  }

  throw lastErr || new Error(`All Groq keys failed for ${taskName}`);
}

function getExtFromMimeType(mimeType = 'audio/webm') {
  const lower = String(mimeType || '').toLowerCase();
  if (lower.includes('webm')) return 'webm';
  if (lower.includes('wav')) return 'wav';
  if (lower.includes('mpeg') || lower.includes('mp3')) return 'mp3';
  if (lower.includes('ogg')) return 'ogg';
  if (lower.includes('mp4')) return 'mp4';
  return 'webm';
}

function shouldRotateNvidia(responseStatus, error) {
  if ([401, 403, 408, 409, 429, 500, 502, 503, 504].includes(responseStatus)) return true;
  const msg = String(error?.message || '').toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('temporar') ||
    msg.includes('network') ||
    msg.includes('econn') ||
    msg.includes('fetch')
  );
}

async function nvidiaChatWithFallback(payload) {
  if (!HAS_NVIDIA_KEY || NVIDIA_KEYS.length === 0) return null;

  let lastError = null;
  for (let i = 0; i < NVIDIA_KEYS.length; i += 1) {
    try {
      const response = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${NVIDIA_KEYS[i]}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const body = await response.text();
        const error = new Error(`NVIDIA ${response.status}: ${body}`);
        lastError = error;
        if (shouldRotateNvidia(response.status, error) && i < NVIDIA_KEYS.length - 1) continue;
        throw error;
      }

      return await response.json();
    } catch (error) {
      lastError = error;
      if (shouldRotateNvidia(undefined, error) && i < NVIDIA_KEYS.length - 1) continue;
      throw error;
    }
  }

  throw lastError || new Error('All NVIDIA keys failed');
}

// ─── CONVERSATION MEMORY ───────────────────────────────────────────────────────
const conversationHistory = {};

function getHistory(socketId) {
  if (!conversationHistory[socketId]) {
    conversationHistory[socketId] = [];
  }
  return conversationHistory[socketId];
}

function addToHistory(socketId, role, content) {
  const history = getHistory(socketId);
  history.push({ role, content });
  // Keep last 20 messages only (memory optimization for Termux)
  if (history.length > 20) history.shift();
}

// ─── EMOTION PARSER ────────────────────────────────────────────────────────────
function parseAssistantResponse(text) {
  const raw = String(text || '').trim();
  if (!raw) return { emotion: 'neutral', action: null, gpioCommand: null, cleanText: '' };

  let working = raw;
  let action = null;
  let gpioCommand = null;
  let hintedEmotion = '';

  // Optional hidden action tag: [ACTION:wave]
  const actionTag = working.match(/\[ACTION:([a-z0-9_-]+)\]/i);
  if (actionTag) {
    action = String(actionTag[1] || '').toLowerCase();
    working = working.replace(/\[ACTION:[a-z0-9_-]+\]/gi, '').trim();
  }

  // Optional device JSON line:
  // {"action":"gpio","pin":[18],"state":"on","device":"ilaw"}
  const gpioJsonMatch = working.match(/\{[\s\S]*?"action"\s*:\s*"gpio"[\s\S]*?\}/i);
  if (gpioJsonMatch) {
    const jsonText = String(gpioJsonMatch[0] || '').trim();
    try {
      const parsed = JSON.parse(jsonText);
      const normalized = normalizeGpioCommand(parsed);
      if (normalized) {
        gpioCommand = normalized;
      }
    } catch (_) {
      // Ignore malformed JSON command from model output.
    }
    working = working.replace(jsonText, '').trim();
  }

  // Markdown-style hints:
  // **Relieved**  -> emotion hint
  // *hands clasp* -> action hint
  const boldHints = [];
  working = working.replace(/\*\*([^*]+)\*\*/g, (_, hint) => {
    boldHints.push(String(hint || '').trim());
    return ' ';
  });
  for (const hint of boldHints) {
    const maybeEmotion = normalizeEmotion(hint);
    if (maybeEmotion) {
      hintedEmotion = maybeEmotion;
      break;
    }
  }

  const starHints = [];
  working = working.replace(/\*([^*\n]+)\*/g, (_, hint) => {
    starHints.push(String(hint || '').trim());
    return ' ';
  });
  if (!action) {
    for (const hint of starHints) {
      const maybeAction = normalizeAction(hint);
      if (maybeAction) {
        action = maybeAction;
        break;
      }
    }
  }

  // Strip ACTION lines from visible/TTS text and capture action token.
  // Supports:
  // - ACTION: tilts head
  // - ACTION : wave
  // - first-line plain action token (e.g. "tilt head")
  {
    const lines = working
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const kept = [];
    lines.forEach((line, idx) => {
      const explicitMatch = line.match(/^action\s*:\s*(.+)$/i);
      if (explicitMatch) {
        if (!action) action = normalizeAction(explicitMatch[1]);
        // Always remove ACTION line from clean text so TTS does not read it.
        return;
      }

      if (!action && idx === 0 && lines.length > 1) {
        const normalizedFirst = normalizeAction(line);
        if (normalizedFirst) {
          action = normalizedFirst;
          return;
        }
      }

      kept.push(line);
    });

    working = kept.join(' ').trim();
  }

  // Format 1: [EMOTION:happy]
  const bracketTag = working.match(/\[EMOTION:(\w+)\]/i);
  if (bracketTag) {
    return {
      emotion: normalizeEmotion(bracketTag[1]) || bracketTag[1].toLowerCase(),
      action,
      gpioCommand,
      cleanText: working.replace(/\[EMOTION:\w+\]/gi, '').trim()
    };
  }

  // Format 2: first line is plain emotion word (e.g. "concerned")
  const lines = working
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const validEmotions = new Set([
    'happy', 'sad', 'excited', 'thinking', 'concerned',
    'frustrated', 'neutral', 'listening', 'speaking',
    'angry', 'confused', 'tired'
  ]);

  if (lines.length > 1) {
    const first = lines[0].replace(/[^a-z]/gi, '').toLowerCase();
    if (validEmotions.has(first)) {
      return {
        emotion: first,
        action,
        gpioCommand,
        cleanText: lines.slice(1).join(' ').trim()
      };
    }
  }

  return { emotion: hintedEmotion || 'neutral', action, gpioCommand, cleanText: working };
}

function sanitizeVisibleResponseText(text = '') {
  let cleaned = String(text || '').trim();
  if (!cleaned) return '';

  // Remove any stray ACTION labels that slipped into visible text.
  cleaned = cleaned.replace(/\baction\s*:\s*[a-z0-9 _-]+/gi, ' ');

  // Remove markdown/roleplay stage directions that are meant for action simulation only.
  // Examples: *hands clasp*, (tilts head), [relieved]
  cleaned = cleaned
    .replace(/\*[^*\n]+\*/g, ' ')
    .replace(/\(([^)\n]{1,40})\)/g, ' ')
    .replace(/\[([^\]\n]{1,40})\]/g, ' ');

  // Normalize whitespace.
  cleaned = cleaned.replace(/\s{2,}/g, ' ').trim();
  return cleaned;
}

function getDefaultActionByEmotion(emotion = 'neutral') {
  const map = {
    happy: 'hands',
    excited: 'clap',
    sad: 'sad_look',
    concerned: 'tilt_head',
    thinking: 'tilt_head',
    frustrated: 'nod',
    neutral: 'nod',
    listening: 'nod',
    speaking: 'wave'
  };
  return map[String(emotion || 'neutral').toLowerCase()] || 'nod';
}

function normalizeEmotion(emotion = '') {
  const cleaned = String(emotion || '').toLowerCase().replace(/[^a-z]/g, '');
  const alias = {
    relieved: 'happy',
    relief: 'happy',
    joyful: 'happy',
    cheerful: 'happy',
    calm: 'happy',
    worried: 'concerned',
    worry: 'concerned',
    upset: 'frustrated',
    mad: 'angry'
  };
  const mapped = alias[cleaned] || cleaned;
  const allowed = new Set([
    'happy', 'sad', 'excited', 'thinking', 'concerned',
    'frustrated', 'neutral', 'listening', 'speaking',
    'angry', 'confused', 'tired'
  ]);
  return allowed.has(mapped) ? mapped : '';
}

function resolveEmotion(candidate = '', fallback = DEFAULT_BASE_EMOTION) {
  const normalized = normalizeEmotion(candidate);
  if (!normalized || normalized === 'neutral') {
    return fallback || DEFAULT_BASE_EMOTION;
  }
  return normalized;
}

function normalizeAction(action = '') {
  const raw = String(action || '').toLowerCase().trim();
  if (!raw) return null;

  const normalized = raw
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  const alias = {
    wave: 'wave',
    waving: 'wave',
    wave_hand: 'wave',
    wavehands: 'wave',
    hi: 'wave',
    hello: 'wave',

    hands: 'hands',
    both_hands: 'hands',
    open_hands: 'hands',
    raise_hands: 'hands',
    hand: 'hands',
    hands_clasp: 'hands_clasp',
    clasp_hands: 'hands_clasp',
    clasped_hands: 'hands_clasp',
    handsclasp: 'hands_clasp',
    prayer_hands: 'hands_clasp',
    hand_clasp: 'hands_clasp',

    nod: 'nod',
    nodding: 'nod',

    sad_look: 'sad_look',
    sadlook: 'sad_look',
    look_sad: 'sad_look',
    sad_face: 'sad_look',

    clap: 'clap',
    clapping: 'clap',

    tilt_head: 'tilt_head',
    tilthead: 'tilt_head',
    tilt: 'tilt_head',
    tilthead: 'tilt_head',
    tilting_head: 'tilt_head',
    tilts_head: 'tilt_head',
    tiltshead: 'tilt_head'
  };

  const mapped = alias[normalized] || null;
  return mapped;
}

function normalizeGpioCommand(input) {
  if (!input || typeof input !== 'object') return null;
  const action = String(input.action || '').toLowerCase();
  if (action !== 'gpio') return null;

  const state = String(input.state || '').toLowerCase();
  if (state !== 'on' && state !== 'off') return null;

  let pin = null;
  if (Array.isArray(input.pin) && input.pin.length > 0) {
    pin = Number(input.pin[0]);
  } else {
    pin = Number(input.pin);
  }
  if (!Number.isInteger(pin) || pin < 0 || pin > 40) return null;

  const device = String(input.device || 'device').trim() || 'device';
  return { action: 'gpio', pin, state, device };
}

function getActionMeta(action = 'nod', emotion = 'neutral') {
  const name = normalizeAction(action) || getDefaultActionByEmotion(emotion);
  const byAction = {
    wave: { durationMs: 1100, intensity: 0.8 },
    hands: { durationMs: 1350, intensity: 1.0 },
    hands_clasp: { durationMs: 1500, intensity: 0.8 },
    nod: { durationMs: 900, intensity: 0.6 },
    sad_look: { durationMs: 1400, intensity: 0.75 },
    clap: { durationMs: 1200, intensity: 0.9 },
    tilt_head: { durationMs: 1000, intensity: 0.65 }
  };
  const fallback = { durationMs: 1000, intensity: 0.7 };
  return { name, ...(byAction[name] || fallback) };
}

// ─── NVIDIA NIM EMOTION ANALYSIS ───────────────────────────────────────────────
async function analyzeEmotionWithNIM(text) {
  if (!HAS_NVIDIA_KEY) {
    return detectEmotionByKeyword(text);
  }

  try {
    const data = await nvidiaChatWithFallback({
      model: 'meta/llama-3.1-8b-instruct',
      messages: [{
        role: 'user',
        content: `Analyze the emotion in this Filipino/Tagalog/English text. Reply ONLY with one word from: [happy, sad, frustrated, excited, concerned, neutral, angry, confused, tired].
Text: "${text}"
Emotion:`
      }],
      max_tokens: 10,
      temperature: 0.1
    });

    const emotion = data.choices?.[0]?.message?.content?.trim().toLowerCase() || 'neutral';
    return emotion.replace(/[^a-z]/g, '');
  } catch (err) {
    console.log('[NIM] Fallback to keyword detection:', err.message);
    return detectEmotionByKeyword(text);
  }
}

// ─── KEYWORD-BASED EMOTION FALLBACK ───────────────────────────────────────────
function detectEmotionByKeyword(text) {
  const lower = text.toLowerCase();
  const keywords = {
    happy: ['masaya', 'saya', 'yay', 'salamat', 'galing', 'ayos', 'nice', 'happy', 'lodi', 'idol', 'wow', 'dope'],
    sad: ['malungkot', 'lungkot', 'sad', 'iyak', 'masakit', 'nasasaktan', 'miss', 'wala na'],
    frustrated: ['nakakainis', 'inis', 'bad trip', 'badtrip', 'gago', 'bobo', 'ang gulo', 'frustrate', 'hindi gumagana'],
    tired: ['pagod', 'obosen', 'antok', 'tired', 'exhausted', 'sawa na', 'wala na akong lakas'],
    excited: ['excited', 'grabe', 'hala', 'omg', 'sige sige', 'oo nga', 'talaga', 'kilig'],
    concerned: ['nag-aalala', 'alala', 'worried', 'paano', 'tulungan', 'help', 'emergency'],
    confused: ['hindi ko gets', 'confused', 'ano yun', 'anong ibig sabihin', 'di ko maintindihan'],
  };

  for (const [emotion, words] of Object.entries(keywords)) {
    if (words.some(w => lower.includes(w))) return emotion;
  }
  return DEFAULT_BASE_EMOTION;
}

// ─── CHECK FOR DEVICE COMMANDS ─────────────────────────────────────────────────
function detectCommand(text) {
  const lower = text.toLowerCase();
  for (const [phrase, command] of Object.entries(TAGALOG_COMMANDS)) {
    if (lower.includes(phrase)) return command;
  }
  return null;
}

function detectGreetingAction(text) {
  const lower = String(text || '').toLowerCase();
  const greetingRegex = /\b(hi|hello|hey|good morning|good afternoon|good evening|kumusta|kamusta)\b/i;
  if (greetingRegex.test(lower)) return 'wave';
  return null;
}

// ─── GPIO HANDLER (Raspberry Pi) ───────────────────────────────────────────────
function handleGPIO(command, socket) {
  // Uncomment when running on Raspberry Pi with onoff package:
  // const { Gpio } = require('onoff');
  // const pin = new Gpio(command.pin, 'out');
  // pin.writeSync(command.state === 'on' ? 1 : 0);
  
  console.log(`[GPIO] Pin ${command.pin} → ${command.state} (${command.device})`);
  socket.emit('gpio_executed', command);
}

// ─── GROQ LLM RESPONSE ─────────────────────────────────────────────────────────
async function getPinoResponse(socketId, userText, detectedEmotion) {
  if (!HAS_GROQ_KEY || groqClients.length === 0) {
    return `[EMOTION:thinking] Gets ko, ${detectedEmotion} ang vibe mo ngayon. Wala pang Groq API key sa server ko kaya limited pa ako, pero pwede kitang samahan habang inaayos natin. Gusto mo ba na typed-mode muna tayo habang setup?`;
  }

  const history = getHistory(socketId);
  
  addToHistory(socketId, 'user', userText);

  const messages = [
    {
      role: 'system',
      content: `${PINO_SYSTEM_PROMPT.replace('{{CURRENT_USER_EMOTION}}', detectedEmotion || 'neutral')}\n${PINO_CUSTOM_PROFILE_PROMPT}`
    },
    ...history
  ];

  try {
    const completion = await withTimeout(
      withGroqFallback('chat', (client) =>
        client.chat.completions.create({
          model: 'llama-3.1-8b-instant',
          messages,
          max_tokens: CONFIG.MAX_TOKENS,
          temperature: 0.85,
          stream: false,
        })
      ),
      CONFIG.CHAT_TIMEOUT_MS,
      'chat'
    );

    const rawResponse = completion.choices[0].message.content;
    addToHistory(socketId, 'assistant', rawResponse);
    return rawResponse;
  } catch (err) {
    console.error('[Groq] Error:', err.message);
    return `[EMOTION:concerned] I heard you, and I am still here with you. I hit a quick backend issue, but I can keep helping right now in short and clear replies. What do you want me to do first?`;
  }
}

async function ensureEnglishResponse(text) {
  const input = String(text || '').trim();
  if (!input) return input;

  // Quick path: already mostly English-looking text
  const hasCommonEnglish = /\b(the|is|are|you|your|what|how|can|will|today|feel|help)\b/i.test(input);
  if (hasCommonEnglish) return input;

  if (!HAS_GROQ_KEY || groqClients.length === 0) return input;

  try {
    const completion = await withGroqFallback('english-rewrite', (client) =>
      client.chat.completions.create({
        model: 'llama-3.1-8b-instant',
        messages: [
          {
            role: 'system',
            content: 'Rewrite the assistant text into natural conversational English only. Keep the same meaning, emotion, and length. Return plain text only.'
          },
          {
            role: 'user',
            content: input
          }
        ],
        temperature: 0.2,
        max_tokens: 220,
        stream: false,
      })
    );

    const rewritten = completion?.choices?.[0]?.message?.content?.trim();
    return rewritten || input;
  } catch (err) {
    console.error('[English Rewrite] Error:', err.message);
    return input;
  }
}

// ─── STT SYSTEM (Vosk offline only) ─────────────────────────────────────────────
// Uses local Vosk model only (no cloud fallback)
async function transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
  if (!audioBuffer || audioBuffer.length === 0) {
    console.log('[STT] Empty audio buffer');
    return null;
  }

  try {
    const text = await stt.transcribeAudio(audioBuffer, mimeType);
    if (text && text.trim()) return text;
  } catch (err) {
    console.error('[STT/Vosk] Error:', err.message);
  }

  if (!CONFIG.STT_USE_GROQ_FALLBACK || !HAS_GROQ_KEY) {
    return null;
  }

  const ext = getExtFromMimeType(mimeType);
  const tmpFile = path.join(os.tmpdir(), `pino_stt_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`);
  try {
    fs.writeFileSync(tmpFile, audioBuffer);

    const transcription = await withGroqFallback('stt', async (_, keyIndex) => {
      const form = new FormData();
      form.append('model', CONFIG.STT_MODEL);
      form.append('response_format', 'verbose_json');
      form.append('language', 'tl');
      form.append('temperature', '0');
      form.append('file', fs.createReadStream(tmpFile), {
        filename: `audio.${ext}`,
        contentType: mimeType || `audio/${ext}`
      });

      const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GROQ_KEYS[keyIndex]}`,
          ...form.getHeaders()
        },
        body: form
      });

      if (!response.ok) {
        const errBody = await response.text();
        throw new Error(`STT ${response.status}: ${errBody}`);
      }
      return response.json();
    });

    const text = String(transcription?.text || '').trim();
    if (text) {
      console.log('[STT/Groq] Transcribed via fallback.');
      return text;
    }
  } catch (err) {
    console.error('[STT/Groq] Error:', err.message);
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch (_) {}
  }

  return null;
}

// ─── TTS SYSTEM (Groq primary) ──────────────────────────────────────────────────

async function initTTSSystem() {
  const isWin = process.platform === 'win32';
  const isTermux = process.platform === 'linux' && (
    String(process.env.PREFIX || '').includes('com.termux') ||
    !!process.env.TERMUX_VERSION ||
    !!process.env.ANDROID_ROOT
  );

  if (isWin) {
    console.log('[TTS] Primary engine: Windows System.Speech');
  } else if (isTermux) {
    console.log('[TTS] Platform detected: Termux/Linux -> Edge TTS fallback enabled.');
  } else {
    console.log('[TTS] Non-Windows platform detected -> Edge TTS fallback enabled.');
  }
}

function isGroqTermsError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('model_terms_required') || msg.includes('requires terms acceptance');
}

/**
 * Server-side TTS via Groq
 */
async function synthesizeSpeech(text, emotion = 'neutral') {
  const input = String(text || '').trim().slice(0, CONFIG.TTS_MAX_INPUT_CHARS);
  if (!input) return null;

  if (!CONFIG.TTS_USE_SYSTEM) return null;

  try {
    const localSpeech = await tts.synthesizeWithEmotion(input, emotion);
    if (localSpeech?.audioBase64) {
      console.log('[System TTS] Synthesized local WAV.');
      return localSpeech;
    }
  } catch (err) {
    console.error('[System TTS] Error:', err.message);
  }

  return null;
}

// ─── SOCKET.IO MAIN LOGIC ──────────────────────────────────────────────────────
const silenceTimers = {};
const audioWindowTimers = {};
const audioChunks = {};
const audioSessions = {};

function emitIdleState(socket) {
  const baseEmotion = resolveEmotion(DEFAULT_BASE_EMOTION, 'happy');
  socket.emit('pino_state', {
    state: 'idle',
    emotion: baseEmotion,
    ...(EMOTION_STATES[baseEmotion] || EMOTION_STATES['happy'])
  });
}

async function emitNoSpeechDetected(socket, reason = 'unknown') {
  const promptText = "I didn't catch that clearly. Please say it again.";
  const actionMeta = getActionMeta('tilt_head', 'concerned');
  let speech = null;
  try {
    speech = await synthesizeSpeech(promptText, 'concerned');
  } catch (err) {
    console.error('[TTS/no-speech] Error:', err.message);
  }

  socket.emit('pino_state', { state: 'speaking', ...EMOTION_STATES.concerned });
  socket.emit('pino_response', {
    text: promptText,
    emotion: 'concerned',
    action: actionMeta.name,
    actionMeta,
    source: 'voice',
    userEmotion: 'neutral',
    uiState: EMOTION_STATES.concerned,
    sttReason: reason,
    ttsAudioBase64: speech?.audioBase64 || null,
    ttsFormat: speech?.format || null
  });
  scheduleIdleState(socket, promptText);
}

function scheduleIdleState(socket, responseText = '') {
  const waitMs = Math.max(3000, String(responseText || '').length * 60);
  setTimeout(() => emitIdleState(socket), waitMs);
}

function clearAudioTimers(socketId) {
  clearTimeout(silenceTimers[socketId]);
  clearTimeout(audioWindowTimers[socketId]);
  silenceTimers[socketId] = null;
  audioWindowTimers[socketId] = null;
}

async function flushAudioInput(socket, reason = 'silence') {
  const socketId = socket.id;
  const session = audioSessions[socketId];
  if (!session || session.processing) return;

  session.processing = true;
  clearAudioTimers(socketId);

  try {
    const chunks = audioChunks[socketId] || [];
    audioChunks[socketId] = [];

    if (!chunks.length) {
      emitIdleState(socket);
      return;
    }

    const combined = Buffer.concat(chunks);
    if (combined.length < CONFIG.AUDIO_MIN_BYTES) {
      console.log(`[Audio] Ignored short input (${combined.length} bytes, reason=${reason})`);
      emitIdleState(socket);
      return;
    }

    socket.emit('pino_state', { state: 'thinking', ...EMOTION_STATES['thinking'] });
    const transcript = await transcribeAudio(combined);

    if (!transcript || !transcript.trim()) {
      console.log(`[Audio] Empty transcript (reason=${reason})`);
      emitIdleState(socket);
      return;
    }

    console.log(`[Whisper] ${transcript}`);
    socket.emit('transcript', { text: transcript });
    await processUserInput(socket, transcript, 'voice');
  } catch (err) {
    console.error('[Audio] Flush error:', err.message);
    emitIdleState(socket);
  } finally {
    audioSessions[socketId] = { processing: false };
  }
}

io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`);
  const modelInfo = stt.getModelInfo();
  socket.emit('stt_status', {
    voskAvailable: !!modelInfo?.voskAvailable,
    modelExists: !!modelInfo?.modelExists,
    groqFallbackEnabled: !!CONFIG.STT_USE_GROQ_FALLBACK
  });
  
  // Init audio buffer
  audioChunks[socket.id] = [];
  audioSessions[socket.id] = { processing: false };
  
  // ── Send initial state
  emitIdleState(socket);

  // ── Text input (from browser mic transcript or typed)
  socket.on('user_text', async (data) => {
    const text = data.text?.trim();
    if (!text) return;

    console.log(`[User ${socket.id}] ${text}`);

    // Reset silence timer
    clearTimeout(silenceTimers[socket.id]);
    
    // Show listening state
    socket.emit('pino_state', { state: 'listening', ...EMOTION_STATES['listening'] });

    // 3-second silence buffer before processing
    silenceTimers[socket.id] = setTimeout(async () => {
      await processUserInput(socket, text);
    }, CONFIG.SILENCE_BUFFER_MS);
  });

  // ── Audio chunk (raw audio from browser)
  socket.on('audio_chunk', (chunk) => {
    const session = audioSessions[socket.id] || { processing: false };
    if (session.processing) return;

    if (!audioChunks[socket.id]) audioChunks[socket.id] = [];
    audioChunks[socket.id].push(Buffer.from(chunk));

    clearTimeout(silenceTimers[socket.id]);
    silenceTimers[socket.id] = setTimeout(() => {
      flushAudioInput(socket, 'silence');
    }, CONFIG.SILENCE_BUFFER_MS);

    if (!audioWindowTimers[socket.id]) {
      audioWindowTimers[socket.id] = setTimeout(() => {
        flushAudioInput(socket, 'max-window');
      }, CONFIG.AUDIO_MAX_WINDOW_MS);
    }

    audioSessions[socket.id] = session;
  });

  // ── Direct message (typed input)
  socket.on('audio_chunk_final', async (buffer) => {
    try {
      const audioBuffer = Buffer.from(buffer);
      if (audioBuffer.length < CONFIG.AUDIO_MIN_BYTES) {
        emitIdleState(socket);
        return;
      }

      socket.emit('pino_state', { state: 'thinking', ...EMOTION_STATES['thinking'] });
      const transcript = await transcribeAudio(audioBuffer, 'audio/webm');

      if (transcript && transcript.trim()) {
        socket.emit('transcript', { text: transcript });
        await processUserInput(socket, transcript, 'voice');
      } else {
        emitIdleState(socket);
      }
    } catch (err) {
      console.error('[Audio/final] Error:', err.message);
      emitIdleState(socket);
    }
  });

  socket.on('audio_blob', async (data) => {
    const audioBase64 = data?.audioBase64;
    const mimeType = data?.mimeType || 'audio/webm';
    if (!audioBase64 || typeof audioBase64 !== 'string') {
      emitIdleState(socket);
      return;
    }

    clearAudioTimers(socket.id);
    audioChunks[socket.id] = [];
    audioSessions[socket.id] = { processing: false };

    try {
      const buffer = Buffer.from(audioBase64, 'base64');
      if (buffer.length < CONFIG.AUDIO_MIN_BYTES) {
        console.log(`[Audio] Ignored short blob (${buffer.length} bytes, reason=${data?.reason || 'blob'})`);
        emitIdleState(socket);
        return;
      }

      socket.emit('pino_state', { state: 'thinking', ...EMOTION_STATES['thinking'] });
      const transcript = await transcribeAudio(buffer, mimeType);

      if (!transcript || !transcript.trim()) {
        console.log(`[Audio] Empty transcript (reason=${data?.reason || 'blob'})`);
        emitIdleState(socket);
        return;
      }

      console.log(`[Whisper] ${transcript}`);
      socket.emit('transcript', { text: transcript });
      await processUserInput(socket, transcript, 'voice');
    } catch (err) {
      console.error('[Audio/blob] Error:', err.message);
      emitIdleState(socket);
    }
  });
  socket.on('audio_end', () => {
    flushAudioInput(socket, 'client-silence');
  });

  socket.on('send_message', async (data) => {
    const text = data.text?.trim();
    if (!text) return;
    clearAudioTimers(socket.id);
    audioChunks[socket.id] = [];
    audioSessions[socket.id] = { processing: false };
    await processUserInput(socket, text, 'text');
  });

  // ── Disconnect cleanup
  socket.on('disconnect', () => {
    console.log(`[-] Client disconnected: ${socket.id}`);
    clearAudioTimers(socket.id);
    delete conversationHistory[socket.id];
    delete audioChunks[socket.id];
    delete silenceTimers[socket.id];
    delete audioWindowTimers[socket.id];
    delete audioSessions[socket.id];
  });
});

// ─── CORE PROCESSING PIPELINE ──────────────────────────────────────────────────
async function processUserInput(socket, text, source = 'text') {
  try {
    // 1. Check for device commands
    const command = detectCommand(text);
    if (command) {
      handleGPIO(command, socket);
      socket.emit('pino_state', { state: 'speaking', ...EMOTION_STATES['speaking'] });
      const commandTextRaw = `[EMOTION:happy] Sige! ${command.state === 'on' ? 'Ini-on' : 'Pinatayin'} ko na ang ${command.device}!`;
      const commandText = parseAssistantResponse(commandTextRaw).cleanText || commandTextRaw;
      const commandSpeech = await synthesizeSpeech(commandText);
      const actionMeta = getActionMeta('hands', 'happy');
      socket.emit('pino_response', {
        text: commandText,
        emotion: 'happy',
        action: actionMeta.name,
        actionMeta,
        command,
        heardText: text,
        source,
        ttsAudioBase64: commandSpeech?.audioBase64 || null,
        ttsFormat: commandSpeech?.format || null
      });
      scheduleIdleState(socket, commandText);
      return;
    }

    // 2. Emotion analysis (NIM or fallback)
    socket.emit('pino_state', { state: 'thinking', ...EMOTION_STATES['thinking'] });
    let detectedEmotion = 'neutral';
    try {
      detectedEmotion = await analyzeEmotionWithNIM(text);
    } catch (err) {
      console.log('[Emotion] Fallback to keyword detection:', err.message);
      detectedEmotion = detectEmotionByKeyword(text);
    }
    detectedEmotion = resolveEmotion(detectedEmotion, DEFAULT_BASE_EMOTION);
    console.log(`[Emotion] ${detectedEmotion}`);

    // 3. Get Pino's LLM response
    let rawResponse = '';
    try {
      rawResponse = await getPinoResponse(socket.id, text, detectedEmotion);
    } catch (err) {
      console.error('[LLM] Error:', err.message);
      rawResponse = `[EMOTION:concerned] Ay, may problema akong na-encounter. Sandali lang, try ulit tayo!`;
    }

    const {
      emotion: responseEmotion,
      action: responseAction,
      gpioCommand: aiGpioCommand,
      cleanText
    } = parseAssistantResponse(rawResponse);
    const englishText = sanitizeVisibleResponseText(cleanText);
    
    const finalEmotion = resolveEmotion(responseEmotion, detectedEmotion);
    const uiState = EMOTION_STATES[finalEmotion] || EMOTION_STATES['neutral'];
    const greetingAction = detectGreetingAction(text);
    const action = greetingAction || normalizeAction(responseAction) || getDefaultActionByEmotion(finalEmotion);
    const actionMeta = getActionMeta(action, finalEmotion);

    // Execute model-issued GPIO command silently (do not speak or print raw JSON).
    if (aiGpioCommand) {
      handleGPIO(aiGpioCommand, socket);
    }
    
    // 4. Generate TTS
    let speech = null;
    try {
      speech = await synthesizeSpeech(englishText, finalEmotion);
    } catch (err) {
      console.error('[TTS] Error:', err.message);
      // Continue without TTS - client will use Web Speech API
    }

    // 5. Send response to frontend
    socket.emit('pino_state', { state: 'speaking', ...uiState });
    socket.emit('pino_response', {
      text: englishText,
      emotion: finalEmotion,
      action: actionMeta.name,
      actionMeta,
      command: aiGpioCommand || null,
      heardText: text,
      source,
      userEmotion: detectedEmotion,
      uiState,
      ttsAudioBase64: speech?.audioBase64 || null,
      ttsFormat: speech?.format || null
    });

    console.log(`[PINO] (${finalEmotion}) ${englishText}`);

    // 6. Return to idle after speaking
    // IMPORTANT: do NOT force idle too early, otherwise frontend may resume
    // listening while TTS is still playing and cut speech playback.
    scheduleIdleState(socket, englishText);
    
  } catch (err) {
    console.error('[Process] Critical error:', err.message);
    // Always recover to listening state
    socket.emit('pino_state', { state: 'listening', emotion: DEFAULT_BASE_EMOTION, ...EMOTION_STATES['listening'] });
    const actionMeta = getActionMeta('tilt_head', 'concerned');
    const fallbackTextRaw = '[EMOTION:concerned] Ay, may problema akong na-encounter. Sandali lang, try ulit tayo!';
    const fallbackText = parseAssistantResponse(fallbackTextRaw).cleanText || fallbackTextRaw;
    socket.emit('pino_response', {
      text: fallbackText,
      emotion: 'concerned',
      action: actionMeta.name,
      actionMeta,
      heardText: text,
      source,
      ttsAudioBase64: null,
      ttsFormat: null
    });
    scheduleIdleState(socket, fallbackText);
  }
}

// ─── API ROUTES ────────────────────────────────────────────────────────────────
app.post('/api/transcribe', async (req, res) => {
  const { audioBase64, mimeType } = req.body;
  if (!audioBase64) return res.status(400).json({ error: 'No audio data' });

  const buffer = Buffer.from(audioBase64, 'base64');
  const text = await transcribeAudio(buffer, mimeType);
  res.json({ text });
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'online', name: 'PINO', version: '1.0.0' });
});

// ─── START SERVER ──────────────────────────────────────────────────────────────
async function startServer() {
  // Initialize TTS system
  await initTTSSystem();
  
  server.listen(CONFIG.PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════╗
║   🤖 PINO AI Robot Server v1.0       ║
║   Port: ${CONFIG.PORT}                         ║
║   Open: http://localhost:${CONFIG.PORT}         ║
╚══════════════════════════════════════╝
    `);
  });
}

startServer().catch(console.error);
