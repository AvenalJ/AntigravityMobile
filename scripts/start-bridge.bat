@echo off
REM ============================================================================
REM  Antigravity Mobile - Bridge launcher
REM  Starts the HTTP + WebSocket bridge on port 5000 (0.0.0.0, Tailscale-reachable).
REM  Leave this window open; close it to stop the bridge.
REM ============================================================================
title Antigravity Mobile Bridge
cd /d "%~dp0.."

REM Skip the interactive PIN prompt (Tailscale is the security boundary).
set MOBILE_SKIP_AUTH_PROMPT=1

echo.
echo   Starting Antigravity Mobile bridge on http://0.0.0.0:5000
echo   Phone connects to your Tailscale IP on port 5000
echo   (Keep this window open. Close it to stop the bridge.)
echo.

node src\http-server.mjs

echo.
echo   Bridge stopped.
REM When launched by desktop-helper.exe (MOBILE_SUPERVISED=1) skip the pause so
REM the helper can detect the exit and relaunch. Manual double-click still pauses.
if "%MOBILE_SUPERVISED%"=="1" exit /b
echo   Press any key to close.
pause >nul
