@echo off
setlocal
cd /d "%~dp0"
set "PORT=8080"
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Milliseconds 800; Start-Process 'http://127.0.0.1:%PORT%/'"
where py >nul 2>&1
if not errorlevel 1 (
  py -3 -m http.server %PORT% --bind 127.0.0.1
  exit /b %errorlevel%
)
python -m http.server %PORT% --bind 127.0.0.1
