@echo off
setlocal
set "PROJECT_DIR=%~dp0.."
for %%I in ("%PROJECT_DIR%") do set "PROJECT_DIR=%%~fI"
cd /d "%PROJECT_DIR%"
if errorlevel 1 exit /b 1
if not exist "output" mkdir "output"
echo [%DATE% %TIME%] scheduler working directory: %CD%>> "output\scheduler.log"
pnpm -C "%PROJECT_DIR%" scheduler:monthly >> "output\scheduler.log" 2>&1
