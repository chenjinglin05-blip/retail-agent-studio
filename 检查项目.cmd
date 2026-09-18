@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Python environment missing. See README.md for setup.
  pause
  exit /b 1
)
chcp 65001 >nul
".venv\Scripts\python.exe" -X utf8 scripts\local.py status
pause
