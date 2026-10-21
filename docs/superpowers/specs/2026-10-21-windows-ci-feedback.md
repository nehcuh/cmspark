# Windows CI feedback and desktop isolation (#750)

Issue: https://github.com/nehcuh/cmspark/issues/750 (created before this document).
Status: proposed implementation contract; genuine changed-head/main measurements remain required.
Risk: T2, CI test-integrity and desktop isolation. Product authority and installed applications are unchanged.

## Evidence and goal

The latest consecutive20 workflow metadata samples at2026-10-21 contain Windows10FAIL/10PASS, median1591.5s (26.525min), p95 nearest-rank2046s. They span different PR revisions: this is not a fixed-version flake rate. Complete census executed18 times, median1033.5s. In PR748/run39554834643 its new first-identity gate began1884s after the Windows job started. Its timeout at service-worker target wait51 has UNKNOWN physical cause; optimizing scheduling does not repair or explain it.

Reduce serial wall-clock and deterministic-contract feedback delay while retaining every current gate. Report measured changed-head timings, not a predicted speedup as a result.

## Finite design

1. Keep the existing `smoke-os` job as the shared step definition. Replace its three-OS cartesian matrix with four explicit include entries: Ubuntu smoke, macOS smoke, Windows census, Windows native. Preserve the actual existing three check names; add `smoke (windows-native)`. Windows entries both use fresh `windows-latest` hosted runners, Node22.23.2, credential-free checkout and no `needs` dependency between them. Matrix fail-fast stays false. All six resulting CI jobs (build, four smoke entries, history) must succeed before merge.
2. Both Windows entries independently install locked dependencies and build their own UIA/native desktop test prerequisites. The original native480/metadata setup is intentionally retained in both: the complete canonical discovery itself consumes these binaries. No build artifacts, profiles, registry, desktop claims or executable caches are transferred between jobs. Each desktop remains internally serial, including original `--test-concurrency=1` and surface leases.
3. Only census lane runs the original complete canonical census, owned SMB/8.3/Registry readiness, finite sealed artifact upload and final module-scope diagnostic. The latter observes only the canonical VM baseline after seal/upload; it does not observe the other VM directed steps. Preserve the census run block, command lists, compiler/config/runner/preload, install/build/stage/test, raw accounting, source identity, seal, cleanup and actual budgets. Shared Registry fixture setup remains in both Windows jobs; official gallery sampling/upload only in census prevents name collisions.
4. The fresh native lane retains Office and every later directed test/launcher/background/UNC/8.3 gate, in their original relative order and with exact command bodies. It installs frontend locked dependencies before those tests, because the census formerly installed them in the shared checkout. After early CPU preflight, the native lane also runs the unchanged `npm run stage:win-scripts` to preserve the original dist/host-scripts-win layout formerly supplied by the census stage; source fallback alone is not identical preparation. Ubuntu/macOS retain their original directed tests. The native lane does not run the post-census diagnostic: it has no census artifact to diagnose. It must not depend on census success or prewarm the census desktop. A failure in either lane leaves the other running, so evidence and coverage are not cancelled.
5. Move the existing complete NSIS/workflow pure CPU contract family to immediately after npm dependencies/build, before UIA/native compilation. Adapt its real parsed-workflow consumer to the explicit lane schedule; preserve original full census/Registry/Office body pins, cardinality, failure conditions and adversarial negatives. Tests must evaluate both lane conditions against the actual YAML, LF/CRLF, omitted/duplicate gate, wrong lane, waived failure, mutated native command and artifact paths.
6. Restore npm download caches before installation using both lockfiles. Keep npm ci and all lifecycle scripts. No node_modules, native/compiler outputs, raw, credentials, browser profiles, registry or lease caching. Initial build restore uses both locks; remove the redundant late frontend-only setup step only if its Node version and installation semantics remain identical.

## Non-goals and limits

Do not delete repeated tsc or test calls merely because labels match. Census recompiles in-place; no complete emit/input equivalence has been proven. Do not alter canonical discovery, argv32000, timeouts, retries, skip/COE, original native predicates, trust, current-user configuration, installation, product version or releases. No local browser/native/GUI/PTY/provider launches. Native and full census retain actual remote Windows acceptance. Separate jobs may increase total runner CPU/downloads even while lowering critical-path wall time; measure both.

Unlanded PR748 is kept separate. Its real identity positive is still mandatory, and this change cannot close #723 or #476. Its future workflow merge must place feature native gates in the native lane after their actual prerequisites, preserve both job gates, and independently pass its real first identity. No blanket claim that Windows failures are fixed.

## Acceptance

- Full actual parsed workflow: four exact matrix records, independent Windows lanes, all original command bodies/failure semantics, no conditional gaps or duplicate artifact names, unchanged canonical source and complete evidence.
- Actual source-consumer LF/CRLF RED before scheduling repair; three inert GREEN checks after, adversarial mutants and affected families. No OS children/native during local tests.
- Necessary host and fresh locked ARM checks; two mutually blind nonauthor source approvals of the frozen diff, one Kimi per active workflow. No third/fourth mandatory review.
- Exact new head all six jobs succeed, including actual Windows directed natives and unchanged full canonical. Root authenticates official census head/synthetic tree/run/attempt/artifact/source, recovers through the approved internal operator and checks complete tag/SHA/TAP/EOF/per-skip oracle. Never expose key/cipher/recovered raw.
- Compare actual new Windows lane start/end and critical path to the published baseline, retaining uncertainty and total-cost tradeoff. Authorized merge then exact main all six jobs and strict census/tree/source verification.
- Update CHANGELOG, TESTING and Windows guide with boundaries and measured results once available. Version remains0.6.14 development; no release/tag/install.
