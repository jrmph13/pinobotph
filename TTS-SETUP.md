# PINO TTS Setup Guide

## Overview

PINO now uses **edge-tts** as the primary TTS engine with **Filipino voice support** and **free unlimited usage**. This replaces the previous Groq TTS that had rate limits and costs.

## Architecture

```
User Text → edge-tts (Primary) → Filipino Voices (Free)
           ↓
        Groq TTS (Fallback) → English Voices (If edge-tts fails)
           ↓
     Web Speech API (Final Fallback) → Browser-based (Always available)
```

## Features

✅ **Free & Unlimited** - No API keys or rate limits  
✅ **Filipino Voices** - Natural Tagalog pronunciation  
✅ **Emotion-Aware** - Voice parameters adjust based on emotion  
✅ **Multi-Fallback** - 3 levels of fallback for reliability  
✅ **Local Processing** - Works offline after setup  

## Available Filipino Voices

| Voice | Gender | Description |
|-------|--------|-------------|
| `fil-PH-BlessicaNeural` | Female | Natural Tagalog, default voice |
| `fil-PH-AngeloNeural` | Male | Natural Tagalog, alternative voice |

## Setup Instructions

### Prerequisites

1. **Python** must be installed (edge-tts requires Python)
2. **Node.js** must be installed

### 1. Install Dependencies

```bash
# Install Node.js dependencies
npm install

# Install edge-tts (Python package)
pip install edge-tts
```

### 2. Quick Setup (Windows)

Double-click `setup-tts.bat` to automatically:
- Install edge-tts
- Test availability
- Test TTS synthesis

### 3. Verify Installation

```bash
# Check if edge-tts is installed
pip show edge-tts

# Test edge-tts command
edge-tts --version

# Test Node.js TTS module
node -e "const tts = require('./tts'); console.log('Edge TTS cmd:', tts.getEdgeTTSCmd());"
```

### 4. Start the Server

```bash
npm start
```

The server will automatically:
1. Check if edge-tts is available
2. Use edge-tts for TTS if available
3. Fall back to Groq TTS if edge-tts fails
4. Signal client to use Web Speech API if both fail

## Configuration

Edit `server.js` to customize TTS behavior:

```javascript
const CONFIG = {
  // Enable edge-tts as primary
  TTS_USE_EDGE: true,
  
  // Enable Groq fallback
  TTS_FALLBACK_TO_GROQ: true,
  
  // Maximum input characters
  TTS_MAX_INPUT_CHARS: 600,
};
```

## Emotion Mapping

The system automatically adjusts TTS parameters based on detected emotion:

| Emotion | Rate | Pitch | Voice |
|---------|------|-------|-------|
| happy | +10% | +10Hz | Filipino Female |
| sad | -15% | -10Hz | Filipino Female |
| excited | +20% | +15Hz | Filipino Female |
| frustrated | +5% | -5Hz | Filipino Female |
| neutral | +0% | +0Hz | Filipino Female |

## Testing

### Test Edge TTS Availability
```bash
node -e "const tts = require('./tts'); tts.checkEdgeTTS().then(available => console.log('Available:', available));"
```

### Test Voice List
```bash
node -e "const tts = require('./tts'); tts.listVoices().then(voices => console.log(voices.filter(v => v.language.includes('fil'))));"
```

### Test Emotion Synthesis
```bash
node -e "const tts = require('./tts'); tts.synthesizeWithEmotion('Masaya ako ngayon!', 'happy').then(res => console.log('Success:', !!res));"
```

## Troubleshooting

### Edge TTS Not Found
```bash
# Reinstall edge-tts
pip uninstall edge-tts
pip install edge-tts

# Check if CLI is available
edge-tts --version
```

### Python Path Issues
```bash
# Use full Python path
python -m pip install edge-tts

# Or specify Python executable in tts.js
// Edit tts.js and change the cmd variable
const cmd = 'C:\\Python39\\python.exe -m edge_tts';
```

### Permission Issues (Windows)
```bash
# Run as Administrator
# Or install for current user only
pip install --user edge-tts
```

### Slow Response
- Edge TTS processes locally but may take 5-10 seconds for long text
- Text is automatically limited to 500 characters for optimal performance
- Consider using shorter responses for faster TTS

## Fallback Behavior

1. **Primary**: edge-tts with Filipino voices (free, unlimited)
2. **Secondary**: Groq TTS with English voices (requires API key, rate-limited)
3. **Final**: Web Speech API in browser (always available, robotic voice)

## Performance Notes

- **edge-tts**: ~3-8 seconds per synthesis, unlimited usage
- **Groq TTS**: ~1-3 seconds per synthesis, rate-limited
- **Web Speech**: Instant, browser-dependent quality

## Development

### Adding New Voices
```javascript
// In tts.js, add to VOICES object
const VOICES = {
  filipino_female: 'fil-PH-BlessicaNeural',
  filipino_male: 'fil-PH-AngeloNeural',
  // Add new voices here
};
```

### Custom Emotion Parameters
```javascript
// In tts.js, modify getEmotionParams function
function getEmotionParams(emotion) {
  const params = {
    custom_emotion: { rate: '+15%', pitch: '+20Hz', voice: VOICES.filipino_female },
    // Add custom emotion mappings
  };
  return params[emotion] || params.neutral;
}
```

## Migration from Groq TTS

If you were previously using Groq TTS:

1. **No code changes needed** - The new system is backward compatible
2. **Remove Groq TTS keys** if you want to use only free edge-tts
3. **Keep Groq keys** for fallback during edge-tts maintenance

## Support

For issues with edge-tts:
- Check [edge-tts GitHub](https://github.com/rany2/edge-tts)
- Ensure Python and pip are properly installed
- Verify internet connection for initial voice downloads

For PINO-specific issues:
- Check server logs for TTS initialization messages
- Test with the provided test commands above
- Ensure all dependencies are installed