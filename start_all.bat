@echo off
setlocal
cd /d "%~dp0"

start "AICTE-TrustNet Backend" cmd /k call "%~dp0start_backend.bat"
start "AICTE-TrustNet Frontend" cmd /k call "%~dp0start_frontend.bat"

timeout /t 5 /nobreak >nul
start "" "http://localhost:5173/registrar"

echo Backend:  http://localhost:8000/docs
echo Frontend: http://localhost:5173
