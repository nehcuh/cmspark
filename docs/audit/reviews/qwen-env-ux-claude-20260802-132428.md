I've completed inspection of the qwen-env-ux batch. Let me record the verdict.

## Review summary — qwen-env-ux batch (HEAD vs 007130b)

**Adversary B1–B4 fixes verified in real code:**

- **B1 (download env gate)** — `companion/src/computer/model-handlers.ts:543-553`: `computer.model.download` calls `resolveCanDownload()` and returns `CANNOT_DOWNLOAD` when env not ready. Explicit test at `computer-model-handlers.test.ts:226-248` passes (`✔ download refuses when env not ready (CANNOT_DOWNLOAD)`).
- **B2 (license accept skips auto-download if env not ready)** — `model-handlers.ts:506-515`: `license_response accepted:true` checks `resolveCanDownload()` and sets `downloadNote = "skipped-env-not-ready"` instead of calling `startBackgroundDownload` when env isn't ready.
- **B3 (isolated download only `isolatedPythonBin`, no PATH fallback)** — `companion/src/computer/qwen-vl-download.ts:227-235`: `pyCandidates = mode === "system" ? [...] : fs.existsSync(iso) ? [iso] : []`. Empty candidates throws `python-missing` with explicit "请在设置页点「创建独立环境」" message.
- **B4 (sanitizePythonPackages allowlist)** — `companion/src/computer/python-runtime.ts:14-50`: fixed allowlist of 10 packages; rejects flags (`-*`), URLs, paths, git refs, regex-validated names. Wired into both `ensure_python_env` (`model-handlers.ts:699`) and `install_deps` (`model-handlers.ts:724`). Test `computer-python-runtime.test.ts` passes.

**WS validation双层围栏:** All 6 new endpoints (`set_model_root`, `pick_model_root`, `set_python_mode`, `pick_python_path`, `ensure_python_env`, `install_deps`) require `source:"settings"` at both `validateWsMessage` (`server.ts:4927-4965`) AND handler belt (`model-handlers.ts:363-381`). New config fields (`modelRootDir`, `pythonMode`, `pythonPath`) are on the `setComputerModelFields` allowlist (`config.ts:700-715`).

**Tests:** All 14 tests in `computer-model-handlers.test.ts` + `computer-python-runtime.test.ts` pass.

**ADR-020 capability axis compliance:**
- Axes fit: settings-page handlers (not "中层 Agent"); no agent-callable tools added (`tool-definitions-catalog.json` diff is reformatting only).
- Trust monotonicity: `auto_approve_dangerous` / god-mode do not bypass these gates; bio-gate on `set_enabled(true)` preserved.
- originWs: no new `securityConfirmations.request`.
- Experimental labeling preserved (Qwen3-VL explicit).

## Non-blocking nits

1. **Missing ADR-020 capability declaration in implementer prompt.** The prompt body lacks the `Surface/Compose/Autonomy/Trust/Channel` block. Per checklist this would be blocking when "primary UI" is added, but the new UI is settings-page plumbing for an already-declared experimental L2 host_computer layer, the trust boundary is being *tightened* (B1–B4), and no agent-tool surface changes. Flagging as nit, not blocker. For the record: Surface=L2(host_computer) · Compose=none · Autonomy=n/a (settings UX, no agent runtime) · Trust=source:"settings" double-belt + bio-gate on enable · Channel=community.

2. **No tests for the 6 new endpoints** (`pick_model_root`, `set_model_root`, `set_python_mode`, `pick_python_path`, `ensure_python_env`, `install_deps`). WS validation entries and handler belt are untested at the unit level. The B1 gate has a test; the rest are coverage gaps.

3. **`statePayload` runs full `runQwenVlPreflight` on every `get_state`** (`model-handlers.ts:222`) — spawns Python + `nvidia-smi` + HTTP HEAD probes to huggingface/modelscope on each state broadcast. Skipped under `NODE_ENV === "test"`. UX perf concern, not security.

4. **`validateModelRootDir` has a side effect** (`qwen-vl-download.ts:47`): `mkdirSync(p, { recursive: true })` runs during validation, so a hand-typed `set_model_root` path will be created before use. Bounded by `source:"settings"` gate; picker output already exists.

5. **`validatePythonExecutable` runs the user-picked binary** (`python-runtime.ts:352`) with `-c "import sys; print(sys.executable)"`. By design (user picks own Python), but worth noting it's host execution of a user-chosen binary gated only by `source:"settings"`.

VERDICT: APPROVE_WITH_NITS
