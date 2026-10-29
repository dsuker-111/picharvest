# -*- coding: utf-8 -*-
"""测试用：模拟本地模型服务（端口 8100），用于验证 cloud_api.py 的 provider 路由。"""
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class H(BaseHTTPRequestHandler):
    def _j(self, code, obj):
        b = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/health":
            self._j(200, {"status": "ok", "provider": "local", "model": "STUB-LOCAL", "loaded": True})
        else:
            self._j(404, {"error": "nf"})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n).decode() or "{}")
        self._j(200, {
            "answer": "[STUB-LOCAL] 收到：%s" % body.get("prompt", ""),
            "model": "STUB-LOCAL",
            "provider": "local",
        })

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 8100), H).serve_forever()