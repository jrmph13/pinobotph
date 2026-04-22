/**
 * PINO STT Module - Offline Speech-to-Text
 * Supports: Vosk only (offline)
 */

const fs = require('fs');
const path = require('path');

// Vosk model paths
const VOSK_MODELS = {
  small: path.join(__dirname, 'vosk-model-tl-ph-generic-0.6'),
  medium: path.join(__dirname, 'vosk-model-tl-ph-generic-0.6'),
  large: path.join(__dirname, 'vosk-model-tl-ph-generic-0.6')
};

// Default model
const DEFAULT_MODEL_PATH = VOSK_MODELS.small;

// Cached Vosk availability
let voskAvailable = false;
let voskModel = null;
let voskRecognizer = null;
let voskInitAttempted = false;

/**
 * Check if Vosk is available and load model
 */
async function initVosk() {
  if (voskAvailable) return true;
  if (voskInitAttempted) return false;
  voskInitAttempted = true;
  
  try {
    const majorNode = Number(process.versions?.node?.split('.')?.[0] || 0);
    if (majorNode >= 21) {
      console.log('[Vosk] Unsupported Node.js version for vosk native bindings:', process.versions.node);
      console.log('[Vosk] Please use Node.js 18 or 20 (LTS) for Windows compatibility.');
      return false;
    }

    // Try to load Vosk
    const vosk = require('vosk');
    
    // Check if model directory exists
    if (!fs.existsSync(DEFAULT_MODEL_PATH)) {
      console.log('[Vosk] Model not found at:', DEFAULT_MODEL_PATH);
      console.log('[Vosk] Please download Vosk model for Tagalog:');
      console.log('[Vosk] https://alphacephei.com/vosk/models');
      console.log('[Vosk] Extract to: vosk-model-tl-ph-generic-0.6/');
      return false;
    }
    
    // Load model
    voskModel = new vosk.Model(DEFAULT_MODEL_PATH);
    voskRecognizer = new vosk.Recognizer(voskModel, 16000);
    
    voskAvailable = true;
    console.log('[Vosk] Model loaded successfully:', DEFAULT_MODEL_PATH);
    return true;
    
  } catch (err) {
    console.log('[Vosk] Not available:', err.message);
    return false;
  }
}

/**
 * Transcribe audio using Vosk (offline)
 */
async function transcribeWithVosk(audioBuffer) {
  if (!voskAvailable) return null;
  
  try {
    // Vosk expects 16kHz mono PCM audio
    // For web audio, we need to convert from WebM/Opus to PCM
    // This is a simplified version - in production you'd use ffmpeg
    
    const result = voskRecognizer.acceptWaveform(audioBuffer);
    const finalResult = voskRecognizer.finalResult();
    
    if (finalResult && finalResult.text) {
      return finalResult.text.trim();
    }
    
    return null;
    
  } catch (err) {
    console.error('[Vosk] Transcription error:', err.message);
    return null;
  }
}

/**
 * Transcribe audio using Vosk only
 */
async function transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
  if (!audioBuffer || audioBuffer.length === 0) {
    return null;
  }
  
  // Try Vosk first (offline)
  if (await initVosk()) {
    const voskResult = await transcribeWithVosk(audioBuffer);
    if (voskResult) {
      console.log('[Vosk] Transcribed:', voskResult);
      return voskResult;
    }
  }
  
  return null;
}

/**
 * Get model info
 */
function getModelInfo() {
  return {
    voskAvailable,
    modelPath: DEFAULT_MODEL_PATH,
    modelExists: fs.existsSync(DEFAULT_MODEL_PATH)
  };
}

module.exports = {
  transcribeAudio,
  initVosk,
  getModelInfo,
  VOSK_MODELS,
  DEFAULT_MODEL_PATH
};
