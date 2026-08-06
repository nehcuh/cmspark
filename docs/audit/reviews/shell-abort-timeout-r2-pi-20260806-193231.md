All verification complete. Summary:

**B1 fix — confirmed fixed:**
- `assert.doesNotMatch` replaced with `assert.ok(!/超时/.test(meta), ...)` in `chrome-extension/tests/shell-card-utils.test.ts`; the only remaining "doesNotMatch" occurrence is a comment
- `tests/node-shims.d.ts` confirmed to lack `doesNotMatch` (only `equal`, `deepEqual`, `notStrictEqual`, `ok`, `match`) — so the replacement was necessary and correct
- `npx tsc -p tsconfig.test.json --noEmit` → **exit 0**
- `npm test` → **450/450 pass, exit 0** (including the new aborted test)
- Targeted `npx tsx --test tests/shell-card-utils.test.ts` → **8/8 pass, exit 0**

**Aborted meta assertions preserved:**
- `card.aborted === true` ✓
- `meta` matches `/已停止/` ✓
- `meta` does **not** contain `超时` ✓ (`assert.ok(!/超时/.test(meta))`)

**Regression scan:** The fix is test-file-only; no production code changed. Companion batch tests (`shell-abort-timeout`, `shell-progress-windowsHide`) still pass **17/17**. No new CI or security regression. Per scope discipline, R1 nits not re-litigated.

VERDICT: APPROVE
