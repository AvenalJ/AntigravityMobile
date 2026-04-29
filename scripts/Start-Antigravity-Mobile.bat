@echo off
title Antigravity Mobile
:: Antigravity Mobile Launcher - Windows
:: Double-click this file to start everything

cd /d "%~dp0\.."

echo.
echo ==========================================
echo   Antigravity Mobile Server
echo ==========================================
echo.

:: Check if node is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js is not installed on your system.
    echo Please install Node.js manually from https://nodejs.org/
    exit /b 1
)
goto :checkmodules

:checkmodules
:: Check if node_modules exists
if not exist "node_modules\" (
    echo First time setup - Installing dependencies...
    echo This may take a minute...
    echo.
    call npm install
    if %errorlevel% neq 0 (
        echo.
        echo ERROR: Failed to install dependencies!
        pause
        exit /b 1
    )
    echo.
    echo Dependencies installed successfully!
    echo.
)

echo Starting server...
echo.

:: Removed interactive cloudflared and PIN setup prompts for automatic headless startup
:startserver
node src\launcher.mjs
pause
