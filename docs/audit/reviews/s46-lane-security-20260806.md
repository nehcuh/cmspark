# Lane: Security — S46 main pull multi-adversarial

**Date:** 2026-08-06  
**Range:** `474df7e..6d2cdcf` (S46 after S45 tip)  
**Tip SHA:** `6d2cdcf`  
**Diff artifact:** `docs/audit/reviews/s46-main-pull-diff-20260806.patch`  
**Stat:** `docs/audit/reviews/s46-main-pull-diff-stat-20260806.txt`  
**Evidence base:** [inspected] patch themes + **LIVE tip sources** (`server.ts`, `skill-install.ts`, `pack-engine.ts`, `validator.ts`, `types.ts`, `message-router.ts`, `thread-manager.ts`, `file-parser.ts`, `PacksPanel.tsx`, `useWebSocket.ts`, `thread-busy.ts`, `FleetStrip.tsx`). No test run in this lane (claim polarity only).  
**Prior:** S45 lane-security `APPROVE_WITH_NITS` (forceConfirm three-flag, upload F5); S45 P0 follow-up adversarial pass (upload isolation + scoped fleet stop).

## Verdict: REQUEST_CHANGES

Trust B (`skip_l2` / global auto_approve / module enable on pack apply) introduces a **durable global Trust elevation that is not reliably restored** on uninstall, delete, or pack switch. Combined with **install-time `origin:user` + `trust` spoof** and **list-apply UI that never discloses Trust**, this is a silent sticky autonomy raise after the user believes they left the scene. Other S46 surfaces (MCP cruise algebra, skill_install home L2, S45 upload isolation) hold.

**Block ship of Trust B restore/uninstall paths until F1–F2 are fixed** (or Trust B is feature-gated off). F3 should ship in the same micro-PR if Trust B remains on.

---

## Findings

### F1 — Trust snapshot lost on uninstall / delete / pack-switch (sticky cruise)
| | |
|---|---|
| **Severity** | **HIGH** |
| **Where** | `companion/src/packs/pack-engine.ts:904-918` (`restoreSnapshot` clears `mission_pack_trust_snapshot` without restore); `:1160-1197` (`uninstallPack` never calls `restoreTrustSnapshot`); `:1066-1084` (`applyPack` sets `mission_pack_trust_snapshot: trustSnap \|\| null` — switch to non-trust pack **nulls** prior snap); `:710-732` (`deleteUserPack` → `uninstallPack`) |
| **Evidence** | [inspected] `unapplyPack` (`:1121-1141`) correctly restores from `mission_pack_trust_snapshot`. `uninstallPack` only calls `restoreSnapshot`, which **clears** the trust snap and never runs `restoreTrustSnapshot`. On A→B switch where B has no `trust` block, `trustSnap` stays `null` and patch overwrites the stored pre-A snap to `null` while global flags from A remain. Test coverage only asserts unapply restore (`packs-engine.test.ts:111-178`); **no** uninstall/switch restore polarity. |
| **Impact** | User applies origin=user scene with `skip_l2` → three-flag cruise + modules on. Then: (1) **删除场景** / `pack.uninstall`, or (2) **切换到无 trust 的内置/其他场景**, or (3) `restoreSnapshot` path — global `auto_approve_dangerous` / `auto_approve_enterprise_tools` / `allow_all_schemes` **stay true**. Product copy claims exit restores config (`PacksPanel` save-apply confirm: "退出场景会尽量恢复"). Sticky full autonomy waives shell / skill_install / critical MCP / evaluate forceConfirm without further HITL. **Silent residual autonomy raise after user intent to leave scene.** |
| **Fix** | Before clearing `mission_pack_trust_snapshot`: always `restoreTrustSnapshot` when present. In `uninstallPack` / `deleteUserPack` / switch-away: restore trust of departing pack **before** applying B (or compose multi-thread refcount — see F4). Add tests: apply trust pack → uninstall; apply A(trust) → apply B(no trust); assert flags restored. |

### F2 — Install path honors self-declared `origin:user` + `trust` (spoof)
| | |
|---|---|
| **Severity** | **HIGH** |
| **Where** | `companion/src/packs/validator.ts:125-136,256-275` (trust allowed when `doc.origin === "user"`); `pack-engine.ts:749-784` (`installPackFromDirectory` does **not** force `origin=installed` or strip `trust`); `:407-419` (`resolvePackOrigin` trusts manifest.origin); `:951` (`applyPack` applies trust when origin resolves to user); `message-router.ts:1928-1944` (`pack.install` has **no** `user_gesture`) |
| **Evidence** | [inspected] Malicious `pack.yaml` with `origin: user` + `trust: { skip_l2: true, … }` validates and installs verbatim. Builtin path does not set origin=user; **zip/dir install is the hole**. `saveUserPack` correctly hardcodes `origin: "user"` server-side; install does not. |
| **Impact** | Authenticated WS peer (or user tricked into installing a third-party zip) plants a "user scene" that, on apply, writes full-autonomy cruise + enables shell/netsec. Combined with F3 (no Trust disclosure on list-apply) and F1 (sticky after uninstall), this is a practical privilege escalator relative to "install pack ≠ raise Trust". |
| **Fix** | On `installPackFromDirectory` / zip: force `origin: "installed"` (or omit) and **strip `trust`** before write; only `saveUserPack` may persist trust. Optionally reject install of packs that declare `origin:user` or any trust keys. Re-validate after strip. |

### F3 — List-apply modal never discloses Trust write
| | |
|---|---|
| **Severity** | **MEDIUM** (HIGH with F2; MEDIUM for intentional user-authored scenes) |
| **Where** | `chrome-extension/src/sidepanel/components/PacksPanel.tsx:379-395,838-870` (confirm modal: name/suitable/tools only); `companion/src/packs/types.ts:80-98` (`PackListItem` has **no** `trust` field); `listInstalledPacks` `pack-engine.ts:386-402` does not emit trust |
| **Evidence** | [inspected] Trust `window.confirm` only on **save+apply** editor path (`PacksPanel.tsx:610-618`). List "用于本对话" uses generic modal with no skip_l2 / auto_approve / modules warning. `getPackDetail` includes trust (`:474`) but apply path does not fetch it. |
| **Impact** | User re-applies a previously saved red-team scene (or spoofed pack) without being told it will rewrite **global** security flags. One click → cruise. |
| **Fix** | Include `trust` summary on `PackListItem` (or `pack.get` before apply). If trust non-empty, modal must state global flag writes + modules; require explicit confirm language matching save-apply. |

### F4 — Global Trust is process-wide; multi-thread apply/unapply races
| | |
|---|---|
| **Severity** | **MEDIUM** |
| **Where** | `pack-engine.ts:149-198` (`applyUserPackTrust` → `saveConfig` global); `:952-957` (per-thread snap, re-apply freezes prior); `:1138-1141` (unapply restores **that** thread's snap only) |
| **Evidence** | [inspected] Thread A applies skip_l2; Thread B applies trust with only `enable_modules` → absolute overwrite sets all three auto_approve flags to **false** (demotes A's cruise) while B's snap captured post-A. A unapply restores pre-A (may wipe B's modules). B unapply may re-raise cruise. No refcount / last-writer-wins policy documented in UI. |
| **Impact** | Multi-scene / multi-thread users get non-deterministic global Trust; possible unexpected cruise on or off. Not LLM self-raise; operator confusion + residual sticky risk with F1. |
| **Fix** | Document global semantics; ideally refcount Trust grants per flag, or refuse second trust-writing apply while another thread holds a trust snap (with clear UI). |

### F5 — `applyUserPackTrust` absolute overwrite demotes unset flags
| | |
|---|---|
| **Severity** | **LOW** (safety-leaning) / product surprise |
| **Where** | `pack-engine.ts:160-178` |
| **Evidence** | [inspected] `dangerous/enterprise/schemes` default false unless pack sets them or `skip_l2`. Partial trust (modules only) **clears** existing cruise flags. |
| **Impact** | Unexpected loss of user-set Settings cruise when applying a "enable shell" scene; reverse of sticky raise. Safer than OR-merge, but surprising. |
| **Fix** | Document; or merge with max(current, pack) for raise-only + snap still restores exact prior. Prefer explicit product choice. |

### F6 — MCP critical confirm waive under cruise: algebra matches shell/evaluate
| | |
|---|---|
| **Severity** | — (positive / closed) |
| **Where** | `companion/src/server.ts:4682-4713` (`executeMcpTool`); `:5042-5055` (`executeMcpMetaTool`); compare `:1522-1541` (forceConfirm three-flag) |
| **Evidence** | [inspected] `userFullAutonomyCruise = auto_approve_dangerous ∧ auto_approve_enterprise_tools ∧ allow_all_schemes`. Partial flags still force confirm. Audit: `mcp.confirm.waived` / `mcp.meta.confirm.waived` with `reason: "full_autonomy_cruise"`. `originWs: ws` retained (`:4745`, `:5080`). Tests claim polarity in `mcp-capability-gate.test.ts` (not re-executed here). |
| **Impact** | No single-flag silent MCP write. Cruise waive is explicit multi-opt-in product residual — same residual as shell/skill_install. |
| **Fix** | None for algebra. |

### F7 — skill_install user_home + L2: boundary and forceConfirm hold
| | |
|---|---|
| **Severity** | — (positive) with LOW residual |
| **Where** | `skill-install.ts:100-135` (classify: default zone / home realpath / denied); `:307-415` (re-check at install); `server.ts:1065-1104` (pre-L2 hard deny outside zone); `:1529,1541` (capabilityForceConfirm + three-flag only); `:3615-3629` (security_token required); `security-policy.ts:86-111` (binding + overwrite bit) |
| **Evidence** | [inspected] Outside home+Downloads/tmp/data denied before dialog. Home allowed only with L2 (unless cruise). `realpath` both sides for home. Dest always `getConfigDir()/skills`. Content size-capped 256KiB. God-mode alone does **not** skip. |
| **Impact** | Residual: L2 consent allows reading any path under `$HOME` (e.g. secrets) into skill library — intentional product ("confirm dialog"). Residual: path segment `downloads` grants default tier even outside home (`classifySkillInstallSource` segment check before home) — LOW ambient. |
| **Fix** | Optional: require Downloads under home or known OS Downloads path; keep L2 for home zone. |

### F8 — Pack native allowlist orthogonal to MCP (no smuggle of *native* tools; MCP surface separate)
| | |
|---|---|
| **Severity** | **LOW** residual (design, not regression) |
| **Where** | `thread-manager.ts:569-585` (`isToolAllowed` always true for `mcp__*` / meta); `server.ts:746-772` (whitelist hard gate); `pack-engine.ts:1052-1053` (mcp_servers ∩ configured → `active_mcp_server_ids`) |
| **Evidence** | [inspected] Cannot smuggle `shell_exec` past allowlist via pack tools.allow unknown names (`validator.ts:195-205` known catalog). MCP tools bypass native whitelist by design (D8); still subject to MCP confirm / cruise (F6) and server allowlists. Pack can **expand** thread MCP set via `mcp_servers`. |
| **Impact** | Allowlist scene is not a full sandbox against MCP filesystem/exec if those servers are configured and active. Not a new silent Trust raise. |
| **Fix** | Product: surface "MCP 仍可用" in scene modal when mcp_servers non-empty; optional future: pack flag to freeze MCP off. |

### F9 — S45 P0 upload isolation + safeUploadBasename still hold at tip
| | |
|---|---|
| **Severity** | — (positive re-verify) |
| **Where** | `file-parser.ts:65-68,256-289` (`safeUploadBasename` + relative containment before write); `useWebSocket.ts:1176-1223` (mapBusy always clear for upload tid; chrome gated); `message-router.ts:599-614` (persist upload error on thread); `thread-busy.ts:171-208` + `message-router.ts:1814-1839` (fleet stop: run / parent / process-wide) |
| **Evidence** | [inspected] S45 F5 outer-filename tmp escape **closed** at tip. Upload error isolation pattern intact. Fleet stop parent scope present in companion (`parent_thread_id` filter). Residual: unstamped `file.upload_error` falls back to active thread (S45 residual MEDIUM, not regressed). |
| **Impact** | No new upload RCE / cross-thread busy stick from this range. |
| **Fix** | None for ship; track unstamped fallback as prior residual. |

### F10 — user_gesture is boolean, not cryptographic proof
| | |
|---|---|
| **Severity** | **LOW** (pre-existing local-agent model) |
| **Where** | `message-router.ts:1946-2012` (`user_gesture !== true` gate on apply/save/unapply/delete) |
| **Evidence** | [inspected] Any authenticated WS peer can set `user_gesture: true`. LLM tool channel cannot call pack.apply as a tool (message types only). Matches prior pack reviews. |
| **Impact** | Compromised extension / stolen `ws_secret` can apply trust packs. Same as rest of companion control plane. |
| **Fix** | Out of scope for S46; optional origin-bound UI nonce later. |

### F11 — Builtin packs cannot write auto_approve via validator
| | |
|---|---|
| **Severity** | — (positive) |
| **Where** | `validator.ts:61-84,256-260`; `types.ts:231-242` (`FORBIDDEN_PACK_KEYS`) |
| **Evidence** | [inspected] `trust` block rejected unless `origin === "user"`. Forbidden keys outside `pack.trust` rejected. Builtin YAML inspected path has no trust block. **Hole is F2 install origin spoof**, not builtin ship packs. |
| **Impact** | Shipped builtin packs alone do not raise Trust. |
| **Fix** | F2. |

---

## Positives (closed claims)

1. **MCP cruise waive = three-flag only** — same algebra as §6.2 forceConfirm; partial flags still confirm; audit + originWs held (`server.ts:4682-4745`, `5042-5080`).
2. **skill_install user_home** — allowed with L2; system paths hard-denied; forceConfirm; token binds mode/path/content/overwrite; dest fixed under data dir.
3. **Pack apply/save/unapply/delete require `user_gesture`** — LLM cannot self-apply Trust B via tools.
4. **S45 upload isolation + `safeUploadBasename`** — holds at tip; prior MEDIUM tmp escape closed.
5. **Scoped fleet.stop_all** — run / parent / residual with honest copy; companion parent filter present.
6. **Native tool allowlist** — cannot invent tools; MCP orthogonal by design with separate confirm path.
7. **Trust B apply path** (when unapply used correctly) snapshots and restores global flags + modules; audited `pack.trust_apply` / `pack.trust_restore`.

---

## Residual risks / nits

| ID | Item | Sev |
|----|------|-----|
| R1 | F1 sticky Trust after uninstall/switch/delete | **HIGH — block** |
| R2 | F2 origin:user + trust on install | **HIGH — block** |
| R3 | F3 list-apply no Trust disclosure | MEDIUM |
| R4 | F4 multi-thread global Trust races | MEDIUM |
| R5 | F8 MCP orthogonal to allowlist (design) | LOW |
| R6 | skill_install home = any home file with L2 | product residual |
| R7 | Unstamped upload_error active fallback (S45) | MEDIUM prior |
| R8 | F10 user_gesture forge by auth WS peer | LOW prior |
| R9 | Downloads path-segment default tier outside home | LOW |

**ADR-020:** Trust B is an **intentional** global autonomy raise on apply (user_gesture). Violations: **sticky raise after leave (F1)** and **install spoof to user origin (F2)** are non-monotonic / silent residual raises relative to user mental model. MCP/skill_install cruise algebra itself is monotonic with three-flag opt-in.

---

## Recommendation summary

| Gate | Result |
|------|--------|
| forceConfirm / three-flag (shell/evaluate/skill_install) | HOLD — tip correct |
| MCP cruise waive | HOLD — same three-flag algebra |
| skill_install path/home/L2 | HOLD — ship |
| Pack Trust B apply (happy unapply) | HOLD mechanics; **FAIL restore completeness** |
| Pack Trust B install origin | **FAIL — strip trust / force origin** |
| Pack list-apply disclosure | **FAIL — warn required** |
| Upload isolation / safe basename | HOLD — S45 closed |
| Fleet stop scope | HOLD |
| **Ship** | **REQUEST_CHANGES** — fix F1+F2 before Trust B on main; F3 with same PR preferred |

**Do not modify production code from this lane** — report only.

---

## VERDICT: REQUEST_CHANGES
