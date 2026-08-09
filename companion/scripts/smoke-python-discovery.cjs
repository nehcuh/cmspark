const path = require("path");
const fs = require("fs");
const m = require("../.test-dist/src/computer/python-runtime.js");

async function main() {
  const results = {};
  const uv = await m.findUv();
  results.findUv = uv;

  const base = await m.findPythonBase({ includeIsolated: false });
  results.findPythonBase_noIsolated = base;

  const baseIso = await m.findPythonBase({ includeIsolated: true });
  results.findPythonBase_withIsolated = baseIso;

  const well = m.listWellKnownPythonCandidates();
  results.wellKnownCount = well.length;
  results.wellKnownSample = well.slice(0, 12);

  const mgr = typeof m.listManagerPythonCandidates === "function" ? m.listManagerPythonCandidates() : [];
  results.managerCount = mgr.length;
  results.managerSample = mgr.slice(0, 8);

  const storePath = path.join(process.env.LOCALAPPDATA || "", "Microsoft", "WindowsApps", "python.exe");
  results.storeStubDetected = m.isWindowsStorePythonStub(storePath);
  results.storePathExists = fs.existsSync(storePath);

  const hint = m.pythonInstallHint("win32");
  results.pythonInstallHint = hint;
  results.hintHasWinget = /winget/i.test(hint);
  results.hintBrewOnly = /brew install python/i.test(hint) && !/winget/i.test(hint);

  const rtIso = await m.resolvePythonRuntime({ mode: "isolated" });
  results.resolveIsolated = {
    mode: rtIso.mode,
    pythonPath: rtIso.pythonPath,
    uvAvailable: rtIso.uvAvailable,
    uvPath: rtIso.uvPath,
    isolatedExists: rtIso.isolatedExists,
    isolatedRoot: rtIso.isolatedRoot,
    basePythonAvailable: rtIso.basePythonAvailable,
    resolution: rtIso.resolution,
  };

  const rtSys = await m.resolvePythonRuntime({ mode: "system" });
  results.resolveSystem = {
    mode: rtSys.mode,
    pythonPath: rtSys.pythonPath,
    basePythonAvailable: rtSys.basePythonAvailable,
    resolution: rtSys.resolution,
  };

  const okUv = uv.ok && path.isAbsolute(uv.path) && /uv\.exe$/i.test(uv.path);
  const okIso = baseIso.ok && path.isAbsolute(baseIso.path) && !String(baseIso.path).toLowerCase().includes("windowsapps");
  // Host has only Store python on PATH — noIsolated should fail closed OR find real non-store
  const storeRejectedAsBase = !base.ok || !String(base.path || "").toLowerCase().includes("windowsapps");

  results.smokePass = {
    findUv_absolute: !!okUv,
    isolated_found_when_includeIsolated: !!okIso,
    store_not_selected_as_base: !!storeRejectedAsBase,
    store_stub_flag: results.storeStubDetected === true,
    hint_winget: results.hintHasWinget === true,
    hint_not_brew_only: results.hintBrewOnly === false,
    resolve_isolated_has_path: !!(rtIso.pythonPath && path.isAbsolute(rtIso.pythonPath)),
    resolve_system_no_store: !rtSys.pythonPath || !String(rtSys.pythonPath).toLowerCase().includes("windowsapps"),
    progressive_fields: typeof rtIso.basePythonAvailable === "boolean" || !!rtIso.isolatedExists,
  };
  results.overall = Object.values(results.smokePass).every(Boolean) ? "PASS" : "FAIL";
  console.log(JSON.stringify(results, null, 2));
  if (results.overall !== "PASS") process.exit(2);
}
main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
