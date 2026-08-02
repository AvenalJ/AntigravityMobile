@echo off
REM ============================================================================
REM  Launch the Antigravity 2.0 desktop app with CDP on a FIXED port 9333.
REM
REM  NOTE: usually you do NOT need this - the 2.0 app already enables remote
REM  debugging on a random port that the bridge auto-discovers via its
REM  DevToolsActivePort file. Use this only if you want a stable, known port.
REM
REM  IMPORTANT: fully QUIT Antigravity first - the flag is ignored if an
REM  instance is already running.
REM ============================================================================
echo Launching Antigravity 2.0 with remote debugging on port 9333 ...
start "" "%LOCALAPPDATA%\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=9333
