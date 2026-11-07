$ErrorActionPreference = 'Stop'
$workspaceRoot = Split-Path -Parent $PSScriptRoot
$binariesDir = Join-Path $workspaceRoot 'apps/desktop/tauri-shell/src-tauri/binaries'
$target = (& rustc -vV | Select-String '^host: (.+)$').Matches.Groups[1].Value
if (-not $target) { throw 'Unable to determine the Rust host target. Install the Rust toolchain first.' }
$suffix = if ($target -match 'windows') { '.exe' } else { '' }
$destination = Join-Path $binariesDir "ffmpeg-$target$suffix"

# An existing sidecar also allows offline builds on machines without FFmpeg on PATH.
if (Test-Path -LiteralPath $destination) {
    if ((Get-Item -LiteralPath $destination).Length -gt 1MB) { exit 0 }
    throw "The FFmpeg sidecar is incomplete: $destination. Remove it and run bun run prepare:desktop again."
}
$source = $env:FFMPEG_PATH
if (-not $source) {
    $ffmpeg = Get-Command ffmpeg -CommandType Application -ErrorAction SilentlyContinue
    if ($ffmpeg) { $source = $ffmpeg.Source }
}
if (-not $source -or -not (Test-Path -LiteralPath $source -PathType Leaf)) {
    throw 'FFmpeg is required. Install FFmpeg and add it to PATH, or set FFMPEG_PATH to its executable, then run bun run prepare:desktop.'
}
New-Item -ItemType Directory -Force -Path $binariesDir | Out-Null
Copy-Item -LiteralPath $source -Destination $destination
& $destination -version | Select-Object -First 1
if ($LASTEXITCODE -ne 0) { throw "The copied FFmpeg sidecar failed validation: $destination" }
Write-Host "Prepared FFmpeg sidecar: $destination"
