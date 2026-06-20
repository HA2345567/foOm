@echo off
echo ===================================================
echo Building foOm React UI and compiling Tauri installer
echo ===================================================

if not exist D:\temp mkdir D:\temp
set TMP=D:\temp
set TEMP=D:\temp

cd apps\desktop\tauri-shell
call bun x tauri build
if errorlevel 1 (
    echo ERROR: Tauri build failed.
    cd ..\..\..
    exit /b 1
)
cd ..\..\..

echo Copying compiled installer to web downloads directory...
if not exist apps\web\public\downloads mkdir apps\web\public\downloads

powershell -NoProfile -ExecutionPolicy Bypass -Command "$roots = @('target\release\bundle\nsis','apps\desktop\tauri-shell\src-tauri\target\release\bundle\nsis','apps\desktop\tauri-shell\target\release\bundle\nsis','D:\ZoOmly-cargo-target\release\bundle\nsis'); $installer = $roots | ForEach-Object { Get-ChildItem -LiteralPath $_ -Filter '*.exe' -ErrorAction SilentlyContinue } | Where-Object { $_.Name -match 'setup|en-US|foom|foOm' } | Sort-Object LastWriteTime -Descending | Select-Object -First 1; if (-not $installer) { Write-Error 'Compiled installer could not be found.'; exit 1 }; Copy-Item -LiteralPath $installer.FullName -Destination 'apps\web\public\downloads\foom-setup.exe' -Force; Write-Host ('Installer copied from ' + $installer.FullName)"
if errorlevel 1 (
    echo ERROR: Compiled installer could not be found!
    exit /b 1
)

if not exist apps\web\public\downloads\foom-setup.exe (
    echo ERROR: Download installer was not created!
    exit /b 1
)

echo Installer successfully copied to apps/web/public/downloads/foom-setup.exe
goto end

:missing
echo ERROR: Compiled installer could not be found!
exit /b 1

:end
echo Build and packaging process completed successfully.
