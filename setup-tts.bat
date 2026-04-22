@echo off
echo.
echo ╔══════════════════════════════════════╗
echo ║   PINO TTS Setup (Windows)           ║
echo ╚══════════════════════════════════════╝
echo.

echo [1/3] Installing edge-tts via pip...
pip install edge-tts

if %ERRORLEVEL% EQU 0 (
    echo [✓] edge-tts installed successfully
) else (
    echo [✗] Failed to install edge-tts via pip
    echo [i] Trying alternative installation...
    python -m pip install edge-tts
)

echo.
echo [2/3] Testing edge-tts availability...
node -e "const tts = require('./tts'); tts.checkEdgeTTS().then(available => { console.log(available ? '[✓] edge-tts is available' : '[✗] edge-tts not found'); process.exit(available ? 0 : 1); }).catch(err => { console.log('[✗] edge-tts check failed:', err.message); process.exit(1); });"

echo.
echo [3/3] Testing TTS synthesis...
node -e "const tts = require('./tts'); tts.synthesizeSpeech('Kamusta! Ako si PINO, ang iyong kaibigan na robot.', 'happy').then(res => { console.log('[✓] TTS test successful:', res ? 'Audio generated' : 'No audio'); }).catch(err => { console.log('[✗] TTS test failed:', err.message); });"

echo.
echo ╔══════════════════════════════════════╗
echo ║   Setup Complete                     ║
echo ║   Run: npm install                   ║
echo ║   Run: npm start                     ║
echo ╚══════════════════════════════════════╝
echo.
pause