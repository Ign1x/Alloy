Param(
  [ValidateSet("local", "release")]
  [string]$Mode = "release",

  [string]$Output,

  [switch]$NoUp
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoRoot = Resolve-Path (Join-Path $ScriptDir "..")
$Template = Join-Path $ScriptDir "docker-compose.$Mode.yml"
$EnvFile = Join-Path $RepoRoot ".env"

if (!(Test-Path $Template)) {
  throw "Template not found: $Template"
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

Copy-Item -Path $Template -Destination $Output -Force

Write-Host "Generated compose: $Output"
Write-Host "Env file: $EnvFile"

if ($NoUp) {
  Write-Host "Skip docker compose (--NoUp)."
  exit 0
}

Sync-ProcessEnvFromFile $EnvFile

if ($Mode -eq "release") {
  docker compose --env-file $EnvFile -f $Output pull
  docker compose --env-file $EnvFile -f $Output up -d
} else {
  docker compose --env-file $EnvFile -f $Output up -d --build
}
