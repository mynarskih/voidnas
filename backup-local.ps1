param([string]$DestinationRoot = 'backups')
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$compose = @('-f', 'docker-compose.yml', '-f', 'docker-compose.local.yml')
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.public-deployment')) { $compose += @('-f','docker-compose.public.yml') }
$configuration = & docker compose @compose config --format json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect Docker Compose configuration.' }
$mount = $configuration.services.api.volumes | Where-Object { $_.target -eq '/srv/nas/storage' -and $_.type -eq 'bind' } | Select-Object -First 1
if (-not $mount) { throw 'Storage bind mount not found.' }
$storagePath = (Resolve-Path -LiteralPath $mount.source).Path
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')
$backupRoot = Join-Path $PSScriptRoot $DestinationRoot
$backupPath = Join-Path $backupRoot $stamp
New-Item -ItemType Directory -Path $backupPath -Force -ErrorAction Stop | Out-Null
$dumpInContainer = "/tmp/voidnas-$stamp.dump"
$apiStopped = $false
$backupSucceeded = $false
function Write-BackupStatus {
  $operationsPath=Join-Path $storagePath '.operations'
  if (Test-Path -LiteralPath $operationsPath) {
    if ((Get-Item -LiteralPath $operationsPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe operations directory.' }
  }
  New-Item -ItemType Directory -Path $operationsPath -Force | Out-Null
  $statusPath=Join-Path $operationsPath 'backup-status.json'
  $lastSuccess=$null
  if (Test-Path -LiteralPath $statusPath) {
    if ((Get-Item -LiteralPath $statusPath).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unsafe backup status path.' }
    try { $lastSuccess=(Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json).lastSuccessAt } catch { $lastSuccess=$null }
  }
  $attempt=(Get-Date).ToUniversalTime().ToString('o')
  $status=@{status=$(if($backupSucceeded){'success'}else{'failed'});lastAttemptAt=$attempt;lastSuccessAt=$(if($backupSucceeded){$attempt}else{$lastSuccess})} | ConvertTo-Json -Compress
  $statusTemp=Join-Path $operationsPath ('backup-status-'+[guid]::NewGuid().ToString('N')+'.tmp')
  [IO.File]::WriteAllText($statusTemp,$status,[Text.UTF8Encoding]::new($false))
  Move-Item -LiteralPath $statusTemp -Destination $statusPath -Force
}
try {
  & docker compose @compose stop api
  if ($LASTEXITCODE -ne 0) { throw 'Could not stop API for a consistent backup.' }
  $apiStopped = $true
  $databaseUser = (& docker compose @compose exec -T postgres printenv POSTGRES_USER).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $databaseUser) { throw 'Could not read database user.' }
  $databaseName = (& docker compose @compose exec -T postgres printenv POSTGRES_DB).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $databaseName) { throw 'Could not read database name.' }
  & docker compose @compose exec -T postgres pg_dump -U $databaseUser -d $databaseName --format=custom "--file=$dumpInContainer"
  if ($LASTEXITCODE -ne 0) { throw 'Database backup failed.' }
  & docker compose @compose cp "postgres:$dumpInContainer" (Join-Path $backupPath 'database.dump')
  if ($LASTEXITCODE -ne 0) { throw 'Could not copy database backup.' }
  # Retain staged COMPLETE files/journals for crash recovery; omit partial streams.
  & tar -C $storagePath '--exclude=users/*/.tmp/*' '--exclude=users/*/.edits/*.tmp' '--exclude=users/*/.previews/*' '--exclude=.operations/*.tmp' -czf (Join-Path $backupPath 'storage.tar.gz') .
  if ($LASTEXITCODE -ne 0) { throw 'Storage backup failed.' }
  $databaseHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $backupPath 'database.dump')).Hash.ToLowerInvariant()
  $storageHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $backupPath 'storage.tar.gz')).Hash.ToLowerInvariant()
  @("$databaseHash  database.dump", "$storageHash  storage.tar.gz") | Set-Content -LiteralPath (Join-Path $backupPath 'SHA256SUMS') -Encoding ascii
  $backupSucceeded = $true
  Write-Host "Backup created: $backupPath" -ForegroundColor Green
} finally {
  try { Write-BackupStatus } catch { Write-Warning 'Could not record backup result for the NAS alerts.' }
  & docker compose @compose exec -T postgres rm -f $dumpInContainer 2>$null
  if ($apiStopped) { & docker compose @compose start api }
}
