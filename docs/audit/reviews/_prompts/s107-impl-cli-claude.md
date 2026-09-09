Implement L3 CLI honesty for CMspark 0.6.7. ONLY file: companion/src/index.ts plus optional companion/tests/cli-version.test.ts

Repo: C:\Users\HuChen\Projects\cmspark

Requirements:
1. `printUsage` banner version must be **0.6.7** (companion/package.json already bumped). Prefer reading version from ../package.json via createRequire or fs so it cannot drift — if you do that, keep a simple fallback "0.6.7".
2. Handle `--version`, `-V`, and `version` BEFORE the unknown-command path. Print one line `cmspark-agent v0.6.7` (or the resolved version) and `process.exit(0)`. Do NOT call initDataDir.
3. `status` must NOT print "not yet implemented". Alias to existing `handleDaemonStatus()` (after initDataDir if that helper needs it — match daemon status behavior).
4. `stop` must NOT print "not yet implemented". Alias to existing `handleDaemonStop()`.
5. Update usage text if needed so status/stop are honest.
6. Add `companion/tests/cli-version.test.ts` that spawns `node dist/index.js --version` OR tests the switch by importing if easier. Prefer a unit that does not require a full daemon. If spawn needs dist, you may instead test via `node --import tsx` only if the repo already does that; otherwise add a tiny pure function `resolveCliVersion()` exported for test. Keep tests isolated: no writes to ~/.cmspark-agent (use CMSPARK_DATA_DIR if you boot anything).

Do not change tray pid behavior. Do not touch adapter.ts or UI.

When done: VERDICT: DONE
