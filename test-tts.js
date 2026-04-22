// Simple test script for non-Edge TTS
const tts = require('./tts');

async function test() {
  console.log('Testing PINO non-Edge TTS...\n');

  try {
    console.log('1) Testing local System.Speech fallback...');
    const local = await tts.synthesizeWithEmotion('Kamusta! Ako si PINO.', 'happy');
    console.log('Local Result:', local ? 'SUCCESS - Audio generated' : 'FAILED - No audio');
    console.log('Local Format:', local ? local.format : 'N/A');
    console.log('Local Audio length:', local ? local.audioBase64.length : 0, 'bytes');

    console.log('\n2) Testing edge-tts helper (disabled in server runtime)...');
    const edge = await tts.synthesizeEdge('Kamusta! Ako si PINO.', 'happy');
    console.log('edge-tts Result:', edge ? 'SUCCESS - Audio generated' : 'FAILED - No audio');
    console.log('edge-tts Format:', edge ? edge.format : 'N/A');
    console.log('edge-tts Audio length:', edge ? edge.audioBase64.length : 0, 'bytes');
  } catch (err) {
    console.error('Error:', err.message);
  }
}

test();
