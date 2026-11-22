@echo off
setlocal
cd /d "%~dp0"
set "STRIKEBOOK_HOSTED_ORIGIN=https://yestertommorrow-a11y.github.io,https://trading-desk-ruby-one.vercel.app"
set "STRIKEBOOK_RUNTIME_ARGS="
set "STRIKEBOOK_LOCAL_RUNTIME=%~dp0.openbb-runtime"
if exist "%STRIKEBOOK_LOCAL_RUNTIME%\openbb\__init__.py" set STRIKEBOOK_RUNTIME_ARGS=--openbb-runtime "%STRIKEBOOK_LOCAL_RUNTIME%"
where python >nul 2>&1
if errorlevel 1 goto no_python
where openbb >nul 2>&1
if errorlevel 1 echo OpenBB CLI was not found on PATH. You can choose Sample mode under Data connection.
python -B server.py --port 8765 --fallback-port --open-browser --cors-origin "%STRIKEBOOK_HOSTED_ORIGIN%" --no-cboe-disk-cache %STRIKEBOOK_RUNTIME_ARGS%
if errorlevel 1 pause
exit /b
:no_python
echo Python 3.10 or newer is required for the local OpenBB bridge.
pause
exit /b 1
