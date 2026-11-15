@echo off
title Antigravity Mobile Server
cd /d "%~dp0"

echo ===================================================
echo   Antigravity Mobile Server (Port 5050)
echo ===================================================
echo.

:: 1. Automatically ensure Antigravity IDE is running with CDP on port 9333
netstat -ano | findstr :9333 | findstr LISTENING >nul 2>&1
if %errorlevel% neq 0 (
    echo [CDP] Remote debugging is not active.
    echo [CDP] Starting Antigravity IDE with --remote-debugging-port=9333...
    if exist "%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe" (
        start "" "%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe" --remote-debugging-port=9333
        echo [CDP] Antigravity IDE started!
        timeout /t 3 /nobreak >nul
    ) else (
        echo [Warning] Antigravity IDE.exe not found at standard path.
    )
) else (
    echo [CDP] Antigravity IDE already active on port 9333.
)

echo.
echo Opening Mobile Dashboard / Setup in browser...
start "" "http://localhost:5050"

echo.
echo Server is running. Keep this window open while using Antigravity Mobile!
echo Press Ctrl+C or close this window when you want to stop the server.
echo.
node src\http-server.mjs
pause
