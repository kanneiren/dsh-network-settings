# Build the plugin and restart the WSL DSH test instance so the latest code
# goes live immediately.
#
# Usage:
#   pwsh scripts/dev-wsl-reload.ps1 [-Distro Ubuntu-24.04] [-Port 3092]
#
# The WSL profile links the package straight to this checkout
# (~/.dsh/profiles/web/node_modules/dsh-network-settings -> /mnt/c/dsh-network-settings),
# so the only steps are: build fresh lib/ here, then restart DSH in WSL.
#
# Do NOT use `dsh-windows-manager restart` here: the DeepSeek Harness Manager
# Control pipe ignores instance targeting and always restarts the default
# Windows instance. wsl-dsh-restart.sh stops the WSL instance via its Runtime
# Bridge (or SIGTERM) and relaunches the manager's exact launch command, which
# the Manager re-adopts afterwards.
param(
  [string]$Distro = 'Ubuntu-24.04',
  [int]$Port = 3092
)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

Push-Location $Root
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
} finally {
  Pop-Location
}

# C:\dsh-network-settings -> /mnt/c/dsh-network-settings (WSL is case-sensitive)
$WslRoot = ('/mnt/' + $Root.Substring(0, 1).ToLower() + $Root.Substring(2)) -replace '\\', '/'
$env:PORT = "$Port"
wsl.exe -d $Distro -- bash "$WslRoot/scripts/wsl-dsh-restart.sh"
if ($LASTEXITCODE -ne 0) { throw 'wsl-dsh-restart.sh failed' }
