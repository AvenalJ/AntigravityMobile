@echo off
title Stop Antigravity Mobile Server
echo.
echo ==========================================
echo   Stopping Antigravity Mobile Server
echo ==========================================
echo.

REM Stop HTTP server on port 3001
echo Checking HTTP server (port 3001)...
set "FOUND_HTTP=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001 ^| findstr LISTENING 2^>nul') do (
    echo   Found HTTP server process with PID: %%a
    taskkill /PID %%a /F >nul 2>&1
    echo   HTTP server stopped.
    set "FOUND_HTTP=1"
)

if "%FOUND_HTTP%"=="0" (
    echo No HTTP server found running on port 3001.
)

REM Stop Antigravity processes launched with CDP (port 9222)
echo.
echo Checking CDP process (port 9222)...
set "FOUND_CDP=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :9222 ^| findstr LISTENING 2^>nul') do (
    echo   Found CDP process with PID: %%a
    taskkill /PID %%a /F >nul 2>&1
    echo   CDP process stopped.
    set "FOUND_CDP=1"
)

if "%FOUND_CDP%"=="0" (
    echo No CDP process found on port 9222.
)

echo.
echo ==========================================
if "%FOUND_HTTP%"=="1" if "%FOUND_CDP%"=="1" (
    echo   All services stopped successfully!
) else if "%FOUND_HTTP%"=="1" (
    echo   HTTP server stopped.
) else if "%FOUND_CDP%"=="1" (
    echo   CDP process stopped.
) else (
    echo   No running services found.
)
echo ==========================================
echo.
echo Press any key to close...
pause >nul
