"""After nvm use 22: uv run --with playwright python scripts/test-terminal-review-ui.py.

Real React/xterm in isolated headless Chrome; recorded production wire, synthetic
transport/PTY. Does not load or replace the installed extension or Companion.
"""
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parent.parent
fixture = json.loads((project / "tests/fixtures/terminal-review-v1.json").read_text())
component = json.dumps(str(project / "src/terminal/TerminalApp.tsx"))
source = f"""
import React from 'react';
import {{createRoot}} from 'react-dom/client';
import {{TerminalApp}} from {component};
const fixture={json.dumps(fixture)};
window.fixture=fixture;window.frames=[];
let listener;
window.pushFrame=frame=>listener(frame);
window.chrome={{runtime:{{connect:()=>({{
  postMessage:m=>{{
    window.frames.push(m);
    if(m.type==='terminal.open')setTimeout(()=>listener({{...fixture.opened,id:m.id}}),10);
    if(m.type==='terminal.review.submit')setTimeout(()=>listener({{...fixture.received,id:m.id}}),10);
  }},
  onMessage:{{addListener:fn=>listener=fn}},onDisconnect:{{addListener(){{}}}},disconnect(){{}}
}})}}}};
createRoot(document.getElementById('root')).render(<TerminalApp/>);
"""
with tempfile.TemporaryDirectory(prefix="cmspark-terminal-ui-") as directory:
    root = Path(directory)
    build = """
const input=JSON.parse(require('fs').readFileSync(0,'utf8'));
require('esbuild').buildSync({stdin:{contents:input.source,resolveDir:process.cwd(),loader:'tsx'},
 bundle:true,outfile:input.outfile,jsx:'automatic',loader:{'.css':'css'}});
"""
    subprocess.run(["node", "-e", build], cwd=project, input=json.dumps({"source": source, "outfile": str(root / "app.js")}), text=True, check=True)
    (root / "index.html").write_text('<html><meta charset="utf-8"><link rel="stylesheet" href="app.css"><body style="margin:0"><div id="root"></div><script src="app.js"></script></body></html>')
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="chrome", headless=True)
        try:
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            page.goto((root / "index.html").as_uri() + "?thread_id=synthetic-thread&review_id=synthetic-review")
            prompt = page.get_by_role("textbox", name="审阅提示词", exact=True)
            prompt.wait_for()
            assert "不可信数据" in prompt.input_value()
            assert page.evaluate('window.frames.find(x=>x.type==="terminal.open").thread_id') == "synthetic-thread"
            assert page.evaluate('window.frames.filter(x=>x.type==="terminal.input").length') == 0
            page.get_by_role("button", name="复制审阅提示词", exact=True).click()
            assert page.evaluate('window.frames.filter(x=>x.type==="terminal.input").length') == 0
            page.get_by_role("textbox", name="Agent 审阅报告 JSON", exact=True).fill(json.dumps(fixture["report"]))
            page.get_by_role("button", name="确认内容并发送到 CMspark", exact=True).click()
            page.get_by_role("status").filter(has_text="已回传原任务").wait_for()
            assert page.evaluate('window.frames.filter(x=>x.type==="terminal.review.submit").length') == 1
            assert page.evaluate('window.frames.filter(x=>x.type==="terminal.input").length') == 0
            assert page.locator("details").bounding_box()["height"] > 200
            assert page.locator(".xterm").bounding_box()["height"] > 200
            page.evaluate('window.pushFrame({...window.fixture.rejected,id:"",code:"disconnected"})')
            assert page.get_by_role("button", name="确认内容并发送到 CMspark", exact=True).is_disabled()
            page.locator(".xterm-helper-textarea").focus()
            page.keyboard.type("must-not-send")
            assert page.evaluate('window.frames.filter(x=>x.type==="terminal.input").length') == 0
        finally:
            browser.close()
print("PASS: bound React/xterm task, explicit report return, no generated terminal input, both panes visible (synthetic transport/PTY).")
