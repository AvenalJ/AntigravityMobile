@echo off
REM ============================================================================
REM  Launch Antigravity IDE with CDP remote debugging on port 9222.
REM  Only needed if you want the IDE's Cascade chat mirrored (the 2.0 desktop
REM  app already exposes debugging automatically - no launcher needed for it).
REM
REM  IMPORTANT: fully QUIT Antigravity IDE first - the flag is ignored if an
REM  instance is already running.
REM ============================================================================
echo Launching Antigravity IDE with remote debugging on port 9222 ...
start "" "%LOCALAPPDATA%\Programs\Antigravity IDE\Antigravity IDE.exe" --remote-debugging-port=9222
