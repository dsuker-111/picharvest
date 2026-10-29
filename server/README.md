# 图仓官网 AI 对话框 · 阿里云百炼接入

官网右下角的「AI 助手」浮动按钮，通过本机代理调用**阿里云百炼（DashScope）**的 OpenAI 兼容接口。

## 为什么需要代理

阿里云百炼需要 API Key。如果把 Key 写进前端 JS，任何访客打开开发者工具就能拿到并盗刷你的额度。因此采用：

```
浏览器 → http://127.0.0.1:8000/chat → cloud_api.py（持有 Key）→ dashscope.aliyuncs.com
```

**Key 只存在于代理进程的环境变量里**，不会打包进前端、不会提交到仓库。

## 快速开始

```bash
# 1) 设置 Key（到 https://bailian.console.aliyun.com/ 创建）
set DASHSCOPE_API_KEY=sk-你的密钥

# 2) 启动代理（零依赖，只用 Python 标准库）
python server/cloud_api.py
```

或直接双击 `server/start-ai-proxy.bat`。

然后打开官网，点右下角「AI 助手」即可对话。

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 返回 `{status, provider, model, key_configured}` |
| POST | `/chat` | 入参 `{prompt, history, max_tokens, temperature}`，返回 `{answer, model}` |

`history` 为 `[{role:"user"|"ai", content:"..."}]`，代理会转换成 OpenAI 的 `user` / `assistant` 并追加在 system prompt 之后。

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DASHSCOPE_API_KEY` | 无（必填） | 阿里云百炼 API Key |
| `DASHSCOPE_BASE_URL` | `https://dashscope.aliyuncs.com/compatible-mode/v1` | OpenAI 兼容接口地址 |
| `MODEL_NAME` | `deepseek-v4.1-flash` | 模型名 |
| `PORT` | `8000` | 监听端口 |

## 换端口/换地址

页面默认请求 `http://127.0.0.1:8000`。如果改端口，在 `index.html` 引入 `ai-chat.js` 之前加一行：

```html
<script>window.PIC_HARVEST_AI_API = "http://127.0.0.1:9000";</script>
<script src="assets/ai-chat.js"></script>
```

## 未启动代理时

对话框会显示「未连接 AI 代理（127.0.0.1:8000）」，页面其余部分完全正常——不会报错、不会卡住。

## 关于「他人电脑访问网址能否用模型」

**不能。** 当前架构里代理跑在**你自己的电脑**上，只有你本机能连 `127.0.0.1:8000`。别人打开 `https://picharvest-2026.surge.sh` 时：

- 他们的浏览器会去连**他们自己的** `127.0.0.1:8000`，那里没有服务，于是显示「未连接」
- 即使代理在你机器上运行，公网 HTTPS 页面请求本机 HTTP 属于混合内容，会被浏览器拦截

若要让任何访客都能用这个模型，必须把代理部署到**公网服务器**（如阿里云 ECS / 函数计算），页面改成请求那个公网地址。详见 README 的「部署到公网」小节。
