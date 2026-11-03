# CDB preparation simplification — actual GLM design gate

**APPROVE. Root may begin exactly two-file implementation:** collector and its focused CJS test. No source-gate or dispatch approval.

- Baseline: `8fa080c2c8e105139eb5adbb7c751c172af1adce`; no implementation diff supplied.
- Prompt SHA256: `5174e12a710f829e7cba1d4b699f05d2157cc111a3b5de9174df60b6c7587a9b`; 85434 bytes.
- Actual reviewer: Claude CLI `2.1.153`, provider `open.bigmodel.cn`, sole actual `modelUsage` key `glm-5.3`; process exit `0`, `success`, duration `106775ms; actual input/output tokens 22134/5084. Tools/hooks/MCP disabled.
- Complete scoped design/plan, both full counterfactual controls/logs, complete current collector/test, 8fa safe JSON+full actual receipt, managed-tool source context and prior gate reports were embedded. No live/private debugger material, executable source edit, actual CDB/native or dispatch was performed.
- Final nine closed stages: INPUT, TOOL, WORKSPACE, DUMMY_READY, CDB, PARSER, DETACH, CLOSE, COMPLETE. First failure survives mandatory cleanup; actual close still required.
- No signature/PE cause is inferred from8fa. Original ownedPID/privacy/MCP20 and mandatory actual functional qualification remain.

## Coordinator scope clarification

The model’s conditional mention of a possible collector-hash consumer is not a discovered defect or third-file requirement. The prior reviewed probe derives using MCP TS/emitted-JS hashes; no new collector hash binding is established by this design review. Scope remains exactly the collector and focused CJS test. VM controls are design-flow evidence only; actual stoppedAt implementation and Windows qualification remain future gates.

## Actual model response (verbatim)

## Design Review: #826 CDB tool-preparation simplification (scoped)

**No supported design defects found. APPROVE. Root may begin the exactly two-file implementation (collector + its focused CJS test).**

### Verified decision paths

**1. Removing the pre-dummy Authenticode query — supported.**
Trigger: current `qualifyCdb826` runs cold PowerShell (`if (!await query826(io, cdb, work, {})) return result`) before spawning the dummy, gating CPU qualification on a predicate unrelated to CDB.
Supported path: the 12-control log shows the actual qualifier with a controlled failing pre-query returns UNKNOWN with `spawns:0`; the identical failing leaf in the revised derivation reaches the real dummy/kc/pong/close path. The pre-query never exercised the CIM branch (binding lacked `binary`), so it validated only "PowerShell launches and Authenticode passes" — redundant to the qualification's purpose.
Impact: one source-reachable failure mode removed; no capability claimed, no MCP relaxation. UNKNOWN still prevents MCP. Fail-closed on a later query failure is retained by `query826` shape validation plus the selector.

**2. Removing manual PE read — supported.**
Trigger: `resolveCdb826` reads MZ/PE32+ machine bytes at the fixed path.
Supported path: the 3-control log shows the old policy returning UNKNOWN before the dummy even with a controlled *valid* x64 PE when signature is false (i.e., the PE check added no independent capability), while the proposed policy reaches the unchanged actual parser/IPC/close logic; nonregular tool still refuses; the projection asserts `openSync` never fires.
Impact: static regular-file check is not claimed to prove x64 capability — the real functional gate (actual clean `kc` output through the real parser, `qd` pong, actual close) subsumes it. Wrong-architecture or corrupt tool → CDB run fails → parserPositive false → UNKNOWN. This matches the managed installed-tool trust already used for vswhere/cl.exe/PowerShell (embedded toolchain lines confirm no per-invocation signature there). Path injection is unchanged: fixed join under validated `ProgramFiles(x86)`, lstat regular/non-symlink retained, no fallback.

**3. Exact `{rows}` contract — supported, no trust substitution.**
The PS producer drops `Get-AuthenticodeSignature`/`signed`; the consumer check becomes exact `'rows'` keys plus the existing `Array.isArray`, with no compatibility parser, no fabricated `signed:true`, no fallback query. The wrong-parent control still returns UNKNOWN with a single call, and the encoded command provably contains no signature predicate. Selector, canonical domain, browser-pvr sequencing, `Fact826` DTO, `First 2` caps, and process-field validation are untouched. Dropping `cdb` from the binding env is a shape-only change the focused test must adapt.

**4. `stoppedAt` design — coherent and closed.**
Finite closed literals, assigned before the corresponding existing operation, first failure preserved through finally, COMPLETE only on all three positives, no raw error/path/PID/time/errno, no new timer/retry/wait, no early return before actual close. The explicit rule against inventing a timeout to exercise CLOSE is the correct tradeoff: CLOSE may be unreachable as a *returned* failure because actual close is unboundedly awaited (preserving the existing held-close fence, which the 3100ms control confirms). A literal that is valid but possibly unreturned is acceptable; adding a cleanup deadline would violate the mandatory-actual-close invariant. COMPLETE↔OBSERVED redundancy is harmless and explicit.

**5. Scope and evidence honesty — acceptable.**
Both controls are VM/grammar-only and are declared as such; `stoppedAt` is deliberately unimplemented in prototypes and reserved for the later source gate. The 8fa all-false receipt is correctly not attributed to signature/PE/SDK — the revision removes *a* reachable prerequisite, not "the" cause. Nothing in product trust, owned-PID identity, privacy caps, MCP20, COM/cleanup inputs, or the no-hard-15s interpretation is touched by this design.

### Conditions for the later source gate (not design blockers)

- Prove exactly: rows-only producer/consumer byte contract; zero qualifier PowerShell before dummy; unchanged positive qualification predicates, selector negatives, and close fences; fixed regular tool policy with missing/nonregular refusal; every returned `stoppedAt` literal plus first-failure preservation through throwing and held cleanup; COMPLETE only after actual close; no raw-error leakage through the safe JSON.
- Confirm any consumer of the changed query/binding shape (including the probe derivation's collector hash binding) adapts or is flagged — if a hash seal forces a third file, raise it rather than silently exceeding the two-file scope.
- Actual Windows qualification, real CDB vendor output, and the fresh normal three-platform dry-run on the final shipping tree remain separate mandatory physical gates; this approval covers neither dispatch nor acceptance.

**Return: APPROVE design. Root may begin the exactly two-file implementation now.**
