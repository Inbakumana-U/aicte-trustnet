@echo off
setlocal
cd /d "%~dp0"

echo ==========================================
echo  AICTE-TrustNet setup
echo ==========================================

echo.
echo [1/3] Backend virtual environment
if not exist "backend\.venv\Scripts\python.exe" (
    where uv >nul 2>nul
    if not errorlevel 1 (
        uv venv "backend\.venv" --python 3.12
    ) else (
        python -m venv "backend\.venv"
    )
)
if not exist "backend\.venv\Scripts\python.exe" (
    echo ERROR: could not create backend\.venv - install Python 3.11+ or uv.
    exit /b 1
)

echo.
echo [2/3] Backend dependencies
"backend\.venv\Scripts\python.exe" -m pip install --upgrade pip
"backend\.venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt"
if errorlevel 1 exit /b 1

echo.
echo [3/3] Frontend dependencies
pushd frontend
call npm install
if errorlevel 1 (
    popd
    exit /b 1
)
rem npm 12 blocks esbuild's postinstall by default; approve it so Vite can run.
call npm install-scripts approve esbuild >nul 2>nul
call npm rebuild esbuild >nul 2>nul
popd

echo.
echo Setup complete. Launch with: start_all.bat
