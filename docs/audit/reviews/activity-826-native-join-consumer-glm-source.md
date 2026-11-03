# Native-join omitted consumer migration — actual GLM source gate

**APPROVE** the exact single-CJS fix. After prior-head actual CI results are collected/recorded and T0 updated, root may commit and run necessary changed-head normal full CI. No reviewer cancel/push/dispatch or Windows physical/canonical-green/merge/tag/release claim.

- Baseline: `a4ddaf13817c201b5ddb66565c3003e093cc8939`.
- Source: `scripts/tests/native-join-observation-788.test.cjs`; SHA256 `0d5397996ddcee1d5fb70c61308a713f2fdecc75133c1304fc24ca2438909273`.
- Full single-path diff SHA256: `09e2cb1f1c0193f9ecc1409189dd78efcc79fe9e261063e7a55bdb97486936c5`.
- Manifest SHA256: `7b84861417986537e5553fa1bcc6d4a9f28ae6d2c5856642f226ce82f13dcab3`.
- Prompt SHA256: `e15f39f6d3ac12c28a45b45f47e1b7c44d19f6d16197c5bfad78713c10337bd9`; 119105 bytes.
- Actual reviewer: Claude CLI `2.1.153`, provider `open.bigmodel.cn`, sole actual `modelUsage` key `glm-5.3`; process exit `0`, `success`, duration `80348ms; actual input/output tokens 33226/5366. Tools/hooks/MCP disabled.
- Full current CJS/diff, complete B/author reports and actual23/7 red →32/0 green logs, necessary existing inverse and generated-wrapper connection embedded. Previously approved six-source/18-baseline coverage reused by exact hash/verdict, not repeated body audit or design review.
- Existing behavior inverse is composed before historical observation seal; expected hashes unchanged. Current full generated wrapper retained, old fallback removed, full3/reentry/refusal/no-heal/original foreground controls preserved. Original30 plus2 controls and required Mac/ACP cases execute; local controls are not real Windows input proof.
- No executable source/index edit, new native/OS API or CI dispatch performed by this gate.

## Actual model review (verbatim)

**VERDICT: APPROVE — single file `scripts/tests/native-join-observation-788.test.cjs` (SHA256 0d539799…, patch 09e2cb1f…, head a4ddaf13).**

**Finding 1 — real regression, correctly diagnosed.** `/tmp/cmspark-826-native-join-before.log` (30 tests, 23 PASS, 7 FAIL, 0 SKIP) shows case 11 failing the *unchanged* b7e49cbd… seal with actual f3681ca6… (new terminal generator bytes passed through the observation-only entry without the explicit behavior inverse), and cases 15–19 + 22 aborting on `selectionComplete826 is not defined` before their intended assertions. Trigger confirmed; these are consumer-migration failures, not product defects.

**Finding 2 — case 11 fix is composition, not seal weakening.** The single change wraps the input: `restoreCloseObservation476(kind, restoreInitialFixture826(input))`. The already-approved `restoreInitialFixture826` is whole-hash-bound (asserts current b47fbcf… before strip, prior 50abdc4f… after, throws on any drift), so the 826-current generator is provably reduced to the prior generator before the existing 476/788 strip, which must still yield b7e49cbd…. The expected-hash map is byte-identical to the old one — no historical authority changed. New case 24 adds the strict negative side (LF/CRLF appended drift and mutated `INPUT826_GENERATOR_BEGIN` both throw). Supported path → the seal is now verified across the full 826→476→788 lineage; strictly stronger than before.

**Finding 3 — wrapper harness consumes the current full generator.** `initialActual788` now declares `selectionAttempted826/selectionComplete826` state plus a controlled `d476_owned_caption826` leaf returning only the current full3+restore boolean contract, matching the actual generator source embedded (`desktopInitialActivation788` emits exactly `if(!selectionComplete826){if(selectionAttempted826)return;…}`). Critically, the old-builder fallback is **removed** and replaced by explicit asserts on the new branch — an old wrapper now fails loudly instead of silently passing. This closes the masquerade risk in the pre-fix fallback. Only the physical OS selection leaf is inert; attempt/complete latch, re-entry guard, both identity re-checks, visibility/foreground gates and once-action latch are real generated code under vm — the same inert-leaf pattern as IsWindow/GetForegroundWindow.

**Finding 4 — new controls are real refusals, not error pass-throughs.** Case 23 covers short 0/1/2 and failed-restore → `failed=true`, `selectionComplete826=false`, one call, zero posts; reentrant activation during incomplete selection installs nothing; post-failure no retry even when selection becomes good; full3 path selects once then installs once; stale epoch/controller/window mutated during selection re-entry → fail with no heal. These assert wrapper state, not caught ReferenceErrors. Tests 16/17/18/20/21/22 are untouched; tests 15/19 keep every original foreground/visibility/POST_GUARD/key/SetForegroundWindow assertion and gain selection counts; renames are honest.

**Finding 5 — scope and evidence clean.** Manifest binds one file + patch; all six approved source hashes byte-match the prior GLM approval JSON; no TS/product/CI-wiring/budget change (test 14 still enforces the command and its 12 fail-closed mutations). Independent B run: 32 PASS / 0 FAIL / 0 SKIP (567.789 ms, Node 22.23.4), Mac795/ACP795 required cases executed as tests 25–32, not skipped. Original 30 retained (22 file + 8 required), +2 controls.

**Decision on the follow-up:** Yes — once the old head's actual CI results are collected and recorded (T0 update), root may commit this one consumer fix as a changed head and run the necessary normal full CI on that head. The a4dd red stays preserved as historical evidence; this reviewer performs no cancel/push/dispatch. This approval makes no Windows physical-validation, canonical-green, merge, tag, or release claim — green status of the changed head depends solely on that head's own completed CI.
