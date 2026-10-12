$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$compose=@('-f','docker-compose.yml','-f','docker-compose.local.yml')
if(Test-Path -LiteralPath (Join-Path $PSScriptRoot '.public-deployment')){$compose+=@('-f','docker-compose.public.yml')}
# Keep the network attached to the external home HTTPS gateway.
docker compose @compose stop
$pidFile = Join-Path $PSScriptRoot '.local-metrics.pid'
if (Test-Path -LiteralPath $pidFile) {
  $monitorPid = 0
  if ([int]::TryParse((Get-Content -LiteralPath $pidFile -Raw).Trim(), [ref]$monitorPid)) {
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$monitorPid" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -like '*windows-metrics.ps1*') { Stop-Process -Id $monitorPid -ErrorAction SilentlyContinue }
  }
  Remove-Item -LiteralPath $pidFile -Force
}
