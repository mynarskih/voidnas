param([Parameter(Mandatory=$true)][string]$BackupPath)
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$backup=(Resolve-Path -LiteralPath $BackupPath).Path
foreach($line in Get-Content -LiteralPath (Join-Path $backup 'SHA256SUMS')){
  if($line -notmatch '^([a-f0-9]{64})  (database\.dump|storage\.tar\.gz)$'){throw 'Invalid backup checksum manifest.'}
  $expected=$Matches[1];$filename=$Matches[2]
  if((Get-FileHash -LiteralPath (Join-Path $backup $filename) -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected){throw 'Backup checksum mismatch.'}
}
$compose=@('-f','docker-compose.yml','-f','docker-compose.local.yml')
$testId=[guid]::NewGuid().ToString('N');$testDatabase='voidnas_restore_test_'+$testId
$workRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'work'))
New-Item -ItemType Directory -Path $workRoot -Force | Out-Null
$testStorage=Join-Path $workRoot ('restore-storage-'+$testId)
New-Item -ItemType Directory -Path $testStorage | Out-Null
$databaseUser=(& docker compose @compose exec -T postgres printenv POSTGRES_USER).Trim()
$connection=(& docker compose @compose exec -T api printenv DATABASE_URL).Trim()
$testConnection=$connection -replace '/[^/?]+(\?.*)?$',"/$testDatabase"
if($testConnection -eq $connection -or $testDatabase -notmatch '^voidnas_restore_test_[a-f0-9]{32}$'){throw 'Could not isolate restore test.'}
$archive=Join-Path $backup 'storage.tar.gz'
foreach($entry in (& tar -tzf $archive)){if($entry -match '(^/|^[a-zA-Z]:|(^|/)\.\.(/|$))'){throw 'Unsafe archive path.'}}
if($LASTEXITCODE -ne 0){throw 'Could not inspect backup archive.'}
$dumpInContainer='/tmp/voidnas-restore-'+$testId+'.dump'
try{
  & tar -xzf $archive -C $testStorage
  if($LASTEXITCODE -ne 0){throw 'Could not restore test storage.'}
  & docker compose @compose exec -T postgres psql -U $databaseUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $testDatabase"
  if($LASTEXITCODE -ne 0){throw 'Could not create test database.'}
  & docker compose @compose cp (Join-Path $backup 'database.dump') "postgres:$dumpInContainer"
  if($LASTEXITCODE -ne 0){throw 'Could not copy backup dump.'}
  & docker compose @compose exec -T postgres pg_restore --exit-on-error -U $databaseUser -d $testDatabase $dumpInContainer
  if($LASTEXITCODE -ne 0){throw 'Database restore failed.'}
  & docker compose @compose run --rm --no-deps -T -e "DATABASE_URL=$testConnection" migrate
  if($LASTEXITCODE -ne 0){throw 'Migration of restored database failed.'}
  $testScript=(Resolve-Path -LiteralPath 'scripts/verify-restore.mjs').Path
  & docker compose @compose run --rm --no-deps -T -e "DATABASE_URL=$testConnection" -e 'STORAGE_ROOT=/tmp/voidnas-restore-test' -v "${testStorage}:/tmp/voidnas-restore-test" -v "${testScript}:/app/verify-restore.mjs:ro" api node /app/verify-restore.mjs
  if($LASTEXITCODE -ne 0){throw 'Restored files did not match the restored database.'}
}finally{
  & docker compose @compose exec -T postgres psql -U $databaseUser -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $testDatabase WITH (FORCE)"
  & docker compose @compose exec -T postgres rm -f $dumpInContainer
  $resolvedTestStorage=(Resolve-Path -LiteralPath $testStorage).Path
  if([IO.Path]::GetDirectoryName($resolvedTestStorage) -ne $workRoot -or [IO.Path]::GetFileName($resolvedTestStorage) -notmatch '^restore-storage-[a-f0-9]{32}$'){throw 'Refusing cleanup outside restore test directory.'}
  Remove-Item -LiteralPath $resolvedTestStorage -Recurse -Force
}
