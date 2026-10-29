@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

echo.
echo   图仓 AI 代理 - 一键上线
echo   ======================
echo   将启动:
echo     1. 阿里云百炼代理 (server/cloud_api.py)
echo     2. 公网隧道 (cloudflared)
echo     3. 自动把新域名写回官网并部署到 Surge
echo.
echo   注意: 本窗口关闭后对话即失效, 请保持窗口打开。
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-ai-public.ps1" -Deploy

echo.
echo   脚本已结束。按任意键关闭。
pause >nul