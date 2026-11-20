#!/usr/bin/env python3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

root = Path(sys.argv[1]).resolve()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path.endswith(".js"):
            body, ctype = (root / "app.js").read_bytes(), "text/javascript"
        elif path.endswith(".css"):
            file = root / "app.css"
            body, ctype = (file.read_bytes() if file.exists() else b""), "text/css"
        else:
            body, ctype = (root / "index.html").read_bytes(), "text/html; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        return

with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
    print(server.server_port, flush=True)
    server.serve_forever()
