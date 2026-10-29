<#
.SYNOPSIS
  一键启动「本地代理 + 公网隧道」，并把新地址写回官网。

.DESCRIPTION
  cloudflared 的免费快速隧道每次重启域名都会变，本脚本自动完成：
    1. 启动 server/cloud_api.py（持有 DASHSCOPE_API_KEY）
    2. 启动 cloudflared 隧道，解析出 https://xxx.trycloudflare.com
    3. 调用 scripts/set-ai-endpoint.mjs 写入 site/index.html
    4. 可选：部署到 Surge

.EXAMPLE
  $env:DASHSCOPE_API_KEY="sk-..."
  .\scripts\start-ai-public.ps1

.EXAMPLE
  .\scripts\start-ai-public.ps1 -Deploy
#>
[CmdletBinding()]
param(
  [string]$Model = "deepseek-v4.1-flash",
  [int]$Port = 8123,
  [switch]$Deploy,
  [string]$CloudflaredPath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

if (-not $env:DASHSCOPE_API_KEY) {
  Write-Host "缺少 DASHSCOPE_API_KEY。" -ForegroundColor Red
  Write-Host "请先执行：`$env:DASHSCOPE_API_KEY='sk-你的百炼Key'" -ForegroundColor Yellow
  exit 1
}

if (-not $CloudflaredPath) {
  $candidates = @(
    (Join-Path (Split-Path -Parent $root) "cloudflared.exe"),
    (Join-Path $root "cloudflared.exe"),
    "cloudflared"
  )
  $CloudflaredPath = $candidates | Where-Object {
    if ($_ -eq "cloudflared") { Get-Command cloudflared -ErrorAction SilentlyContinue }
    else { Test-Path $_ }
  } | Select-Object -First 1
}
if (-not $CloudflaredPath) {
  Write-Host "找不到 cloudflared.exe，请用 -CloudflaredPath 指定路径。" -ForegroundColor Red
  exit 1
}

$python = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $python) { $python = "python" }

Write-Host "[1/3] 选择端口并启动代理 ..." -ForegroundColor Cyan

# 8000 常被其他进程（如 mock 服务）占用，这里自动找一个空闲端口。
function Test-PortFree([int]$p) {
  $busy = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue
  return -not $busy
}

$startPort = $Port
$chosen = $null
for ($p = $startPort; $p -lt $startPort + 20; $p++) {
  if (Test-PortFree $p) { $chosen = $p; break }
}
if (-not $chosen) {
  Write-Host "      $startPort ~ $($startPort + 19) 全部被占用。" -ForegroundColor Red
  exit 1
}
if ($chosen -ne $startPort) {
  Write-Host "      端口 $startPort 已被占用，改用 $chosen" -ForegroundColor Yellow
}
$Port = $chosen

$env:MODEL_NAME = $Model
$env:PORT = "$Port"
$proxy = Start-Process -FilePath $python `
  -ArgumentList "server/cloud_api.py" `
  -WorkingDirectory $root -PassThru -WindowStyle Minimized

Start-Sleep -Seconds 3
try {
  $h = Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 10
} catch {
  Write-Host "      代理启动失败：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

# 关键校验：确认应答的是阿里云代理，而不是别的 mock 服务
if ($h.provider -ne "aliyun-dashscope") {
  Write-Host "      端口 $Port 上运行的不是阿里云代理（provider=$($h.provider)）。" -ForegroundColor Red
  Write-Host "      可能是其他进程占用了端口，请重试或换一个端口。" -ForegroundColor Yellow
  exit 1
}
Write-Host "      代理就绪 :$Port，模型 $($h.model)，Key $($(if ($h.key_configured) { '已配置' } else { '缺失' }))" -ForegroundColor Green

Write-Host "[2/3] 建立公网隧道 ..." -ForegroundColor Cyan
$logFile = Join-Path $env:TEMP "cloudflared-ph.log"
if (Test-Path $logFile) { Remove-Item $logFile -Force }
$tunnel = Start-Process -FilePath $CloudflaredPath `
  -ArgumentList "tunnel --url http://127.0.0.1:$Port --no-autoupdate" `
  -RedirectStandardError $logFile -PassThru -WindowStyle Hidden

$publicUrl = $null
for ($i = 0; $i -lt 40; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $logFile) {
    $m = Select-String -Path $logFile -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches |
         ForEach-Object { $_.Matches } | Select-Object -First 1
    if ($m) { $publicUrl = $m.Value; break }
  }
}

if (-not $publicUrl) {
  Write-Host "      未能获取隧道地址，请查看 $logFile" -ForegroundColor Red
  exit 1
}
Write-Host "      公网地址：$publicUrl" -ForegroundColor Green

Start-Sleep -Seconds 3
try {
  $null = Invoke-RestMethod "$publicUrl/health" -TimeoutSec 20
  Write-Host "      公网 /health 校验通过" -ForegroundColor Green
} catch {
  Write-Host "      公网校验失败（隧道可能还在初始化）：$($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "[3/3] 写回站点地址 ..." -ForegroundColor Cyan
node scripts/set-ai-endpoint.mjs $publicUrl

if ($Deploy) {
  Write-Host "      部署到 Surge ..." -ForegroundColor Cyan
  npx --yes surge site picharvest-2026.surge.sh
}

Write-Host ""
Write-Host "完成。代理 PID=$($proxy.Id) 隧道 PID=$($tunnel.Id)" -ForegroundColor Green
Write-Host "关闭本窗口不会停止服务；需要停止请执行：" -ForegroundColor DarkGray
Write-Host "  Stop-Process -Id $($proxy.Id),$($tunnel.Id)" -ForegroundColor DarkGray