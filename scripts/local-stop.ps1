[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$stateFile = Join-Path $env:LOCALAPPDATA 'HdfcBankLocal/processes.json'
if (-not (Test-Path -LiteralPath $stateFile)) {
    Write-Host 'The local app is not recorded as running.'
    return
}

$state = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
function Stop-LocalTree([int]$ProcessId) {
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId")
    foreach ($child in $children) {
        Stop-LocalTree ([int]$child.ProcessId)
    }
    Stop-Process -Id $ProcessId -ErrorAction SilentlyContinue
}
foreach ($entry in $state.processes) {
    $process = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
    if ($process -and $process.StartTime.ToUniversalTime().Ticks -eq $entry.startTicks) {
        Stop-LocalTree $process.Id
        Write-Host "Stopped local process $($process.Id)."
    }
}
Remove-Item -LiteralPath $stateFile -Force
Write-Host 'Local app stopped.'
