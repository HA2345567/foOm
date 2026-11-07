@echo off
setlocal enabledelayedexpansion

echo ===================================================
echo   foOom Desktop Installer Build Process
echo ===================================================

echo [1/3] Checking desktop types and tests...
cd /d "%~dp0"
call bun run typecheck:desktop
if errorlevel 1 (
    echo [ERROR] Desktop TypeScript check failed.
    exit /b 1
)
call bun run test:desktop
if errorlevel 1 (
    echo [ERROR] Desktop tests failed.
    exit /b 1
)

echo [2/3] Compiling Tauri Rust core and NSIS Installer...
cd /d "%~dp0apps\desktop\tauri-shell"
call bun x tauri build -- --locked
if errorlevel 1 (
    echo [ERROR] Tauri build failed.
    exit /b 1
)

cd /d "%~dp0"

echo [3/3] Locating compiled installer executable...
if not exist "apps\web\public\downloads" (
    mkdir "apps\web\public\downloads"
)

powershell -NoProfile -ExecutionPolicy Bypass -Command "$target = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { 'target' }; $bundle = Join-Path $target 'release\bundle\nsis'; $installer = Get-ChildItem -LiteralPath $bundle -Filter '*.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if (-not $installer) { Write-Error 'Compiled installer executable could not be found in the Cargo target bundle path.'; exit 1 }; $dest = 'apps\web\public\downloads\foom-setup.exe'; Copy-Item -LiteralPath $installer.FullName -Destination $dest -Force; $sizeMB = [math]::Round($installer.Length / 1MB, 2); Write-Host ('[SUCCESS] Installer copied: ' + $installer.FullName + ' (' + $sizeMB + ' MB) -> ' + $dest);"

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
