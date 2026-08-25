# Independent adversary — Lane B knowledge identity / distill / skill-install nits

> **Lane**: B — knowledge identity / distill / skill-install (NOT overlay HUD / ACL)  
> **Role**: independent adversary — did **not** implement this fold. Default **REFUTED** until `file:line` + `[executed]` / `[inspected]`.  
> **Date**: 2026-08-25  
> **Repo**: `C:\Users\HuChen\Projects\cmspark`  
> **HEAD**: `8f5c94c6` (`8f5c94c6325a9bd1081a6cc400062532e81d71ff`)  
> **Base**: `d4cbbfae` (`d4cbbfaefe38ce32dd6e0bc771bcab2c32f07c13`)  
> **Range commits**: `7ec76d78` nits fold → `8f5c94c6` Windows C-thin paper HUD (HUD out of this lane)  
> **Frozen patch**: `docs/audit/reviews/post220-nits-hud-diff-20260825.patch`  
> **SHA256**: `AB1D1A1285F558BE52A86D5A1F5A6B8EDB5BC671F565348337B7240F6EFE6825` — `[executed]` `Get-FileHash` match  
> **Prior**: `docs/audit/reviews/head-6ce291db-post220-p1-r2-lane-b-knowledge-20260825.md` (AWN; P1×3 folded; COM0 / junction skip / DSA listed as leftover nits)  
> **Exclusive files**: `companion/src/skills/{doc-identity,skill-engine,skill-install}.ts`, `companion/src/threads/distill.ts`, `companion/tests/{doc-identity,distill,skill-engine}.test.ts`  
> **Method**: replay the five claimed nits on live HEAD, then attack the fix; mutation copies under `companion/.tmp-adv-nits-hud-b/` (deleted after). No production edits.

```text
Surface:      L0 overlay HUD workbench (Mac NSPanel + Win C-thin HTML restyle) — HUD not this lane
L2-classes:   none on HUD; mcp.toggle HTML now rides tray client
Compose:      threads / pack.apply overlay-safe / knowledge USE / skill toggle
Autonomy:     n/a
Trust:        overlay ACL: pack.apply extras stripped; knowledge.import still denied on summoner WS
              HTML restyle is visual only — no new confirm dialect, no Allow/Deny
Channel:      community
Blast:        T2 (this lane: identity / distill redact / skill-dir walk). No overlay Allow/Deny in exclusive files.
```

This increment’s exclusive delta (`git diff d4cbbfae..HEAD` on lane paths): 6 files, +18/−3. `skill-engine.test.ts` **unchanged** this range (F-I-5 pin is a P1-r2 leftover; re-executed for no-regress).

---

## MACHINE

Cwd `companion/` `[executed]`. Node `v24.18.0` win32.

| Command | Result |
|---------|--------|
| `.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json` | **PASS** exit 0 |
| `npx tsx --test tests/doc-identity.test.ts tests/distill.test.ts tests/skill-engine.test.ts` | **58 pass / 0 fail** (duration ~0.70s) |
| Frozen patch SHA256 | **MATCH** `AB1D1A1285F558BE52A86D5A1F5A6B8EDB5BC671F565348337B7240F6EFE6825` |
| Private probes | `.tmp-adv-nits-hud-b/probe.ts` + `probe-fi5.ts` + `probe-junc-stat.ts` (then **deleted**). Isolated `CMSPARK_DATA_DIR`. |

In-suite includes `importKnowledge: ASCII same heading does not silently overwrite (F-I-5)`, `redactSecrets PEM through END has no 4000-char cap`, `redactSecrets covers DSA PRIVATE KEY`, `allocateDocIdentity: CON and ../x hash` (now also COM0/LPT0 `isUnsafePathComponent`).

---

## Claimed-fold scorecard

Default **REFUTED**. Live payload first, then mutation.

| ID | Claim | Score | Evidence |
|----|--------|-------|----------|
| **1** COM0/LPT0 | `WINDOWS_RESERVED` includes COM0/LPT0; `allocateDocIdentity` hashes them | **HOLD** | `[inspected]` `doc-identity.ts:11` `com[0-9]\|lpt[0-9]`. `[executed]` `isUnsafePathComponent("COM0"/"LPT0")===true`; `asciiSlug("COM0")==="com0"` then allocator hashes: COM0 → `k-cb288b8477` (`=== hashedStem("COM0")`); LPT0 → `k-21ee4357ca`. Neither stem is `com0`/`lpt0`. COM1 still reserved; COM10 **not** (regex `$` after one digit — correct). In-suite CON test **pass**. **MUT** old `com[1-9]\|lpt[1-9]`: COM0/LPT0 **false**, COM1 still true — would fail the new pin (`doc-identity.test.ts:65-68`). |
| **2** `loadFromDir` | skips `isSymlinkOrJunction` at entry | **HOLD** | `[inspected]` `skill-engine.ts:249` first statement in the `readdir` loop. `[executed]` planted `knowledge/global/evil-junc` → outside dir with `evil.md` / `JUNCTION_EVIL_BODY` via `mklink /J` (status 0). Dirent `isLink=true isDir=false`; helper `true`. After `engine.refresh()`, `listKnowledge` names = `notes,notes-2,notes-3` only; **no** `evil-junc`; body marker absent. |
| **3** `assertDirBudget` | skill-install budget walk skips junctions | **HOLD** | `[inspected]` `skill-install.ts:318-320` skip before recurse/`statSync`; copy path `readDirectoryFiles` already skipped at `skill-engine.ts:1266`. `[executed]` skill dir with `SKILL.md` + `/J escape` → decoy `SECRET_OUTSIDE.md`: budget-sim `files=1` (SKILL.md only); `skillInstall({path})` **ok**, dest files **`SKILL.md` only** — no `escape`, no `SECRET_OUTSIDE.md`. |
| **4** PEM DSA + 4200 RSA | regex includes DSA; 4200-char RSA still fully redacted (P1 must not regress) | **HOLD** | `[inspected]` `distill.ts:7-8` optional prefix now `RSA \|DSA \|OPENSSH \|EC \|ENCRYPTED `; `[\s\S]*?` to END **or `$`**; `redactSecrets` PEM **first**. `[executed]` RSA + `MIIEAAA_UNIQUE_PEM_BODY` + 4200×`A` + END → `keep [REDACTED] after`; marker/BEGIN absent. Same for 4200-char **DSA**. BEGIN-only 4200 RSA (no END) eats to EOS (`keep [REDACTED]`). `distillThreadMarkdown` excerpt has no marker. PKCS#8 `PRIVATE KEY` / `ENCRYPTED` / `EC` / `OPENSSH` 4200 also fully redacted. In-suite 4200 + DSA tests **pass**. **MUT** regex without DSA leaks `MIIEAAA_DSA`; old `{0,4000}?` + optional END leaks the 4200 RSA marker. |
| **5** F-I-5 | `taken.delete` still gone; dual `# Notes` → `notes` + `notes-2` | **HOLD** | `[inspected]` `skill-engine.ts:1401-1410` — comment forbids dropping occupied stems; `taken.delete` **absent** (`rg` 0 hits under `companion/src`). `[executed]` isolated engine: ids `notes` / `notes-2` / `notes-3`; files `notes.md`+`notes-2.md`+`notes-3.md`; `FIRST_UNIQUE_ALPHA` only in `notes.md`; `SECOND_UNIQUE_BETA` in `notes-2.md`. In-suite F-I-5 **pass**. **MUT** `taken.delete("notes")` then `allocateDocIdentity({preferredId:"notes"})` → stem `notes` (would overwrite); live taken-kept → `notes-2`. |

No claimed nit **REFUTED**. No P1 regression of the 4200-PKCS / F-I-5 r2 HOLDs.

---

## Attacks on the fold (keep REJECT if any restore a P1)

None restore P1-1 silent overwrite or P1-2 4200 PEM remainder.

### nit — decoy first-END still leaks body after a well-formed block

`[executed]` `BEGIN RSA…END RSA` then `MIIEAAA_UNIQUE_PEM_BODY` **without** a second BEGIN → lazy `*?` stops at first END; remainder leaks (`text="[REDACTED]\nMIIEAAA_UNIQUE_PEM_BODY\nno-second-begin"`). Same first-END behavior r2 already scored as pre-existing vs the 4200-PKCS fold. Crafted two-block paste, not a well-formed 4200-char key. **Not** a P1 regress.

### nit — `BEGIN ECDSA PRIVATE KEY` still not in the allowlist

`[executed]` ECDSA 4200-style block: `hits=0`, marker leaks. Prefix group is `RSA |DSA |OPENSSH |EC |ENCRYPTED` — `ECDSA` is not `EC ` + `PRIVATE KEY`. Pre-existing vs this DSA add. Typical OpenSSL EC keys use `BEGIN EC PRIVATE KEY` (HOLD above). DSA fold itself is real.

### nit — in-suite pins are thinner than the claims

- COM0 test (`doc-identity.test.ts:65-68`) asserts `isUnsafePathComponent` for COM0 **and** LPT0, but only **allocates COM0** and only `notEqual(..., "com0")` — does not `match /^k-[0-9a-f]{10}$/` or allocate LPT0. Live allocator **does** hash both `[executed]`.
- DSA test is a short body; 4200 RSA is a separate test. Live 4200 DSA HOLD.
- **No in-suite junction test.** Removing `isSymlinkOrJunction` would not fail existing tests.

### nit — `loadFromDir` inner resource listing still `statSync`-follows

After the new entry skip, folder-based skills still collect resources via `skill-engine.ts:270-275` `readdirSync` **names** + `statSync` (follows). A file symlink *inside* a real skill folder is not the entry-skip claim. `[inspected]` only — win32 file/`mklink /D` symlink needs elevation (`/D` stderr 权限不足; `/J` does not). Not T3; budget/copy of the **entry** junction is skipped `[executed]`.

### nit — `computeDiskFingerprint` still has no junction helper

`skill-engine.ts:110-137` walks `ent.isDirectory()` without `isSymlinkOrJunction`, then `statSync` on files. On **this** Node 24.18.0, a `/J` Dirent is `isSymbolicLink()===true` and `isDirectory()===false` (`probe-junc-stat.ts`), so the fingerprint walk also does **not** descend. Helper on `loadFromDir` is still the right fail-closed lstat for older Dirent-as-directory nodes. Incomplete lock-step, not a live follow on this runtime.

### note — Node 24 Dirent already classifies `/J` as a link

`[executed]` junction: Dirent `isDir=false isFile=false isLink=true`; `lstat.isSymbolicLink()===true`; `stat` (follow) `isDirectory()===true`. The **pre-fold** `if (ent.isDirectory()) recurse` would therefore also skip on this Node. That does **not** falsify “skip is present and live `listKnowledge` / `skillInstall` ignore the junction.” It does mean a mutation that only deletes the helper is **green on Node 24 tests** and still live-skips here. The lstat helper remains the portable fold.

---

## Prior HOLDs re-checked (exclusive only)

| # | Claim | Score | Evidence |
|---|--------|-------|----------|
| CJK identity | `{id,filename,title}`; no `--.md` | **HOLD** | In-suite CJK test **pass**. Allocator unchanged except reserved regex. |
| CON / `../x` | hashed; never `x.md` | **HOLD** | In-suite **pass**; COM0/LPT0 now same class. |
| Distill no-write | no `fs` in `distill.ts` | **HOLD** | `[inspected]` redact/join only. |
| 4200 RSA through END | P1-2 must not regress | **HOLD** | See scorecard #4. BEGIN-only still EOS-eats. |
| F-I-5 suffix | dual ASCII heading | **HOLD** | See scorecard #5. Third import `notes-3`. |
| 0o600 helper | `writeRestrictedFile` `{mode:0o600}` | **HOLD** | `[inspected]` `doc-identity.ts:136-140`. Posix test skipped on win32. |

F-S-1 `wrapKnowledgeBlock` / `content-sanitizer.ts` are **out of exclusive range** this round (P1 r2 already HOLD). Not re-scored.

---

## Confirmed-safe (this increment, this lane)

- COM0/LPT0 reserved → `k-<sha256 10>` stems; old `[1-9]` mutation dies.
- `loadFromDir` entry skip: junction knowledge doc not indexed `[executed]`.
- `assertDirBudget` + `readDirectoryFiles` skip: install dest does not copy junction contents `[executed]`.
- DSA PEM redacted; 4200-char RSA (and PKCS#8 / EC / OPENSSH / ENCRYPTED) still fully `[REDACTED]`; BEGIN-without-END does not leave `MIIEAAA`.
- F-I-5: `taken.delete` still gone; dual/triple `# Notes` suffix; mutation would reuse `notes`.

---

## Cross-cut (not findings)

- Overlay ACL / summoner `pack.apply` / HUD paper restyle = Lane A.
- History evaluate `result_summary` collapse = Lane D (`history/store.ts`).
- `message-router.ts` `isSymlinkOrJunction` on directory import (`:2706`) is **out of exclusive range**; not used as REJECT.

---

All five claimed nits **HOLD** `[executed]`. P1-2 4200 RSA and F-I-5 dual-heading did **not** regress. Residuals are decoy-END / ECDSA PEM edges, fingerprint/resource-walk lock-step, and missing in-suite junction / LPT0-hash pins. No T3 (no overlay Allow/Deny, no confirm skip, no new auto-ingest).

VERDICT: APPROVE_WITH_NITS
