# 在桌面创建「图仓AI」快捷方式，双击即可启动代理并打开官网。
# 用法： powershell -ExecutionPolicy Bypass -File scripts\create-shortcut.ps1
# 参数： -Name 快捷方式名称   -Remove 删除快捷方式

param(
  [string]$Name = "图仓AI",
  [switch]$Remove
)

$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$linkPath = Join-Path $desktop "$Name.lnk"

if ($Remove) {
  if (Test-Path $linkPath) {
    Remove-Item $linkPath -Force
    Write-Host "已删除快捷方式：$linkPath" -ForegroundColor Green
  } else {
    Write-Host "桌面没有找到 $Name.lnk" -ForegroundColor Yellow
  }
  exit 0
}

$target = Join-Path $root "scripts\start-all.bat"
if (-not (Test-Path $target)) {
  Write-Host "找不到启动脚本：$target" -ForegroundColor Red
  exit 1
}

$icon = Join-Path $root "site\assets\picharvest.ico"
if (-not (Test-Path $icon)) { $icon = "" }

$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($linkPath)
$sc.TargetPath = $target
$sc.WorkingDirectory = $root
$sc.Description = "一键启动图仓 AI 代理并打开官网"
$sc.WindowStyle = 7          # 最小化运行
if ($icon) { $sc.IconLocation = "$icon,0" }
$sc.Save()

if (Test-Path $linkPath) {
  Write-Host "已创建桌面快捷方式：" -ForegroundColor Green
  Write-Host "  $linkPath"
  Write-Host ""
  Write-Host "以后双击桌面上的「$Name」即可：" -ForegroundColor Cyan
  Write-Host "  1) 后台启动 AI 代理（最小化窗口）"
  Write-Host "  2) 自动打开 https://picharvest-2026.surge.sh"
  Write-Host "  3) 网页里点「本地 · LoRA」会自动拉起本地模型"
} else {
  Write-Host "创建失败。" -ForegroundColor Red
  exit 1
}