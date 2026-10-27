# PicHarvest → Gitee 部署脚本
# 使用方法：在 PowerShell 中执行
#   cd C:\Users\lx\Documents\deepseek-harness\default-workspace\picharvest
#   .\scripts\deploy-gitee.ps1
#
# 前置条件：
#   1. 已注册 Gitee 账号（https://gitee.com）
#   2. 已在 Gitee 创建一个空仓库，仓库名建议为 picharvest
#      → 在 Gitee 首页点击「新建仓库」，选「公开」，不要勾选任何初始化选项
#   3. 能正常访问 gitee.com（如果 DNS 被劫持，请先解决网络问题）
#
# 部署完成后，启用 Gitee Pages：
#   仓库页面 → 服务 → Gitee Pages → 启动
#   分支选 main，目录选 /site
#   访问地址格式：https://<用户名>.gitee.io/picharvest/

param(
    [string]$GiteeUser,     # Gitee 用户名（可覆盖，不填则交互输入）
    [string]$RepoName = "picharvest",
    [switch]$SkipPush       # 仅设置 remote，不执行 push（调试用）
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

# --- 1. 检查 Git 仓库状态 ---
if (!(Test-Path ".git")) {
    Write-Host "❌ 当前目录不是 Git 仓库，请先 git init 并 commit" -ForegroundColor Red
    exit 1
}

$branch = git branch --show-current
Write-Host "📦 当前分支: $branch" -ForegroundColor Cyan

# --- 2. 获取 Gitee 用户名 ---
if (!$GiteeUser) {
    $GiteeUser = Read-Host "请输入你的 Gitee 用户名"
}
$remoteUrl = "https://gitee.com/$GiteeUser/$RepoName.git"
Write-Host "🎯 目标仓库: $remoteUrl" -ForegroundColor Cyan

# --- 3. 设置 remote ---
$existing = git remote
if ($existing -contains "gitee") {
    git remote set-url gitee $remoteUrl
    Write-Host "🔄 更新已存在的 remote 'gitee'" -ForegroundColor Yellow
} else {
    git remote add gitee $remoteUrl
    Write-Host "➕ 新增 remote 'gitee'" -ForegroundColor Green
}

git remote -v

# --- 4. 推送 ---
if ($SkipPush) {
    Write-Host "⏭️  SkipPush 模式，跳过实际推送" -ForegroundColor Yellow
} else {
    Write-Host "🚀 正在推送到 Gitee（可能需要输入 Gitee 账号密码/Token）..." -ForegroundColor Cyan
    Write-Host "   注意：Gitee 已禁用密码推送，请在 Gitee 设置 → 私人令牌中生成一个带 projects 权限的 token，作为密码输入" -ForegroundColor DarkGray
    git push -u gitee "$branch`:$branch" --tags
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ 推送失败，请检查网络或凭据" -ForegroundColor Red
        Write-Host "   如果 gitee.com 无法访问，可能是 DNS 被劫持，尝试：" -ForegroundColor Yellow
        Write-Host "     1. 换网络/开 VPN" -ForegroundColor DarkGray
        Write-Host "     2. 在 C:\Windows\System32\drivers\etc\hosts 添加:" -ForegroundColor DarkGray
        Write-Host "        212.64.62.1 gitee.com" -ForegroundColor DarkGray
        exit 1
    }
    Write-Host "✅ 推送成功！" -ForegroundColor Green
}

# --- 5. Gitee Pages 启用指引 ---
Write-Host ""
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Magenta
Write-Host "🎉 下一步：启用 Gitee Pages" -ForegroundColor Magenta
Write-Host "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" -ForegroundColor Magenta
Write-Host "  1. 打开：https://gitee.com/$GiteeUser/$RepoName/pages" -ForegroundColor White
Write-Host "  2. 点击「启动」" -ForegroundColor White
Write-Host "  3. 分支选：$branch，目录选：/site" -ForegroundColor White
Write-Host "  4. 稍等 1-2 分钟，访问：https://$GiteeUser.gitee.io/$RepoName/" -ForegroundColor White
Write-Host ""
Write-Host "  当前线上可用地址：https://picharvest-2026.surge.sh" -ForegroundColor DarkGray
