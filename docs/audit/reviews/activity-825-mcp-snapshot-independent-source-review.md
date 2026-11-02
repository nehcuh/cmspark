# Independent source review —MCP fixed snapshot825

VERDICT: APPROVE. The sole identified file-identity blocker is fixed and independently verified. This approves the frozen test-only implementation unit for the GLM source gate; it is not Windows native acceptance or a finding of the historical root cause.

## Scope

Reviewed the11 implementation paths listed in /tmp/cmspark-825-mcp-b585-snapshot-implementation.md: new snapshot header, reversible generator, Node helper, actual C++/file CPU controls and POSIX test leaf; modified bootstrap wrapper, Windows test builder, native MCP case, existing773 test entrance, actual producer VM consumer and actual finally consumer. Excluded root's release-status/audit documents, its identity lock metadata and the known unrelated Darwin host-integrity pin. No source edits, commit, push or CI run by reviewer.

## Design and actual paths

- Only the explicit Windows MCP test-builder branch passes the new header. Default MCP and original480 generator outputs are identical to HEAD across complete source/inverse/sites for LF and CRLF (four independent comparisons). New layered transforms restore the original bytes; actual tests cover host/fixture/header EOL combinations and preserve original SDK/send/Translate/Dispatch call counts and arguments.
- UI checkpoint publication consists of short sequentially-consistent lock-free uint32 atomic updates. Each odd/even update finishes before the original API/send/dispatch can wait. Actual controller callback hook precedes its old phase send. Fixed TLS tags only select original phase/BOOT sends; normal authentication/business sends add no observation state. No additional message, SDK call, dispatcher wakeup or readiness retry.
- One process-local worker is started once. It opens only the fixed receipt beside its module, verifies ordinary/non-reparse/single-link128-byte identity, reads the seed, sleeps once, takes one stable double-version sample and writes one payload plus final commit. No UI/filesystem/network lock is awaited by checkpoint hooks; no worker join or diagnostic await is added to original finally. Missing, uncommitted, updating, changing, late sample or writer failure produces UNKNOWN.
- Node copies the original MCP exe and all9 canonical assets (runtime files plus licenses), using the existing copier and source/canonical byte comparison. Receipt uses wx+/0600 and a retained descriptor. Read checks owned directories, full file identity, two fixed byte reads and identity again. The public projection is closed enums/booleans/uint32 values and a bounded relative sample offset; no path/body/key/capability/URI/pointer/HWND is emitted.
- The independent C++ controls use the actual new header/worker, actual generated recorder/flush/emit/send/test_note bodies and actual Node reader/copier. They distinguish the three already-reproduced same-wire schedules, preserve the nested-dispatch negative, and exercise odd/changed versions, late sampling, WriteFile failure, short seed, no writer, corrupted/partial records, path replacement and closed reader. These are CPU/file controls, not Windows COM execution.
- Actual original native MCP business assertions and successful desktop.close/exit section remain byte-identical to HEAD. Product DesktopHost and opaque child binding have no diff. Original20-second timeout, permissions, COM operands/counts, surface lease and cleanup assertions stay authoritative. Actual finally consumers preserve primary error and full cleanup for LF/CRLF, throwing output and throwing FD close.

## Sole blocker resolved: full-width receipt identity

Initial helper used default Number Stats. Independently extracted its real identity/same functions and demonstrated that distinct64-bit inode values collapse through Number and compare equal. The repository's explicit full-width same-file contract therefore required a local correction.

The final helper uses BigIntStats for every receipt lstat/fstat call, compares dev/ino/birthtimeNs as bigint, and checks link count/size as bigint. Binary regular-file checks and the unchanged existing directory copier are outside this narrowly corrected receipt identity. No Number conversion remains in this new receipt identity path.

The incremental test executes the actual helper with an actual native-written valid receipt and controlled filesystem identity leaves. Same9007199254740992n identity yields OBSERVED. Separately changing path inode, handle inode, path birthtimeNs or handle birthtimeNs by1n yields UNKNOWN before any readSync; restoring the same full-width identity yields OBSERVED again. Options assertions require bigint:true on both path and descriptor stats. I independently reran this control successfully. No second blocker was found.

## Independent machine results

- Existing Windows480 build-contract entry, including actual new producer/reader and all inherited consumers:177 PASS/0 FAIL/0 SKIP. Log /tmp/cmspark-825-snapshot-independent-build.log.
- Official isolated runner for desktop-acceptance-diagnostics and desktop-native-receipts-476:22 PASS/0 FAIL/0 SKIP. Log /tmp/cmspark-825-snapshot-independent-consumers.log.
- Independent preservation probe: four old/new complete default-generator comparisons; product/binding diff empty; original native business/success-close section exact. /tmp/cmspark-825-snapshot-preservation-independent.mjs and same stem.log.
- After the BigInt-only correction, direct inert snapshot CPU/file tests:2 PASS/0 FAIL/0 SKIP, including the full-width before-read positive/negative gate. /tmp/cmspark-825-snapshot-bigint-independent.log. Prior177/22 results remain applicable to unchanged code paths; full tsconfig.test compile also passed after the correction per unchanged author machine log /tmp/cmspark-825-snapshot-bigint-types.log.

The sample describes only its actual sampling instant. A missing/UNKNOWN snapshot is not negative proof; completed diagnostic send plus one outer return does not establish overall pump health or a WebView runtime cause. Native Windows compilation/execution at the approved next head remains the next gate. No new hypotheses or extra scope were added after the supported identity correction.
