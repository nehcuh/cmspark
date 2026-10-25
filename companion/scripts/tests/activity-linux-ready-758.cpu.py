"""Execute the actual readiness function with inert X/Tk boundaries only."""
import ast
import hashlib
import json
from pathlib import Path
import sys
import types


source = Path(__file__).resolve().parents[2] / "tests/fixtures/activity-linux-758.py"
body = source.read_bytes()
tree = ast.parse(body)
functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "await_managed_ready"]
assert len(functions) == 1
code = compile(ast.fix_missing_locations(ast.Module(body=functions, type_ignores=[])), "<actual-owned-readiness>", "exec")
namespace = {"tk": types.SimpleNamespace(READABLE=2)}
exec(code, namespace)
ready = namespace["await_managed_ready"]


class Fn:
    def __init__(self, fn):
        self.fn = fn
    def __call__(self, *args):
        return self.fn(*args)


class Long:
    def __mul__(self, size):
        assert size == 24
        return lambda: [0] * size


def fixture(current=None, *, buffered=False, error=False, fd=17):
    trace, queued, published = [], [], []
    root = types.SimpleNamespace()
    root.handlers, root.idle = {}, []
    def register(number, mask, callback):
        assert number == fd and mask == 2
        trace.append("register")
        root.handlers[number] = callback
    def remove(number):
        assert number in root.handlers
        trace.append("detach")
        del root.handlers[number]
    root.createfilehandler, root.deletefilehandler = register, remove
    root.after_idle = lambda callback: root.idle.append(callback)
    c = types.SimpleNamespace(c_int=object(), c_void_p=object(), c_ulong=object(), c_long=Long(), byref=lambda value: value)
    desktop = types.SimpleNamespace(display=object(), root=7, error=error, ctypes758=c, current=current, buffered=buffered)
    def select(display, window, mask):
        assert display is desktop.display and window == 7
        assert mask == (1 << 19) | (1 << 22) and not mask & (1 << 20)
        trace.append("select-notifications-only")
    def pending(display):
        assert display is desktop.display
        return len(queued)
    def consume(display, event):
        assert display is desktop.display and len(event) == 24 and queued
        queued.pop(0)
        trace.append("consume-own-event")
    desktop.x = types.SimpleNamespace(
        XSelectInput=Fn(select), XSync=Fn(lambda display, discard: trace.append("sync")),
        XConnectionNumber=Fn(lambda display: fd), XPending=Fn(pending), XNextEvent=Fn(consume),
    )
    def prop(window, name):
        assert window == desktop.root and name == "_NET_CLIENT_LIST_STACKING"
        return [] if desktop.current is None else [41]
    desktop.prop = prop
    def info(window, include_title):
        assert window == 41 and include_title is False
        assert "register" in trace
        trace.append("actual-info-boundary")
        value = desktop.current
        if desktop.buffered:
            desktop.buffered = False
            desktop.current = {"pid": 2468}
            queued.append(1)  # An X reply buffered an event, FD now drained.
        if isinstance(value, Exception):
            raise value
        return value
    desktop.info = info
    def publish():
        assert not root.handlers
        trace.append("publish")
        published.append(2468)
    return root, desktop, queued, published, trace, publish


cases = 0
for value in [None, {"pid": 999}, {"pid": True}, RuntimeError("FOREGROUND_UNAVAILABLE"), OSError("owned refusal")]:
    root, desktop, queue, out, trace, publish = fixture(value)
    detach = ready(root, desktop, 2468, publish)
    assert not out and len(root.idle) == 1
    root.idle.pop()()
    assert not out and root.handlers
    desktop.current = {"pid": 2468}
    queue.append(1)
    callback = root.handlers[17]
    callback(17, 2)
    assert out == [2468] and not root.handlers
    callback(17, 2)
    detach()
    assert out == [2468] and trace.count("publish") == 1
    cases += 1

root, desktop, queue, out, trace, publish = fixture({"pid": 2468})
detach = ready(root, desktop, 2468, publish)
root.idle.pop()()
assert out == [2468] and not root.handlers
detach()
cases += 1

root, desktop, queue, out, trace, publish = fixture(RuntimeError("FOREGROUND_UNAVAILABLE"), buffered=True)
detach = ready(root, desktop, 2468, publish)
root.idle.pop()()
assert out == [2468] and trace.count("actual-info-boundary") == 2
cases += 1

root, desktop, queue, out, trace, publish = fixture()
detach = ready(root, desktop, 2468, publish)
callback = root.idle.pop()
detach()
desktop.current = {"pid": 2468}
callback()
assert not out and trace.count("actual-info-boundary") == 0
cases += 1

for options in [{"error": True}, {"fd": -1}]:
    root, desktop, queue, out, trace, publish = fixture(**options)
    try:
        ready(root, desktop, 2468, publish)
        raise AssertionError("invalid observer accepted")
    except RuntimeError as error:
        assert str(error) == "OWNED_ACTIVITY_OBSERVER_FAILED"
    assert not out and not root.handlers
    cases += 1

root, desktop, queue, out, trace, publish = fixture(ValueError("owned unexpected error"))
detach = ready(root, desktop, 2468, publish)
try:
    root.idle.pop()()
    raise AssertionError("unexpected error swallowed")
except ValueError:
    pass
assert not out
detach()
cases += 1

root, desktop, queue, out, trace, publish = fixture()
detach = ready(root, desktop, 2468, publish)
queue.extend(range(4097))
try:
    root.idle.pop()()
    raise AssertionError("unbounded event drain accepted")
except RuntimeError as error:
    assert str(error) == "OWNED_ACTIVITY_OBSERVER_EVENT_LIMIT"
assert not out and len(queue) == 1
detach()
cases += 1

# Optional local counterexample executes the actual old producer statement,
# never imports or launches its Tk/X libraries. Not required for normal CI.
old = None
if len(sys.argv) == 2:
    raw = Path(sys.argv[1]).read_bytes()
    old_tree = ast.parse(raw)
    calls = [n for n in old_tree.body if isinstance(n, ast.Expr) and isinstance(n.value, ast.Call)
             and isinstance(n.value.func, ast.Attribute) and n.value.func.attr == "after"
             and isinstance(n.value.args[0], ast.Constant) and n.value.args[0].value == 500]
    assert len(calls) == 1
    writes = []
    clock = types.SimpleNamespace(after=lambda ms, callback: callback())
    exec(compile(ast.Module(body=calls, type_ignores=[]), "<actual-old-readiness>", "exec"),
         {"root": clock, "record": lambda name, value: writes.append(name), "os": types.SimpleNamespace(getpid=lambda: 2468)})
    assert writes == ["ready.json"]  # real old readiness accepts no managed window
    old = {"sha256": hashlib.sha256(raw).hexdigest(), "publishesWithoutWindow": True}

assert cases == 12
print(json.dumps({"schema": 1, "cases": cases, "sourceSHA256": hashlib.sha256(body).hexdigest(),
                  "old": old, "native": False, "tkImported": False, "foreignCalls": False}))
