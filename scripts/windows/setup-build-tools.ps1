#requires -Version 7.0
param(
    [string]$ToolsDirectory = $(if ($env:RUNNER_TEMP) {
        Join-Path $env:RUNNER_TEMP 'cleartier-build-tools'
    } else {
        Join-Path $PSScriptRoot '../../.cache/windows-build-tools'
    })
)
$ErrorActionPreference = 'Stop'

if (-not $IsWindows -or [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture -ne 'X64') {
    throw 'Build tools require Windows x64 and PowerShell 7.'
}

# Compare without logging the environment: it can contain signing credentials.
$before = [Environment]::GetEnvironmentVariables('Process')
$tools = [IO.Path]::GetFullPath($ToolsDirectory)
New-Item -ItemType Directory -Force $tools | Out-Null

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $vswhere)) {
    throw 'Visual Studio Installer and the MSVC x64 build tools are required.'
}
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if ($LASTEXITCODE -ne 0 -or -not $installation) {
    throw 'No Visual Studio installation with the MSVC x64 build tools was found.'
}
$developerShell = Join-Path $installation 'Common7/Tools/Launch-VsDevShell.ps1'
if (-not (Test-Path -LiteralPath $developerShell)) {
    throw "Visual Studio Developer PowerShell is missing: $developerShell"
}
& $developerShell -Arch amd64 -HostArch amd64 -SkipAutomaticLocation | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw 'Visual Studio Developer PowerShell initialization failed.'
}

# Official protobuf v21.12 asset; pin the bytes as well as the version.
$version = '21.12'
$expectedHash = '71852a30cf62975358edfcbbff93086e8857a079c8e4d6904881aa968d65c7f9'
$archive = Join-Path $tools "protoc-$version-win64.zip"
$download = "$archive.download"
$archiveToVerify = $archive
if (-not (Test-Path -LiteralPath $archive)) {
    $url = "https://github.com/protocolbuffers/protobuf/releases/download/v$version/protoc-$version-win64.zip"
    Invoke-WebRequest -Uri $url -OutFile $download -TimeoutSec 120 -MaximumRetryCount 3 -RetryIntervalSec 2
    $archiveToVerify = $download
}
if ((Get-FileHash -LiteralPath $archiveToVerify -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedHash) {
    Remove-Item -LiteralPath $archiveToVerify -Force
    throw 'The protoc archive failed SHA-256 verification.'
}
if ($archiveToVerify -eq $download) {
    Move-Item -LiteralPath $download -Destination $archive -Force
}
$protocDirectory = Join-Path $tools "protoc-$version"
if (Test-Path -LiteralPath $protocDirectory) {
    Remove-Item -LiteralPath $protocDirectory -Recurse -Force
}
Expand-Archive -LiteralPath $archive -DestinationPath $protocDirectory
$env:PROTOC = Join-Path $protocDirectory 'bin/protoc.exe'
$env:PROTOC_INCLUDE = Join-Path $protocDirectory 'include'
$env:PATH = "$(Join-Path $protocDirectory 'bin');$env:PATH"
if (-not (Test-Path -LiteralPath (Join-Path $env:PROTOC_INCLUDE 'google/protobuf/timestamp.proto'))) {
    throw 'The protoc archive is missing its standard include files.'
}
$protocVersion = & $env:PROTOC --version
if ($LASTEXITCODE -ne 0 -or $protocVersion -ne 'libprotoc 3.21.12') {
    throw "Unexpected protoc version: $protocVersion"
}

# Exercise the compiler, Windows SDK headers and linker before a long Rust build.
$probe = Join-Path $tools 'probe'
New-Item -ItemType Directory -Force $probe | Out-Null
$source = Join-Path $probe 'compiler.c'
$executable = Join-Path $probe 'compiler.exe'
$object = Join-Path $probe 'compiler.obj'
@'
#include <windows.h>
#ifndef _M_X64
#error The compiler must target Windows x64.
#endif
int main(void) { return GetCurrentProcessId() == 0; }
'@ | Set-Content -LiteralPath $source -Encoding utf8NoBOM
$compiler = (Get-Command cl.exe -CommandType Application).Source
& $compiler /nologo /W4 /WX "/Fe:$executable" "/Fo:$object" $source
if ($LASTEXITCODE -ne 0) { throw 'The MSVC/Windows SDK compile and link probe failed.' }
& $executable
if ($LASTEXITCODE -ne 0) { throw 'The Windows x64 executable probe failed.' }

$proto = Join-Path $probe 'probe.proto'
$descriptor = Join-Path $probe 'probe.pb'
@'
syntax = "proto3";
import "google/protobuf/timestamp.proto";
message Probe { google.protobuf.Timestamp time = 1; }
'@ | Set-Content -LiteralPath $proto -Encoding utf8NoBOM
& $env:PROTOC "--proto_path=$env:PROTOC_INCLUDE" "--proto_path=$probe" "--descriptor_set_out=$descriptor" $proto
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $descriptor)) {
    throw 'The protoc standard-include probe failed.'
}

# Carry only changed variables to subsequent Actions steps. Local invocation
# already changes the current PowerShell process through the developer shell.
if ($env:GITHUB_ENV) {
    $utf8 = [Text.UTF8Encoding]::new($false)
    foreach ($entry in [Environment]::GetEnvironmentVariables('Process').GetEnumerator()) {
        $name = [string]$entry.Key
        $value = [string]$entry.Value
        if ($name -notmatch '^[A-Za-z_][A-Za-z0-9_]*$' -or $name -match '^(GITHUB_|RUNNER_)' -or $name -eq 'NODE_OPTIONS') { continue }
        if ($before.Contains($name) -and [string]$before[$name] -ceq $value) { continue }
        $delimiter = "cleartier_$([Guid]::NewGuid().ToString('N'))"
        [IO.File]::AppendAllText($env:GITHUB_ENV, "$name<<$delimiter`n$value`n$delimiter`n", $utf8)
    }
}
Write-Host "Windows x64 tools verified: $protocVersion; compiler: $compiler"
