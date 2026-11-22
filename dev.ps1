[CmdletBinding()]
param(
    [ValidateSet('menu','setup','demo','frontend','hosted-db','local','encrypt','decrypt','check')]
    [string]$Action = 'menu'
)

$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$python = Join-Path $repo '.venv/Scripts/python.exe'

function Write-Status([string]$Text, [ConsoleColor]$Color = 'Cyan') {
    Write-Host "  $Text" -ForegroundColor $Color
}

function Invoke-Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program failed (exit $LASTEXITCODE)." }
}

function Initialize-Project {
    Get-Command py, node, npm.cmd -ErrorAction Stop | Out-Null
    Invoke-Checked node @('-e', 'const [a,b,c]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&(b<23||(b===23&&c<4))))process.exit(1)')
    if (-not (Test-Path -LiteralPath $python)) { Invoke-Checked py @('-3.12', '-m', 'venv', (Join-Path $repo '.venv')) }
    Invoke-Checked $python @('-m','pip','install','-r',(Join-Path $repo 'backend/requirements-dev.txt'))
    Push-Location (Join-Path $repo 'frontend')
    try { Invoke-Checked npm.cmd @('ci') } finally { Pop-Location }
    Write-Status 'Setup complete. Option 2 runs the SQLite demo; option 5 runs local MySQL.' Green
}

function Get-SecretFiles([switch]$Encrypted) {
    $roots = @($repo, (Join-Path $repo 'backend'), (Join-Path $repo 'frontend'))
    $files = @()
    foreach ($root in $roots) {
        $files += @(Get-ChildItem -LiteralPath $root -File -Force | Where-Object {
            if ($Encrypted) { $_.Name -match '^\.env(?:\.[^.]+)*\.age$' }
            else { $_.Name -match '^\.env(?:\.[^.]+)*$' -and $_.Name -notmatch '\.(age|example|bak)$' }
        })
    }
    $secrets = Join-Path $repo 'secrets'
    if (Test-Path -LiteralPath $secrets) {
        $files += @(Get-ChildItem -LiteralPath $secrets -File -Recurse -Force | Where-Object {
            if ($Encrypted) { $_.Name -match '^\.env(?:\.[^.]+)*\.age$' }
            else { $_.Name -match '^\.env(?:\.[^.]+)*$' -and $_.Name -notmatch '\.(age|example|bak)$' }
        })
    }
    return $files
}

function Protect-Secrets {
    $helper = Get-Command agel -CommandType Function -ErrorAction Stop
    Get-Command age -ErrorAction Stop | Out-Null
    if (-not $env:AGE_PUBLIC_KEY) { throw 'Set AGE_PUBLIC_KEY to your public age recipient first.' }
    foreach ($file in @(Get-SecretFiles)) {
        # The existing agel helper intentionally operates on .env in its current directory.
        if ($file.Name -eq '.env') {
            Push-Location $file.DirectoryName
            try { & $helper; if ($LASTEXITCODE -ne 0) { throw 'agel encryption failed.' } }
            finally { Pop-Location }
        } else {
            Invoke-Checked age @('-r',$env:AGE_PUBLIC_KEY,'-o',($file.FullName + '.age'),$file.FullName)
        }
        Write-Status ("Encrypted " + $file.FullName.Substring($repo.Length + 1)) Green
    }
    Write-Status 'Private age identities and external signing keys are never collected.' DarkGray
}

function Restore-Secrets {
    $age = (Get-Command age -CommandType Application -ErrorAction Stop).Source
    $files = @(Get-SecretFiles -Encrypted)
    if (-not $files.Count) { throw 'No encrypted environment files found.' }
    Write-Status 'Restores each encrypted file beside its .age backup. Existing plaintext is replaced.' Yellow
    $secure = Read-Host 'Paste private AGE-SECRET-KEY (hidden)' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    $pending = @()
    try {
        $identity = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr).Trim()
        if ($identity -notmatch '^AGE-SECRET-KEY-1[0-9A-Z]+$') { throw 'Expected a private age identity beginning AGE-SECRET-KEY-1.' }
        foreach ($file in $files) {
            $target = $file.FullName.Substring(0, $file.FullName.Length - 4)
            $temp = $target + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
            $pending += [pscustomobject]@{ Temp = $temp; Target = $target }
            $info = New-Object System.Diagnostics.ProcessStartInfo
            $info.FileName = $age
            $info.Arguments = '-d -i - -o "' + $temp + '" "' + $file.FullName + '"'
            $info.UseShellExecute = $false
            $info.CreateNoWindow = $true
            $info.RedirectStandardInput = $true
            $info.RedirectStandardError = $true
            $process = [System.Diagnostics.Process]::Start($info)
            try {
                $process.StandardInput.WriteLine($identity)
                $process.StandardInput.Close()
                $detail = $process.StandardError.ReadToEnd()
                $process.WaitForExit()
                if ($process.ExitCode -ne 0) { throw "Decryption failed for $($file.Name). Check that this key matches every backup. $detail" }
            } finally { $process.Dispose() }
        }
        # Authenticate every backup before replacing any existing configuration.
        foreach ($item in $pending) {
            Move-Item -LiteralPath $item.Temp -Destination $item.Target -Force
            Write-Status ("Restored " + $item.Target.Substring($repo.Length + 1)) Green
        }
    } finally {
        $identity = $null
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
        $secure.Dispose()
        foreach ($item in $pending) {
            if (Test-Path -LiteralPath $item.Temp) { Remove-Item -LiteralPath $item.Temp -Force }
        }
    }
}

function Invoke-Action([string]$Selected) {
    switch ($Selected) {
        setup { Initialize-Project }
        encrypt { Protect-Secrets }
        decrypt { Restore-Secrets }
        check {
            foreach ($name in @('py','node','npm.cmd','docker','age','agel')) {
                if (Get-Command $name -ErrorAction SilentlyContinue) { Write-Status "$name available" Green }
                else { Write-Status "$name missing" Yellow }
            }
            Write-Status ("Encrypted environments: " + @(Get-SecretFiles -Encrypted).Count)
        }
        default {
            if (-not (Test-Path -LiteralPath $python)) { throw 'Run option 1 (setup) first.' }
            if ($Selected -eq 'hosted-db') {
                Write-Status 'LIVE DATABASE: local actions change hosted accounts and balances.' Yellow
                if ((Read-Host 'Type LIVE to connect') -cne 'LIVE') { return }
            }
            Invoke-Checked $python @((Join-Path $repo 'scripts/dev_runner.py'),$Selected)
        }
    }
}

if ($Action -ne 'menu') { Invoke-Action $Action; return }
while ($true) {
    Write-Host ''
    Write-Host '  HDFC BANK  /  DEVELOPER CONSOLE' -ForegroundColor Cyan
    Write-Host '  --------------------------------------------------------' -ForegroundColor DarkGray
    Write-Status '1  Setup project locally                 install dependencies' White
    Write-Status '2  Run local demo                        SQLite, no cloud' White
    Write-Status '3  Local frontend                        deployed API + MySQL' White
    Write-Status '4  Local frontend + backend              deployed MySQL' Yellow
    Write-Status '5  Run fully local                       Docker MySQL 8.4' White
    Write-Status '6  Encrypt all project environments      agel / public key' White
    Write-Status '7  Decrypt to original locations          paste private key' White
    Write-Host ''
    Write-Status 'C  Check tools     Q  Quit     Ctrl+C stops local servers' DarkGray
    $choice = Read-Host '  Select'
    if ($choice -in @('q','Q')) { break }
    $actions = @{ '1'='setup'; '2'='demo'; '3'='frontend'; '4'='hosted-db'; '5'='local'; '6'='encrypt'; '7'='decrypt'; 'c'='check' }
    if (-not $actions.ContainsKey($choice)) { Write-Status 'Choose 1-7, C or Q.' Yellow; continue }
    try { Invoke-Action $actions[$choice] }
    catch { Write-Status $_.Exception.Message Red }
}
