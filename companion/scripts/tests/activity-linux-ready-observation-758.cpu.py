"""Check actual fixture marker code and byte-exact inverse without importing Tk/X."""
import ast
import hashlib
import json
from pathlib import Path
import re
import types

source = Path(__file__).resolve().parents[2] / "tests/fixtures/activity-linux-758.py"
raw = source.read_bytes()
text = raw.decode("utf-8")
parsed = ast.parse(text)
functions = [node for node in parsed.body if isinstance(node, ast.FunctionDef) and node.name == "mark_ready758"]
assert len(functions) == 1
calls = [node for node in ast.walk(parsed) if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "mark_ready758"]
assert all(len(node.args) == 1 and isinstance(node.args[0], ast.Constant) and type(node.args[0].value) is int for node in calls)
assert sorted(node.args[0].value for node in calls) == list(range(1, 23))

rows = []
def write(fd, data):
    assert fd == 2 and type(data) is bytes
    rows.append(data)
    return len(data)

scope = {"os": types.SimpleNamespace(write=write), "_ready_seen758": set()}
exec(compile(ast.fix_missing_locations(ast.Module(body=functions, type_ignores=[])), "<actual-marker>", "exec"), scope)
mark = scope["mark_ready758"]
for number in range(1, 23):
    mark(number)
    mark(number)
for bad in [0, 23, True, "PRIVATE", None]:
    mark(bad)
assert rows == [("D758_LINUX_READY_%02d\n" % n).encode("ascii") for n in range(1, 23)]
assert sum(map(len, rows)) < 4096
scope["os"].write = lambda *_: (_ for _ in ()).throw(OSError("private"))
scope["_ready_seen758"].clear()
assert mark(1) is None and mark(1) is None

pattern = re.compile(r"(?m)^[ \t]*# OBS758_READY_BEGIN\r?\n[\s\S]*?^[ \t]*# OBS758_READY_END\r?\n")
prior = {
    "LF": "ef3ecd2bb972107982904b341add55a100e6cb3da63a113eca4096cd949eb958",
    "CRLF": "16d3e23ab30d00aebeae16502196cf3cb94b459b65a04e3d50d5a9abd8d46650",
}
count = text.count("# OBS758_READY_BEGIN")
assert count == 21 and text.count("# OBS758_READY_END") == count
current_sha = "f4a8ed6487cde0fbfc2772225d54ef6f3b59c6a8356adcf68b129234a85e78d7"
for name, eol in [("LF", "\n"), ("CRLF", "\r\n")]:
    candidate = text.replace("\r\n", "\n").replace("\n", eol)
    def validate(value):
        assert hashlib.sha256(value.replace("\r\n", "\n").encode()).hexdigest() == current_sha
        assert value.count("# OBS758_READY_BEGIN") == count
        assert value.count("# OBS758_READY_END") == count
        restored, removed = pattern.subn("", value)
        assert removed == count
        assert hashlib.sha256(restored.encode()).hexdigest() == prior[name]
    validate(candidate)
    for mutant in [candidate.replace("# OBS758_READY_BEGIN", "# MISSING", 1), candidate.replace("# OBS758_READY_BEGIN", "# OBS758_READY_BEGIN" + eol + "# OBS758_READY_BEGIN", 1), candidate.replace("mark_ready758(11)", "mark_ready758(12)", 1), candidate + eol]:
        try:
            validate(mutant)
        except AssertionError:
            continue
        raise AssertionError("mutation accepted")
print(json.dumps({"schema": 1, "markers": len(rows), "blocks": count, "inverse": True, "native": False, "sourceSHA256": hashlib.sha256(raw).hexdigest()}))
