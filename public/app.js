/**
 * PINO Robot - Frontend App (Auto Mode)
 * app.js: Socket.io client, auto mic handling, eye animations, TTS
 */

const AUTO_MODE = true;
const USE_BROWSER_TTS_ONLY = false;
let preferBrowserSTT = false;
const IS_MOBILE = /android|iphone|ipad|ipod/i.test(navigator.userAgent || '');

// --- SOCKET CONNECTION ---
const socket = io({
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 800,
  reconnectionDelayMax: 4000,
  timeout: 10000
});

// --- DOM REFS ---
const $ = (id) => document.getElementById(id);
const statusDot = $('statusDot');
const statusLabel = $('statusLabel');
const emotionLabel = $('emotionLabel');
const statusChip = $('statusChip');
const guideOverlay = $('guideOverlay');
const guideClose = $('guideClose');
const bubbleText = $('bubbleText');
const bubbleState = $('bubbleState');
const transcriptText = $('transcriptText');
const speechBubble = $('speechBubble');
const mouthPath = $('mouthPath');
const mouthAsciiCenter = $('mouthAsciiCenter');
const mouthWave = $('mouthWave');
const signalBars = $('signalBars');
const facePanel = $('facePanel');
const btnMic = $('btnMic');
const micLabel = $('micLabel');
const textInput = $('textInput');
const btnSend = $('btnSend');
const actionFx = $('actionFx');
const actionFxLeft = $('actionFxLeft');
const actionFxRight = $('actionFxRight');

function updateViewportMode() {
  const isLandscape = window.matchMedia('(orientation: landscape)').matches;
  document.body.classList.toggle('mobile-device', IS_MOBILE);
  document.body.classList.toggle('mobile-landscape', IS_MOBILE && isLandscape);
}

// --- STATE ---
let shouldStreamAudio = true;
let blinkInterval = null;
let currentEmotion = 'neutral';
let speakInterval = null;
let canRetryMicOnUserGesture = false;
let activeTTSAudio = null;
let ttsUnlocked = false;
let pendingTTSJob = null;
let waitingForTTSUnlock = false;
let thinkingFallbackTimer = null;
let responseTypingInterval = null;
let vad = null;
let speechRec = null;
let speechRecRunning = false;
let speechBusy = false;
let lastSpeechText = '';
let lastSpeechAt = 0;
let speechRecDebounceTimer = null;
let pendingSpeechText = '';
let activeInputMode = 'unknown';
let activeSpeechToken = 0;
let lastTTSResponseSignature = '';
let lastTTSResponseAt = 0;
let ttsPlaybackActive = false;
let thinkingFxEnterTimer = null;
let thinkingFxExitTimer = null;
let actionFxTimer = null;
let activeActionClass = '';
let actionLabelRestoreTimer = null;
let holdSpeakingHands = false;
let waitingForTTSFinish = false;

const MOUTH_SHAPES = {
  neutral: 'M 16 22 Q 60 22 104 22',
  happy: 'M 18 24 Q 60 14 102 24',
  sad: 'M 18 18 Q 60 30 102 18',
  excited: 'M 16 25 Q 60 10 104 25',
  thinking: 'M 22 22 Q 60 20 98 22',
  concerned: 'M 20 23 Q 60 18 100 23',
  angry: 'M 18 21 Q 60 28 102 21',
  frustrated: 'M 18 23 Q 60 27 102 23',
  speaking: 'M 20 16 Q 60 31 100 16',
  listening: 'M 18 22 Q 60 21 102 22',
  idle: 'M 16 22 Q 60 22 104 22'
};

const MOUTH_ASCII_CENTER = {
  neutral: 'u',
  happy: 'u',
  sad: 'u',
  excited: 'u',
  thinking: 'u',
  concerned: 'u',
  angry: 'u',
  frustrated: 'u',
  speaking: 'o',
  listening: 'u',
  idle: 'u'
};

function randomizeMouthWave() {
  if (!mouthWave) return;
  const bars = mouthWave.querySelectorAll('.bar');
  bars.forEach((bar) => {
    bar.style.animationDuration = `${Math.random() * (0.7 - 0.2) + 0.2}s`;
  });
}

function initMouthWave() {
  if (!mouthWave) return;
  if (mouthWave.childElementCount > 0) {
    randomizeMouthWave();
    return;
  }

  const BAR_COUNT = 25;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < BAR_COUNT; i += 1) {
    const bar = document.createElement('div');
    bar.className = 'bar';
    frag.appendChild(bar);
  }
  mouthWave.appendChild(frag);
  randomizeMouthWave();
}

function startBlink() {
  stopBlink();
  const doBlink = (durationMs = 180) => {
    document.body.classList.add('is-blinking');
    setTimeout(() => {
      document.body.classList.remove('is-blinking');
    }, durationMs);
  };

  const scheduleNext = () => {
    const delay = 1700 + Math.random() * 2200;
    blinkInterval = setTimeout(() => {
      doBlink();
      // Occasional quick double-blink.
      if (Math.random() < 0.22) {
        setTimeout(() => doBlink(130), 170);
      }
      scheduleNext();
    }, delay);
  };

  scheduleNext();
}

function stopBlink() {
  if (blinkInterval) clearTimeout(blinkInterval);
  blinkInterval = null;
  document.body.classList.remove('is-blinking');
}

function setGuideOpen(open) {
  if (!guideOverlay) return;
  guideOverlay.classList.toggle('open', !!open);
  guideOverlay.setAttribute('aria-hidden', open ? 'false' : 'true');
}

document.addEventListener('mousemove', (e) => {
  const irisLeft = $('irisLeft');
  const irisRight = $('irisRight');
  const eyeLeftEl = $('eyeLeft');
  const eyeRightEl = $('eyeRight');
  if (!irisLeft || !irisRight || !eyeLeftEl || !eyeRightEl) return;

  if (currentEmotion === 'thinking' || currentEmotion === 'speaking') return;

  const eyeLeft = eyeLeftEl.getBoundingClientRect();
  const eyeRight = eyeRightEl.getBoundingClientRect();

  const getOffset = (eyeRect, mouseX, mouseY) => {
    const cx = eyeRect.left + eyeRect.width / 2;
    const cy = eyeRect.top + eyeRect.height / 2;
    const dx = mouseX - cx;
    const dy = mouseY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxMove = 8;
    const scale = Math.min(dist / 60, 1);
    return { x: (dx / dist || 0) * maxMove * scale, y: (dy / dist || 0) * maxMove * scale };
  };

  const oL = getOffset(eyeLeft, e.clientX, e.clientY);
  const oR = getOffset(eyeRight, e.clientX, e.clientY);

  irisLeft.style.transform = `translate(${oL.x}px, ${oL.y}px)`;
  irisRight.style.transform = `translate(${oR.x}px, ${oR.y}px)`;
});

function applyEmotionState(state, emotion) {
  currentEmotion = emotion || state;

  const bodyState = emotion === 'frustrated' ? 'angry' : (emotion || state);
  const removable = [];
  document.body.classList.forEach((cls) => {
    if (cls.startsWith('state-')) removable.push(cls);
  });
  removable.forEach((cls) => document.body.classList.remove(cls));
  document.body.classList.add(`state-${bodyState}`);
  document.body.classList.toggle('is-speaking', state === 'speaking');
  document.body.classList.toggle('is-thinking', state === 'thinking');
  document.body.classList.toggle('is-listening', state === 'listening');

  const stateText = String(state || 'idle').toLowerCase() === 'thinking'
    ? 'PROCESSING'
    : String(state || 'idle').toUpperCase();

  if (statusLabel) statusLabel.textContent = stateText;
  if (emotionLabel) emotionLabel.textContent = (emotion || state || 'neutral').toUpperCase();
  if (bubbleState) {
    const label = stateText;
    bubbleState.textContent = `PINO ${label}`;
  }

  const shape = MOUTH_SHAPES[emotion] || MOUTH_SHAPES[state] || MOUTH_SHAPES.neutral;
  animateMouth(shape);
  if (mouthAsciiCenter) {
    mouthAsciiCenter.textContent = MOUTH_ASCII_CENTER[emotion] || MOUTH_ASCII_CENTER[state] || MOUTH_ASCII_CENTER.neutral;
  }

  if (signalBars) {
    const activeStates = ['listening', 'speaking'];
    signalBars.classList.toggle('active', activeStates.includes(state));
  }

  if (statusDot) {
    statusDot.style.background = getComputedStyle(document.documentElement).getPropertyValue('--eye-color') || '#00f5ff';
    statusDot.style.boxShadow = `0 0 8px ${statusDot.style.background}`;
  }
  if (speechBubble) {
    speechBubble.classList.toggle('thinking', state === 'thinking');
  }
}

function clearThinkingFallback() {
  if (!thinkingFallbackTimer) return;
  clearTimeout(thinkingFallbackTimer);
  thinkingFallbackTimer = null;
}

function startThinkingFx() {
  if (thinkingFxExitTimer) {
    clearTimeout(thinkingFxExitTimer);
    thinkingFxExitTimer = null;
  }
  if (thinkingFxEnterTimer) {
    clearTimeout(thinkingFxEnterTimer);
    thinkingFxEnterTimer = null;
  }
  document.body.classList.add('thinking-transition');
  document.body.classList.remove('thinking-typing-active');
  document.body.classList.remove('response-pop');

  thinkingFxEnterTimer = setTimeout(() => {
    if (!document.body.classList.contains('is-thinking')) return;
    document.body.classList.add('thinking-typing-active');
  }, 220);
}

function stopThinkingFx(withPop = false, onDone = null) {
  if (thinkingFxEnterTimer) {
    clearTimeout(thinkingFxEnterTimer);
    thinkingFxEnterTimer = null;
  }
  const wasTyping = document.body.classList.contains('thinking-typing-active');
  if (wasTyping) {
    document.body.classList.add('thinking-typing-exit');
    setTimeout(() => {
      document.body.classList.remove('thinking-typing-active');
      document.body.classList.remove('thinking-typing-exit');
      if (typeof onDone === 'function') onDone();
    }, 280);
  } else {
    document.body.classList.remove('thinking-typing-active');
    document.body.classList.remove('thinking-typing-exit');
    if (typeof onDone === 'function') onDone();
  }
  document.body.classList.remove('thinking-transition');

  if (withPop) {
    document.body.classList.add('response-pop');
    if (thinkingFxExitTimer) clearTimeout(thinkingFxExitTimer);
    thinkingFxExitTimer = setTimeout(() => {
      document.body.classList.remove('response-pop');
      thinkingFxExitTimer = null;
    }, 420);
  } else {
    document.body.classList.remove('response-pop');
  }
}

function enterThinkingState(reason = 'unknown') {
  applyEmotionState('thinking', 'thinking');
  startThinkingFx();
  clearThinkingFallback();
  thinkingFallbackTimer = setTimeout(() => {
    if (waitingForTTSUnlock) return;
    if (currentEmotion === 'thinking') {
      console.log(`[UI] Thinking fallback -> listening (${reason})`);
      stopThinkingFx(false, () => applyEmotionState('listening', 'listening'));
    }
  }, 6500);
}

function animateMouth(targetD) {
  if (mouthPath) mouthPath.setAttribute('d', targetD);
}

function startSpeakingMouth() {
  if (speakInterval) return;
  randomizeMouthWave();
  const frames = [
    'M 16 16 Q 60 36 104 16',
    'M 20 13 Q 60 28 100 13',
    'M 23 20 Q 60 26 97 20',
    'M 18 18 Q 60 34 102 18',
    'M 26 21 Q 60 24 94 21'
  ];
  let idx = 0;
  const asciiFrames = ['o', 'O', 'o', 'u', 'o'];
  speakInterval = setInterval(() => {
    idx = (idx + 1) % frames.length;
    if (mouthPath) mouthPath.setAttribute('d', frames[idx]);
    if (mouthAsciiCenter) mouthAsciiCenter.textContent = asciiFrames[idx % asciiFrames.length];
  }, 120);
}

function stopSpeakingMouth() {
  if (!speakInterval) return;
  clearInterval(speakInterval);
  speakInterval = null;
  animateMouth(MOUTH_SHAPES[currentEmotion] || MOUTH_SHAPES.neutral);
  if (mouthAsciiCenter) {
    mouthAsciiCenter.textContent = MOUTH_ASCII_CENTER[currentEmotion] || MOUTH_ASCII_CENTER.neutral;
  }
}

function displayResponse(text) {
  if (!bubbleText) return;
  if (responseTypingInterval) {
    clearInterval(responseTypingInterval);
    responseTypingInterval = null;
  }
  bubbleText.textContent = '';

  let i = 0;
  responseTypingInterval = setInterval(() => {
    if (i < text.length) {
      bubbleText.textContent += text[i++];
      return;
    }
    clearInterval(responseTypingInterval);
    responseTypingInterval = null;
  }, 28);
}

function sanitizeActionName(action = '') {
  return String(action || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
}

function actionFromEmotion(emotion = 'neutral') {
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

function actionIcon(action = '') {
  const icons = {
    wave: '\u{1F44B}',
    hands: '\u{1F91A}',
    hands_clasp: '\u{1F932}',
    nod: '\u{1F642}',
    sad_look: '\u{1F614}',
    clap: '\u{1F91A}',
    tilt_head: '\u{1F914}'
  };
  return icons[action] || '';
}
function clearActionFxElements() {
  holdSpeakingHands = false;
  [actionFx, actionFxLeft, actionFxRight].forEach((el) => {
    if (!el) return;
    el.classList.remove('active', 'hand-wave', 'hand-float', 'hand-clasp');
    el.textContent = '';
  });
}
function clearActionFxNow() {
  if (actionFxTimer) {
    clearTimeout(actionFxTimer);
    actionFxTimer = null;
  }
  if (activeActionClass) {
    document.body.classList.remove(activeActionClass);
    activeActionClass = '';
  }
  clearActionFxElements();
}
function setActionFx(el, icon, extraClass = '') {
  if (!el) return;
  el.textContent = icon || '';
  if (extraClass) el.classList.add(extraClass);
  el.classList.add('active');
}
function showSpeakingHands() {
  if (!actionFxLeft && !actionFxRight && !actionFx) return;
  if (activeActionClass) {
    document.body.classList.remove(activeActionClass);
    activeActionClass = '';
  }
  clearActionFxElements();
  holdSpeakingHands = true;
  activeActionClass = 'action-hands';
  document.body.classList.add(activeActionClass);
  setActionFx(actionFxLeft || actionFx, '\u{1F91A}', 'hand-float');
  setActionFx(actionFxRight || actionFx, '\u{1F91A}', 'hand-float');
}

function getActionProfile(actionMeta = {}, emotion = 'neutral') {
  const name = sanitizeActionName(actionMeta?.name || actionMeta?.action || '') || actionFromEmotion(emotion);
  const durationMs = Math.max(700, Math.min(2200, Number(actionMeta?.durationMs) || 1200));
  const intensityRaw = Number(actionMeta?.intensity);
  const intensity = Number.isFinite(intensityRaw) ? Math.max(0.35, Math.min(1.25, intensityRaw)) : 0.8;
  return { name, durationMs, intensity };
}

function playActionFx(action, emotion = 'neutral', actionMeta = null) {
  if (!actionFx && !actionFxLeft && !actionFxRight) return;

  const profile = getActionProfile(
    actionMeta || { name: action },
    emotion
  );
  const finalAction = profile.name;
  const icon = actionIcon(finalAction);

  if (activeActionClass) {
    document.body.classList.remove(activeActionClass);
    activeActionClass = '';
  }

  if (!icon && !['wave', 'hands', 'hands_clasp', 'clap'].includes(finalAction)) {
    clearActionFxElements();
    return;
  }

  activeActionClass = `action-${finalAction}`;
  document.body.style.setProperty('--action-intensity', String(profile.intensity));
  document.body.classList.add(activeActionClass);
  clearActionFxElements();

  if (finalAction === 'wave') {
    setActionFx(actionFxRight || actionFx, '\u{1F44B}', 'hand-wave');
  } else if (finalAction === 'hands') {
    setActionFx(actionFxLeft || actionFx, '\u{1F91A}', 'hand-float');
    setActionFx(actionFxRight || actionFx, '\u{1F91A}', 'hand-float');
  } else if (finalAction === 'hands_clasp') {
    setActionFx(actionFxLeft || actionFx, '\u{1F91A}', 'hand-clasp');
    setActionFx(actionFxRight || actionFx, '\u{1F91A}', 'hand-clasp');
  } else if (finalAction === 'clap') {
    setActionFx(actionFxLeft || actionFx, '\u{1F91A}', 'hand-float');
    setActionFx(actionFxRight || actionFx, '\u{1F91A}', 'hand-float');
  } else {
    setActionFx(actionFx, icon);
  }

  if (emotionLabel) {
    emotionLabel.textContent = `${String(emotion || 'neutral').toUpperCase()} • ${finalAction.toUpperCase()}`;
    if (actionLabelRestoreTimer) clearTimeout(actionLabelRestoreTimer);
    actionLabelRestoreTimer = setTimeout(() => {
      emotionLabel.textContent = String(currentEmotion || emotion || 'neutral').toUpperCase();
    }, Math.max(900, profile.durationMs));
  }

  if (actionFxTimer) clearTimeout(actionFxTimer);
  const keepWhileSpeaking = finalAction === 'hands' && document.body.classList.contains('is-speaking');
  if (keepWhileSpeaking) {
    holdSpeakingHands = true;
    return;
  }
  actionFxTimer = setTimeout(() => {
    if (holdSpeakingHands && document.body.classList.contains('is-speaking')) return;
    clearActionFxElements();
    if (activeActionClass) {
      document.body.classList.remove(activeActionClass);
      activeActionClass = '';
    }
  }, profile.durationMs);
}

function pauseAudioStreaming() {
  shouldStreamAudio = false;
  speechBusy = true;
  if (vad) vad.pause();
  if (speechRec && speechRecRunning) {
    try { speechRec.stop(); } catch (_) {}
    speechRecRunning = false;
  }
}

function resumeAudioStreaming() {
  shouldStreamAudio = true;
  speechBusy = false;
  if (vad) vad.resume();
  if (speechRec && !speechRecRunning) {
    try {
      speechRec.start();
      speechRecRunning = true;
    } catch (_) {}
  }
  if (micLabel) {
    micLabel.textContent = activeInputMode === 'browser'
      ? 'AUTO-LISTEN (BROWSER STT)'
      : 'AUTO-LISTEN (VOSK TL-PH)';
  }
}

function initBrowserSTT() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;

  if (!speechRec) {
    speechRec = new SR();
    speechRec.lang = 'tl-PH';
    speechRec.interimResults = false;
    speechRec.continuous = false;

    speechRec.onstart = () => {
      speechRecRunning = true;
      applyEmotionState('listening', 'listening');
      if (micLabel) micLabel.textContent = 'LISTENING... (BROWSER STT)';
    };

    speechRec.onresult = (event) => {
      if (!shouldStreamAudio || speechBusy) return;

      const last = event.results[event.results.length - 1];
      if (!last || !last[0]) return;
      if (last.isFinal === false) return;
      const text = String(last[0].transcript || '').trim();
      if (!text || text.length < 3) return;

      const now = Date.now();
      if (text.toLowerCase() === lastSpeechText && (now - lastSpeechAt) < 3000) {
        return;
      }
      lastSpeechText = text.toLowerCase();
      lastSpeechAt = now;

      if (transcriptText) transcriptText.textContent = text;
      pendingSpeechText = text;
      clearTimeout(speechRecDebounceTimer);
      speechRecDebounceTimer = setTimeout(() => {
        const finalText = String(pendingSpeechText || '').trim();
        if (!finalText) return;
        pauseAudioStreaming();
        enterThinkingState('browser-stt');
        if (micLabel) micLabel.textContent = 'PROCESSING...';
        socket.emit('send_message', { text: finalText });
        pendingSpeechText = '';
      }, 1100);
    };

    speechRec.onend = () => {
      speechRecRunning = false;
      if (!AUTO_MODE || !shouldStreamAudio) return;
      setTimeout(() => {
        if (!shouldStreamAudio) return;
        try {
          speechRec.start();
          speechRecRunning = true;
        } catch (_) {}
      }, 2300);
    };

    speechRec.onerror = () => {
      speechRecRunning = false;
    };
  }

  try {
    speechRec.start();
    speechRecRunning = true;
    return true;
  } catch (_) {
    return false;
  }
}

function stopActiveTTSAudio() {
  activeSpeechToken += 1;
  ttsPlaybackActive = false;
  try {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  } catch (_) {}
  if (!activeTTSAudio) return;
  try {
    if (typeof activeTTSAudio.pause === 'function') {
      activeTTSAudio.pause();
    }
  } catch (_) {}
  try {
    if (typeof activeTTSAudio.src === 'string') {
      activeTTSAudio.src = '';
    }
  } catch (_) {}
  activeTTSAudio = null;
}

function runPendingTTSIfAny() {
  if (!pendingTTSJob) return;
  const job = pendingTTSJob;
  pendingTTSJob = null;
  waitingForTTSUnlock = false;
  // Must run immediately within user gesture callstack to satisfy autoplay policy.
  playGroqTTS(job.audioBase64, job.format, job.onDone, job.fallbackText);
}

function speakTextFallback(text, onDone) {
  try {
    const clean = String(text || '').trim();
    if (!clean) {
      if (typeof onDone === 'function') onDone();
      return;
    }

    const finish = () => {
      if (typeof onDone === 'function') onDone();
    };

    speakTextFallbackBrowser(clean, finish);
  } catch (_) {
    if (typeof onDone === 'function') onDone();
  }
}

function speakTextFallbackBrowser(clean, onDone) {
  try {
    if (!('speechSynthesis' in window)) {
      if (typeof onDone === 'function') onDone();
      return;
    }

    const utter = new SpeechSynthesisUtterance(clean);
    utter.lang = 'en-US';
    utter.rate = 0.9;
    utter.pitch = 1;

    const voices = window.speechSynthesis.getVoices?.() || [];
    const preferred = voices.find((v) => /^en(-|_)us$/i.test(v.lang))
      || voices.find((v) => /^en(-|_)/i.test(v.lang))
      || voices.find((v) => /^fil(-|_)ph$/i.test(v.lang))
      || voices.find((v) => /^tl(-|_)ph$/i.test(v.lang));
    if (preferred) {
      utter.voice = preferred;
      utter.lang = preferred.lang || utter.lang;
    }

    utter.onend = () => {
      if (typeof onDone === 'function') onDone();
    };
    utter.onerror = () => {
      if (typeof onDone === 'function') onDone();
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utter);
  } catch (_) {
    if (typeof onDone === 'function') onDone();
  }
}

function playGroqTTS(audioBase64, format = 'wav', onDone, fallbackText = '') {
  // Hard single-speaker rule: stop previous speech before starting new.
  stopActiveTTSAudio();
  const speechToken = ++activeSpeechToken;
  const runOnDone = () => {
    if (speechToken !== activeSpeechToken) return;
    if (typeof onDone === 'function') onDone();
  };

  if (!ttsUnlocked) {
    // Keep a single pending job and avoid speaking fallback now,
    // otherwise it can speak once now and again after user gesture.
    pendingTTSJob = { audioBase64, format, onDone: runOnDone, fallbackText };
    waitingForTTSUnlock = true;
    if (micLabel) micLabel.textContent = 'TAP SCREEN TO ENABLE AUDIO';
    enterThinkingState('waiting-user-audio-gesture');
    return;
  }

  if (USE_BROWSER_TTS_ONLY) {
    pauseAudioStreaming();
    ttsPlaybackActive = true;
    stopSpeakingMouth();
    speakTextFallback(fallbackText, () => {
      if (speechToken !== activeSpeechToken) return;
      ttsPlaybackActive = false;
      runOnDone();
      resumeAudioStreaming();
      clearActionFxNow();
      applyEmotionState('listening', 'listening');
      if (micLabel) micLabel.textContent = 'AUTO-LISTEN (BROWSER STT)';
    });
    return;
  }

  pauseAudioStreaming();

  if (!audioBase64) {
    ttsPlaybackActive = true;
    stopSpeakingMouth();
    speakTextFallback(fallbackText, () => {
      if (speechToken !== activeSpeechToken) return;
      ttsPlaybackActive = false;
      runOnDone();
      // IMPORTANT: Resume streaming and go back to listening
      resumeAudioStreaming();
      clearActionFxNow();
      applyEmotionState('listening', 'listening');
      if (micLabel) micLabel.textContent = 'AUTO-LISTEN (VOSK TL-PH)';
    });
    return;
  }

  const mime = format && typeof format === 'string' ? format.toLowerCase() : 'wav';
  const mimeTypeMap = {
    mp3: 'audio/mpeg',
    mpeg: 'audio/mpeg',
    wav: 'audio/wav',
    webm: 'audio/webm',
    ogg: 'audio/ogg'
  };
  const contentType = mimeTypeMap[mime] || `audio/${mime}`;
  let objectUrl = null;

  const b64ToUint8 = (b64) => {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i += 1) bytes[i] = bin.charCodeAt(i);
    return bytes;
  };

  let audio;
  try {
    const bytes = b64ToUint8(audioBase64);
    const blob = new Blob([bytes], { type: contentType });
    objectUrl = URL.createObjectURL(blob);
    audio = new Audio(objectUrl);
  } catch (decodeErr) {
    console.error('[TTS] Base64 decode failed, using browser speech fallback:', decodeErr);
    ttsPlaybackActive = true;
    speakTextFallback(fallbackText, () => {
      if (speechToken !== activeSpeechToken) return;
      ttsPlaybackActive = false;
      runOnDone();
      resumeAudioStreaming();
      clearActionFxNow();
      applyEmotionState('listening', 'listening');
      if (micLabel) micLabel.textContent = 'AUTO-LISTEN (VOSK TL-PH)';
    });
    return;
  }
  audio.preload = 'auto';
  activeTTSAudio = audio;
  let finalized = false;
  let startedPlayback = false;
  let startGuardTimer = null;
  let mediaReady = false;

  const finalize = () => {
    if (finalized) return;
    if (speechToken !== activeSpeechToken) return;
    finalized = true;
    ttsPlaybackActive = false;
    if (startGuardTimer) {
      clearTimeout(startGuardTimer);
      startGuardTimer = null;
    }
    if (objectUrl) {
      try { URL.revokeObjectURL(objectUrl); } catch (_) {}
      objectUrl = null;
    }
    stopSpeakingMouth();
    runOnDone();
    // IMPORTANT: After TTS finishes, resume listening after a short delay
    setTimeout(() => {
      resumeAudioStreaming();
      clearActionFxNow();
      applyEmotionState('listening', 'listening');
      if (micLabel) micLabel.textContent = 'AUTO-LISTEN (VOSK TL-PH)';
    }, 500);
  };

  audio.onplay = () => {
    if (speechToken !== activeSpeechToken) return;
    startedPlayback = true;
    ttsPlaybackActive = true;
    applyEmotionState('speaking', currentEmotion || 'speaking');
    startSpeakingMouth();
  };
  audio.oncanplay = () => {
    mediaReady = true;
  };
  audio.onloadeddata = () => {
    mediaReady = true;
  };
  audio.onended = finalize;
  audio.onpause = () => {
    // Ignore incidental pause events unless playback already started and truly ended.
    if (!startedPlayback || !audio.ended) return;
    finalize();
  };
  audio.onerror = () => {
    if (speechToken !== activeSpeechToken) return;
    console.error('[TTS] Audio element failed to play, using browser speech fallback');
    speakTextFallback(fallbackText, finalize);
  };

  // Soft guard only: do not force fallback on timer to avoid cutting valid slow starts.
  startGuardTimer = setTimeout(() => {
    if (startedPlayback || finalized) return;
    console.warn('[TTS] Audio still waiting to start (no forced fallback).');
  }, 9000);

  audio.play().catch((err) => {
    console.error('[TTS] Playback error:', err);
    if (String(err?.name || '').toLowerCase() === 'notallowederror') {
      pendingTTSJob = { audioBase64, format, onDone: runOnDone, fallbackText };
      waitingForTTSUnlock = true;
      if (micLabel) micLabel.textContent = 'TAP SCREEN TO ENABLE AUDIO';
      enterThinkingState('autoplay-blocked');
      return;
    }
    speakTextFallback(fallbackText, finalize);
  });
}

function showCommandFeedback(cmd) {
  const flash = document.createElement('div');
  flash.style.cssText = [
    'position: fixed',
    'top: 20px',
    'right: 20px',
    'background: rgba(0,255,136,0.15)',
    'border: 1px solid rgba(0,255,136,0.4)',
    'color: #00ff88',
    'padding: 10px 16px',
    'border-radius: 10px',
    'font-family: monospace',
    'font-size: 12px',
    'z-index: 999',
    'backdrop-filter: blur(10px)',
    'animation: slideIn 0.3s ease'
  ].join(';');

  flash.textContent = `GPIO ${cmd.pin} -> ${String(cmd.state || '').toUpperCase()} (${cmd.device || 'device'})`;
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 3000);
}

function sendText() {
  if (!textInput) return;
  const text = textInput.value.trim();
  if (!text) return;

  if (transcriptText) transcriptText.textContent = text;
  if (bubbleText) bubbleText.textContent = '...';
  enterThinkingState('typed-input');
  socket.emit('send_message', { text });
  textInput.value = '';
}

async function initVAD() {
  if (vad) return;
  if (!window.PinoVAD) {
    throw new Error('PinoVAD is not loaded. Ensure vad.js is included before app.js');
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('getUserMedia is unavailable in this browser');
  }
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    throw new Error('Mic requires secure context. Open via https or localhost.');
  }

  const silenceMs = IS_MOBILE ? 1700 : 2400;
  const speechThresh = IS_MOBILE ? 0.009 : 0.012;
  const pollMs = IS_MOBILE ? 36 : 48;
  const minBlobBytes = IS_MOBILE ? 300 : 500;

  vad = new window.PinoVAD(socket, {
    silenceMs,
    speechThresh,
    pollMs,
    minBlobBytes,
    onStateChange: (state) => {
      if (state === 'speaking') {
        applyEmotionState('listening', 'listening');
        if (micLabel) micLabel.textContent = 'LISTENING... (MIC)';
      } else if (state === 'paused') {
        if (micLabel) micLabel.textContent = 'WAITING...';
      } else if (state === 'processing') {
        enterThinkingState('vad-processing');
        if (micLabel) micLabel.textContent = 'PROCESSING...';
      } else if (state === 'idle') {
        if (micLabel) micLabel.textContent = 'AUTO-LISTEN (VOSK TL-PH)';
        if (AUTO_MODE && shouldStreamAudio) {
          applyEmotionState('listening', 'listening');
        }
      }
    }
  });

  await vad.start();
  activeInputMode = 'vosk';
  if (micLabel) micLabel.textContent = 'AUTO-LISTEN (VOSK TL-PH)';
  canRetryMicOnUserGesture = false;
}

async function ensureInputMode() {
  if (preferBrowserSTT) {
    if (initBrowserSTT()) {
      activeInputMode = 'browser';
      if (micLabel) micLabel.textContent = 'AUTO-LISTEN (BROWSER STT)';
      return true;
    }
    // If browser STT is unavailable, fallback to VAD.
  }

  try {
    await initVAD();
    activeInputMode = 'vosk';
    return true;
  } catch (err) {
    console.error('[Input] VAD init error:', err);
    if (micLabel && /secure context/i.test(String(err?.message || ''))) {
      micLabel.textContent = 'OPEN VIA http://127.0.0.1:3000';
    }
  }

  if (initBrowserSTT()) {
    activeInputMode = 'browser';
    if (micLabel) micLabel.textContent = 'AUTO-LISTEN (BROWSER STT)';
    return true;
  }

  activeInputMode = 'none';
  if (micLabel) micLabel.textContent = 'MIC UNAVAILABLE - TAP TO RETRY';
  canRetryMicOnUserGesture = true;
  return false;
}

function attachManualControls() {
  if (!btnSend || !textInput) return;

  if (btnMic) {
    btnMic.title = 'Click once to enable auto-listen';
    btnMic.addEventListener('click', async () => {
      try {
        await ensureInputMode();
      } catch (err) {
        console.error('[Input] init error:', err);
      }
    });
  }

  btnSend.addEventListener('click', sendText);
  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendText();
  });
}

async function startAutoMode() {
  document.body.classList.add('auto-mode');
  if (micLabel) micLabel.textContent = 'AUTO-LISTEN...';
  await ensureInputMode();
}

async function retryMicFromGesture() {
  if (!ttsUnlocked) {
    ttsUnlocked = true;
    waitingForTTSUnlock = false;
    runPendingTTSIfAny();
  }
  if (!canRetryMicOnUserGesture) return;
  await ensureInputMode();
}

// --- SOCKET EVENTS ---
socket.on('connect', async () => {
  console.log('[Socket] Connected:', socket.id);
  startBlink();
  applyEmotionState('listening', 'listening');

  if (AUTO_MODE) {
    await startAutoMode();
  }
});

socket.on('stt_status', (data) => {
  const voskAvailable = !!data?.voskAvailable;
  // If local Vosk is unavailable, use browser STT as robust fallback.
  const previous = preferBrowserSTT;
  preferBrowserSTT = !voskAvailable;
  console.log(`[STT] Mode: ${preferBrowserSTT ? 'BROWSER' : 'VOSK'}`);
  if (AUTO_MODE && previous !== preferBrowserSTT) {
    ensureInputMode().catch((err) => console.error('[STT] Mode switch error:', err));
  }
});

socket.on('connect_error', (err) => {
  console.error('[Socket] Connect error:', err.message || err);
  if (statusLabel) statusLabel.textContent = 'OFFLINE';
});

socket.on('disconnect', () => {
  console.log('[Socket] Disconnected');
  clearThinkingFallback();
  stopThinkingFx(false);
  applyEmotionState('idle', 'neutral');
  if (statusLabel) statusLabel.textContent = 'OFFLINE';
});

socket.on('pino_state', (data) => {
  if ((ttsPlaybackActive || waitingForTTSFinish || waitingForTTSUnlock) && data.state !== 'speaking') {
    return;
  }
  if (data.state !== 'thinking') clearThinkingFallback();
  if (data.state !== 'thinking') {
    stopThinkingFx(false, () => applyEmotionState(data.state, data.emotion));
  } else {
    applyEmotionState(data.state, data.emotion);
    }
  if (data.state === 'speaking') {
    const isWaving = activeActionClass === 'action-wave';
    if (!isWaving) {
      showSpeakingHands();
    }
  } else {
    if (actionFxTimer) {
      clearTimeout(actionFxTimer);
      actionFxTimer = null;
    }
    if (activeActionClass) {
      document.body.classList.remove(activeActionClass);
      activeActionClass = '';
    }
    clearActionFxElements();
  }
  // When server sends idle state, return to listening mode
  if (AUTO_MODE && data.state === 'idle') {
    if (ttsPlaybackActive || waitingForTTSFinish || waitingForTTSUnlock) return;
    // Always resume listening after idle state, regardless of shouldStreamAudio
    setTimeout(() => {
      if (ttsPlaybackActive || waitingForTTSFinish || waitingForTTSUnlock) return;
      applyEmotionState('listening', 'listening');
      if (micLabel) micLabel.textContent = 'AUTO-LISTEN (VOSK TL-PH)';
      resumeAudioStreaming();
    }, 500);
  }
});

socket.on('transcript', (data) => {
  if (transcriptText) transcriptText.textContent = data.text || '-';
});

socket.on('pino_response', (data) => {
  const text = String(data?.text || '').trim();
  const emotion = data?.emotion || 'neutral';
  const action = data?.action || actionFromEmotion(emotion);
  const actionMeta = data?.actionMeta || null;
  const heardText = String(data?.heardText || '').trim();
  const source = data?.source || 'text';
  const ttsAudioBase64 = data?.ttsAudioBase64 || null;
  const ttsFormat = data?.ttsFormat || 'wav';
  const signature = `${source}|${heardText}|${text}`;
  const now = Date.now();
  if (
    signature &&
    signature === lastTTSResponseSignature &&
    (now - lastTTSResponseAt) < 4000
  ) {
    console.warn('[TTS] Duplicate response ignored');
    return;
  }
  lastTTSResponseSignature = signature;
  lastTTSResponseAt = now;

  if (heardText && transcriptText) {
    transcriptText.textContent = heardText;
  }
  if (heardText) {
    console.log(`[Heard/${source}] ${heardText}`);
  }

  // Keep thinking state until TTS actually starts playing.
  enterThinkingState('waiting-for-tts-playback');
  setTimeout(() => {
    stopThinkingFx(true);
  }, 500);
  if (text) {
    waitingForTTSFinish = true;
    pauseAudioStreaming();
    displayResponse(text);
    playActionFx(action, emotion, actionMeta);
    const onTtsDone = () => {
      waitingForTTSFinish = false;
    };
    if (USE_BROWSER_TTS_ONLY) {
      playGroqTTS(null, 'wav', onTtsDone, text);
    } else {
      playGroqTTS(ttsAudioBase64, ttsFormat, onTtsDone, text);
    }
  } else {
    waitingForTTSFinish = false;
    setTimeout(() => {
      speechBusy = false;
      resumeAudioStreaming();
    }, 500);
  }

  if (data?.command) {
    showCommandFeedback(data.command);
  }
});

socket.on('gpio_executed', (cmd) => {
  showCommandFeedback(cmd);
});

// --- INIT ---
window.addEventListener('load', () => {
  updateViewportMode();
  initMouthWave();
  const themeToggle = $('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      document.body.classList.toggle('theme-alt');
    });
  }
  if (statusChip) {
    statusChip.addEventListener('click', () => {
      const isOpen = guideOverlay?.classList?.contains('open');
      setGuideOpen(!isOpen);
    });
  }
  if (guideClose) {
    guideClose.addEventListener('click', () => setGuideOpen(false));
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'g' || e.key === 'G') {
      const isOpen = guideOverlay?.classList?.contains('open');
      setGuideOpen(!isOpen);
    }
    if (e.key === 'Escape') {
      setGuideOpen(false);
    }
  });
  attachManualControls();
});
window.addEventListener('orientationchange', updateViewportMode);
window.addEventListener('resize', updateViewportMode);

document.addEventListener('pointerdown', retryMicFromGesture);
document.addEventListener('keydown', retryMicFromGesture);

console.log('%cPINO Robot UI Loaded', 'color: #00f5ff; font-size: 16px; font-weight: bold;');
