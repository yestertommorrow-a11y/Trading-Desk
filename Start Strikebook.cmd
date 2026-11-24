@echo off
rem Double-click this file to start Strikebook with live data.
rem The first run installs Python packages into .venv\ in this folder; see launcher\start.ps1.
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher\start.ps1"
rem Exit code 1 means PowerShell itself failed; the script pauses on its own errors (exit code 2).
if %errorlevel% equ 1 pause
