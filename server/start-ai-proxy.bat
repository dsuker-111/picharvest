@echo off
REM ============================================================
REM  图仓官网 AI 代理启动脚本（阿里云百炼 / DashScope）
REM
REM  用法：
REM    1. 到 https://bailian.console.aliyun.com/ 创建 API Key
REM    2. 把下面的 sk-xxxx 替换成你的 Key（或改用系统环境变量）
REM    3. 双击本文件
REM ============================================================

setlocal

if "%DASHSCOPE_API_KEY%"=="" (
  set "DASHSCOPE_API_KEY=sk-在这里填入你的阿里云百炼APIKey"
)

if "%MODEL_NAME%"=="" set "MODEL_NAME=deepseek-v4.1-flash"
if "%PORT%"=="" set "PORT=8000"

echo.
echo   图仓 AI 代理启动中...
echo   模型 : %MODEL_NAME%
echo   端口 : %PORT%
echo.

python "%~dp0cloud_api.py"

echo.
echo   服务已退出。按任意键关闭。
pause >nul
