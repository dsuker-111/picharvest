# -*- coding: utf-8 -*-
"""
图仓 · 本地部署模型服务
======================

加载 TRAE 里微调好的 Qwen2.5-0.5B-Instruct + LoRA（已合并权重），
以 HTTP 方式供 server/cloud_api.py 转发，实现「云端 / 本地」可切换。

依赖：torch、transformers、peft、accelerate
    pip install -r server/requirements.txt

用法：
    python server/local_model.py

环境变量：
    LOCAL_PORT          监听端口，默认 8100（避开常被占用的 8000）
    MODEL_DIR           合并后的模型目录，默认 E:\\peft_out\\qwen_lora_qa_merged
    BASE_MODEL          回退用的基座模型，默认 Qwen/Qwen2.5-0.5B-Instruct
    ADAPTER_DIR         LoRA 适配器目录，默认 E:\\peft_out\\lora_lora_qa
    LOCAL_MODEL_LABEL   展示名称

接口：
    GET  /health  -> {status, provider:"local", model, loaded}
    POST /chat    -> {answer, model, provider:"local"}
                     入参 {prompt, max_new_tokens?, temperature?, history?}
"""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

os.environ.setdefault("HF_HOME", r"E:\hf_cache")
os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("TRANSFORMERS_NO_ADVISORY_WARNINGS", "1")

HOST = "127.0.0.1"
PORT = int(os.environ.get("LOCAL_PORT", "8100"))

MODEL_DIR = os.environ.get("MODEL_DIR", r"E:\peft_out\qwen_lora_qa_merged")
BASE_MODEL = os.environ.get("BASE_MODEL", "Qwen/Qwen2.5-0.5B-Instruct")
ADAPTER_DIR = os.environ.get("ADAPTER_DIR", r"E:\peft_out\lora_lora_qa")
LABEL = os.environ.get("LOCAL_MODEL_LABEL", "Qwen2.5-0.5B + LoRA（本地）")

SYSTEM = (
    "你是「图仓 PicHarvest」官网的 AI 助手。图仓是一个 Chrome / Edge 浏览器扩展，"
    "用于在电商商品详情页批量提取图片：打开商品页后点击图仓图标，扩展在本地扫描页面图片，"
    "自动去重、优先还原高清原图，然后打包 ZIP 或逐张下载。"
    "它没有账号系统、没有后端服务器，图片由浏览器直接从原 CDN 下载，不上传到任何服务器。"
    "支持的平台包括 Amazon、Shopify、淘宝、天猫、1688、AliExpress、Shopee、eBay、Walmart、"
    "Etsy、Temu、SHEIN、京东、拼多多、小红书、抖音商城、TikTok Shop 等。"
    "回答用中文，简洁直接；不确定就说明不确定，不要编造功能。"
)

_lock = threading.Lock()
tokenizer = None
model = None
loaded = False
load_error = ""


def load_model():
    """加载模型：优先用合并后的目录，否则回退到 base + LoRA 适配器。"""
    global tokenizer, model, loaded, load_error
    try:
        import torch
        from transformers import AutoTokenizer, AutoModelForCausalLM

        if os.path.isdir(MODEL_DIR):
            print("[local] 加载合并模型: %s" % MODEL_DIR, flush=True)
            tokenizer = AutoTokenizer.from_pretrained(MODEL_DIR, trust_remote_code=True)
            model = AutoModelForCausalLM.from_pretrained(
                MODEL_DIR, torch_dtype="auto", device_map="auto", trust_remote_code=True
            )
        else:
            print("[local] 未找到合并目录，回退 base + adapter", flush=True)
            from peft import PeftModel

            tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, trust_remote_code=True)
            model = AutoModelForCausalLM.from_pretrained(
                BASE_MODEL, torch_dtype="auto", device_map="auto", trust_remote_code=True
            )
            model = PeftModel.from_pretrained(model, ADAPTER_DIR).merge_and_unload()

        model.eval()
        loaded = True
        print("[local] 模型就绪", flush=True)
    except Exception as exc:  # noqa: BLE001
        load_error = "%s: %s" % (type(exc).__name__, exc)
        loaded = False
        print("[local] 加载失败 -> %s" % load_error, flush=True)


def answer(prompt, max_new_tokens=256, temperature=0.0, history=None):
    import torch

    msgs = [{"role": "system", "content": SYSTEM}]
    for item in (history or [])[-6:]:
        role = item.get("role")
        content = (item.get("content") or "").strip()
        if not content:
            continue
        if role == "ai":
            role = "assistant"
        if role in ("user", "assistant"):
            msgs.append({"role": role, "content": content[:1000]})
    msgs.append({"role": "user", "content": prompt})

    text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
    inputs = tokenizer(text, return_tensors="pt").to(model.device)

    do_sample = temperature > 0
    gen_kwargs = dict(
        max_new_tokens=int(max_new_tokens),
        do_sample=do_sample,
        repetition_penalty=1.1,
        eos_token_id=tokenizer.eos_token_id,
        pad_token_id=tokenizer.pad_token_id or tokenizer.eos_token_id,
    )
    if do_sample:
        gen_kwargs.update(temperature=float(temperature), top_p=0.9)

    with _lock, torch.no_grad():
        out = model.generate(**inputs, **gen_kwargs)

    gen_ids = out[0][inputs["input_ids"].shape[1]:]
    text = tokenizer.decode(gen_ids, skip_special_tokens=True)
    return text.replace("<|im_start|>assistant", "").replace("<|im_end|>", "").strip()


class Handler(BaseHTTPRequestHandler):
    server_version = "PicHarvestLocalModel/1.0"

    def _send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.end_headers()

    def do_GET(self):
        if urlparse(self.path).path == "/health":
            self._send_json(200, {
                "status": "ok" if loaded else "loading",
                "provider": "local",
                "model": LABEL,
                "loaded": loaded,
                "error": load_error,
                "model_dir": MODEL_DIR,
            })
        else:
            self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if urlparse(self.path).path != "/chat":
            self._send_json(404, {"error": "not found"})
            return

        if not loaded:
            self._send_json(200, {
                "answer": "",
                "error": "本地模型尚未就绪：" + (load_error or "正在加载，请稍后重试"),
                "model": LABEL,
                "provider": "local",
            })
            return

        try:
            length = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(length) if length else b"{}"
            body = json.loads(raw.decode("utf-8") or "{}")
        except Exception as exc:  # noqa: BLE001
            self._send_json(400, {"answer": "", "error": "请求体解析失败：%s" % exc})
            return

        prompt = (body.get("prompt") or "").strip()
        if not prompt:
            self._send_json(200, {"answer": "", "model": LABEL, "provider": "local"})
            return

        try:
            text = answer(
                prompt,
                max_new_tokens=body.get("max_new_tokens") or body.get("max_tokens") or 256,
                temperature=body.get("temperature", 0.0),
                history=body.get("history"),
            )
            self._send_json(200, {
                "answer": text or "（本地模型没有返回内容）",
                "model": LABEL,
                "provider": "local",
            })
        except Exception as exc:  # noqa: BLE001
            self._send_json(200, {"answer": "", "error": "本地推理异常：%s" % exc,
                                  "model": LABEL, "provider": "local"})

    def log_message(self, fmt, *args):
        print("[local] " + (fmt % args), flush=True)


if __name__ == "__main__":
    print("=" * 58)
    print("  图仓 · 本地模型服务")
    print("  地址   : http://%s:%d" % (HOST, PORT))
    print("  模型   : %s" % LABEL)
    print("  目录   : %s" % MODEL_DIR)
    print("=" * 58, flush=True)

    threading.Thread(target=load_model, daemon=True).start()
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()