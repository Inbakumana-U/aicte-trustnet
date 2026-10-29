@echo off
setlocal
cd /d "%~dp0frontend"

if not exist "node_modules" (
    echo Frontend dependencies missing. Run setup.bat first.
    exit /b 1
)

call npm run dev
