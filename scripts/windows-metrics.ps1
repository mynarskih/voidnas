param(
  [string]$StoragePath = (Join-Path $PSScriptRoot '..\storage'),
  [int]$Port = 9182
)
$ErrorActionPreference = 'Stop'
$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
$pidFile = Join-Path $PSScriptRoot '..\.local-metrics.pid'
[System.IO.File]::WriteAllText($pidFile, [string]$PID)
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
      $client.ReceiveTimeout = 3000
      $client.SendTimeout = 3000
      $stream = $client.GetStream()
      $request = New-Object System.Collections.Generic.List[byte]
      while ($request.Count -lt 8192) {
        $next = $stream.ReadByte()
        if ($next -lt 0) { break }
        $request.Add([byte]$next)
        $count = $request.Count
        if ($count -ge 4 -and $request[$count-4] -eq 13 -and $request[$count-3] -eq 10 -and $request[$count-2] -eq 13 -and $request[$count-1] -eq 10) { break }
      }
      $firstLine = ([System.Text.Encoding]::ASCII.GetString($request.ToArray()) -split "`r`n", 2)[0]
      if ($firstLine -ne 'GET /metrics HTTP/1.1' -and $firstLine -ne 'GET /metrics HTTP/1.0') {
        $status = '404 Not Found'
        $body = '{"error":"Not found"}'
      } else {
        $status = '200 OK'
        try {
          $os = Get-CimInstance Win32_OperatingSystem
          $processors = @(Get-CimInstance Win32_Processor)
          $total = [int64]$os.TotalVisibleMemorySize * 1024
          $available = [int64]$os.FreePhysicalMemory * 1024
          $driveRoot = [System.IO.Path]::GetPathRoot((Resolve-Path -LiteralPath $StoragePath).Path)
          $drive = [System.IO.DriveInfo]::new($driveRoot)
          $cpuUsage = [math]::Round(($processors | Measure-Object -Property LoadPercentage -Average).Average, 1)
          $model = ($processors | Select-Object -First 1).Name
          $threads = ($processors | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum
          $metrics = @{
            source = 'HOST'; status = 'Healthy'
            cpu = @{ model = $model; cores = $null; threads = $threads; usagePercent = $cpuUsage; loadAverage = $null }
            memory = @{ totalBytes = $total; usedBytes = $total - $available; availableBytes = $available; usagePercent = [math]::Round(($total - $available) / $total * 100, 1) }
            storage = @{ totalBytes = $drive.TotalSize; usedBytes = $drive.TotalSize - $drive.AvailableFreeSpace; freeBytes = $drive.AvailableFreeSpace; usagePercent = [math]::Round(($drive.TotalSize - $drive.AvailableFreeSpace) / $drive.TotalSize * 100, 1) }
            system = @{ hostname = $os.CSName; operatingSystem = $os.Caption; kernel = $os.Version; architecture = $env:PROCESSOR_ARCHITECTURE; uptimeSeconds = [math]::Floor(((Get-Date) - $os.LastBootUpTime).TotalSeconds) }
          }
          $body = ConvertTo-Json -InputObject $metrics -Depth 5 -Compress
        } catch {
          $status = '503 Service Unavailable'
          $body = '{"error":"Host metrics unavailable"}'
        }
      }
      $payload = [System.Text.Encoding]::UTF8.GetBytes($body)
      $header = [System.Text.Encoding]::ASCII.GetBytes("HTTP/1.1 $status`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($payload.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n")
      $stream.Write($header, 0, $header.Length)
      $stream.Write($payload, 0, $payload.Length)
    } catch { }
    finally { $client.Dispose() }
  }
} finally {
  $listener.Stop()
  if ((Test-Path -LiteralPath $pidFile) -and (Get-Content -LiteralPath $pidFile -Raw).Trim() -eq [string]$PID) {
    Remove-Item -LiteralPath $pidFile -Force
  }
}
