@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  echo 请先按 README 创建 Python 环境并安装依赖。
  pause
  exit /b 1
)
echo API 文档地址：http://127.0.0.1:8000/docs
.venv\Scripts\python.exe -m uvicorn backend.api:app --host 127.0.0.1 --port 8000
pause
