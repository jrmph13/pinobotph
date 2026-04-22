/**
 * PINO TTS Module - Local-first TTS engines
 * Supports: Windows System.Speech, edge-tts
 */

const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
let edgeTTSModulePromise = null;
let ffmpegCheckPromise = null;
let ffmpegUnavailableLogged = false;

function isTermuxLinux() {
  if (process.platform !== 'linux') return false;
  const prefix = String(process.env.PREFIX || '');
  return (
    prefix.includes('com.termux') ||
    !!process.env.TERMUX_VERSION ||
    !!process.env.ANDROID_ROOT
  );
}

function isRobotFilterEnabled() {
  // Enabled by default on Termux/Linux mobile unless explicitly disabled.
  const forcedOff = String(process.env.PINO_ROBOT_FILTER || '').toLowerCase();
  if (forcedOff === '0' || forcedOff === 'false' || forcedOff === 'off') return false;
  return isTermuxLinux();
}

function runExecFile(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function hasFfmpeg() {
  if (!ffmpegCheckPromise) {
    ffmpegCheckPromise = runExecFile('ffmpeg', ['-version'], { windowsHide: true })
      .then(() => true)
      .catch(() => false);
  }
  return ffmpegCheckPromise;
}

async function getEdgeTTSModule() {
  if (!edgeTTSModulePromise) {
    edgeTTSModulePromise = import('edge-tts/out/index.js').catch((err) => {
      edgeTTSModulePromise = null;
      throw err;
    });
  }
  return edgeTTSModulePromise;
}

function mapEmotionToEdgeOptions(emotion) {
  const voiceByEmotion = {
    neutral: 'en-US-JennyNeural',
    happy: 'en-US-AriaNeural',
    excited: 'en-US-GuyNeural',
    sad: 'en-US-JennyNeural',
    concerned: 'en-US-JennyNeural',
    frustrated: 'en-US-GuyNeural',
    thinking: 'en-US-JennyNeural',
    listening: 'en-US-JennyNeural',
    speaking: 'en-US-JennyNeural'
  };

  const rateByEmotion = {
    happy: '+0%',
    excited: '+4%',
    sad: '-12%',
    concerned: '-10%',
    frustrated: '-5%',
    thinking: '-10%',
    neutral: '-6%',
    listening: '-6%',
    speaking: '-6%'
  };

  const termuxPreferredVoices = [
    'en-PH-RosaNeural',
    'fil-PH-BlessicaNeural',
    'en-US-AriaNeural',
    'en-US-JennyNeural'
  ];

  const baseVoice = voiceByEmotion[emotion] || voiceByEmotion.neutral;
  const voiceCandidates = isTermuxLinux()
    ? [termuxPreferredVoices[0], termuxPreferredVoices[1], baseVoice, ...termuxPreferredVoices.slice(2)]
    : [baseVoice, 'en-US-AriaNeural', 'en-US-JennyNeural'];

  // Unique voices in order.
  const uniqueVoices = [];
  voiceCandidates.forEach((voice) => {
    const v = String(voice || '').trim();
    if (!v || uniqueVoices.includes(v)) return;
    uniqueVoices.push(v);
  });

  return {
    voices: uniqueVoices,
    rate: rateByEmotion[emotion] || rateByEmotion.neutral,
    pitch: isRobotFilterEnabled() ? '-10Hz' : '-2Hz',
    volume: '+0%'
  };
}

async function applyRobotFilterIfAvailable(audioBuffer) {
  if (!audioBuffer || !Buffer.isBuffer(audioBuffer)) return audioBuffer;
  if (!isRobotFilterEnabled()) return audioBuffer;

  const ffmpegOk = await hasFfmpeg();
  if (!ffmpegOk) {
    if (!ffmpegUnavailableLogged) {
      ffmpegUnavailableLogged = true;
      console.warn('[TTS] ffmpeg not found; robot filter skipped.');
    }
    return audioBuffer;
  }

  const tmpIn = path.join(os.tmpdir(), `pino_tts_in_${Date.now()}_${Math.floor(Math.random() * 10000)}.mp3`);
  const tmpOut = path.join(os.tmpdir(), `pino_tts_out_${Date.now()}_${Math.floor(Math.random() * 10000)}.mp3`);
  try {
    fs.writeFileSync(tmpIn, audioBuffer);
    const filter = [
      'highpass=f=130',
      'lowpass=f=3600',
      'compand=attacks=0.02:decays=0.2:points=-80/-80|-20/-12|0/-7',
      'aecho=0.8:0.88:45:0.2'
    ].join(',');

    await runExecFile(
      'ffmpeg',
      ['-y', '-hide_banner', '-loglevel', 'error', '-i', tmpIn, '-af', filter, '-ar', '24000', tmpOut],
      { windowsHide: true }
    );

    if (!fs.existsSync(tmpOut)) return audioBuffer;
    return fs.readFileSync(tmpOut);
  } catch (err) {
    console.warn('[TTS] Robot filter failed; using unfiltered audio:', err.message);
    return audioBuffer;
  } finally {
    try { if (fs.existsSync(tmpIn)) fs.unlinkSync(tmpIn); } catch (_) {}
    try { if (fs.existsSync(tmpOut)) fs.unlinkSync(tmpOut); } catch (_) {}
  }
}

/**
 * Synthesize speech using edge-tts package.
 */
async function synthesizeEdge(text, emotion = 'neutral') {
  const input = String(text || '').trim();
  if (!input) return null;

  try {
    const { tts } = await getEdgeTTSModule();
    const options = mapEmotionToEdgeOptions(emotion);

    let rawBuffer = null;
    let lastErr = null;
    for (const voice of options.voices) {
      try {
        const audioBuffer = await tts(input, {
          voice,
          rate: options.rate,
          pitch: options.pitch,
          volume: options.volume
        });
        rawBuffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);
        if (rawBuffer?.length) break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (!rawBuffer) {
      throw lastErr || new Error('No usable Edge voice for this platform');
    }

    const finalBuffer = await applyRobotFilterIfAvailable(rawBuffer);

    return {
      format: 'mp3',
      audioBase64: finalBuffer.toString('base64')
    };
  } catch (err) {
    console.error('[Edge TTS] Error:', err.message);
    return null;
  }
}

/**
 * Synthesize speech using Windows SAPI (System.Speech)
 * Returns WAV base64 audio or null when unavailable.
 */
async function synthesizeSystemSpeech(text, options = {}) {
  if (process.platform !== 'win32') {
    return null;
  }

  const input = String(text || '').trim();
  if (!input) return null;

  // Keep command payload size bounded for PowerShell invocation.
  const boundedInput = input.slice(0, 800);
  const escaped = boundedInput.replace(/'/g, "''");

  const outFile = path.join(os.tmpdir(), `pino_tts_${Date.now()}_${Math.floor(Math.random() * 10000)}.wav`);
  const rate = Number.isFinite(options.rate) ? Math.max(-10, Math.min(10, Math.trunc(options.rate))) : 0;

  const psScript = [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Speech",
    '$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `$synth.Rate = ${rate}`,
    "$voice = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'fil-PH' } | Select-Object -First 1",
    "if ($voice) { $synth.SelectVoice($voice.VoiceInfo.Name) }",
    `$out = '${outFile.replace(/'/g, "''")}'`,
    "$synth.SetOutputToWaveFile($out)",
    `$synth.Speak('${escaped}')`,
    '$synth.Dispose()',
    "Write-Output $out"
  ].join('; ');

  return new Promise((resolve) => {
    execFile('powershell', ['-NoProfile', '-Command', psScript], { windowsHide: true }, (error) => {
      if (error) {
        console.error('[System TTS] PowerShell error:', error.message);
        try {
          if (fs.existsSync(outFile)) fs.unlinkSync(outFile);
        } catch (_) {}
        resolve(null);
        return;
      }

      try {
        const audioBuffer = fs.readFileSync(outFile);
        fs.unlinkSync(outFile);
        resolve({
          format: 'wav',
          audioBase64: audioBuffer.toString('base64')
        });
      } catch (readErr) {
        console.error('[System TTS] Read error:', readErr.message);
        resolve(null);
      }
    });
  });
}

/**
 * Emotion-aware helper for local/system speech parameters.
 */
function getEmotionParams(emotion) {
  const params = {
    // Slightly slower overall pacing so speech sounds more natural.
    happy: { rate: 0 },
    sad: { rate: -3 },
    excited: { rate: 1 },
    frustrated: { rate: -1 },
    thinking: { rate: -2 },
    concerned: { rate: -2 },
    neutral: { rate: -1 },
    listening: { rate: -1 },
    speaking: { rate: -1 }
  };
  return params[emotion] || params.neutral;
}

async function synthesizeWithEmotion(text, emotion = 'neutral') {
  const systemAudio = await synthesizeSystemSpeech(text, getEmotionParams(emotion));
  if (systemAudio?.audioBase64) return systemAudio;

  // Non-Windows (Termux/Linux) or System.Speech failure -> Edge fallback.
  return synthesizeEdge(text, emotion);
}

module.exports = {
  synthesizeEdge,
  synthesizeSystemSpeech,
  synthesizeWithEmotion,
  getEmotionParams
};
