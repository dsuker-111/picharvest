@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

echo.
echo   图仓 - 启动 AI 代理
echo   ==================
echo   端口: 8123
echo   云端: 阿里云百炼 (读取 .env.local 的 DASHSCOPE_API_KEY)
echo   本地: 点击网页里的「本地」按钮时自动拉起 server\local_model.py
echo.
echo   保持本窗口打开。关闭即停止服务。
echo   启动后刷新 https://picharvest-2026.surge.sh 即可对话。
echo.

REM 从 .env.local 读取 Key
if exist ".env.local" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do (
    if not "%%A"=="" if not "%%A:~0,1"=="#" set "%%A=%%B"
  )
)

if "%DASHSCOPE_API_KEY%"=="" (
  echo [警告] 没有找到 DASHSCOPE_API_KEY，云端对话将不可用。
  echo        请在 .env.local 里写入: DASHSCOPE_API_KEY=sk-...
  echo.
)

if "%PORT%"=="" set "PORT=8123"

python server\cloud_api.py

echo.
echo   代理已停止。按任意键关闭。
pause >nul