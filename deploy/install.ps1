Param(
  [ValidateSet("local", "release")]
  [string]$Mode = "release",

  [string]$Output,

  [switch]$NoUp
)

$ErrorActionPreference = "Stop"
$CurrentStep = "init"
$FailureReported = $false

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$Template = Join-Path $ScriptDir "docker-compose.$Mode.yml"
$EnvFile = Join-Path $RepoRoot ".env"

function Write-InstallLine([string]$level, [string]$message) {
  $line = "[alloy-install][$Mode][$level] $message"
  if ($level -eq "ERROR") {
    [Console]::Error.WriteLine($line)
    return
  }
  Write-Host $line
}

function Write-InstallInfo([string]$message) {
  Write-InstallLine "INFO" $message
}

function Write-InstallWarn([string]$message) {
  Write-InstallLine "WARN" $message
}

function Write-InstallError([string]$message) {
  Write-InstallLine "ERROR" $message
}

function Write-InstallHint([string]$message) {
  [Console]::Error.WriteLine("  -> $message")
}

function Fail-WithHelp([string]$message, [string[]]$hints = @()) {
  $script:FailureReported = $true
  Write-InstallError $message
  foreach ($hint in $hints) {
    Write-InstallHint $hint
  }
  throw $message
}

function Ensure-DirectoryWritable([string]$path, [string]$label) {
  New-Item -ItemType Directory -Path $path -Force | Out-Null
  if (!(Test-Path -Path $path -PathType Container)) {
    Fail-WithHelp "$label directory is not accessible: $path"
  }

  $probe = Join-Path $path ".alloy-write-test-$PID.tmp"
  try {
    Set-Content -Path $probe -Value "probe" -Encoding UTF8 -NoNewline
  }
  catch {
    Fail-WithHelp "$label directory is not writable: $path" @("Grant write permission and rerun.")
  }
  finally {
    Remove-Item -Path $probe -Force -ErrorAction SilentlyContinue
  }
}

function Require-Command([string]$name) {
  if (!(Get-Command $name -ErrorAction SilentlyContinue)) {
    Fail-WithHelp "Required command not found: $name" @("Install '$name' and rerun deploy/install.ps1.")
  }
}

function Test-PortInUse([int]$port) {
  try {
    $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
    foreach ($listener in $listeners) {
      if ($listener.Port -eq $port) {
        return $true
      }
    }
  }
  catch {
    Write-InstallWarn "Skipping port check for $port because active listener query is unavailable."
    return $false
  }

  return $false
}

function Test-ServiceRunning([string]$serviceName) {
  $runningServices = docker compose --env-file $EnvFile -f $Output ps --status running --services 2>$null
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($runningServices)) {
    return $false
  }

  foreach ($line in ($runningServices -split "`r?`n")) {
    if ($line.Trim() -eq $serviceName) {
      return $true
    }
  }

  return $false
}

function Check-PortOrThrow([int]$port, [string]$serviceName, [string]$label) {
  if (!(Test-PortInUse $port)) {
    return
  }

  if (Test-ServiceRunning $serviceName) {
    Write-InstallInfo "Port $port is already held by running compose service '$serviceName'; continuing."
    return
  }

  Fail-WithHelp "Port $port is already in use before starting $label." @(
    "Stop the conflicting process (PowerShell: Get-NetTCPConnection -LocalPort $port -State Listen).",
    "Or update the port mapping in $Output and rerun."
  )
}

function Require-EnvValue([string]$key) {
  $value = [Environment]::GetEnvironmentVariable($key, "Process")
  if ([string]::IsNullOrWhiteSpace($value)) {
    Fail-WithHelp "Required environment variable '$key' is empty." @("Set $key in $EnvFile and rerun.")
  }
}

if (!(Test-Path $Template)) {
  Fail-WithHelp "Template not found: $Template" @("Run from a complete repository checkout and retry.")
}

if ([string]::IsNullOrWhiteSpace($Output)) {
  $Output = Join-Path $ScriptDir "docker-compose.generated.$Mode.yml"
}

function New-HexRandom([int]$byteCount) {
  $bytes = New-Object byte[] $byteCount
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  return ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

function New-Base64UrlRandom([int]$byteCount) {
  $bytes = New-Object byte[] $byteCount
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $b64 = [Convert]::ToBase64String($bytes)
  return $b64.TrimEnd('=') -replace '\+', '-' -replace '/', '_'
}

function Ensure-EnvKey([string]$key, [string]$value, [string]$filePath) {
  if (!(Test-Path $filePath)) {
    New-Item -ItemType File -Path $filePath | Out-Null
  }

  $lines = Get-Content -Path $filePath
  $pattern = "^$([Regex]::Escape($key))="
  $index = -1

  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) {
      $index = $i
      break
    }
  }

  if ($index -ge 0) {
    $current = $lines[$index].Substring($key.Length + 1)
    if (![string]::IsNullOrWhiteSpace($current)) {
      return
    }

    $lines[$index] = "$key=$value"
    Set-Content -Path $filePath -Value $lines
    return
  }

  Add-Content -Path $filePath -Value "$key=$value"
}

function Sync-ProcessEnvFromFile([string]$filePath) {
  if (!(Test-Path $filePath)) {
    return
  }

  foreach ($raw in Get-Content -Path $filePath) {
    $line = $raw.TrimEnd("`r")
    if ([string]::IsNullOrWhiteSpace($line)) {
      continue
    }

    if ($line.TrimStart().StartsWith("#")) {
      continue
    }

    $eq = $line.IndexOf("=")
    if ($eq -lt 1) {
      continue
    }

    $key = $line.Substring(0, $eq)
    if ($key -notmatch '^[A-Za-z_][A-Za-z0-9_]*$') {
      continue
    }

    $value = $line.Substring($eq + 1)
    [Environment]::SetEnvironmentVariable($key, $value, "Process")
  }
}

try {
  $CurrentStep = "directory preflight"
  Ensure-DirectoryWritable (Split-Path -Parent $Output) "compose output"
  Ensure-DirectoryWritable (Split-Path -Parent $EnvFile) "env"

  $CurrentStep = "env bootstrap"
  Ensure-EnvKey "ALLOY_JWT_SECRET" (New-Base64UrlRandom 48) $EnvFile
  Ensure-EnvKey "ALLOY_ADMIN_USER" "admin" $EnvFile
  Ensure-EnvKey "ALLOY_ADMIN_PASS" "admin123456" $EnvFile
  Ensure-EnvKey "ALLOY_WATCHTOWER_TOKEN" (New-HexRandom 24) $EnvFile

  if ($Mode -eq "local") {
    Ensure-EnvKey "ALLOY_POSTGRES_PASSWORD" (New-HexRandom 12) $EnvFile
    Ensure-EnvKey "ALLOY_CONTROL_BIND_ADDR" "127.0.0.1" $EnvFile
    Ensure-EnvKey "ALLOY_WEB_BIND_ADDR" "127.0.0.1" $EnvFile
    Ensure-EnvKey "ALLOY_AGENT_TRANSPORT" "auto" $EnvFile
    Ensure-EnvKey "ALLOY_AGENT_CONNECT_TOKEN" "" $EnvFile
    Ensure-EnvKey "ALLOY_ALLOW_UNAUTHENTICATED_AGENT_WS" "false" $EnvFile
  }
  else {
    Ensure-EnvKey "ALLOY_POSTGRES_DATA_DIR" "./alloy-postgres" $EnvFile
  }

  Sync-ProcessEnvFromFile $EnvFile

  Copy-Item -Path $Template -Destination $Output -Force

  $dataDir = ""
  if ($Mode -eq "release") {
    $CurrentStep = "release data directory preflight"
    $composeDir = Split-Path -Parent $Output
    $rawDataDir = [Environment]::GetEnvironmentVariable("ALLOY_POSTGRES_DATA_DIR", "Process")
    if ([string]::IsNullOrWhiteSpace($rawDataDir)) {
      $rawDataDir = "./alloy-postgres"
    }
    if ([System.IO.Path]::IsPathRooted($rawDataDir)) {
      $dataDir = $rawDataDir
    }
    else {
      $dataDir = Join-Path $composeDir $rawDataDir
    }
    Ensure-DirectoryWritable $dataDir "release postgres data"
  }

  Write-InstallInfo "Generated compose: $Output"
  Write-InstallInfo "Env file: $EnvFile"
  if (![string]::IsNullOrWhiteSpace($dataDir)) {
    Write-InstallInfo "Release data dir: $dataDir"
  }

  if ($NoUp) {
    $next = "up -d"
    if ($Mode -eq "local") {
      $next = "up -d --build"
    }
    Write-InstallInfo "Skip docker compose (--NoUp)."
    Write-InstallHint "Next step: docker compose --env-file `"$EnvFile`" -f `"$Output`" $next"
    exit 0
  }

  $CurrentStep = "docker preflight"
  Require-Command "docker"
  docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    Fail-WithHelp "Cannot connect to Docker daemon." @("Start Docker and rerun deploy/install.ps1.")
  }
  docker compose version *> $null
  if ($LASTEXITCODE -ne 0) {
    Fail-WithHelp "docker compose plugin is unavailable." @("Install Docker Compose v2 and rerun deploy/install.ps1.")
  }

  $CurrentStep = "env validation"
  Require-EnvValue "ALLOY_JWT_SECRET"
  Require-EnvValue "ALLOY_ADMIN_USER"
  Require-EnvValue "ALLOY_ADMIN_PASS"
  Require-EnvValue "ALLOY_WATCHTOWER_TOKEN"
  if ($Mode -eq "local") {
    Require-EnvValue "ALLOY_POSTGRES_PASSWORD"
  }
  else {
    Require-EnvValue "ALLOY_POSTGRES_DATA_DIR"
  }

  $CurrentStep = "port preflight"
  if ($Mode -eq "release") {
    Check-PortOrThrow 10043 "web" "release web"
  }
  else {
    Check-PortOrThrow 10043 "alloy-control" "local control"
    Check-PortOrThrow 3000 "web" "local web"
  }

  $CurrentStep = "docker compose up"
  if ($Mode -eq "release") {
    docker compose --env-file $EnvFile -f $Output pull
    if ($LASTEXITCODE -ne 0) {
      Fail-WithHelp "docker compose pull failed." @("Check network/GHCR access, then retry.")
    }
    docker compose --env-file $EnvFile -f $Output up -d
    if ($LASTEXITCODE -ne 0) {
      Fail-WithHelp "docker compose up failed." @("Run: docker compose --env-file `"$EnvFile`" -f `"$Output`" logs --tail=120")
    }
  }
  else {
    docker compose --env-file $EnvFile -f $Output up -d --build
    if ($LASTEXITCODE -ne 0) {
      Fail-WithHelp "docker compose up --build failed." @("Run: docker compose --env-file `"$EnvFile`" -f `"$Output`" logs --tail=120")
    }
  }

  Write-InstallInfo "Deployment command completed successfully."
  Write-InstallHint "Check status: docker compose --env-file `"$EnvFile`" -f `"$Output`" ps"
}
catch {
  if (-not $FailureReported) {
    $err = $_.Exception.Message
    Write-InstallError "Step '$CurrentStep' failed: $err"
    Write-InstallHint "Check docker daemon: docker info"
    Write-InstallHint "Render compose config: docker compose --env-file `"$EnvFile`" -f `"$Output`" config"
    Write-InstallHint "Inspect logs: docker compose --env-file `"$EnvFile`" -f `"$Output`" logs --tail=120"
  }
  exit 1
}
