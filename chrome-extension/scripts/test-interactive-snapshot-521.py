#!/usr/bin/env python3
"""Owned Chromium proof only; select Node22 with nvm first. No browser installs.
Run with uv run --no-project python ... --chrome /explicit/testing/executable --out /new/owned/path.
The IPC driver uses real Chat scope binding below the router, not a model/human decision.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import tempfile


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chrome", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    chrome = Path(args.chrome).resolve(strict=True)
    out = Path(args.out).resolve()
    if out.exists():
        parser.error("--out must be new; prior evidence is never overwritten")
    node = shutil.which("node")
    if not node:
        parser.error("select Node22 with nvm use22 first")
    version = subprocess.check_output([node, "--version"], text=True).strip()
    if not version.startswith("v22."):
        parser.error("Node22 required; run nvm use22")
    if not (root / "companion/.test-dist/src/server.js").exists():
        parser.error("compile Companion tsconfig.test.json first")
    out.mkdir(mode=0o700, parents=True)
    for name in ("run.cjs", "build.cjs", "server-child.cjs"):
        shutil.copy2(root / "chrome-extension/scripts/fixtures/interactive-snapshot-521" / name, out / name)
    # Before any application runtime import; no inherited provider credentials.
    with tempfile.TemporaryDirectory(prefix="cmspark521-driver-data-") as data:
        env = {key: os.environ[key] for key in ("PATH", "HOME", "TMPDIR") if key in os.environ}
        env.update(LANG="C", CMSPARK_DATA_DIR=data, CMSPARK_521_ROOT=str(root), CMSPARK_521_CHROME=str(chrome))
        with (out / "run.log").open("w") as log:
            result = subprocess.run([node, str(out / "run.cjs")], env=env, stdout=log, stderr=subprocess.STDOUT, check=False)
    (out / "exit.txt").write_text(str(result.returncode) + "\n")
    hashes = [{"path": str(p.relative_to(out)), "sha256": hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted(out.rglob("*")) if p.is_file()]
    (out / "artifact-hashes.json").write_text(json.dumps({"node": version, "exit": result.returncode, "artifacts": hashes}, indent=2) + "\n")
    print(json.dumps({"exit": result.returncode, "packet": str(out), "native": "dedicated Chrome profile; real HMAC/WS/Chat binder/executor/CDP; synthetic owned IPC request driver"}))
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
