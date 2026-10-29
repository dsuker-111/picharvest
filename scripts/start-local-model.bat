@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

echo.
echo   图仓 - 启动本地部署模型 (Qwen2.5-0.5B + LoRA)
echo   ============================================
echo   端口: 8100
echo   加载完成前 /health 会返回 "loading"
echo   保持本窗口打开, 关闭即停止服务。
echo.

REM 优先使用已有的虚拟环境
if exist "D:\WEBkf\test1\.venv\Scripts\python.exe" (
  set "PY=D:\WEBkf\test1\.venv\Scripts\python.exe"
) else (
  set "PY=python"
)

"%PY%" server\local_model.py

echo.
echo   本地模型已停止。按任意键关闭。
pause >nul