# 图仓官网 AI 对话框 · 云端部署（Vercel Serverless）

把 AI 代理部署到公网后，**任何人在任何电脑上打开官网都能用这个模型**。

## 为什么需要它

| 方案 | 他人访问能否用 | 说明 |
| --- | --- | --- |
| 本机代理 `127.0.0.1:8000` | ❌ | 访客的 `127.0.0.1` 是他自己的电脑 |
| 本目录（Vercel 函数） | ✅ | 公网 HTTPS 地址，全球可访问 |

## 一、部署

```bash
cd server-vercel
npx vercel            # 首次会登录并创建项目
npx vercel --prod     # 部署到生产环境
```

记下输出的域名，形如 `https://picharvest-ai-xxxx.vercel.app`。

## 二、配置 API Key

在 Vercel 项目 **Settings → Environment Variables** 添加：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DASHSCOPE_API_KEY` | ✅ | 阿里云百炼 API Key（[控制台](https://bailian.console.aliyun.com/)） |
| `MODEL_NAME` | 可选 | 默认 `deepseek-v4.1-flash` |
| `DASHSCOPE_BASE_URL` | 可选 | 默认 `https://dashscope.aliyuncs.com/compatible-mode/v1` |

> Key 只存在于 Vercel 服务端环境变量，不会出现在前端代码或响应里。

添加后重新部署一次使其生效：

```bash
npx vercel --prod
```

## 三、验证

```bash
curl https://你的域名/api/health
# {"status":"ok","provider":"aliyun-dashscope","model":"deepseek-v4.1-flash","key_configured":true}

curl -X POST https://你的域名/api/chat \
  -H "Content-Type: application/json" \
  -d '{"prompt":"图仓支持哪些平台？"}'
# {"answer":"...","model":"deepseek-v4.1-flash"}
```

## 四、让官网用上它

前端会**自动探测**，无需改代码：

1. 同域 `/api`（把官网也部署到同一个 Vercel 项目时）
2. `http://127.0.0.1:8000`（本机代理）

如果官网在别处托管（如 Surge / GitHub Pages），在 `index.html` 里显式指定：

```html
<script>window.PIC_HARVEST_AI_API = "https://你的域名";</script>
<script src="assets/ai-chat.js"></script>
```

## 五、成本与防滥用

公开给全网使用会持续产生阿里云百炼调用费用。建议至少加一层限制：

- Vercel 侧的 Rate Limit（`@vercel/edge` 或中间件按 IP 限流）
- 简单口令：前端多传一个 `token`，函数里校验
- 阿里云百炼控制台设置用量上限/告警

## 路由

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查，返回模型与 Key 配置状态 |
| POST | `/api/chat` | 对话，入参 `{prompt, history, max_tokens, temperature}` |
| OPTIONS | `/api/*` | CORS 预检 |
