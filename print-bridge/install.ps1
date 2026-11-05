# Installs the Buzzify print bridge on this PC, once: copies it, starts it with Windows, starts it now.
# Run by double-clicking install.cmd. Needs no administrator rights.
param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'BuzzifyPrintBridge'),
  [switch]$NoStartup,
  [switch]$NoLaunch,
  [switch]$SkipNode
)
$ErrorActionPreference = 'Stop'

function Say($text) { Write-Host $text }

# 1. Node.js 20 or newer.
function Get-NodeMajor {
  try { return [int]((& node -v) -replace '^v(\d+)\..*$', '$1') } catch { return 0 }
}
if (-not $SkipNode -and (Get-NodeMajor) -lt 20) {
  Say 'Node.js 20 or newer is needed. Installing it (this takes a minute)...'
  try {
    & winget install OpenJS.NodeJS.LTS -e --silent --accept-package-agreements --accept-source-agreements | Out-Null
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
  } catch { }
  if ((Get-NodeMajor) -lt 20) {
    Say ''
    Say 'Could not install Node.js automatically.'
    Say 'Install it from https://nodejs.org (the LTS button), then run this file again.'
    exit 1
  }
}

# 2. Copy the bridge.
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
Copy-Item (Join-Path $PSScriptRoot 'bridge.mjs') (Join-Path $InstallDir 'bridge.mjs') -Force
$launcher = Join-Path $InstallDir 'start-bridge.cmd'
Set-Content -Path $launcher -Encoding ASCII -Value "@echo off`r`ncd /d `"%~dp0`"`r`nnode bridge.mjs`r`n"
Say "Installed in $InstallDir"

# 3. Start with Windows (a minimized window; closing it stops the bridge until the next sign-in).
if (-not $NoStartup) {
  $startup = [Environment]::GetFolderPath('Startup')
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut((Join-Path $startup 'Buzzify Print Bridge.lnk'))
  $link.TargetPath = $launcher
  $link.WorkingDirectory = $InstallDir
  $link.WindowStyle = 7
  $link.Save()
  Say 'It will start by itself when Windows starts.'
}

# 4. Start it now, replacing a bridge that is already running.
if (-not $NoLaunch) {
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'bridge\.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
  Start-Process -FilePath $launcher -WindowStyle Minimized
  Say 'The print bridge is running.'
}

Say ''
Say 'Done. Open the pharmacy, then Settings > Print settings, choose the receipt printer and press Save.'
