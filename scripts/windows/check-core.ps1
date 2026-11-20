param(
    [Parameter(Mandatory)][string]$AppDirectory,
    [ValidateSet('Direct', 'Process', 'Tun', 'Cancel', 'Recovery', 'MissingResource')]
    [string]$Mode = 'Process',
    [string]$ReportPath
)
$ErrorActionPreference = 'Stop'
$packageDirectory = (Resolve-Path -LiteralPath $AppDirectory).ProviderPath
$appDirectory = $packageDirectory
$temporaryPackage = $null
$report = if ($ReportPath) { [System.IO.Path]::GetFullPath($ReportPath) } else {
    Join-Path ([System.IO.Path]::GetTempPath()) ('cleartier-core-check-' + [guid]::NewGuid() + '.json')
}
if ($Mode -eq 'Tun' -or $Mode -eq 'Cancel') {
    $conflicts = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -in @('198.18.0.1', '198.18.0.2') }
    if ($conflicts) { throw 'Temporary test addresses 198.18.0.1 or 198.18.0.2 are already in use. No test was started.' }
    if ($Mode -eq 'Cancel') { Write-Output 'Choose No / Cancel when Windows asks for administrator permission.' }
    else { Write-Output 'Approve the UAC prompt. This creates two temporary TUN adapters, then removes them.' }
}
try {
    if ($Mode -eq 'MissingResource') {
        $temporaryPackage = Join-Path ([System.IO.Path]::GetTempPath()) ('cleartier-missing-resource-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Path $temporaryPackage | Out-Null
        foreach ($name in @('cleartier.exe', 'Packet.dll', 'WinDivert64.sys')) {
            Copy-Item -LiteralPath (Join-Path $packageDirectory $name) -Destination $temporaryPackage
        }
        $appDirectory = $temporaryPackage
    }
    $app = Join-Path $appDirectory 'cleartier.exe'
    if ($Mode -eq 'Direct') { $arguments = @('--core-check', ('"' + $report + '"')) }
    else {
        $checkMode = if ($Mode -eq 'MissingResource') { 'missing-resource' } else { $Mode.ToLowerInvariant() }
        $arguments = @('--process-check', $checkMode, ('"' + $report + '"'))
    }
    $process = Start-Process -FilePath $app -ArgumentList $arguments -WorkingDirectory $appDirectory -PassThru
    if (-not $process.WaitForExit(300000)) {
        $process.Kill()
        throw 'Core check timed out after five minutes. Its worker will exit when the controller closes.'
    }
    if (-not (Test-Path -LiteralPath $report)) {
        throw "Core check produced no report (exit code $($process.ExitCode))."
    }
    $result = Get-Content -LiteralPath $report -Raw -Encoding UTF8
    Write-Output $result
    Write-Output "Report saved to: $report"
    if ($process.ExitCode -ne 0 -or -not ($result | ConvertFrom-Json).passed) { exit 1 }
} finally {
    if ($temporaryPackage) { Remove-Item -LiteralPath $temporaryPackage -Recurse -Force }
}
