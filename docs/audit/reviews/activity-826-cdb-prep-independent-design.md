# #826 CDB qualification preparation — independent scoped rethink

**VERDICT: APPROVE this bounded design revision before actual GLM review and implementation.** Remove the live Authenticode prerequisite and redundant manual PE-byte inspection; use the fixed managed GHA SDK x64 regular tool path plus the actual owned CPU CDB qualification. Add one fixed `stoppedAt` qualification enum, preserving the first unsuccessful stage through cleanup. No production/MCP timing/ownership/permission/privacy boundary is relaxed. This does not approve a source implementation or dispatch.

Read-only baseline: current8fa080c2 collector and its actual existing controls, existing Windows builder tool resolution, and the terminal8fa safe receipts. No shared source/config edit, API/model invocation, real debugger/native launch or CI dispatch occurred. The only experimental code is a private in-memory derivation under `/tmp`; it never replaces the repository helper.

## Supported trust decision

`companion/scripts/build-desktop-windows.mjs:175–201` selects installed vswhere/VC tools and the managed `Hostx64/x64/cl.exe` path, then executes those installed tools without a fresh Authenticode/PE check on every invocation. PowerShell is likewise selected by its fixed System32 path, Node by the pinned setup/runtime route. This is installed CI tool trust, distinct from downloaded input integrity or product process/credential trust.

The diagnostic CDB is already fixed to `ProgramFiles(x86)/Windows Kits/10/Debuggers/x64/cdb.exe`; there is no free tool path, executable name fallback or new download. Retaining the platform/arch guard and regular non-symlink fixed path is consistent with that managed-tool boundary. The actual CPU qualification must still run that tool, obtain parseable real `kc` output, observe `qd` through IPC pong and observe actual dummy close before MCP is eligible. A static PE header alone cannot establish any of those capabilities. Its removal simplifies preparation without bypassing the physical gate.

The signature check was introduced by this agent workflow, not required by the user's task or a separate product trust boundary. In current source it invokes cold PowerShell before the dummy, repeats during post-MCP PID lookup, and gates unrelated process facts on signature success. This extra dependency has a source-reachable failure path. **It is not proven to have caused8fa UNKNOWN**: the all-false receipt and elapsed time do not identify the failed predicate. Intended SDK provisioning also does not prove this runner's actual CDB file existed. Neither claim is made here.

## Minimal revision

1. Resolver retains explicit Windows/x64 usage, fixed SDK x64 path, a regular/non-symlink file check and refusal if absent. Remove manual `MZ`/PE-machine file reads. No PATH fallback, installer, tool search, caller command or extra permission.
2. Qualification performs **zero PowerShell/CIM/signature query before the dummy**. Resolve tool/workspace, start its existing owned CPU/IPC child, preserve2s ready,6s debugger work,1s pong, actual tool/dummy close and existing raw/JSON caps. Native acceptance/MCP is still NOT_RUN unless all existing positive qualification predicates succeed.
3. Post-timeout target query retains its existing3s work limit and exact path/Node-parent/creation/live/uniqueness selector. Remove signature/provider work and signature output entirely; emit only the existing explicit rows DTO. Do not replace signature with fabricated `signed:true` or an unconditional admission flag. Keep the same process-field validation, actual native realpath domain and native-pv/browser-pvr policy. No new broker, tool authority or environment inheritance.
4. Add only `qualification.stoppedAt`, a closed finite stage string. Recommended meanings: `TOOL` (fixed-tool/workspace/platform preparation), `READY` (actual dummy spawn/PID/ready), `CDB` (tool execution/exit/cap), `PARSER` (actual vendor-output projection), `DETACH` (real pong), `CLOSE` (final required dummy closure where applicable), `DONE` (all positive predicates). The field names the stage being attempted when the first unsuccessful result/exception stops qualification, not an SDK root cause. No paths, exception strings, numbers, errno or open text.
5. Cleanup must **not overwrite** an earlier `READY/CDB/PARSER/DETACH` failure with `CLOSE`, merely because finally runs. Once a first unsuccessful stage is established it stays. Only full success after actual close becomes DONE/OBSERVED. Waiting for close still cannot be turned into early return to publish a stage. A CLOSE value is not permission to skip actual closure. If a stage can never produce a returned outcome in the final simple implementation, do not invent an artificial timeout solely to exercise it.
6. Existing qualification booleans/status remain; the runner still requires status OBSERVED and original MCP20/TAP outcome remains separate. Keep local-only raw output, finite parser, fixed debugger commands, no source/PDB/SDK/browser flag changes and no new MCP phase fields. Configured tool work plus required teardown is still not a hard15s end-to-end bound.

A single fixed stage clarifies the previously ambiguous preparation outcome without opening another general diagnostic framework. It belongs to the CPU helper qualification, not native business authority. No additional fallback, observer worker, retry, broad process enumeration or user-facing flag is justified.

## Source-derived finite controls actually run

Node22.23.4 via nvm. `/tmp/cmspark-826-cdb-rethink-controls.cjs` and `.log`: **12 controls PASS**.

The private script reads the full actual collector, uniquely removes the exact signature prerequisites/query and PE-read block, and runs the resulting full helper in a VM with only OS/process/debugger leaves controlled. No repository bytes are written; final byte comparison confirms shared helper unchanged. These are design-flow controls, **not Windows, real CDB or vendor-output evidence**.

- Current actual qualifier with a controlled failed pre-query returns UNKNOWN before spawning any dummy. The virtual revised qualifier with the same failing-PowerShell leaf reaches the actual dummy/parser/pong/close path and succeeds without calling PowerShell. This demonstrates removal of a redundant reachable prerequisite, not the historic cause of8fa.
- Revised actual qualifier still rejects missing tool, missing ready, failed CDB, unparseable output and failed detach pong. All cases preserve owned cleanup; no permissive status substitution was used.
- Held actual dummy-close event keeps result/workspace pending after kill; only emitting actual close permits return/removal. No teardown shortcut was introduced by simplification.
- Revised full collector accepts valid rows-only pure-CIM facts and executes the same native-pv/browser-pvr chain. A wrong native parent remains UNKNOWN with no debugger attach. The actual encoded PS contains no Authenticode/signature field or predicate.
- Revised resolver selects exactly the managed SDK x64 path with a regular file port and performs no PE reads; an invalid root path still refuses.

`stoppedAt` was deliberately not implemented in this private prototype. It requires actual source controls after implementation for every returned failure stage, successful DONE, and preservation through throwing/held cleanup. This report does not claim those future tests already passed.

## Required next source gate and decision value

Before source approval: actual resolver/query/qualifier diff must match this narrow deletion; actual tests must prove zero prequalification PowerShell, real positive criteria unchanged, exact pure-row query contract/owned target negatives, every literal returned stage, actual close holding, and no raw data exposed. Existing real parser/dummy Windows qualification remains mandatory before MCP; local grammar controls cannot replace it. Update only consumers of the changed qualification/query shape, not product source or normal Release jobs. Reuse all unaffected source/CPU/runtime evidence.

The changed helper input can support one purposeful, separately authorized next attempt after independent and actual GLM source gates; this design approval does not dispatch it. If a resulting UNKNOWN has a stage, that stage narrows preparation only. It does not prove the old SDK cause or automatically authorize another change/run. The three prior run receipts remain intact (two early preparation failures, then qualification UNKNOWN; zero native MCP attempts/target stack samples). The user's explicit resumption and this concrete preparation simplification do not reset the historical three-round cap or permit generic diagnostic expansion.

**APPROVE design: managed fixed-tool trust + real CPU functional qualification; one first-failure-preserving stoppedAt enum; product/ownedPID/privacy/MCP20 unchanged.**
