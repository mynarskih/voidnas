$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$metricsUrl = 'http://127.0.0.1:9182/metrics'
$monitorReady = $false
try { $monitorReady = (Invoke-WebRequest -Uri $metricsUrl -TimeoutSec 2).StatusCode -eq 200 } catch { }
if (-not $monitorReady) {
  $scriptPath = (Resolve-Path -LiteralPath 'scripts/windows-metrics.ps1').Path
  $storagePath = (Resolve-Path -LiteralPath 'storage').Path
  $arguments = '-NoProfile -File "' + $scriptPath + '" -StoragePath "' + $storagePath + '"'
  Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $arguments -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 500
    try { $monitorReady = (Invoke-WebRequest -Uri $metricsUrl -TimeoutSec 2).StatusCode -eq 200; if ($monitorReady) { break } } catch { }
  }
  if (-not $monitorReady) { Write-Warning 'Windows host metrics are unavailable; CPU and RAM charts will show Unavailable.' }
}
$compose=@('-f','docker-compose.yml','-f','docker-compose.local.yml')
$publicMode=Test-Path -LiteralPath (Join-Path $PSScriptRoot '.public-deployment')
if($publicMode){$compose+=@('-f','docker-compose.public.yml')}
docker compose @compose up -d
if($LASTEXITCODE -ne 0){throw 'Could not start VoidNAS.'}
docker compose @compose ps
Write-Host $(if($publicMode){'VoidNAS: https://nas.serwerbb.win'}else{'VoidNAS: http://localhost:8090'}) -ForegroundColor Green
