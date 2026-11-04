@echo off
title Allow Antigravity Mobile Through Firewall
echo Opening port 5050 in Windows Firewall...
powershell -Command "Start-Process netsh -ArgumentList @('advfirewall', 'firewall', 'add', 'rule', 'name=AntigravityMobilePort5050', 'dir=in', 'action=allow', 'protocol=TCP', 'localport=5050') -Verb RunAs"
echo Done! If a Windows UAC prompt appeared, click "Yes".
pause
