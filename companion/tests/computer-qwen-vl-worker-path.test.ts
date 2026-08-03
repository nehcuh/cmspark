// resolveQwenVlWorkerScript — packaging + dev path resolution (no model load).

import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  resolveQwenVlWorkerScript,
  ModelRuntimeError,
} from "../src/computer/qwen-vl-runtime"

test("explicit existing path wins", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qwen-vl-worker-"))
  const p = path.join(dir, "qwen-vl-worker.py")
  fs.writeFileSync(p, "# test\n")
  try {
    assert.equal(resolveQwenVlWorkerScript(p), p)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("explicit missing path → worker-missing", () => {
  const ghost = path.join(os.tmpdir(), `qwen-vl-missing-${Date.now()}.py`)
  assert.throws(
    () => resolveQwenVlWorkerScript(ghost),
    (err: unknown) =>
      err instanceof ModelRuntimeError && err.code === "worker-missing",
  )
})

test("repo dist/src layout resolves when present", () => {
  // After npm run build, dist/computer/qwen-vl-worker.py exists; in pure src
  // checkout, src/computer/qwen-vl-worker.py exists. Either is fine.
  const resolved = resolveQwenVlWorkerScript()
  assert.ok(fs.existsSync(resolved), `resolved path must exist: ${resolved}`)
  assert.match(resolved, /qwen-vl-worker\.py$/)
})

test("isolatedPythonBin path is under python-env (never bare PATH python3)", async () => {
  const { isolatedPythonBin } = await import("../src/computer/python-runtime")
  const iso = isolatedPythonBin()
  // Contract: path always points at DATA_DIR/python-env/… whether or not the
  // venv has been created yet (CI has no ~/.cmspark-agent/python-env).
  assert.match(iso, /python-env/)
  assert.notEqual(iso, "python3")
  assert.notEqual(iso, "python")
})

test("QwenVlRuntime without pythonBin fails closed when isolated env is missing", async () => {
  const { QwenVlRuntime } = await import("../src/computer/qwen-vl-runtime")
  const { isolatedPythonBin } = await import("../src/computer/python-runtime")
  const iso = isolatedPythonBin()
  if (fs.existsSync(iso)) {
    // Dev machine with uv env: construction must not require PATH python3.
    // Fake transport avoids spawning a real worker process in unit tests.
    const rt = new QwenVlRuntime({
      variant: "2b",
      transport: {
        load: async () => {},
        infer: async () => ({ x: 0, y: 0 }),
        dispose: async () => {},
      },
    })
    await rt.dispose()
    return
  }
  // CI / clean machine: no transport + no pythonBin → defaultPythonBin throws
  // model-not-ready (never falls back to system python3).
  // Worker script may resolve first; either model-not-ready or worker-missing is fail-closed.
  assert.throws(
    () => new QwenVlRuntime({ variant: "2b" }),
    (err: unknown) =>
      err instanceof ModelRuntimeError &&
      (err.code === "model-not-ready" || err.code === "worker-missing"),
  )
})

test("QwenVlRuntime with injected transport does not require isolated python", async () => {
  const { QwenVlRuntime } = await import("../src/computer/qwen-vl-runtime")
  // transport short-circuits both worker script resolve and defaultPythonBin —
  // tests / admission fakes rely on this.
  const rt = new QwenVlRuntime({
    variant: "2b",
    transport: {
      load: async () => {},
      infer: async () => ({ x: 1, y: 2 }),
      dispose: async () => {},
    },
  })
  await rt.dispose()
})
