@echo off
rem Double-click to build dist\PttyPCMonitor-Setup-vX.Y.Z.zip (runs build-package.ps1).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build-package.ps1"
if errorlevel 1 echo. & echo BUILD FAILED - see the messages above.
echo.
pause
