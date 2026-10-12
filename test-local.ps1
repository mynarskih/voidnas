$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$compose = @('-f', 'docker-compose.yml', '-f', 'docker-compose.local.yml')
$testDatabase = 'voidnas_regression_test_' + [guid]::NewGuid().ToString('N')
if ($testDatabase -notmatch '^voidnas_regression_test_[a-f0-9]{32}$') { throw 'Invalid test database target.' }
$databaseUser = (& docker compose @compose exec -T postgres printenv POSTGRES_USER).Trim()
$connection = (& docker compose @compose exec -T api printenv DATABASE_URL).Trim()
$testConnection = $connection -replace '/[^/?]+(\?.*)?$', "/$testDatabase"
if ($testConnection -eq $connection) { throw 'Could not isolate the test database connection.' }
$testScript = (Resolve-Path -LiteralPath 'scripts/regression.mjs').Path
$featureScript = (Resolve-Path -LiteralPath 'scripts/feature-regression.mjs').Path
$durableScript = (Resolve-Path -LiteralPath 'scripts/durable-upload-regression.mjs').Path
$testStorageRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'work'))
New-Item -ItemType Directory -Path $testStorageRoot -Force | Out-Null
$testStorage = Join-Path $testStorageRoot ('regression-storage-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testStorage | Out-Null
try {
  & docker compose @compose exec -T postgres psql -U $databaseUser -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE $testDatabase"
  if ($LASTEXITCODE -ne 0) { throw 'Could not create isolated test database.' }
  & docker compose @compose run --rm --no-deps -T -e "DATABASE_URL=$testConnection" migrate
  if ($LASTEXITCODE -ne 0) { throw 'Test migration failed.' }
  & docker compose @compose run --rm --no-deps -T -e "DATABASE_URL=$testConnection" -e 'STORAGE_ROOT=/tmp/voidnas-regression-storage' -v "${testStorage}:/tmp/voidnas-regression-storage" -v "${testScript}:/app/regression.mjs:ro" -v "${featureScript}:/app/feature-regression.mjs:ro" -v "${durableScript}:/app/durable-upload-regression.mjs:ro" api node /app/regression.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Regression tests failed.' }
} finally {
  & docker compose @compose exec -T postgres psql -U $databaseUser -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $testDatabase WITH (FORCE)"
  $resolvedTestStorage = (Resolve-Path -LiteralPath $testStorage).Path
  if ([IO.Path]::GetDirectoryName($resolvedTestStorage) -ne $testStorageRoot -or [IO.Path]::GetFileName($resolvedTestStorage) -notmatch '^regression-storage-[a-f0-9]{32}$') { throw 'Refusing cleanup outside the isolated test directory.' }
  Remove-Item -LiteralPath $resolvedTestStorage -Recurse -Force
}
