"""Emit inert responses from the actual Qwen worker; no model or image is loaded."""
import ast
import contextlib
import io
import json
import re
import sys
import types
from pathlib import Path

worker = Path(__file__).resolve().parents[2] / "src/computer/qwen-vl-worker.py"
tree = ast.parse(worker.read_text(encoding="utf-8"))
functions = [node for node in tree.body if isinstance(node, ast.FunctionDef)]
module = ast.fix_missing_locations(ast.Module(
    body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0)] + functions,
    type_ignores=[],
))

class Image:
    size = (500, 500)
    def convert(self, _mode): return self

class Processor:
    raw = ""
    def apply_chat_template(self, *args, **kwargs): return "fixture"
    def __call__(self, *args, **kwargs): return {}
    def batch_decode(self, *args, **kwargs): return [self.raw]

class Model:
    def generate(self, *args, **kwargs): return []

sys.modules["PIL"] = types.SimpleNamespace(Image=types.SimpleNamespace(open=lambda _: Image()))
sys.modules["torch"] = types.SimpleNamespace(inference_mode=contextlib.nullcontext)
processor = Processor()
scope = {"json": json, "re": re, "sys": sys, "_model": Model(), "_processor": processor, "_device": "cpu"}
exec(compile(module, str(worker), "exec"), scope)
suffix = '{"x":1,"y":0}'
cases = {
    "unicode499": "😀" + "a" * 485 + suffix,
    "ascii500": "a" * 487 + suffix,
    "surrogate500": "a" * 485 + "\ud83d\ude00" + suffix,
    "truncated": "a" * 500 + suffix,
}
out = {}
for label, raw in cases.items():
    processor.raw = raw
    response = scope["_infer"]("owned-fixture", "click", 500, 500)
    stream = io.StringIO()
    with contextlib.redirect_stdout(stream):
        scope["_reply"]({"id": "r1", **response})
    # Model output may contain lone surrogates. This models Python stdout
    # with UTF-8 backslashreplace, not a claim about the default environment.
    out[label] = stream.getvalue().encode("utf-8", "backslashreplace").decode("utf-8")
print(json.dumps(out, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
