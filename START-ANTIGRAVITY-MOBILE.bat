@echo off
title Antigravity Mobile Server
cd /d "%~dp0"

echo ===================================================
echo   Antigravity Mobile Server (Port 5050)
echo ===================================================
echo.
echo Opening Setup Wizard in browser: http://localhost:5050/setup
start "" "http://localhost:5050/setup"
echo.
echo Server is running. Keep this window open while using Antigravity Mobile!
echo Press Ctrl+C or close this window when you want to stop the server.
echo.
node src\http-server.mjs
pause
