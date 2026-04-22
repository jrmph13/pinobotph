# 🤖 PINO Robot — Termux Setup Guide

## Quick Install (Termux)

```bash
# 1. Update packages
pkg update && pkg upgrade

# 2. Install Node.js
pkg install nodejs

# 3. Clone or copy this folder
cd ~/storage/shared   # or wherever your project is

# 4. Install dependencies
npm install

# 5. Set your API keys
cp .env.example .env
nano .env   # paste your keys here

# 6. Run PINO!
node server.js
```

Open your Termux browser (or phone browser) at:
**http://localhost:3000**

---

## API Keys

| Key | Where to get |
|-----|-------------|
| `GROQ_API_KEY` | https://console.groq.com |
| `NVIDIA_API_KEY` | https://build.nvidia.com |

---

## File Structure

```
pino-robot/
├── server.js          ← Main backend (Node.js)
├── package.json
├── .env               ← Your API keys (never commit!)
└── public/
    ├── index.html     ← Robot Eyes UI
    ├── style.css      ← Glassmorphism styles
    └── app.js         ← Frontend socket + mic logic
```

---

## How It Works

```
[User speaks] → MediaRecorder (browser)
     ↓
[Socket.io] → server.js receives audio chunks
     ↓
[3-second silence buffer] → setTimeout waits
     ↓
[Groq Whisper] → Transcribes audio to text
     ↓
[NVIDIA NIM] → Detects emotion (frustrated, happy, etc.)
     ↓
[Groq LLaMA 3.1] → Generates PINO's response
     ↓
[Socket.io] → Sends state + text to frontend
     ↓
[Eyes animate] → Color/shape changes based on emotion
     ↓
[Web Speech API] → Browser speaks the response
```

---

## Adding New Tagalog Commands (GPIO)

In `server.js`, find `TAGALOG_COMMANDS` and add:

```js
'buksan ang TV': { action: 'gpio', pin: 19, state: 'on', device: 'TV' },
'patayin ang aircon': { action: 'gpio', pin: 20, state: 'off', device: 'aircon' },
```

---

## Emotion → Eye State Map

| Emotion | Eye Color | Shape |
|---------|-----------|-------|
| happy | `#00ff88` green | Half-moon curved up |
| sad | `#4488ff` blue | Drooping lids |
| excited | `#ffcc00` gold | Wide open |
| thinking | `#aa88ff` purple | One eye squinted |
| frustrated | `#ff3355` red | Angry brows + slight shake |
| listening | `#00ffcc` teal | Scanning side to side |
| speaking | `#ffffff` white | Pulsing |
| neutral | `#00f5ff` cyan | Normal |

---

## Troubleshooting

**No mic access?**
→ Open in Chrome/Chromium, allow microphone permission.

**Socket not connecting?**
→ Make sure server is running (`node server.js`), and URL is `http://localhost:3000`.

**Groq errors?**
→ Check your API key in `.env`. Free tier has rate limits.

**NVIDIA NIM fallback?**
→ If NIM fails, the robot uses keyword-based emotion detection automatically.
