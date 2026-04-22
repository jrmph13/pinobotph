@echo off
echo ========================================
echo PINO - Vosk Speech Recognition Setup
echo ========================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python from https://www.python.org/downloads/
    pause
    exit /b 1
)

echo [1/2] Installing Vosk...
pip install vosk

if errorlevel 1 (
    echo ERROR: Failed to install Vosk
    echo Try: pip install --upgrade pip vosk
    pause
    exit /b 1
)

echo [2/2] Checking Tagalog Vosk model...
echo.
echo The Tagalog model (vosk-model-tl-ph-generic-0.6) is already in the project root.
echo Model path: %~dp0vosk-model-tl-ph-generic-0.6

if exist "vosk-model-tl-ph-generic-0.6" (
    echo Model found! Ready to use.
) else (
    echo WARNING: Model directory not found!
    echo Please ensure vosk-model-tl-ph-generic-0.6 is in the project root.
)

echo.
echo ========================================
echo Setup complete!
echo ========================================
echo.
echo To verify installation, run:
echo   python -c "import vosk; print('Vosk installed!')"
echo.
echo Then start PINO:
echo   npm start
echo.
echo Note: npm start now uses bundled Node 20 for Vosk compatibility.
echo.
pause