$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8000
$endpoint = "http://localhost:$port/"

$mimeTypes = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".webmanifest" = "application/manifest+json; charset=utf-8"
  ".svg" = "image/svg+xml"
  ".png" = "image/png"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".ico" = "image/x-icon"
  ".txt" = "text/plain; charset=utf-8"
}

function Get-ContentType {
  param([string]$Path)

  $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
  if ($mimeTypes.ContainsKey($extension)) {
    return $mimeTypes[$extension]
  }

  "application/octet-stream"
}

function Resolve-RequestPath {
  param([string]$RawPath)

  $cleanPath = $RawPath.Split("?")[0]
  $relativePath = [Uri]::UnescapeDataString($cleanPath.TrimStart("/"))

  if ([string]::IsNullOrWhiteSpace($relativePath)) {
    $relativePath = "index.html"
  }

  $candidate = Join-Path $root $relativePath
  $fullPath = [System.IO.Path]::GetFullPath($candidate)

  if (-not $fullPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }

  if (Test-Path $fullPath -PathType Container) {
    $fullPath = Join-Path $fullPath "index.html"
  }

  $fullPath
}

function Write-Response {
  param(
    [System.Net.Sockets.NetworkStream]$Stream,
    [int]$StatusCode,
    [string]$StatusText,
    [byte[]]$Body,
    [string]$ContentType
  )

  $headerText = @(
    "HTTP/1.1 $StatusCode $StatusText"
    "Content-Type: $ContentType"
    "Content-Length: $($Body.Length)"
    "Connection: close"
    ""
    ""
  ) -join "`r`n"

  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headerText)
  $Stream.Write($headerBytes, 0, $headerBytes.Length)
  $Stream.Write($Body, 0, $Body.Length)
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)

try {
  $listener.Start()
} catch {
  Write-Host "Could not start the local server on $endpoint" -ForegroundColor Red
  throw
}

Write-Host ""
Write-Host "Campus Collective local server is running." -ForegroundColor Green
Write-Host "Open $endpoint in your browser." -ForegroundColor Cyan
Write-Host "Press Ctrl+C to stop the server." -ForegroundColor Yellow
Write-Host ""

try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $null

    try {
      $stream = $client.GetStream()
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()

      if ([string]::IsNullOrWhiteSpace($requestLine)) {
        continue
      }

      while (($line = $reader.ReadLine()) -ne "") {
        if ($null -eq $line) {
          break
        }
      }

      $parts = $requestLine.Split(" ")
      if ($parts.Length -lt 2) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Bad request")
        Write-Response -Stream $stream -StatusCode 400 -StatusText "Bad Request" -Body $body -ContentType "text/plain; charset=utf-8"
        continue
      }

      $method = $parts[0].ToUpperInvariant()
      $requestPath = Resolve-RequestPath -RawPath $parts[1]

      if ($method -ne "GET") {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Method not allowed")
        Write-Response -Stream $stream -StatusCode 405 -StatusText "Method Not Allowed" -Body $body -ContentType "text/plain; charset=utf-8"
        continue
      }

      if (-not $requestPath -or -not (Test-Path $requestPath -PathType Leaf)) {
        $body = [System.Text.Encoding]::UTF8.GetBytes("Not found")
        Write-Response -Stream $stream -StatusCode 404 -StatusText "Not Found" -Body $body -ContentType "text/plain; charset=utf-8"
        continue
      }

      $fileBytes = [System.IO.File]::ReadAllBytes($requestPath)
      $contentType = Get-ContentType -Path $requestPath
      Write-Response -Stream $stream -StatusCode 200 -StatusText "OK" -Body $fileBytes -ContentType $contentType
    } finally {
      if ($stream) {
        $stream.Dispose()
      }
      $client.Dispose()
    }
  }
} finally {
  $listener.Stop()
}
