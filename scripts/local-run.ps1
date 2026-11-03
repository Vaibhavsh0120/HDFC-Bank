[CmdletBinding()]
param(
    [string]$LanAddress,
    [switch]$BuildAndroid,
    [string]$MySqlUser = 'root',
    [ValidateRange(1, 65535)][int]$MySqlPort = 3306,
    [ValidatePattern('^[A-Za-z][A-Za-z0-9_]{0,63}$')]
    [string]$MySqlDatabase = 'hdfc_bank_local'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $repo 'backend'
$frontend = Join-Path $repo 'frontend'
$python = Join-Path $repo '.venv/Scripts/python.exe'
$astro = Join-Path $frontend 'node_modules/astro/bin/astro.mjs'
$stateDir = Join-Path $env:LOCALAPPDATA 'HdfcBankLocal'
$stateFile = Join-Path $stateDir 'processes.json'

if (-not (Test-Path -LiteralPath $python) -or -not (Test-Path -LiteralPath $astro)) {
    throw 'Install the backend virtual environment and run npm ci in frontend first. See README.'
}
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not $LanAddress) {
    $wifi = Get-NetIPConfiguration | Where-Object {
        $_.IPv4DefaultGateway -and $_.InterfaceAlias -match 'Wi-Fi|Wireless'
    } | Select-Object -First 1
    if (-not $wifi) {
        $wifi = Get-NetIPConfiguration | Where-Object IPv4DefaultGateway | Select-Object -First 1
    }
    $LanAddress = $wifi.IPv4Address.IPAddress | Select-Object -First 1
}
$ip = $null
if (-not [System.Net.IPAddress]::TryParse($LanAddress, [ref]$ip) -or
    $ip.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork -or
    [System.Net.IPAddress]::IsLoopback($ip)) {
    throw 'Pass -LanAddress with the IPv4 address of this computer on the intended network.'
}
if ($LanAddress -notin @(Get-NetIPAddress -AddressFamily IPv4 | ForEach-Object IPAddress)) {
    throw 'The LAN address must belong to this computer.'
}

if (Test-Path -LiteralPath $stateFile) {
    $state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
    foreach ($entry in $state.processes) {
        $process = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
        if ($process -and $process.StartTime.ToUniversalTime().Ticks -eq $entry.startTicks) {
            throw 'The local app is already running. Use scripts/local-stop.ps1 first.'
        }
    }
}
foreach ($port in @(8000, 4321)) {
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
        throw "Port $port is already in use. Stop that service before starting the local app."
    }
}

if ($null -eq $env:BANK_LOCAL_DB_PASSWORD) {
    $secure = Read-Host "Password for local MySQL user '$MySqlUser' (Enter for empty)" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
} else {
    $password = $env:BANK_LOCAL_DB_PASSWORD
}

# Explicit overrides prevent backend/.env from selecting the hosted database.
$env:DJANGO_DEBUG = '1'
$env:DJANGO_SECRET_KEY = 'local-network-development-only'
$env:DJANGO_ALLOWED_HOSTS = "localhost,127.0.0.1,$LanAddress"
$env:CORS_ORIGINS = ('http://localhost,http://localhost:4321,http://127.0.0.1:4321,http://{0}:4321' -f $LanAddress)
$env:DB_HOST = '127.0.0.1'
$env:DB_PORT = "$MySqlPort"
$env:DB_NAME = $MySqlDatabase
$env:DB_USER = $MySqlUser
$env:DB_PASSWORD = $password
$env:DB_SSL_CA = ''
$env:DB_SSL_CA_BASE64 = ''
$env:PUBLIC_API_URL = ('http://{0}:8000' -f $LanAddress)

# The local user must be permitted to create this database if it does not exist.
$bootstrap = @'
import os
import re
import MySQLdb
name = os.environ["DB_NAME"]
if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", name):
    raise SystemExit("Invalid database name")
connection = MySQLdb.connect(host="127.0.0.1", port=int(os.environ["DB_PORT"]),
    user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"], connect_timeout=5)
try:
    with connection.cursor() as cursor:
        quote = chr(96)
        cursor.execute("CREATE DATABASE IF NOT EXISTS " + quote + name + quote + " CHARACTER SET utf8mb4")
finally:
    connection.close()
'@
$bootstrap | & $python -
if ($LASTEXITCODE -ne 0) { throw 'Could not connect to local MySQL or create the local database.' }
& $python (Join-Path $backend 'manage.py') migrate --noinput
if ($LASTEXITCODE -ne 0) { throw 'Local database migrations failed.' }

if ($BuildAndroid) {
    # This APK is intentionally configured for the selected private LAN address.
    Push-Location $frontend
    try {
        & npm.cmd run build
        if ($LASTEXITCODE -ne 0) { throw 'Local frontend build failed.' }
        & npm.cmd run native:android
        if ($LASTEXITCODE -ne 0) { throw 'Capacitor Android preparation failed.' }
        $nativeConfigPath = Join-Path $frontend 'android/app/src/main/assets/capacitor.config.json'
        $nativeConfig = Get-Content -LiteralPath $nativeConfigPath -Raw | ConvertFrom-Json
        if (-not $nativeConfig.server) {
            $nativeConfig | Add-Member -NotePropertyName server -NotePropertyValue ([pscustomobject]@{})
        }
        $nativeConfig.server | Add-Member -NotePropertyName androidScheme -NotePropertyValue 'http' -Force
        $nativeConfig | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $nativeConfigPath -Encoding utf8
        $manifestPath = Join-Path $frontend 'android/app/src/main/AndroidManifest.xml'
        $originalManifest = [IO.File]::ReadAllText($manifestPath)
        try {
            [xml]$manifest = $originalManifest
            $application = $manifest.manifest.application
            $application.SetAttribute('usesCleartextTraffic', 'http://schemas.android.com/apk/res/android', 'true')
            $manifest.Save($manifestPath)
            Push-Location (Join-Path $frontend 'android')
            try {
                & ./gradlew.bat assembleDebug
                if ($LASTEXITCODE -ne 0) { throw 'Local Android build failed. Check your Android SDK and JDK 21.' }
            } finally { Pop-Location }
            $output = Join-Path $repo 'artifacts'
            New-Item -ItemType Directory -Path $output -Force | Out-Null
            Copy-Item -LiteralPath (Join-Path $frontend 'android/app/build/outputs/apk/debug/app-debug.apk') -Destination (Join-Path $output 'HDFC-Bank-local.apk') -Force
        } finally {
            [IO.File]::WriteAllText($manifestPath, $originalManifest)
        }
        Write-Host "Local Android APK: $output/HDFC-Bank-local.apk"
    } finally { Pop-Location }
}

New-Item -ItemType Directory -Path $stateDir -Force | Out-Null
$started = @()
function Stop-LocalTree([int]$ProcessId) {
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId")
    foreach ($child in $children) {
        Stop-LocalTree ([int]$child.ProcessId)
    }
    Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue
}
try {
    $apiArgs = @(('"{0}"' -f (Join-Path $backend 'manage.py')), 'runserver', '0.0.0.0:8000', '--noreload')
    $api = Start-Process -FilePath $python -ArgumentList $apiArgs -WorkingDirectory $backend -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'api.log') -RedirectStandardError (Join-Path $stateDir 'api-error.log')
    $started += $api
    $webArgs = @(('"{0}"' -f $astro), 'dev', '--host', '0.0.0.0', '--port', '4321')
    $web = Start-Process -FilePath $node -ArgumentList $webArgs -WorkingDirectory $frontend -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $stateDir 'web.log') -RedirectStandardError (Join-Path $stateDir 'web-error.log')
    $started += $web
    $state = @{
        processes = @($started | ForEach-Object {
            @{ id = $_.Id; startTicks = $_.StartTime.ToUniversalTime().Ticks }
        })
    }
    $state | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $stateFile -Encoding utf8
    $deadline = (Get-Date).AddSeconds(45)
    $ready = $false
    while ((Get-Date) -lt $deadline) {
        if ($api.HasExited -or $web.HasExited) { throw "A server exited. Check logs in $stateDir." }
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8000/health/' -TimeoutSec 2
            $response = Invoke-WebRequest -Uri ('http://{0}:4321/' -f $LanAddress) -TimeoutSec 2
            if ($health.status -eq 'ok' -and $response.StatusCode -eq 200) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) { throw "The servers did not become ready. Check logs in $stateDir." }
} catch {
    foreach ($process in $started) {
        if (-not $process.HasExited) { Stop-LocalTree $process.Id }
    }
    if (Test-Path -LiteralPath $stateFile) { Remove-Item -LiteralPath $stateFile -Force }
    throw
} finally {
    $env:DB_PASSWORD = ''
    $password = $null
}

Write-Host ('Local website: http://{0}:4321/' -f $LanAddress)
Write-Host 'Devices on the same Wi-Fi need access to TCP ports 4321 and 8000 in Windows Firewall.'
Write-Host "Logs: $stateDir"
Write-Host 'To stop, run scripts/local-stop.ps1.'
