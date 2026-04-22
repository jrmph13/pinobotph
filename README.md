# pinobotph

PINO is a conversational emotional AI robot assistant with:
- Voice input (Vosk STT, offline-first)
- AI responses (Groq + NVIDIA NIM support)
- Animated robot face UI (Socket.IO realtime)
- Local-first TTS with platform auto-fallback

## Features
- Emotion-aware responses and UI states
- Action simulation tags (wave, hands, nod, etc.)
- GPIO command payload support for device actions
- Faster turn-taking voice pipeline
- Linux/Termux TTS fallback via Edge TTS

## Requirements
- Node.js 18+ (Node 20 recommended)
- npm
- ffmpeg (recommended for robot voice filter on Termux)

## Quick Start (Windows/Linux)
```bash
npm install
node server.js
```

Open:
`http://localhost:3000`

## Termux Setup (Android)
```bash
pkg update -y && pkg upgrade -y
pkg install -y nodejs-lts git ffmpeg
```

Clone and run:
```bash
git clone https://github.com/<your-username>/pinobotph.git
cd pinobotph
bash run.sh
```

Open in your phone browser:
`http://127.0.0.1:3000`

Notes:
- `run.sh` auto-installs Termux packages and npm deps.
- If `keys.local.json` is missing, it creates one from `keys.local.example.json`.
- Insert your test keys in `keys.local.json`, then run `bash run.sh` again.

### Optional: keep server running in background
```bash
pkg install -y tmux
tmux
node server.js
```
Detach: `Ctrl+b`, then `d`

## TTS Notes
- Windows: uses System.Speech locally.
- Linux/Termux: auto-falls back to Edge TTS.
- Robot filter on Termux uses ffmpeg automatically.
- To disable robot filter:
```bash
export PINO_ROBOT_FILTER=0
```

## Environment / Keys
Project currently uses direct keys in `server.js`.  
Recommended for production: move API keys to environment variables and `.env`.

## Project Structure
- `server.js` - backend + socket pipeline
- `tts.js` - TTS engines and platform fallback logic
- `stt.js` - STT handling (Vosk/offline-first)
- `public/` - frontend UI

## License
MIT (or your preferred license)
