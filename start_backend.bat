@echo off
setlocal
cd /d "%~dp0backend"

if not exist ".venv\Scripts\python.exe" (
    echo Backend virtual environment missing. Run setup.bat first.
    exit /b 1
)

".venv\Scripts\python.exe" run_backend.py %*
