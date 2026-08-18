# Build the plugin and restart the Windows-native DSH instance so the latest
# code goes live immediately.
#
# Usage:
#   pwsh scripts/dev-windows-reload.ps1 [-Port 3091]
#
# The Windows web profile links the package straight to this checkout
# (~/.dsh/profiles/web/node_modules/dsh-network-settings -> C:\dsh-network-settings,
# a directory junction), so the only steps are: build fresh lib/ here, then
# restart the Windows DSH instance. Unlike the WSL case (dev-wsl-reload.ps1),
# the Manager Control pipe is exactly right here: dsh-windows-manager targets
# the default Windows instance by design.
param(
  [int]$Port = 3091
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

dsh-windows-manager restart
if ($LASTEXITCODE -ne 0) { throw 'dsh-windows-manager restart failed' }

# Verify the instance is back before declaring success.
$Ready = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/" -UseBasicParsing -TimeoutSec 4
    if ($response.StatusCode -ge 200) { $Ready = $true; break }
  } catch {
    # Not listening yet; keep waiting.
  }
}
if (-not $Ready) { throw "DSH did not come back on port $Port within 15s" }
Write-Host "windows DSH reloaded: http://127.0.0.1:$Port/"
