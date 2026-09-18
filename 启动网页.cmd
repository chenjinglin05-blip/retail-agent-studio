@echo off
chcp 65001 >nul
cd /d "%~dp0"
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.13 或更高版本，再重新打开此文件。
  pause
  exit /b 1
)
if not exist node_modules (
  call npm.cmd ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
echo 请在浏览器打开下方 Local 地址。按 Ctrl+C 停止。
call npm.cmd run dev
pause
