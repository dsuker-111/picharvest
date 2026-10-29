@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0.."

REM ============================================================
REM  图仓 · 一键启动
REM    1. 若代理没在跑，就在后台窗口里启动它（最小化）
REM    2. 打开官网，点右下角「AI 助手」即可对话
REM    3. 在网页里点「本地 · LoRA」会自动拉起本地模型
REM ============================================================

REM 从 .env.local 读取 Key
if exist ".env.local" (
  for /f "usebackq tokens=1,* delims==" %%A in (".env.local") do (
    if not "%%A"=="" if not "%%A:~0,1"=="#" set "%%A=%%B"
  )
)
if "%PORT%"=="" set "PORT=8123"

echo.
echo   图仓 AI 一键启动中...
echo.

REM 已经在运行？
powershell -NoProfile -Command "try{$null=Invoke-RestMethod 'http://127.0.0.1:%PORT%/health' -TimeoutSec 2;exit 0}catch{exit 1}"
if %errorlevel%==0 (
  echo   代理已在运行，直接打开官网。
  goto open_site
)

echo   正在启动代理（窗口最小化，关闭它即停止服务）...
start "图仓AI代理" /min cmd /c "chcp 65001 >nul && python server\cloud_api.py"

echo   等待就绪...
powershell -NoProfile -Command "$ok=$false;for($i=0;$i -lt 25;$i++){try{$r=Invoke-RestMethod 'http://127.0.0.1:%PORT%/health' -TimeoutSec 2;if($r.status -eq 'ok'){$ok=$true;break}}catch{};Start-Sleep -Milliseconds 600};if($ok){exit 0}else{exit 1}"
if not %errorlevel%==0 (
  echo.
  echo   [失败] 代理没有起来。
  echo   请确认已安装 Python，且在本目录执行过：
  echo       pip install -r server\requirements.txt
  echo.
  pause
  exit /b 1
)

echo   代理就绪。

:open_site
start "" "https://picharvest-2026.surge.sh"
echo.
echo   已在浏览器打开官网。
echo   提示：网页里点「本地 · LoRA」会自动启动本地模型（首次约 10-40 秒）。
echo.
timeout /t 4 >nul
exit /b 0