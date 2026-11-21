"""Run after Companion test compilation. Real Chrome, isolated Companion data, local text-only model fixture."""
import json
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.request import Request, urlopen

from playwright.sync_api import sync_playwright


class TextModel(BaseHTTPRequestHandler):
    calls = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        assert self.path == "/v1/chat/completions"
        assert body["model"] == "translation-fixture"
        assert self.headers["Authorization"] == "Bearer fixture-key"
        assert [message["role"] for message in body["messages"]] == ["system", "user"]
        text = body["messages"][1]["content"]
        self.calls.append(text)
        reply = {"choices": [{"index": 0, "message": {"role": "assistant", "content": "Translation " + text}, "finish_reason": "stop"}]}
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(reply).encode())

    def log_message(self, *_):
        pass


def verify():
    root = Path(__file__).resolve().parents[1]
    model = ThreadingHTTPServer(("127.0.0.1", 0), TextModel)
    Thread(target=model.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix="meeting-translation-") as temp_dir:
            temp = Path(temp_dir)
            data = temp / "data"
            data.mkdir()
            endpoint = f"http://127.0.0.1:{model.server_port}/v1"
            (data / "config.json").write_text(json.dumps({"llm": {"base_url": endpoint, "model_name": "translation-fixture", "api_key": "fixture-key"}}))
            subprocess.run(["node", "scripts/render-meeting-workflow-fixture.cjs", str(temp / "web"), "--translation"], cwd=root, check=True)
            with (temp / "server.log").open("w") as log:
                server = subprocess.Popen(["node", "scripts/meeting-workflow-server.cjs", str(temp / "web"), str(data), str(temp / "frames.json")], cwd=root, stdout=subprocess.PIPE, stderr=log, text=True)
                try:
                    host = f"http://127.0.0.1:{json.loads(server.stdout.readline())['port']}"
                    def rpc(frame):
                        payload = json.dumps({"message": {"v": 1, **frame}}).encode()
                        with urlopen(Request(host + "/rpc", data=payload, headers={"Content-Type": "application/json"})) as res:
                            return json.load(res)

                    with sync_playwright() as p:
                        browser = p.chromium.launch(channel="chrome", headless=True)
                        page = browser.new_page()
                        errors = []
                        page.on("pageerror", lambda error: errors.append(str(error)))
                        page.goto(host)
                        page.get_by_label("原文", exact=True).fill("人工输入")
                        def preview():
                            page.get_by_role("button", name="核对翻译接收方").click()
                            page.get_by_text(endpoint, exact=False).wait_for()
                            page.get_by_text("模型 translation-fixture · 目标语言 English").wait_for()
                        preview()
                        page.get_by_role("button", name="取消", exact=True).click()
                        assert TextModel.calls == []
                        preview()
                        page.get_by_role("button", name="确认发送并翻译").click()
                        page.get_by_text("Translation 人工输入", exact=True).wait_for()
                        meeting = rpc({"type": "meeting.create", "title": "Translation fixture"})["meeting"]["id"]
                        def add(segment, text):
                            return rpc({"type": "meeting.append_transcript", "id": meeting, "source": "stt", "segment_id": segment, "text": text})
                        add("segment-1", "第一句")
                        page.goto(host + "/#" + meeting)
                        page.reload()
                        page.get_by_text("第一句", exact=True).wait_for()
                        preview()
                        page.get_by_role("button", name="确认发送并翻译").click()
                        page.get_by_text("Translation 第一句", exact=True).wait_for()
                        page.evaluate("m => window.emit(m)", {"type": "voice.stt.partial", "text": "临时文字"})
                        page.evaluate("m => window.emit(m)", add("segment-2", "第二句"))
                        page.get_by_text("Translation 第二句", exact=True).wait_for()
                        page.get_by_role("button", name="停止翻译").click()
                        page.evaluate("m => window.emit(m)", add("segment-3", "停止后"))
                        page.get_by_text("停止后", exact=True).wait_for()
                        page.reload()
                        page.get_by_text("Translation 第二句", exact=True).wait_for()
                        assert TextModel.calls == ["人工输入", "第一句", "第二句"]
                        assert not errors, errors
                        browser.close()
                        print("PASS: manual decline/confirm; final segments only; cancellation; saved translations after reload")
                finally:
                    server.terminate()
                    server.wait()
    finally:
        model.shutdown()
        model.server_close()


if __name__ == "__main__":
    verify()
