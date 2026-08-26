All verification complete. Here is my independent Security/Trust review.

---

# Security/Trust Review — product-form-deepening SoT (2026-08-26)

**Scope**: `docs/superpowers/specs/2026-08-26-product-form-deepening-design.md` vs ADR-022 L3/L4/L8/L9, F-UX-OVERLAY-1 (08-25 spec), and code (`summoner-acl.ts`, `summoner-web.ts`, `mcp/confirm-target.ts`, `outbound-mcp/*`, `l2-admission.ts`, `ws/lifecycle.ts`, `config.ts`).

## Trust monotonicity checks — all pass

1. **Overlay never Allow/Deny** — `[inspected]` Spec §4/§6/§7/§10/§12 consistently ban it; §6 makes the ban verbatim-contractual («召唤器永不出现 允许 拒绝»). Code confirms: `security.confirmation.response` is in neither `SUMMONER_ALLOW` (summoner-acl.ts:14-45) nor `SUMMONER_WEB_DISPATCH_ALLOW` (summoner-web.ts:19-42). Not reopened.

2. **Four channels four ACLs; HUD stdin not license** — `[inspected]` §9's channel table matches code topology: summoner WS gated by surface, tray stdin ungated (local privileged, Swift hash-pinned), extension full, outbound grant-gated. §5/§10 explicitly deny tray-stdin-as-license for `knowledge.get`/grant-issue. The C-thin HTTP dispatch carries a separate allowlist with no CONFIGURE leak.

3. **F-S-10 = L8 fan-out, not overlay MCP admin** — `[inspected]` §7.4 names the real defect (confirm lands on wrong surface / missing fan-out, not skipped confirm) and bans overlay MCP admin, HUD `mcp.add`, and overlay Allow/Deny as pseudo-fixes. NEVER #10 repeats it.

4. **L3+ disclosure = HITL** — `[inspected]` §8.4 honestly labels today's `cmspark__accept_data_disclosure` (stdio-server.ts:33; docs/mcp.md admits "编程 Agent 自确认…不表示终端用户已同意") an L4 self-attestation violation, requires human checkbox at issuance and/or first-leak confirm, and puts it in slice 1 DoD ("调用方 acknowledge 不够"). Matches ADR-022 L3+ and §5.4.

5. **require_grant default true; ws_secret never deputy** — `[executed via grep]` config.ts:402 `require_grant: true`; companion-http.ts:163 and stdio-server.ts:82 explicitly reject `ws_secret` bearers under require_grant. Slice 1 DoD's `GRANT_REQUIRED` observable matches code error paths.

6. **knowledge.get on tray REJECT this season** — `[inspected]` §10 line "本季 REJECT（Security + Product）" + §13 closed "否". No contradiction elsewhere.

7. **Win/Linux fail-closed** — `[inspected]` §4/§7.1.7/§9/slice 2 DoD all say never-skip, attachChromeOnly-or-explicit-fail. Code agrees: `trayEligible` requires Swift backend (l2-admission.ts:1139-1146, with the comment documenting that systray2/readline "lied on Windows/Linux"); `resolveMcpConfirmTarget` returns error (not skip) when overlay-origin with no extension (confirm-target.ts:28).

8. **T1 gates width not form; default profile not widened** — `[inspected]` §8.1 forbids widening to win bake-off; §3.3 keeps the road narrow without deleting it; outbound-grants.ts:134-137 hard-rejects any profile except `outbound_l1_default`. Experimental/non-default-on labeling retained per ADR-022 status.

## REJECT triggers — neither fires

- **Grant-issue or Allow/Deny on overlay?** No. §8.3 explicitly forbids overlay WS `outbound_mcp.grants.issue` and HUD `mcp.add` as issuance; §15 self-check "实现者不能发明 grant 门（CLI / 非 overlay）". Grant path stays CLI/tray-stdin/侧栏备用.
- **L8 optional relative to 5-min 租手?** No. §7.4: "L8 是 §8 五分钟租手的 DoD，不是后置 bug…「五分钟」未完成 = L8 未绿"; §11: "切片 1 与 2 同一里程碑". Not severable.

## Spec's "today it's a hole" diagnosis is accurate

`[inspected]` l2-admission.ts:1290-1293: non-outbound calls bind `{ originWs: ws }`, so overlay-origin L2 binds to the summoner socket; fan-out (1241-1264) fires only for `isOutboundMcpCall`; lifecycle.ts:1399 `rejectAll("disconnect", ws)` kills pending on overlay close. The proposed fix (never bind originWs to summoner; fan-out to all authenticated non-summoner peers including extension; extension-or-unbound binding) mirrors the already-shipped outbound pattern — a tightening consistent with P1-2, not a regression of the checklist's originWs discipline.

## Capability checklist (ADR-020)

Declaration block present at spec head (lines 10-17). Axes fit ✓ (Composition export, "中层 Agent" banned). No new confirm dialect ✓ (reuses 确认台/托盘; bans 浮窗 dialect). No new runtime ✓. Experimental labeling honest ✓ (T1 unbun, "实验 / 非产品 ship"). P1 watchlist: P1-1 `config.set` stays off overlay ✓; P1-2 originWs strengthened ✓; P1-3/P1-4 untouched (evaluate/shell stay out of default profile) ✓.

## Nits (non-blocking)

1. **§8.4 disclosure checkbox granularity** — the issuance-time "允许 caller X 发页文/截图" checkbox could be implemented as standing consent for the grant's full 30d TTL, coarser than ADR-022 L3+'s "按会话/任务 disclosure". "Companion 服务端会话是 SoT" pulls the right way, but the SoT should state the checkbox is caller-scoped, revocable, and audit-logged — or prefer the first-leak-confirm branch.
2. **Slice 2/3 copy ownership overlap** — §7.2's 「侧栏」→「确认台」 is in slice 2's DoD ("仍说「去侧栏批准」" forbidden) but `mcp-confirm-target.test.ts` is listed under 切片 3's test changes (§6). Ride the test with slice 2 to avoid a claimed-green slice 2 with stale copy.
3. **§9 channel 2 wording** — 允许 column lists "现有 HUD add/import" while 禁止 says "本季冻结 add/import". Intent clear (exists-in-code vs frozen), but placement reads contradictory.
4. **Frozen residues for the record** — `mcp.toggle_server` / `skill.activate` remain in both summoner allowlists this season (rollback ticket deferred beyond slices 1–3). Spec handles honestly (F-S-5: residue ≠ precedent, chrome hides switches); pre-existing state, not a widening by this SoT.
5. Grant CLI doesn't exist yet (WS methods only); §14 correctly forbids docs/mcp.md advertising it pre-slice-1, and flags the spike-plan/preflight `Bearer ws_secret` residue for slice 1 cleanup — accurate.

VERDICT: APPROVE_WITH_NITS
