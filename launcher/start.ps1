# Strikebook Windows launcher. Start Strikebook.cmd runs this script.
# First run: finds (or offers to install) Python 3.10-3.13, creates a private environment in .venv\
# and installs OpenBB into it. Every run: starts the local server on port 8765 and opens the browser.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts in the ANSI code page.

# 'Continue', not 'Stop': Windows PowerShell 5.1 turns pip's stderr warnings into fatal errors under 'Stop'.
# Each step checks its own result instead.
$ErrorActionPreference = 'Continue'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $Root
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$env:PYTHONIOENCODING = 'utf-8'
$Host.UI.RawUI.WindowTitle = 'Strikebook'

$HostedOrigins = 'https://yestertommorrow-a11y.github.io,https://trading-desk-ruby-one.vercel.app'
$Port = 8765
$Venv = Join-Path $Root '.venv'
$VenvPython = Join-Path $Venv 'Scripts\python.exe'
$VenvOpenBB = Join-Path $Venv 'Scripts\openbb.exe'
$Requirements = Join-Path $Root 'requirements-live.txt'
$ReadyMarker = Join-Path $Venv 'strikebook-ready.txt'
$InstallLog = Join-Path $Root 'strikebook-install.log'

function Say([string]$Text, [string]$Color = 'Gray') { Write-Host $Text -ForegroundColor $Color }
function Step([string]$Text) { Write-Host ''; Write-Host ">> $Text" -ForegroundColor Cyan }
function Fail([string]$Title, [string[]]$Lines) {
    Write-Host ''
    Write-Host "  PROBLEM: $Title" -ForegroundColor Red
    foreach ($line in $Lines) { Write-Host "  $line" -ForegroundColor Yellow }
    Write-Host ''
    Write-Host '  Need help? Open an issue at https://github.com/yestertommorrow-a11y/Trading-Desk/issues' -ForegroundColor Gray
    Write-Host '  and attach strikebook-install.log from this folder if it exists.' -ForegroundColor Gray
    Write-Host ''
    Read-Host '  Press Enter to close this window' | Out-Null
    exit 2  # already paused above; Start Strikebook.cmd only pauses for exit code 1
}
function Ask([string]$Question) {
    while ($true) {
        $reply = Read-Host "$Question [Y/N]"
        if ($null -eq $reply) { return $false }  # no keyboard input available
        $answer = $reply.Trim().ToUpperInvariant()
        if ($answer -in 'Y', 'YES') { return $true }
        if ($answer -in 'N', 'NO') { return $false }
    }
}

Write-Host ''
Write-Host '  ==============================================' -ForegroundColor DarkCyan
Write-Host '    Strikebook - options research (live data)   ' -ForegroundColor White
Write-Host '  ==============================================' -ForegroundColor DarkCyan

# --- 1. Must run from an extracted folder, not from inside the ZIP -------------------------------
# Explorer opens files inside a ZIP from a temporary folder such as ...\Temp\Temp1_Strikebook-windows.zip\
if ($Root -match '\\Temp\d*_[^\\]*\.zip(\\|$)' -or $Root -match '\\Rar\$') {
    Fail 'Strikebook is running from inside the ZIP file.' @(
        'Windows only opened the ZIP temporarily, so Strikebook cannot install anything.',
        '1. Close this window.',
        '2. In File Explorer, right-click Strikebook-windows.zip and choose "Extract All...", then "Extract".',
        '3. Open the new Strikebook folder and double-click "Start Strikebook.cmd" there.')
}

# --- 2. Already running? Just open it. -----------------------------------------------------------
try {
    $status = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/status" -TimeoutSec 3
    if ($status.data.backend) {
        Say ''
        Say "Strikebook is already running on this PC. Opening http://127.0.0.1:$Port/ ..." 'Green'
        Start-Process "http://127.0.0.1:$Port/"
        Start-Sleep -Seconds 4
        exit 0
    }
} catch {}

# --- 3. Find Python 3.10-3.13 --------------------------------------------------------------------
function Test-Python([string]$Exe, [string[]]$PreArgs = @()) {
    try {
        # No double quotes in the code: Windows PowerShell 5.1 strips them from native arguments.
        $out = & $Exe @PreArgs -c 'import sys; print(str(sys.version_info[0]) + chr(46) + str(sys.version_info[1]) + chr(124) + sys.executable)' 2>$null
        if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
        $version, $path = ([string]($out | Select-Object -Last 1)).Split('|', 2)
        $major, $minor = $version.Split('.') | ForEach-Object { [int]$_ }
        if ($major -eq 3 -and $minor -ge 10 -and $minor -le 13 -and (Test-Path -LiteralPath $path)) {
            return [pscustomobject]@{ Version = $version; Path = $path }
        }
    } catch {}
    return $null
}
function Find-Python {
    foreach ($minor in 12, 13, 11, 10) {
        if (Get-Command py -ErrorAction SilentlyContinue) {
            $found = Test-Python 'py' @("-3.$minor"); if ($found) { return $found }
        }
        foreach ($dir in "$env:LOCALAPPDATA\Programs\Python\Python3$minor", "$env:ProgramFiles\Python3$minor") {
            $exe = Join-Path $dir 'python.exe'
            if (Test-Path -LiteralPath $exe) { $found = Test-Python $exe; if ($found) { return $found } }
        }
    }
    foreach ($name in 'python', 'python3') {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        # Skip the Microsoft Store placeholder in WindowsApps, which opens the Store instead of running Python.
        if ($cmd -and $cmd.Source -notlike '*\WindowsApps\*') { $found = Test-Python $cmd.Source; if ($found) { return $found } }
    }
    return $null
}

$venvReady = (Test-Path -LiteralPath $VenvPython) -and (Test-Path -LiteralPath $VenvOpenBB) -and (Test-Path -LiteralPath $ReadyMarker)
$requirementsHash = (Get-FileHash -LiteralPath $Requirements -Algorithm SHA256).Hash
if ($venvReady -and ((Get-Content -LiteralPath $ReadyMarker -Raw).Trim() -ne $requirementsHash)) { $venvReady = $false }

if (-not $venvReady) {
    Say ''
    Say 'First-time setup. This installs OpenBB (the free market-data library Strikebook uses)'
    Say 'into a private folder inside Strikebook. It changes nothing else on your PC.'
    Say 'It downloads about 300 MB and takes 5-15 minutes. You only do this once.'

    Step 'Looking for Python 3.10 - 3.13'
    $python = Find-Python
    if (-not $python) {
        Say 'Python 3.10 - 3.13 was not found on this PC.' 'Yellow'
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if ($winget) {
            Say 'Strikebook can install Python 3.12 for you, for your Windows account only, using Windows'' own'
            Say 'installer (winget). This accepts the Python Software Foundation licence.'
            if (-not (Ask 'Install Python 3.12 now?')) {
                Fail 'Python is needed for live data.' @(
                    'Install Python 3.12 from https://www.python.org/downloads/windows/',
                    '(in the installer, tick "Add python.exe to PATH"), then double-click Start Strikebook.cmd again.',
                    'Or use the hosted site in sample mode without installing anything.')
            }
            Step 'Installing Python 3.12 (a Windows prompt may ask for permission)'
            & winget install --exact --id Python.Python.3.12 --scope user --silent --accept-package-agreements --accept-source-agreements
            $python = Find-Python
        } else {
            Start-Process 'https://www.python.org/downloads/release/python-3129/'
        }
        if (-not $python) {
            Fail 'Python could not be found after installation.' @(
                'Your browser has opened the Python download page (or open https://www.python.org/downloads/windows/).',
                '1. Download "Windows installer (64-bit)" for Python 3.12 and run it.',
                '2. Tick "Add python.exe to PATH" at the bottom of the first screen, then click "Install Now".',
                '3. Close this window and double-click Start Strikebook.cmd again.',
                'Note: Python 3.14 and newer are not supported by OpenBB yet.')
        }
    }
    Say "Using Python $($python.Version) at $($python.Path)" 'Green'

    Step 'Creating the private environment (.venv)'
    if (Test-Path -LiteralPath $Venv) { Remove-Item -LiteralPath $Venv -Recurse -Force }
    & $python.Path -m venv $Venv
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $VenvPython)) {
        Fail 'Could not create the Python environment.' @(
            'Try moving the Strikebook folder somewhere simple, such as Documents\Strikebook, and run it again.',
            'Folders synced by OneDrive or protected by antivirus can block this step.')
    }

    Step 'Installing OpenBB and Yahoo Finance (this is the long part; keep this window open)'
    "Strikebook install log $(Get-Date -Format s)`r`nPython $($python.Version) $($python.Path)" | Set-Content -LiteralPath $InstallLog -Encoding UTF8
    & $VenvPython -m pip install --upgrade pip --disable-pip-version-check 2>&1 | Tee-Object -FilePath $InstallLog -Append | Select-String -Pattern '^(Successfully|ERROR)' | ForEach-Object { Say "   $_" }
    & $VenvPython -m pip install --disable-pip-version-check --prefer-binary -r $Requirements 2>&1 | Tee-Object -FilePath $InstallLog -Append |
        ForEach-Object { if ($_ -match '^(Collecting|Successfully installed|ERROR)') { Say ("   " + ([string]$_).Substring(0, [Math]::Min(110, ([string]$_).Length))) } }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $VenvOpenBB)) {
        Fail 'Installing OpenBB failed.' @(
            'Check your internet connection and double-click Start Strikebook.cmd again. Files already downloaded are reused.',
            'Company networks sometimes block Python downloads. Try a home network.',
            "Details are in $InstallLog")
    }

    Step 'Adding the optional candlestick pattern engine (TA-Lib)'
    & $VenvPython -m pip install --disable-pip-version-check --only-binary=:all: -r (Join-Path $Root 'requirements-patterns.txt') 2>&1 | Out-File -LiteralPath $InstallLog -Append -Encoding UTF8
    if ($LASTEXITCODE -eq 0) { Say '   TA-Lib installed: all 61 pattern detectors are available.' 'Green' }
    else { Say '   TA-Lib was not installed. Strikebook still works with its 3 built-in pattern detectors.' 'Yellow' }

    Step 'Preparing OpenBB (first start only, about a minute)'
    & $VenvOpenBB --help *> $null
    Set-Content -LiteralPath $ReadyMarker -Value $requirementsHash -Encoding ASCII
    Say 'Setup complete.' 'Green'
}

# --- 4. Start the server -------------------------------------------------------------------------
$serverArgs = @('-B', 'server.py', '--port', $Port, '--fallback-port', '--open-browser',
    '--cli', $VenvOpenBB, '--cors-origin', $HostedOrigins, '--no-cboe-disk-cache')
$runtime = Join-Path $Root '.openbb-runtime'
if (Test-Path -LiteralPath (Join-Path $runtime 'openbb\__init__.py')) { $serverArgs += @('--openbb-runtime', $runtime) }

Write-Host ''
Write-Host '  ==============================================================' -ForegroundColor Green
Write-Host '   Strikebook is starting. Your browser will open in a moment.' -ForegroundColor Green
Write-Host '   KEEP THIS WINDOW OPEN while you use Strikebook.' -ForegroundColor White
Write-Host '   To stop Strikebook, close this window.' -ForegroundColor Gray
Write-Host '   The first data can take up to a minute to appear.' -ForegroundColor Gray
Write-Host '  ==============================================================' -ForegroundColor Green
Write-Host ''
& $VenvPython @serverArgs
if ($LASTEXITCODE -ne 0) {
    Fail 'Strikebook stopped unexpectedly.' @('Read the messages above. Then close this window and double-click Start Strikebook.cmd again.')
}
