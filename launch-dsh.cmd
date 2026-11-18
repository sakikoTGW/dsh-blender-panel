@echo off
set "DSH_HOME=E:\DSH-Home"
set "ELECTRON_RUN_AS_NODE="
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0launch-dsh.ps1"
if errorlevel 1 (
  echo.
  echo [dsh] If DSH did not open, run the plain launcher:
  echo       E:\DSH-App\launch-safe.cmd
  pause
)
