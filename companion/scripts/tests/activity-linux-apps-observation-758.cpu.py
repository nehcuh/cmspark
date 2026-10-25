"""CPU contract: AST-selected real producer; no native helper import or X/proc IO."""
import argparse
import ast
import errno
import hashlib
import io
import json
import pathlib
import posixpath
import re
import types


def selected(source, observed):
    tree = ast.parse(source)
    desktops = [n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Desktop"]
    assert len(desktops) == 1
    methods = [n for n in desktops[0].body if isinstance(n, ast.FunctionDef) and n.name in ("client_pid", "info", "close")]
    assert sorted(n.name for n in methods) == ["client_pid", "close", "info"]
    nodes = [n for n in tree.body if isinstance(n, ast.Assign) and len(n.targets) == 1 and isinstance(n.targets[0], ast.Name) and n.targets[0].id == "PROTECTED"]
    assert len(nodes) == 1
    if observed:
        wanted = {"_D758Observation", "_d758_begin", "_d758_next", "_d758_mark", "_d758_record", "_d758_snapshot"}
        helpers = [n for n in tree.body if isinstance(n, (ast.ClassDef, ast.FunctionDef)) and n.name in wanted]
        assert {n.name for n in helpers} == wanted and len(helpers) == len(wanted)
        nodes += helpers
    nodes += [ast.ClassDef(name="Desktop", bases=[], keywords=[], body=methods, decorator_list=[])]
    main = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main"]
    assert len(main) == 1
    nodes += main
    hashes = [{"kind": type(n).__name__, "name": getattr(n, "name", "PROTECTED"), "sha256": hashlib.sha256(ast.dump(n, include_attributes=False).encode()).hexdigest()} for n in nodes]
    return compile(ast.fix_missing_locations(ast.Module(body=nodes, type_ignores=[])), "<actual-linux-apps-selected-758>", "exec"), hashes


class Pointer:
    def __init__(self):
        self.rows = []
    def __bool__(self):
        return bool(self.rows)
    def __getitem__(self, index):
        return self.rows[index]


def run_actual(code, fault, stack):
    calls = []
    def note(name):
        calls.append(name)
    def raise_os(where, code):
        if fault == where:
            raise OSError(code, "PRIVATE_BOUNDARY_TEXT", "PRIVATE_BOUNDARY_PATH")
    class X:
        def XGetWindowAttributes(self, display, window, attr):
            note("attributes")
            attr.map_state = 1 if fault == "unmapped" else 2
            return 0 if fault == "attributes-zero" else 1
        def XCloseDisplay(self, display):
            note("close")
    class Res:
        def XResQueryClientIds(self, display, count_in, spec, count, ids):
            note("query-client")
            count.value = 2 if fault == "count" else 1
            ids.rows = [] if fault == "ids-empty" else [types.SimpleNamespace(spec=types.SimpleNamespace(mask=1 if fault == "mask" else 2))]
            return 1 if fault == "query-status" else 0
        def XResGetClientPid(self, ids):
            note("client-pid")
            return 0 if fault == "pid-zero" else 27182
        def XResClientIdsDestroy(self, count, ids):
            note("destroy-client")
    def stat(path):
        assert path == "/proc/27182"
        note("stat")
        raise_os("stat-enoent", errno.ENOENT)
        return types.SimpleNamespace(st_uid=1001 if fault == "foreign" else 1000)
    def readlink(path):
        assert path == "/proc/27182/exe"
        note("readlink")
        raise_os("readlink-eacces", errno.EACCES)
        raise_os("readlink-eio", errno.EIO)
        if fault == "readlink-runtime":
            raise RuntimeError("PRIVATE_UNKNOWN_RUNTIME")
        return {"relative": "relative", "deleted": "/owned/app (deleted)", "protected": "/owned/1password"}.get(fault, "/owned/app")
    class Stream(io.StringIO):
        def read(self, size=-1):
            assert size == 8192
            note("read")
            raise_os("read-esrch", errno.ESRCH)
            return super().read(size)
    def fake_open(path, *, encoding):
        assert path == "/proc/27182/stat" and encoding == "utf-8"
        note("open")
        raise_os("open-eperm", errno.EPERM)
        return Stream("27182 (owned) " + " ".join(str(i) for i in range(24)))
    namespace = {"C": types.SimpleNamespace(byref=lambda value: value, c_long=lambda: types.SimpleNamespace(value=0), POINTER=lambda _kind: Pointer), "Spec": lambda window, mask: types.SimpleNamespace(window=window, mask=mask), "Id": object, "Attributes": lambda: types.SimpleNamespace(map_state=0), "hashlib": hashlib, "re": re, "_d758_errno": errno, "os": types.SimpleNamespace(stat=stat, readlink=readlink, getuid=lambda: 1000, path=types.SimpleNamespace(basename=posixpath.basename)), "open": fake_open}
    exec(code, namespace)
    real_class = namespace["Desktop"]
    desktop = real_class()
    desktop.display, desktop.root, desktop.x, desktop.res = object(), 1, X(), Res()
    def prop(window, name):
        assert window == desktop.root and name == "_NET_CLIENT_LIST_STACKING", "title access is forbidden in apps"
        note("stack")
        return stack
    desktop.prop = prop
    namespace["Desktop"] = lambda: desktop  # Only native constructor is replaced; actual info/client_pid/main/close remain.
    value = namespace["main"](["apps"])
    assert calls.count("close") == 1 and calls[-1] == "close"
    return value, calls


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("original")
    parser.add_argument("observed")
    parser.add_argument("output")
    args = parser.parse_args()
    original_bytes, observed_bytes = pathlib.Path(args.original).read_bytes(), pathlib.Path(args.observed).read_bytes()
    assert len(original_bytes) <= 2 * 1024 * 1024 and len(observed_bytes) <= 2 * 1024 * 1024
    old_code, old_nodes = selected(original_bytes.decode(), False)
    new_code, new_nodes = selected(observed_bytes.decode(), True)
    # Expected points follow the exact before-operation marks in the real transform.
    scenarios = [("success", 12, 0, 0), ("attributes-zero", 1, 1, 0), ("unmapped", 1, 1, 0), ("query-status", 3, 2, 0), ("count", 4, 2, 0), ("ids-empty", 4, 2, 0), ("mask", 4, 2, 0), ("pid-zero", 6, 3, 0), ("foreign", 6, 3, 0), ("relative", 8, 4, 0), ("deleted", 8, 4, 0), ("protected", 8, 4, 0), ("stat-enoent", 6, 6, 1), ("readlink-eacces", 7, 6, 2), ("open-eperm", 9, 6, 3), ("read-esrch", 10, 6, 4), ("readlink-eio", 7, 6, 5), ("readlink-runtime", 7, 5, 0)]
    observations = []
    for fault, stage, category, err in scenarios:
        old, before_calls = run_actual(old_code, fault, [11])
        new, after_calls = run_actual(new_code, fault, [11])
        assert before_calls == after_calls
        assert old == {key: new[key] for key in ("ok", "apps")}
        snapshot = new["observation758"]
        assert snapshot["rows"] == [[1, stage, category, err]]
        assert snapshot["appCount"] == (1 if category == 0 else 0)
        observations.append({"case": fault, "snapshot": snapshot})
    old_empty, empty_calls = run_actual(old_code, "success", [])
    new_empty, new_empty_calls = run_actual(new_code, "success", [])
    old_refusal, _ = run_actual(old_code, "attributes-zero", [11])
    assert empty_calls == new_empty_calls and old_empty == old_refusal == {"ok": True, "apps": []}
    # Genuine old producer ambiguity: both real outputs are equal, not a missing-new-API assertion.
    old_ambiguity_red = False
    try:
        assert old_empty != old_refusal
    except AssertionError:
        old_ambiguity_red = True
    assert old_ambiguity_red
    assert new_empty["observation758"]["stackCount"] == 0
    observations.append({"case": "empty-stack", "snapshot": new_empty["observation758"]})
    old_multi, old_calls = run_actual(old_code, "success", [11, 12, 13])
    new_multi, new_calls = run_actual(new_code, "success", [11, 12, 13])
    assert old_calls == new_calls and old_multi == {key: new_multi[key] for key in ("ok", "apps")}
    assert new_multi["observation758"]["rows"] == [[1, 12, 0, 0], [2, 12, 0, 0], [3, 12, 0, 0]]
    assert new_multi["observation758"]["infoReturned"] == 3 and new_multi["observation758"]["appCount"] == 1
    observations.append({"case": "stack-ordinals", "snapshot": new_multi["observation758"]})
    result = {"schema": 1, "status": "CPU_CONTRACT", "originalSHA256": hashlib.sha256(original_bytes).hexdigest(), "observedSHA256": hashlib.sha256(observed_bytes).hexdigest(), "oldSelectedNodes": old_nodes, "newSelectedNodes": new_nodes, "observations": observations, "originalOutputAmbiguityRED": old_ambiguity_red, "nativeExecuted": False, "realProcRead": False, "apiTracesConserved": True}
    encoded = json.dumps(result, ensure_ascii=True, separators=(",", ":"))
    assert len(encoded.encode()) <= 131072
    pathlib.Path(args.output).write_text(encoded, encoding="utf-8")


if __name__ == "__main__":
    main()
