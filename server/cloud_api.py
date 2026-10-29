"""
阿里云百炼（DashScope）代理服务 cloud_api.py
==========================================

把前端 AI 对话框的请求转发到阿里云的 OpenAI 兼容接口，
**API Key 只保存在服务端环境变量里，不会进入前端代码或仓库。**

默认模型：deepseek-v4.1-flash
默认接口：https://dashscope.aliyuncs.com/compatible-mode/v1

【零依赖】只使用 Python 标准库，无需 pip install。

用法：
    # 1) 设置阿里云百炼 API Key（在百炼控制台创建）
    Windows:  set DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxx
    macOS/Linux: export DASHSCOPE_API_KEY=sk-xxxxxxxxxxxxxxxx

    # 2) 启动
    python server/cloud_api.py

可选环境变量：
    DASHSCOPE_BASE_URL  接口地址，默认 https://dashscope.aliyuncs.com/compatible-mode/v1
    MODEL_NAME          模型名，默认 deepseek-v4.1-flash
    PORT                监听端口，默认 8000
"""

import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

API_KEY = os.environ.get("DASHSCOPE_API_KEY", "").strip()
BASE_URL = os.environ.get(
    "DASHSCOPE_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"
).rstrip("/")
MODEL_NAME = os.environ.get("MODEL_NAME", "deepseek-v4.1-flash")
PORT = int(os.environ.get("PORT", "8123"))

# ---- 本地部署模型（可选）----
# 由 server/local_model.py 提供，默认端口 8100，避免与常见 8000 端口冲突。
LOCAL_MODEL_URL = os.environ.get("LOCAL_MODEL_URL", "http://127.0.0.1:8100").rstrip("/")
LOCAL_MODEL_NAME = os.environ.get("LOCAL_MODEL_NAME", "Qwen2.5-0.5B + LoRA（本地）")
# 默认走云端；前端可在请求里用 provider 覆盖
DEFAULT_PROVIDER = os.environ.get("DEFAULT_PROVIDER", "cloud").lower()

SYSTEM_PROMPT = (
    "你是「图仓 PicHarvest」官网的 AI 助手，服务对象是电商运营、设计师和选品人员。\n\n"
    "关于图仓的准确事实（不要编造其他信息）：\n"
    "- 图仓是一个 Chrome / Edge 浏览器扩展，Manifest V3，要求浏览器 116 以上。\n"
    "- 用法：打开电商商品详情页 → 点击工具栏的图仓图标 → 扩展在本地扫描当前页面图片 → "
    "自动去重、优先还原高清原图 → 勾选后一键打包 ZIP 或逐张下载。\n"
    "- 支持平台：Amazon、Shopify（含自定义域名）、淘宝、天猫、1688、AliExpress、Alibaba、"
    "Shopee、eBay、Walmart、Etsy、Temu、SHEIN、京东、拼多多、小红书、抖音商城、"
    "TikTok Shop、Wish。未列出的电商页面走通用抓取。\n"
    "- 核心能力：识别 CDN 尺寸后缀还原原图；合并同一张图的缩略图 / srcset / webp 变体；"
    "读取 img、srcset、JSON-LD、Open Graph、CSS 背景图、懒加载属性；ZIP 打包不转码不压缩画质。\n"
    "- 隐私：没有账号系统、没有后端服务器、没有统计脚本。图片由浏览器直接从原 CDN 下载，"
    "不上传到任何服务器。\n"
    "- 安装：下载 zip 解压 → 打开 chrome://extensions 或 edge://extensions → 开启右上角"
    "「开发者模式」→ 点「加载已解压的扩展程序」→ 选择解压后的文件夹。安装时出现"
    "「开发者模式扩展」提示是正常的，因为尚未上架应用商店。\n"
    "- 版本 v1.0.0，安装包约 72 KB，MIT 许可，免费无需注册。\n"
    "- 限制：部分 CDN 使用签名 URL、服务端裁切或严格防盗链，无法还原或拉取原图；"
    "ZIP 会跳过这些图片并提示，可改用逐张下载。ZIP 单次最多 80 张，单张上限 40 MB，"
    "压缩包上限 280 MB；不处理视频文件，只提取视频封面图。\n\n"
    "回答要求：用中文，简洁直接，不要夸张营销语气；不确定就说明不确定，不要编造功能；"
    "不要声称图仓有服务器、账号、云端存储或视频下载能力。"
)


def build_messages(prompt, history):
    """把前端传的 prompt + history 转成 OpenAI 格式 messages。"""
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    for item in history or []:
        role = item.get("role")
        content = (item.get("content") or "").strip()
        if not content:
            continue
        # 前端用 ai 表示助手，OpenAI 兼容接口用 assistant
        if role == "ai":
            role = "assistant"
        if role not in ("user", "assistant"):
            continue
        messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": prompt})
    return messages


def call_dashscope(messages, max_tokens=512, temperature=0.7):
    """调用阿里云 OpenAI 兼容 chat/completions。"""
    if not API_KEY:
        raise RuntimeError(
            "未配置 DASHSCOPE_API_KEY。请先设置环境变量后重启本服务。"
        )

    payload = {
        "model": MODEL_NAME,
        "messages": messages,
        "max_tokens": int(max_tokens),
        "temperature": float(temperature),
        "stream": False,
    }
    # deepseek 推理模型默认开启思考，会把 max_tokens 全用在 reasoning 上，
    # 导致正文为空。官网问答场景关闭思考，响应更快、更直接。
    if MODEL_NAME.lower().startswith("deepseek"):
        payload["enable_thinking"] = False
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        BASE_URL + "/chat/completions",
        data=data,
        method="POST",
        headers={
            "Authorization": "Bearer " + API_KEY,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")[:600]
        raise RuntimeError("阿里云接口 HTTP %s：%s" % (exc.code, detail))
    except urllib.error.URLError as exc:
        raise RuntimeError("无法连接阿里云接口：%s" % exc.reason)
    except TimeoutError:
        raise RuntimeError("调用阿里云接口超时，请稍后重试。")

    choices = body.get("choices") or []
    if not choices:
        raise RuntimeError(
            "阿里云返回内容为空：%s" % json.dumps(body, ensure_ascii=False)[:400]
        )
    message = choices[0].get("message") or {}
    return (message.get("content") or "").strip()


def probe_local(timeout=2):
    """探测本地模型服务是否在线。"""
    if not LOCAL_MODEL_URL:
        return False
    try:
        req = urllib.request.Request(LOCAL_MODEL_URL + "/health", method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status == 200
    except Exception:
        return False


def call_local(prompt, history=None, max_tokens=512, temperature=0.0):
    """转发到本地部署的 transformers 模型服务（server/local_model.py）。"""
    if not LOCAL_MODEL_URL:
        raise RuntimeError("未配置 LOCAL_MODEL_URL")

    payload = {
        "prompt": prompt,
        "max_new_tokens": int(max_tokens),
        "temperature": float(temperature),
    }
    if history:
        payload["history"] = history

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        LOCAL_MODEL_URL + "/chat",
        data=data,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    try:
        # 本地 CPU/GPU 推理可能较慢，给足超时
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "ignore")[:300]
        raise RuntimeError("本地模型 HTTP %s：%s" % (exc.code, detail))
    except urllib.error.URLError as exc:
        raise RuntimeError(
            "无法连接本地模型（%s）：%s。请先运行 server/local_model.py"
            % (LOCAL_MODEL_URL, getattr(exc, "reason", exc))
        )
    except TimeoutError:
        raise RuntimeError("本地模型推理超时。")

    if not isinstance(body, dict):
        raise RuntimeError("本地模型返回格式异常")
    answer = body.get("answer") or body.get("content") or ""
    if not answer:
        raise RuntimeError(body.get("error") or "本地模型返回空内容")
    return str(answer).strip()


class Handler(BaseHTTPRequestHandler):
    server_version = "PersonalSiteAIProxy/1.0"

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # 允许静态站点（含 GitHub Pages 域名）跨域调用本机代理
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        # Chrome 私有网络访问（Public → localhost）要求显式放行，
        # 否则 GitHub Pages 等公网 HTTPS 页面无法请求本机 127.0.0.1
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Access-Control-Request-Private-Network")
        self.send_header("Access-Control-Max-Age", "600")
        # 关键：允许公网页面访问本机（Private Network Access 预检）
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        if self.path.split("?")[0] == "/health":
            local_ok = probe_local()
            self._send_json(200, {
                "status": "ok",
                "provider": "aliyun-dashscope",
                "model": MODEL_NAME,
                "base_url": BASE_URL,
                "key_configured": bool(API_KEY),
                # 双后端可用性，前端据此启用 / 禁用「本地模型」按钮
                "providers": {
                    "cloud": bool(API_KEY),
                    "local": local_ok,
                },
                "default_provider": DEFAULT_PROVIDER,
                "local_url": LOCAL_MODEL_URL,
            })
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path.split("?")[0] != "/chat":
            self._send_json(404, {"error": "not found"})
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception as exc:
            self._send_json(400, {"answer": "", "error": "请求体解析失败：%s" % exc})
            return

        prompt = (body.get("prompt") or "").strip()
        if not prompt:
            self._send_json(200, {"answer": "", "model": MODEL_NAME})
            return

        provider = (body.get("provider") or DEFAULT_PROVIDER or "cloud").lower()
        max_tokens = body.get("max_tokens") or body.get("max_new_tokens") or 512
        temperature = body.get("temperature", 0.7)

        # ---- 本地部署模型 ----
        if provider == "local":
            try:
                answer = call_local(prompt, history=body.get("history"),
                                    max_tokens=max_tokens, temperature=temperature)
                self._send_json(200, {"answer": answer, "model": LOCAL_MODEL_NAME, "provider": "local"})
            except RuntimeError as exc:
                self._send_json(200, {"answer": "", "error": str(exc),
                                      "model": LOCAL_MODEL_NAME, "provider": "local"})
            except Exception as exc:
                self._send_json(200, {"answer": "", "error": "本地模型异常：%s" % exc,
                                      "model": LOCAL_MODEL_NAME, "provider": "local"})
            return

        # ---- 云端阿里云百炼 ----
        messages = build_messages(prompt, body.get("history"))

        try:
            answer = call_dashscope(messages, max_tokens, temperature)
            self._send_json(200, {"answer": answer, "model": MODEL_NAME, "provider": "cloud"})
        except RuntimeError as exc:
            # 返回 200 + 错误说明，前端可直接展示
            self._send_json(200, {"answer": "", "error": str(exc), "model": MODEL_NAME, "provider": "cloud"})
        except Exception as exc:  # 兜底
            self._send_json(200, {"answer": "", "error": "代理异常：%s" % exc})

    def log_message(self, fmt, *args):
        print("[cloud_api] " + (fmt % args))


if __name__ == "__main__":
    print("=" * 62)
    print("  个人网页 AI 代理（阿里云百炼 · 零依赖）")
    print("  地址     : http://127.0.0.1:%d" % PORT)
    print("  模型     : %s" % MODEL_NAME)
    print("  接口     : %s" % BASE_URL)
    print("  API Key  : %s" % ("已配置" if API_KEY else "❌ 未配置 DASHSCOPE_API_KEY"))
    print("=" * 62)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()