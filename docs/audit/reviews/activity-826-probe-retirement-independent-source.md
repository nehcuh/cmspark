# #826 temporary probe retirement — independent draft source gate

**VERDICT: APPROVE the frozen six-file local retirement draft for actual GLM source review.** This is an uncommitted local shipping draft, **not** remote retirement, a diagnostic result, canonical PASS, merge or release approval. Remote run41570019778 remains bound to `aad9d65eac4596fdd68e199410f262ebf3cadaa7` and is unaffected by these local files.

Reviewed the six-path delta and `/tmp/cmspark-826-probe-retirement-implementation.md`, frozen manifest and patch. The four deleted helper/test files were already reviewed in their final form; their content is not re-audited. I made no source/config edit, index change, API/model/native/OS probe or dispatch. The existing independent remote watcher continues45-second metadata observations separately.

## Source finding

No blocker found. The draft removes exactly the two temporary scripts and their two focused script-test files, removes only the temporary Release input/job/package condition, and restores759's Release setup-node count3→2. It retains the independently reviewed CPU installation fix and persistent test.

The **entire actual normal Release postimage** equals the actual original67 Git blob plus precisely the two reviewed normal companion-install envskip blocks. This is byte equality, not a partial selected-job check. Both LF and CRLF represented forms restore exactly their original raw blobs when those exact two blocks are removed. Normal jobs are only preflight/package/release, manual dispatch has no temporary input, package has no probe condition, release remains original tag-gated and original dependent jobs/permissions/commands are conserved. Two setup-node jobs remain.

759 is byte-for-byte its actual original67 blob, not merely a weaker new count assertion. The persistent CPU test remains SHA `ecee4f062a13bdedc0d26c0a51dd4c3288a2dd093b79e4b4f3d26dcf233f3e35`; both normal envskip additions remain, along with plain npmci/postinstall, normal tests/audit and CPU packaging. No original MCP20 or native host/launcher change is part of the draft.

## Independent evidence

Node22.23.4 through nvm. `/tmp/cmspark-826-probe-retirement-b-controls.mjs` and `.log`: **9 focused controls PASS**.

- All six manifest preimages match actual remote-head Git bytes; four deletion postimages are absent and both modified postimages match their frozen hashes.
- Current normal Release equals original67 plus exactly two CPUenv additions; LF and CRLF full inverses match actual original Git-blob forms.
- Actual parsed normal workflow has exactly three original jobs, no temporary input/condition, original tag publication gate and setup-node count2.
- Actual759 raw equals original67.
- Actual AST-extracted persistent `requireCpuInstalls` accepts the retirement postimage and rejects independently removing either retained env block, using actual ERR_ASSERTIONs.
- Scoped workflow/scripts/product runtime search finds **zero** references to the retired entry/helper/environment/input names. Archived audit documents are deliberately not runtime callers.
- Persistent CPU test hash unchanged; affected index empty/unchanged; scoped/global diff-check PASS.

Relevant already-completed postimage machine results reused because the input bytes match: `/tmp/cmspark-826-retirement-759-tests.log` **13 PASS /0 FAIL /0 SKIP**, and strict targeted compilation plus official isolated CPU test `/tmp/cmspark-826-retirement-cpu-tests.log` **3 PASS /0 FAIL /0 SKIP**. The latter includes actual current macOS arm64 CPU-backend load, not new Linux/Windows inference. No unchanged native/MCP/20s suite was repeated.

Frozen actual normal Release SHA `7d0fdd3f1212d480760ec646ce492d709eb18e9ed6a79a7e00aeca3b51f0f4a4`; original Release raw SHA `484078da169a63dfbe5d4fe174568d597dfc48f38d57d05a1e86a67265244480`. All six before/after details and four explicit null deletion postimages are in `/tmp/cmspark-826-probe-retirement-frozen-manifest.json`; independently matched above.

## Disposition

**APPROVE draft source.** After actual GLM source approval, the parent can commit/push retirement only after preserving the final fixed-head run's real outcome as planned. No further temporary-tool budget/framework iteration is implied. Tool limitations remain diagnostic NOT_RUN/UNKNOWN and cannot become another product acceptance requirement or an excuse to bypass the real MCP20 canonical gate.

Canonical CI must run on the actual final shipping tree; every required original native/business gate remains necessary. A fresh normal three-platform Release dry-run is still required because CPU installation input changed. No draft, old package evidence, other-lane success or diagnostic PASS can replace canonical/main/tag acceptance. Until the parent commits/pushes this draft, the temporary entry is not claimed retired remotely.
