@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo   foOm Desktop Installer Build Process
echo ===================================================

:: Setup build directories
if exist D:\temp (
    set "TMP=D:\temp"
    set "TEMP=D:\temp"
)
if exist D:\ZoOmly-cargo-target (
    set "CARGO_TARGET_DIR=D:\ZoOmly-cargo-target"
)

echo [1/3] Building React UI for Desktop...
cd /d "%~dp0apps\desktop\ui-react"
call bun run build
if errorlevel 1 (
    echo [ERROR] React UI build failed.
    exit /b 1
)

echo [2/3] Compiling Tauri Rust core and NSIS Installer...
cd /d "%~dp0apps\desktop\tauri-shell"
call bun x tauri build
if errorlevel 1 (
    echo [ERROR] Tauri build failed.
    exit /b 1
)

cd /d "%~dp0"

echo [3/3] Locating compiled installer executable...
if not exist "apps\web\public\downloads" (
    mkdir "apps\web\public\downloads"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "^
$roots = @('target\release\bundle\nsis', 'apps\desktop\tauri-shell\src-tauri\target\release\bundle\nsis', 'apps\desktop\tauri-shell\target\release\bundle\nsis', 'D:\ZoOmly-cargo-target\release\bundle\nsis'); ^
$installer = $roots | ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter '*.exe' -ErrorAction SilentlyContinue } | Where-Object { $_.Name -match 'setup|en-US|foom|foOm' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1; ^
if (-not $installer) { ^
    Write-Error 'Compiled installer executable could not be found in target bundle paths.'; ^
    exit 1; ^
}; ^
$dest = 'apps\web\public\downloads\foom-setup.exe'; ^
Copy-Item -LiteralPath $installer.FullName -Destination $dest -Force; ^
$sizeMB = [math]::Round($installer.Length / 1MB, 2); ^
Write-Host ('[SUCCESS] Installer copied: ' + $installer.FullName + ' (' + $sizeMB + ' MB) -> ' + $dest); ^
"

if errorlevel 1 (
    echo [ERROR] Failed to locate or copy the installer executable!
    exit /b 1
)

if not exist "apps\web\public\downloads\foom-setup.exe" (
    echo [ERROR] Destination file apps\web\public\downloads\foom-setup.exe does not exist!
    exit /b 1
)

echo.
echo ===================================================
echo   Desktop Application Build Complete!
echo   Installer: apps/web/public/downloads/foom-setup.exe
echo ===================================================
