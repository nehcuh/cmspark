kimi version 0.38.0
• Let me read the key files: the brief v2, the adversary synthesis, the checklist template, and cross-check code files. This is a substantial read-only review task. I should read files myself since I need deep understanding. Let me parallelize reads.

• I'll read the two core documents first, then cross-check the code.

• Now cross-check code claims. Key files: `companion/src/ws/lifecycle.ts` (pickAuthenticatedClientWs, createToolExecutor), `companion/src/ws/tool-forward.ts`, `companion/src/platform.ts` (openSidePanel), HUD N1-N10 lock doc, ADR-020, ADR-022. Also check S19 claims about classifyError and 15s timeout.

  This is a large review. I could delegate to explore agents, but the cross-checks are focused. Let me grep the code myself in parallel.

• Now I'll cross-check the code claims. Reading the key implementation files and lock documents in parallel.

• Confirmed: openSidePanel only activates Chrome — the brief's claim is accurate. tool-forward confirms `forwardToolToExtension` sends `tool.execute` to the `ws` passed in, with a 15000ms timeout returning English error "Tool execution timeout (15000ms)". Now I need to verify:

  1. `pickAuthenticatedClientWs` (lifecycle.ts:256) — what origins it accepts.
  2. lifecycle.ts:796 — chat loop uses createToolExecutor(ws) with the originating ws.
  3. classifyError — how "Tool execution timeout" / "WebSocket not connected" are classified (recoverable?).
  4. Whether the default forward path in server.ts:439 createToolExecutor actually forwards everything to ws, or whether it checks extension-only first.

  Also read HUD N1-N10 lock doc, ADR-020, ADR-022 L8/L9. Let me read lifecycle.ts relevant sections and grep classifyError.

• Code claims confirmed for `openSidePanel` and tool-forward. Now checking `pickAuthenticatedClientWs`, the chat-loop executor binding, and `classifyError`.

• Now check classifyError to verify the brief's claim that timeout/disconnected → recoverable → model retries. Read security.ts classifyError. Also check how the chat loop (adapter.ts:1438) treats recoverable errors (retry?).

  Also read the N1–N10 lock doc, ADR-020, ADR-022 L8/L9. These are the remaining cross-checks.The claims check out:

  - `pickAuthenticatedClientWs` only binds `chrome-extension://` origin, used by outbound runner. Tray authenticates but doesn't handle tool.execute (S42 P1 comment confirms the 15s timeout residual).
  - Chat loop at lifecycle.ts:796 uses `createToolExecutor(ws)` per connecting socket — so a tray-origin chat would forward tool.execute to the tray socket → 15s timeout "Tool execution timeout (15000ms)".
  - classifyError: "timeout" and "disconnected" both → recoverable → adapter feeds back to LLM for retry (up to MAX_SAME_TOOL_RECOVERABLE_FAILURES). Confirms X8 and the S19 rationale.

  Now check the remaining docs: N1–N10 lock (N2 MinimalConfirm Panel-only, N5 single writer, N6 conductor, N1 single binary), ADR-020, ADR-022 L8/L9. Also verify tray capabilities: does the tray have thread.list / confirm / activate Chrome via stdin respond()? And whether tray has chat composer (claimed not). Also S21 claims: does tray origin currently have no method ACL (X6 claim) — check ws-auth / method gating for tray origin.

  Let me delegate the doc reads? They're likely long. Actually let me just read them in parallel — N1-N10 lock, ADR-020, ADR-022. And grep for tray stdin respond and tray ACL.

• Core code claims confirmed. Now reading the lock documents (N1–N10, ADR-020, ADR-022) and checking tray capabilities.

• Now check ADR-020 briefly, and tray capabilities (does the tray currently have thread.list, confirm, activate Chrome; no chat composer — S21 claims re: no method ACL for tray origin). Also check S19 sufficiency: the brief says tray-origin loops should use pickAuthenticatedClientWs for L1. But wait — there's a subtlety: `createToolExecutor(ws)` does more than forward; it also handles L0 tools, companion dispatch, MCP. The S19 gate requires that when origin is tray-class, L1 tools go to extension peer instead of the originating ws. Is that claim "sufficient"? The question in the review: "Is S19 actually sufficient vs today's createToolExecutor(originatingWs)?" Let me check what createToolExecutor does with ws — which tools actually forward to the ws (BROWSER_* / extension tools) vs companion-side tools. Also check whether there is an existing notion of "extension-only" tools list.

  Also check: does the tray currently use WS with `cmspark-tray://local` origin and can call chat.create? Check what methods tray origin can call today (X6: "tray origin 鉴权后几乎无方法 ACL"). Look for origin checks in message handling.

  Let me delegate a focused exploration to an explore agent to save context? I still need: 
  1. createToolExecutor structure — what determines forward-to-ws vs local handling (server.ts:439+).
  2. Tray client capabilities — what does tray companion-client do (thread.list, confirm respond, activate chrome)? Search for tray stdin commands and companion-client.
  3. Whether chat.create from tray origin works today / any ACL on methods.
  4. ADR-020 §1 content.

  Let me do a couple of greps/reads myself. Read server.ts createToolExecutor head.The `createToolExecutor` closure captures `ws` and eventually forwards unhandled tools to that ws (the originating socket). Confirmed.

  Now check: what methods tray origin can call today — X6 claim "tray origin 鉴权后几乎无方法 ACL". Look at stt-handlers.ts:43 (refuses tray), and whether chat.* methods check origin. Grep for origin checks in message handling in lifecycle.ts.Interesting: some handlers (voice.stt, meeting) fence to chrome-extension origin, but chat.* apparently isn't origin-fenced — consistent with X6 claim that tray origin has nearly no method ACL after auth. The brief's claim "tray 已能 thread.list / 确认 / activate Chrome ... tray 没有 chat composer" is consistent.

  Also check `swift-tray-bridge.ts` respond() privileged path (bypasses originWs) — that's the "tray stdin respond() 保持特权通道" claim.

  Also verify the brief's claim in §5.3 that "确认超时 45s" — C2 says ~45s default. OK.

  Now check ADR-020 §1 (the "one sentence" the brief references) and the HUD brief §6.2, quickly. And check S21's whitelist feasibility: does the tray client have chat.create today? The brief says "tray client 不得 5s RPC 死等" for chat.create streaming — need to check companion-client sendRequest timeout (5s?). Let me check companion-client for timeout.

  Also, does the message router restrict chat.create to extension origin? Grep for chat.create handling.Good. ADR-020 §1 one-sentence positioning confirmed: "默认：浏览器内 Agent（对话 → 页内操控）". The brief's §9.5 item 28 says accepting this brief must change GOAL / architecture §0 — but wait, S24 says GOAL one-liner NOT changed until P0 falsification passes. Is there tension? §9.5.28 says "把 GOAL.md「浏览器内 Agent」留着和新叙事并存：接受本 brief 后必须改 GOAL / architecture §0，否则文档分裂。" Hmm, that says after ACCEPTING the brief, GOAL/architecture must change. But S24 and §0 say P0 falsification before changing GOAL one-liner; at most add "实验：菜单栏召唤". So item 28 could be read as contradiction: does "接受本 brief 后必须改 GOAL" mean immediately, or after P0 passes? Actually it says "留着和新叙事并存" is forbidden — accepting the brief requires changing GOAL/architecture §0. But S24/§0/P2 says narrative switch is P2, after falsification. The resolution: P0 allows adding "实验：菜单栏召唤" annotation to GOAL — that IS the change. But item 28 says "必须改 GOAL / architecture §0" which could conflict with the "P0 不改 GOAL 一句话" phrasing. Minor wording ambiguity — a NIT at most (the fold log and S24 are clear; item 28 predates? no, it's in v2). Actually re-reading: item 28's "禁止的错误行为" framing: "接受本 brief 后必须改 GOAL / architecture §0，否则文档分裂". Under v2, the change at accept-time = add the "实验" line; the one-liner rewrite happens at P2. Slight ambiguity worth flagging as NIT — or maybe it's fine.

  Now let me work through the reviewer's 8 questions:

  1. **Does v2 still call the overlay a product home?** Search the brief: §3 product model diagram says "Summoner overlay (OS home, L0+search)" — line 109: "(OS home," — YES! The ASCII diagram still says "OS home". Also S2 says "不得对外称「家/主界面」" but the diagram literally labels it "OS home". That's a leftover v1 identity lie in the diagram. Also §14? Let me check other instances: "召唤器是 L0 捕获壳" etc. The diagram "OS home" is a contradiction with the identity lock ("禁止把召唤器叫「家/主界面」"). This is a real finding — the synthesis X3 and P-B1 folded this, and §2 says "v1 把 overlay 叫「家」已被对抗否定", yet the diagram still says "OS home". That's at least MAJOR (identity lie is BLOCK-class per verdict rules? "REJECT if any BLOCK remains (unenforceable Trust, identity lie, or P0 not landable)"). Hmm — is "OS home" in an internal diagram an identity lie? The identity lock explicitly says "召唤器不是「主界面」". The diagram says "OS home". This is a direct internal contradiction. I'd call it MAJOR leaning BLOCK — the verdict criteria say identity lie = BLOCK. But it's a diagram label vs. the law text being correct everywhere else. Let me weigh: the review instruction says hunt leftover BLOCK-class holes; question 1 explicitly asks. The verdict rule: "REJECT if any BLOCK remains (identity lie)". A single diagram token "OS home" — is that an identity lie or a foldable nit? The law S2 locks "不得对外称家/主界面" — the diagram is internal, not 对外. But the brief's own 规范用语 says "禁止...把召唤器叫「家/主界面」" — not scoped to external copy. The diagram violates the brief's own normative language rule. I'll call it MAJOR (must fix before spike plan, trivially foldable) — hmm, but MAJOR with APPROVE_WITH_NITS? The verdict definitions: APPROVE_WITH_NITS = foldable nits only. If I find a MAJOR, verdict should be REJECT? The instructions: "REJECT if any BLOCK remains... APPROVE_WITH_NITS = foldable nits only." So a MAJOR finding → REJECT per these instructions? Not explicitly — it says REJECT if any BLOCK. MAJOR handling isn't defined. In the dual-review convention from the checklist: "APPROVE_WITH_NITS lists only non-blockers". So MAJORs that are non-blocking can be nits? The synthesis doc says "MAJOR 折回（v2 写入；外审可降 NIT）". The prompt says "Findings BLOCK / MAJOR / NIT" and "APPROVE_WITH_NITS = foldable nits only". I think the spirit: REJECT if BLOCK; if only MAJOR/NIT that are foldable without re-architecture, APPROVE_WITH_NITS is plausible but strictly says "nits only". A MAJOR leftover identity contradiction... The "OS home" in the diagram is exactly the kind of thing the adversary lanes BLOCKED (P-B1 家). A reviewer should not wave it through as a NIT. I could classify it as BLOCK-lite. Let me think harder about severity: the entire v2 fold hinges on killing the "home" identity. §0 capability declaration in the prompt itself says "L0 capture overlay... full L0/L1 = Side Panel" — clean. §2 says v1's "家" was rejected. S2 clean. §13 clean. But §3 diagram: "Summoner overlay (OS home, L0+search)". One leftover token. It contradicts the identity lock in the same document. Given the review prompt's question 1 asks exactly this, and the verdict rule names "identity lie" as BLOCK — but is a diagram label a "lie"? It's an internal inconsistency that would be caught in spike planning. Hmm.

  Actually, let me also check line 40: "召唤器是缺浏览器时的续聊/检索" — fine. Line 109 "OS home" is the only occurrence. Also §16? no.

  I think honest assessment: this is a MAJOR — direct self-contradiction with the brief's own 规范用语， trivially foldable (one word change). Whether it forces REJECT depends on how strict. The prompt says "REJECT if any BLOCK remains (unenforceable Trust, identity lie, or P0 not landable)". Is the diagram label an "identity lie"? The identity lock is about capability + copy: "召唤器不是「主界面」". The diagram says OS home. That IS the identity lie surviving in one sentence — exactly question 1 and question 8 ("any v1 sentence that survived unamended"). I'd argue this qualifies as a leftover of the P-B1 BLOCK, incompletely folded. But severity proportionality: one word in a diagram, where 15 other places state the correct identity. An adversary would flag it; whether it blocks... The instructions are strict: "Do not rubber-stamp." If I find the exact thing question 1 asks about, calling it a NIT seems like soft-pedaling. But is it truly BLOCK-class? A BLOCK = "must fold into v2, otherwise not eligible for APPROVE". The fix is one word; the law around it is unambiguous. If the spike plan inherited "OS home" language it would matter; as a document defect it's foldable. I'll classify it MAJOR and weigh the verdict at the end.

  2. **S19 sufficient vs createToolExecutor(originatingWs)?** S19 says: tray-class origin loops route L1 only via pickAuthenticatedClientWs(); never send tool.execute back to originating socket; no peer → BROWSER_UNAVAILABLE non-recoverable. Is that sufficient? createToolExecutor(originatingWs) also uses ws for: MCP session cache (mcpSessionByWs), security.confirmation originWs binding (P1-2 watchlist: originWs binding for securityConfirmations.request). If a tray-origin chat loop runs, L2 admission / confirmations would bind originWs = tray socket. S6 says "禁止解绑非 outbound 的 originWs" and confirmations go through tray stdin respond()/HUD. Also companion-side tools and MCP tools execute locally — fine. The gap: S19 changes where tool.execute goes for L1, but createToolExecutor's closure still uses originating ws for confirm routing (sendToExtension chat.error goes to originating ws — that's desired, overlay needs the error). One subtlety: confirmations during tray-origin chat — SecurityConfirmationManager.request binding {originWs: ws} — if ws is tray, confirm request goes to tray socket which doesn't render ConfirmElevated... but tray stdin respond() exists. N5 single-writer: tray confirm path exists today (tray quick-confirm). So probably fine but S19 as worded ("L1 只 pickAuthenticatedClientWs") only covers L1 forwarding. L2 tools (host_computer) from overlay-origin chat: admission gates run; confirm goes... where? S22 says overlay doesn't render confirms when LIVE/pending L2; but if the user starts an L2 task from the overlay chat, the confirm request would be routed to tray socket/HUD. Brief says S6: confirmations go via existing tray stdin respond() and HUD/Cockpit ConfirmElevated — so covered. I think S19 is sufficient as a law, with an implementation note: the executor needs an "actuator ws" separate from "session ws" — the brief states this ("conversation origin ⊥ actuator origin"). Also non-recoverable: BROWSER_UNAVAILABLE must not match classifyError recoverable tokens — check: "BROWSER_UNAVAILABLE" lowercased = "browser_unavailable". Does it contain "timeout"? No. "not found"? No. But if implemented as error string "Browser unavailable"... contains "unavailable"? recoverable list doesn't include "unavailable". Wait — does it include... "disconnected" yes, "timeout" yes. "browser_unavailable" — safe. But careful: if message includes "extension unavailable"? not in list. OK. One catch: classifyError checks msg.includes("not found") — if error message were "no browser found"... but the code is new; law says new code must not hit those branches. Fine — NIT: the law should note the error string must avoid recoverable tokens (§10 already says "禁止命中 classifyError 的 disconnected/timeout recoverable 分支" — covered).

  Sufficiency gap: `sendToExtension` in adapter — where do chat.stream tokens go for a tray-origin loop? They go to originating ws presumably (the loop was started from that socket's chat.create). Fine. Another gap: adapter's tabId recovery path (list_tabs via executeTool) — that would also route through S19 gate; fine.

  One more: S19 says "禁止 tool.execute 打回发起 socket" for tray-class origin. But what about extension-origin loops — unchanged, originating ws IS the extension. Fine.

  Potential hole: today there might be paths where the chat loop needs ws for things other than tool.execute — e.g., voice, computer.evidence. Not P0 scope. I'll say S19 is sufficient as a law; mark LOCK.

  3. **S21 hybrid — recreate WS superuser?** S21: stdin whitelist for window/hotkey/hydrate; chat.* over tray-origin WS with server ACL allowing only chat.create/abort, thread.list/select/create, history.query; hard-reject pack.apply+allowTrust, config.set, security.unattended.arm, mcp.add, security.confirmation.response (non-outbound). Today: tray origin authenticates via HMAC (shared secret readable by same user — noted residual) and has nearly no method ACL (confirmed: only voice/meeting handlers fence origin; chat.* presumably open). So S21 adds a real ACL where none exists — that's an improvement, not recreating a superuser. BUT: the hybrid means the overlay holds the same ws_secret as tray (same binary, same user). HMAC doesn't stop same-user key reads (acknowledged). The ACL is server-side per-origin — and origin is self-asserted header? isAllowedWsOrigin allows cmspark-tray://local; any local process can claim that Origin header if it has the secret. The ACL ties to origin string, which is spoofable by anyone with the secret — but that's the existing trust model (secret = the gate). Residual accepted by brief §8. Is the ACL enforceable? chat.create from tray origin → starts chat loop with originating ws = tray socket → S19 gate handles L1. Also chat.create could drive L2 (host_computer) via LLM — confirms go tray stdin — that's existing tray privilege. Hmm, does the ACL allow the overlay chat to trigger L2 tasks? The brief says 召唤器不做 CU (§12 non-goal, 9.5.27), but S21 allows chat.create which can lead the LLM to call host_computer — gated by L2 admission + confirm via tray/HUD. That's the same as any chat. OK.

  Also `history.query` — is there such a method today? Brief §7 says "已有或需扩". Fine.

  Does S21 recreate the superuser? No — it's a restriction. But one question: does the ACL apply to tray origin globally (breaking existing tray client calls like skill.list, skill activate)? Tray already uses skill.list / thread.list / system.ping / respond. If ACL is per-origin "cmspark-tray://local" and the overlay shares that origin, the ACL must include everything tray needs (skill.list, etc.) or use a sub-identity. S17 says origin only reuses cmspark-tray://local (no new origin) — so server can't distinguish overlay from tray by origin! Then "服务器 ACL 只允许 chat.create/abort, thread.list/select/create, history.query" — would that break tray's existing skill.list / activate Chrome / pairing calls? This is a real tension: S17 forbids a new origin; S21 defines an ACL whitelist that is narrower than what the tray client already does (skill.list, system.ping, pairing, respond via stdin not WS). If ACL applies to the origin, tray breaks; if it applies to "overlay" as a separate identity, you need a distinguishing claim (new origin or a declared client class) — contradicting S17 or requiring a new handshake field. Hmm — but the ACL could key on a client-class field in auth handshake rather than Origin header. S17 says "Origin 只复用 cmspark-tray://local（v1 不新 cmspark-ui://local）". It doesn't forbid a client-class declaration within the tray origin. The brief's S21 says "chat.* 可走 tray-origin WS，但服务器 ACL 只允许..." — ambiguous whether the whitelist is for overlay's WS usage or all tray-origin WS. Reading strictly, S21's allowlist = the overlay's permitted methods; tray keeps its existing broader (still HMAC-gated) set. Since overlay and tray share origin, enforcement needs a distinguishing attribute. The brief doesn't specify. Is this a leftover hole? The security BLOCK was "tray origin 鉴权后几乎无方法 ACL" — the fold says overlay gets a strict whitelist. Enforceability requires server to distinguish overlay connections from tray connections. Options: separate WS connection with a declared role (e.g. auth.handshake client="summoner"), or route overlay chat through the tray's existing connection via stdin (then tray is the only WS client and ACL applies per-request through stdin whitelist — actually the cleanest: overlay sends chat.* to tray over stdin, tray forwards via its WS... but then server sees tray origin for everything, ACL can't distinguish). The brief's hybrid: "窗口/热键 stdin；chat.* 走 tray-origin WS + ACL". So overlay opens its own WS with tray origin. Distinguishing requires a handshake-declared client type. Not specified = implementation gap, MAJOR at most? The synthesis §6.4 explicitly flags: "外审应打这个混合是否又变回超户". My answer: it doesn't recreate the superuser IF the ACL is keyed on a declared client class; but as written, S17+S21 leave the enforcement key unspecified — self-asserted client class is spoofable by anything holding the secret (same residual as origin spoofing, acknowledged in §8 冒充 row: "overlay 不是第二个全权 WS 超户（S21）" — the claim rests on ACL enforcement, which needs the distinction mechanism). Given the acknowledged HMAC residual, a spoofed client class is the same class of residual. I'd call this a NIT/MAJOR: specify the ACL enforcement key (handshake client class) in spike plan. Not BLOCK because the threat model (local same-user attacker with secret) is already acknowledged residual, and ACL still raises the bar from zero.

  Actually wait — re-read S21: "硬拒：...security.confirmation.response（非 outbound）". Today tray confirm respond() goes via stdin bridge (swift-tray-bridge.ts:67 "gains the privileged respond() path"). So WS-level hard-reject of confirmation.response for tray origin doesn't break tray (stdin path separate). OK consistent.

  4. **S6 vs N2 — remaining overlay Allow?** N2: MinimalConfirm Panel-only. S6: 不改 N2; overlay doesn't render Allow/Deny; confirmations via tray stdin respond()/HUD. §5.5: "召唤器可以为本机用户提供同一 MinimalConfirm，但仍是 N5 的一个观察者，不是第二个 writer". Hmm — §5.5 says "召唤器可以为本机用户提供同一 MinimalConfirm" — "提供同一 MinimalConfirm"?! That reads like the overlay CAN show MinimalConfirm (as an observer of N5, not writer). But S6 says overlay 只显示徽章/深链，不渲染 Allow/Deny, and S22 says overlay 不画任何确认按钮 during L2. And P1 phasing says "Overlay MinimalConfirm 接入 N5" (P1). So §5.5's "提供同一 MinimalConfirm" contradicts S6's "不渲染 Allow/Deny" unless "观察者" means display-only. "提供 MinimalConfirm" as observer = shows the confirm but response goes through... no, a MinimalConfirm IS an allow/deny UI. If overlay shows it read-only (badge) it's not a MinimalConfirm. This is wording slippage — "观察者，不是第二个 writer" suggests overlay displays the confirm state but the actual respond goes through tray stdin? But then the overlay renders Allow/Deny buttons that pipe to tray stdin respond() — is that allowed? S6 says confirmations go through "既有 tray stdin respond()" — the overlay is in the same binary as tray (S10 one binary). An overlay Allow button that calls the tray's stdin respond() path would technically satisfy "single writer = tray stdin respond()" while violating the letter of "召唤器只显示徽章/深链，不渲染 Allow/Deny". v2 has internal tension: §5.5 "提供同一 MinimalConfirm" vs S6 "不渲染 Allow/Deny" vs P1 "Overlay MinimalConfirm 接入 N5". P1 item suggests overlay MinimalConfirm is planned for P1 — which AMENDS N2's "MinimalConfirm stays Panel-only"? N2 says MinimalConfirm Panel-only, standby wide surfaces don't show confirms. Overlay is not a wide shell. If P1 adds overlay MinimalConfirm, N2 must be explicitly amended — v2 says "N2 不改". Contradiction: P1 "Overlay MinimalConfirm 接入 N5" implies rendering a confirm UI on overlay = changing N2's Panel-only rule. Hmm, but C3 in N1-N10 lock: "Tray quick-confirm: L1/browser confirms Keep". Tray already shows L1 confirms. Overlay as part of tray binary showing the same tray quick-confirm might not violate N2 (which is about MinimalConfirm Panel-only among wide shells... actually N2: "MinimalConfirm stays Panel-only (D10′)"). Tray quick-confirm dialog exists as separate thing. So overlay "MinimalConfirm" would be a new confirm surface = N2 amendment needed. v2 claims "N2 不改" while P1 plans overlay MinimalConfirm. That's an inconsistency — MAJOR (docs-level, foldable by either dropping the P1 bullet or marking it N2-amend). Question 4 asks "any remaining overlay Allow?" — S6/S22 forbid it for P0; §5.5 + P1 leave a door. So: no P0 overlay Allow (good), but §5.5 wording and P1 roadmap contradict "N2 不改". Flag MAJOR.

  5. **P0 falsification — still theater?** §11: observable pass/fail criteria: ≥6/8 complete tasks 1+2 without launching Chrome; task 3 typed error; history.db zero auto-L1 before "继续"; IME 5/5; dual-surface single composer. Falsification: ≥50% open Chrome, ≥3/8 say not-a-conversation, ≥3/5 launcher users prefer launcher, CTA misconception abandonment. These are observable and genuinely falsifiable. Weaknesses: 8+5 users is small but it's a spike; "history.db 零次自动 L1" is machine-checkable; IME gate measurable. One soft spot: "≥3/8 侧栏用户说「这不像对话」" — subjective interview, but explicit threshold. Not theater. Also C-M7 fold: IME failure ≠ strategic failure but product gate — brief says exactly that. OK: P0 is landable and falsifiable. LOCK.

  But: is P0 landable technically? Requires: hotkey overlay window in Swift binary, stdin commands for window/hotkey (new), chat.create streaming over tray WS (tray client currently 5s RPC timeout — brief notes "不得 5s RPC 死等" so streaming protocol change needed), S19 gate, BROWSER_UNAVAILABLE code, composer.lease (S20, 帧字段 OPEN). X5 said "P0 不是加一扇已有窗：无热键、无 composer、无 IME、无 overlay stdin cmd" — v2 acknowledges this is a spike (S24, P0 = spike). The work is sizable but that's what a spike is. Landable: yes, though composer.lease frames unspecified (OPEN, acknowledged).

  6. **S10 OPEN (IME×CU process) — shipping P0 spike acceptable?** S10: one SHA256 gate, one Swift binary LOCK; single-process OPEN pending IME×CU spike. P0 ships overlay in the same binary regardless — the process question is whether the overlay window lives in the same process as tray/HUD (IME input + nonactivating panel issues). The synthesis: "P0 spike 用非激活面板 + 输入时临时 regular; 未 spike 不得锁单进程". Acceptable: yes — P0 is a spike precisely to resolve this; the IME gate (5/5) is the falsification. If single-process fails IME, fallback = separate process (still one binary? a helper process spawned by same binary keeps one SHA256 gate). Fine. LOCK/acceptable.

  7. **ADR-020 copy freeze until P0 pass — good or docs split?** S24/§0: don't change GOAL one-liner before falsification; at most add "实验：菜单栏召唤". But §9.5.28 says "接受本 brief 后必须改 GOAL / architecture §0，否则文档分裂" — contradiction with the freeze unless the "改" = adding the experiment line. Wording: 28 says "把 GOAL.md「浏览器内 Agent」留着和新叙事并存：接受本 brief 后必须改" — but the new narrative is NOT accepted until P0 passes (S24). So 28 as written contradicts S24: it demands GOAL change on brief acceptance; S24 forbids one-liner change pre-falsification. Unless 28 means "add the experiment annotation". This is the ambiguity I noted. MAJOR/NIT — I'd call it MAJOR-lite or NIT: needs one clarifying clause ("改 = 加实验行；一句话定位 P2 再改"). Given the freeze is otherwise sound (prevents docs split by keeping narrative frozen until evidence), I'll flag the contradiction as a finding. Which severity? It's a direct internal contradiction on a locked question (S24 vs 9.5.28). Adversary lanes would call this MAJOR. Fold: one-line amendment. I'll put MAJOR.

  Also ADR-020 checklist question: does the brief hang on correct axes? Capability declaration puts overlay on Surface L0 — correct; Compose index-only; Autonomy single; Trust same SHA256; Channel community. Axes fit. Pack-first: overlay doesn't add new Side Panel chrome; scenario entry stays Pack — OK. Confirm dialects: no new family — S6 explicit. Trust monotonicity: unaffected; S13/S22 good. originWs: S6 says don't unbind originWs — good. No new runtime: S1. 

  8. **v1 sentences survived unamended contradicting v2 laws?** Found: (a) §3 diagram "OS home" — contradicts 规范用语 + S2. (b) §5.5 "召唤器可以为本机用户提供同一 MinimalConfirm" — contradicts S6 不渲染 Allow/Deny (unless read as observer-only; but "提供 MinimalConfirm" ≠ "显示徽章"). (c) §9.5.28 vs S24 GOAL freeze. (d) P1 "Overlay MinimalConfirm 接入 N5" vs "N2 不改" in §13 table. Also line 51-52: "tray 已能 thread.list / 确认 / activate Chrome" — verified accurate. Also check §3 table row Tray: "Chrome 缺席时的 L1 确认（既有 stdin respond()）" — consistent.

  Any other "家" instances? Line 8 identity lock: fine (negation). Line 39: "非「取代 Panel 的家」" fine. Line 58: "v1 把 overlay 叫「家」已被对抗否定" fine. Line 109 diagram "OS home" — the one positive use. Also §13: "修订的是 默认家 文案" — fine (refers to narrative). Line 306: "承认家还在浏览器" — fine.

  Also check S2: "Chrome 缺席时这是唯一可输入 L0" — "唯一可输入 L0"... when Chrome absent, could HUD composer input L0? N6 conductor during LIVE. Edge: unattended/HUD — minor, skip.

  Also question: S19 and §5.3.3: "服务器禁止重放上一 L1 tool_call" — consistent with X8 fold.

  Also S14: "持久徽章按 §5.1 已实现的状态（P0 先二元）" consistent.

  Now also verify the claim "history.query" exists? §7 table says "已有或需扩" — honest. And "thread.list tray 已用" — confirmed (companion-client.ts:226). "activate Chrome" — tray has openSidePanel/openChrome via platform.ts; quick actions list includes "新建对话" etc. Fine.

  One more check: brief claims "chat loop 的 createToolExecutor(ws) 把 tool.execute 发给发起 socket" — confirmed via lifecycle.ts:796 + forwardToolToExtension(ctx.ws). And "Tray 发起的 L1 会 15s timeout" — confirmed TOOL_EXECUTION_TIMEOUT_MS=15000, and S42 comment in pickAuthenticatedClientWs confirms tray doesn't handle tool.execute. And classifyError "timeout" → recoverable → adapter retries with loop guard (MAX_SAME_TOOL_RECOVERABLE_FAILURES) — confirmed. So §5.3's "今日缺口" is accurate.

  Also verify claim "无 extension peer → outbound 快失败 EXTENSION_UNAVAILABLE" — ensureOutboundToolRunnerWired comment says "no extension peer → EXTENSION_UNAVAILABLE (fast fail)". Confirmed.

  Claim: "Side Panel 无法程序打开" — confirmed platform.ts:142-151.

  Claim: macOS only Google Chrome — confirmed osascript.

  Now also ADR-022 L8/L9 cross-check (brief §5.5, §13): L8 = confirm UX must not require Side Panel focus; tray/global confirm. Brief's use is consistent. L9 = dual-entry tab lease, Side Panel wins, MCP queues. Brief §13 says "L9 赢家 = 人机会话（Panel ∪ summoner-origin thread），MCP 排队" — hmm, this CHANGES L9's winner from "Side Panel" to "人机会话 (Panel ∪ summoner-origin)" — flagged as P0 不改， post-falsification change. Actually §13 says "P0 不改。证伪通过后：...L9 赢家 = 人机会话". OK it's deferred, consistent.

  Now — is there anything about S12 检索封闭 vs §7 "消息正文 thread store 本地倒排 (v1 可笨）"? S12 says "P0 不搜消息正文" but §7 includes 消息正文 as a source with "v1 可笨". Contradiction? S12: "不搜文件/App/剪贴板/窗口。P0 不搜消息正文；空态写明范围." §7 lists message body search as available "v1 可笨" — v1 (product version 1, post-spike?) vs P0. "v1" here ambiguous with brief-v1! §7's "v1" means product v1 (the first shipped version), while elsewhere "v1" means the rejected brief draft. §6 also says "v1 overlay 安装 Pack/Skill：只 deep-link Panel" and S17 "v1 不新 origin". These "v1" = product v1. In a document whose headline drama is brief-v1 vs v2, using "v1" for product version is confusing but not a law contradiction. S12 P0 excludes body search; §7 allows it in product v1 — consistent if P0 < v1. NIT: terminology collision.

  Also S7: hydrate 上限 20 条 — fine.

  Now score three layers:
  - Outcome (can this be a spike without lying): mostly yes; the remaining self-contradictions (OS home label, §5.5 MinimalConfirm, 9.5.28 GOAL, P1 overlay MinimalConfirm vs N2) are doc-level and foldable. P0 criteria observable.
  - Trajectory (fold vs ignore adversary): genuine fold — S19/S20/S21/S22/S23/S24 directly answer X1-X9; claims verified against code are accurate. Not rubber-stamping: the adversary's core technical claims (executor binding, classifyError recoverable, openSidePanel, outbound fast-fail) all check out in live code.
  - Component: laws S1-S24 mostly LOCK.

  Verdict decision: REJECT if any BLOCK remains (unenforceable Trust, identity lie, P0 not landable). Do my findings include a BLOCK?

  - "OS home" in diagram: identity-lie residue. Is it BLOCK? The verdict rule's "identity lie" refers to the product identity claim. One diagram parenthetical, contradicted by the law text everywhere else... A strict triple-review that just blocked v1 for calling it "home" should not wave through a surviving "OS home" label. But is it "remaining BLOCK-class"? I judged: it's the residue of P-B1. The instruction says "Hunt leftover BLOCK-class holes: 1. Does v2 still call the overlay a product home in any remaining sentence?" — the answer is YES, it does, in the §3 diagram. Given the prompt explicitly asks this and the answer is yes, calling it NIT would be dishonest. But is it truly BLOCK (unfixable without re-architecture)? No — one word. The verdict options force: BLOCK → REJECT; foldable nits → APPROVE_WITH_NITS. MAJORs aren't mapped explicitly. The checklist says APPROVE_WITH_NITS lists only non-blockers. In prior repo convention (synthesis §2: "BLOCK 处置（必须折进 v2，否则不得外审当 APPROVE 候选）"), MAJORs can be present with APPROVE_WITH_NITS? The synthesis said "MAJOR 折回（v2 写入；外审可降 NIT）" — external review may downgrade MAJOR to NIT. So MAJOR findings that are foldable → APPROVE_WITH_NITS is within convention if they're non-blocking.

  Is the "OS home" label blocking? It contradicts the identity lock — the exact thing the owner cares about. However, since the law (S2, 规范用语） is unambiguous and the diagram is a single stray label, a spike plan written from the laws would not inherit the lie. I'd rate it MAJOR — must fix before the brief is used as spike basis, but foldable in one edit. Under this repo's convention, that lands at APPROVE_WITH_NITS only if I consider these foldable nits. Hmm. The prompt: "APPROVE_WITH_NITS = foldable nits only." If I have MAJORs, strictly I should REJECT? But REJECT is defined as "any BLOCK remains". MAJOR ≠ BLOCK. The three verdicts don't cleanly map; I must choose. Let me weigh the spirit: REJECT means send back for another fold cycle. The remaining issues are: two wording contradictions, one terminology ambiguity, one ACL-enforcement-key gap, one P1/N2 tension. None requires redesign; all are one-line amendments. Sending the whole brief back to REJECT for that seems disproportionate and would itself be theater. But the prompt warns "Do not rubber-stamp" and "REJECT if any BLOCK remains (identity lie...)". 

  Decision hinges on whether the §3 "OS home" is an "identity lie" BLOCK. Honestly: it's a leftover label that contradicts S2, in the product model diagram — the section most likely to be quoted. The identity lock was THE central v1 BLOCK (P-B1/B3, X3). A reviewer who finds "OS home" surviving in the diagram and says "nit" is not doing the job. But also, REJECT over a one-word diagram label when 24 laws folded correctly... The verdict rule is explicit though: "REJECT if any BLOCK remains (unenforceable Trust, identity lie, or P0 not landable)". Is a single internal label an "identity lie"? The identity lie in v1 was calling the overlay the product home in the capability/marketing sense. The diagram says "OS home" — capability-wise the doc everywhere says capture shell. I'll classify it as MAJOR (documentation-level identity residue), and the aggregate as: no unenforceable Trust (S21 ACL gap is specifiable at spike), no standing identity lie in law text (one stray label to delete), P0 landable. 

  Hmm, let me also double-check §5.5 more carefully: "召唤器可以为本机用户提供同一 MinimalConfirm，但仍是 N5 的一个观察者，不是第二个 writer。" Combined with P1 "Overlay MinimalConfirm 接入 N5" — this is the v2 deliberately leaving P1 open for overlay confirm display as N5 observer. But S6 says "召唤器只显示徽章/深链，不渲染 Allow/Deny" without phase qualification. And §13 says N2 不改. If P1 renders MinimalConfirm on overlay, N2 ("MinimalConfirm stays Panel-only") is amended — the brief should say so. This is a real inconsistency worth MAJOR.

  Let me settle: findings = 0 BLOCK, 4 MAJOR (OS home label; §5.5/P1 vs S6/N2; 9.5.28 vs S24; S21 ACL enforcement key unspecified given S17), 2-3 NITs ("v1" product-vs-draft terminology collision; S19 error-string token caution already mostly covered; composer.lease frames OPEN acknowledged).

  With 0 BLOCK and foldable MAJORs... the strict reading "APPROVE_WITH_NITS = foldable nits only" vs my MAJORs. I can downgrade: are these MAJORs "foldable nits"? They're each one-line amendments. The repo convention allowed external review to downgrade MAJOR→NIT. But honest severity: the MinimalConfirm/N2 tension is a roadmap contradiction that needs an explicit AMEND marker, not just a typo. Still foldable without re-litigation.

  Alternative: REJECT. Let me reconsider the "OS home" once more. The prompt's job list item 1: "Does v2 still call the overlay a product home in any remaining sentence?" — clearly they suspect it might. It does: §3 diagram "(OS home, L0+search)". If I answer yes and then APPROVE, is that coherent? APPROVE_WITH_NITS with a mandatory one-word fix is coherent if I classify it NIT/MAJOR rather than BLOCK. The verdict definitions: REJECT if any BLOCK remains. I genuinely don't think a stray diagram label — contradicted by S2, §0, §2, §13, and the capability declaration — constitutes a surviving identity-lie BLOCK; the identity law is enforceable and clear. The label is a fold defect. I'll go APPROVE_WITH_NITS with explicit required folds (listing the MAJORs as must-fix-before-spike-plan nits). Hmm, but "must fix before spike plan" + APPROVE_WITH_NITS... the gate in §15: "三路 APPROVE* 才允许 spike 计划". APPROVE_WITH_NITS counts as APPROVE* and nits are non-blocking. If I require fixes before spike plan, that's REJECT-ish. To stay consistent with the framework: APPROVE_WITH_NITS lists non-blocking nits. My findings: are they non-blocking? The diagram label — blocking? If the spike plan author reads the diagram and writes "OS home" into UI copy... S2 forbids it, so no. Non-blocking but should fix. OK.

  Actually, let me reconsider whether any finding is a true BLOCK one more time:

  Trust enforceability: S21 ACL — server-side, enforceable IF connection class is distinguishable. S17 says same origin. Without a distinguishing mechanism specified, the ACL as literally written ("chat.* 可走 tray-origin WS，但服务器 ACL 只允许...") could be read as applying to ALL tray-origin WS — which would break existing tray functions (skill.list etc. — wait, would it? The allowlist: chat.create/abort, thread.list/select/create, history.query. Tray today uses thread.list ✓, skill.list ✗ (not in allowlist!), system.ping ✗, pairing ✗, openSidePanel/activate ✗). If ACL applies per-origin, the tray breaks — the brief can't intend that. So the ACL must apply to overlay connections specifically, requiring a distinction the brief doesn't specify. Under-specification of a Trust mechanism = potentially "unenforceable Trust"? It's enforceable in principle (add client-class to handshake); the brief just doesn't say it. Synthesis §6.4 explicitly invited external review to attack this. My judgment: MAJOR — spike plan must define the ACL key (e.g. auth.handshake client_class="summoner" declared + server allowlist per class). Not BLOCK because the fix is additive and the threat model residual is acknowledged. 

  P0 landable: yes.

  So final: no BLOCKs → not REJECT. Between APPROVE and APPROVE_WITH_NITS: I have real findings → APPROVE_WITH_NITS.

  Now S1–S24 stances where I disagree:
  - S6: AMEND — add phase qualifier: P0 badge/deep-link only; any P1 overlay confirm surface = explicit N2 amendment.
  - S21: AMEND — specify ACL enforcement key (declared client class in auth handshake; not Origin alone), and clarify tray's existing broader method set is unaffected.
  - S24: LOCK, but §9.5.28 must be reconciled (AMEND the edge-case text, not the law).
  - S2: LOCK (law text correct; fix §3 diagram label).
  - S10: OPEN stands (agree with v2).
  - S17: AMEND lightly — allow an in-handshake client-class discriminator while keeping single origin.
  - Others: LOCK.

  Also S12 vs §7 body search: NIT, clarify "P0 不搜正文；product v1 可笨" consistent — fine as NIT.

  Residual before spike plan:
  1. Delete/relabel "OS home" in §3 diagram.
  2. Reconcile §5.5 + P1 overlay MinimalConfirm with S6/N2 (either drop or mark N2-amend).
  3. Reconcile §9.5.28 with S24 freeze (change = experiment line only until P0 passes).
  4. S21: define ACL key (client class), confirm tray's existing methods unaffected; add skill.list/system.ping etc. to tray-class allowlist or scope ACL to summoner class.
  5. composer.lease frame fields (already OPEN) — minimal fields before ADR.
  6. "v1" terminology collision (product v1 vs brief v1) — rename to "P0+1" or "GA v1".
  7. BROWSER_UNAVAILABLE error string must avoid classifyError recoverable tokens — §10 covers; add unit test name.

  Scoring:
  - Outcome: spike without lying — achievable after the four doc folds; P0 criteria observable and landable.
  - Trajectory: genuine fold. All four lanes' BLOCKs trace to S19–S24 / §5.1 / §11; code claims verified accurate (lifecycle.ts:256-266, 796; tool-forward.ts:20, 316-321; security.ts:950-976; adapter.ts:1446-1476; platform.ts:142-151).
  - Component: S19/S20/S21/S22/S23 land on the right files (server.ts createToolExecutor, tool-forward, lifecycle, swift-tray-bridge); S6/N2 tension is the one misaligned component.

  Write the review concisely in Chinese? The user wrote in English mostly with Chinese docs. The prompt is English; repo docs are Chinese. The user's language: the request is in English. I'll write in English with Chinese quotes where citing. Mixed is fine — keep English structure, quote Chinese原文.

  Output format: findings BLOCK/MAJOR/NIT with citations; S1–S24 stances only where disagree; residual; verdict line.

• All key code claims verified. I have enough to write the review — here it is.

  ---

  # External review — OS Agent Shell brief v2 (Kimi lane)

  ## Code cross-check results (all brief claims I tested hold)

  - `pickAuthenticatedClientWs` is extension-only and serves **only** the outbound runner — `companion/src/ws/lifecycle.ts:256-266`, wired at `:287`. The S42 comment at `:253` itself records "tray authenticates but does NOT handle tool.execute — was 15s timeout residual". Brief §1 table is accurate.
  - Chat loop binds executor to the **originating** socket: `lifecycle.ts:796` `createToolExecutor(ws)`; terminal forward sends `tool.execute` to that same `ws` with `TOOL_EXECUTION_TIMEOUT_MS = 15000` (`tool-forward.ts:20,335-340`). Tray-origin chat → L1 today = 15s English timeout, exactly as §5.3 claims.
  - `classifyError` maps "timeout"/"disconnected" → `recoverable` (`security.ts:950-976`), and the adapter feeds recoverable errors back to the LLM for retry (`adapter.ts:1459-1476`). The X8 fold (typed non-recoverable `BROWSER_*`) is against real behavior.
  - `openSidePanel()` only activates Chrome; comment admits the panel cannot be opened programmatically (`platform.ts:142-151`). macOS target is literally `tell application "Google Chrome"` (`platform.ts:131`). CTA honesty requirements are grounded.
  - Outbound path fast-fails with `EXTENSION_UNAVAILABLE` when no extension peer (`lifecycle.ts:269-301`) — confirms the brief's claim that v1 mis-pasted that error onto the chat path.
  - Tray today: `thread.list` over WS (`tray/companion-client.ts:226`), 5s default RPC timeout (`:324` — brief's "不得 5s RPC 死等" is a real constraint), privileged stdin `respond()` (`swift-tray-bridge.ts:67`), origin allowlist includes `cmspark-tray://local` (`lifecycle.ts:206`). Origin fencing exists only for voice/meeting handlers (`stt-handlers.ts:140`, `meeting-handlers.ts:94`) — the X6 claim "tray origin 鉴权后几乎无方法 ACL" is accurate for `chat.*`.
  - N1–N10 lock and ADR-022 L8/L9 read as the brief represents them.

  ## Findings

  **BLOCK: none.**

  **MAJOR-1 — §3 diagram still says "OS home".** The product-model ASCII labels the overlay `(OS home, L0+search)` (brief line 109). This is the exact identity the v1 BLOCK (P-B1/X3) killed and that §0 规范用语 + S2 forbid ("禁止把召唤器叫「家/主界面」"). Every law sentence is clean; the diagram — the most quotable artifact in the doc — is not. One-word fold, but it must happen before this doc parents a spike plan. Answers review question 1: yes, one sentence survived.

  **MAJOR-2 — §5.5 + P1 vs S6/N2 contradiction on overlay MinimalConfirm.** S6 locks "召唤器只显示徽章/深链，不渲染 Allow/Deny" and §13 locks "N2 不改 (MinimalConfirm Panel-only)". But §5.5 says "召唤器可以为本机用户提供同一 MinimalConfirm" and §11 P1 lists "Overlay MinimalConfirm 接入 N5". A rendered MinimalConfirm on the overlay *is* an Allow/Deny surface and *does* amend N2's Panel-only rule (N2 lock, `companion-native-hud-n1n10-lock-2026-07-27.md` N2: "MinimalConfirm stays Panel-only"). v2 must either drop the P1 bullet or mark it explicitly "N2 AMEND at P1". Answers review question 4: no P0 overlay Allow — good — but the P1 roadmap silently re-opens N2.

  **MAJOR-3 — §9.5.28 vs S24 GOAL freeze.** Edge-case 28 says "接受本 brief 后必须改 GOAL / architecture §0，否则文档分裂". S24 + §0 lock the opposite: one-liner frozen until P0 falsification passes, at most an "实验：菜单栏召唤" annotation. As written, accepting the brief triggers a docs split either way. Fold: amend 28 to "接受本 brief 后 GOAL/architecture 必须加实验行；一句话定位 P2 再改". Answers review question 7: the freeze itself is right (prevents narrative split pre-evidence); the edge-case text contradicts it.

  **MAJOR-4 — S21 ACL enforcement key unspecified, collides with S17.** S17 forbids a new origin (overlay shares `cmspark-tray://local`); S21's allowlist (`chat.create/abort`, `thread.list/select/create`, `history.query`) is narrower than what the tray client already legitimately calls (`skill.list`, `system.ping`, pairing, activate — `companion-client.ts`). If the ACL keys on Origin, it either breaks the tray or is unenforceable for the overlay. The synthesis §6.4 explicitly asked external review to attack this hybrid. It does **not** recreate the WS superuser (it's a restriction, and the HMAC same-user residual is honestly acknowledged in §8), but the spike plan must define the discriminator — e.g. a declared `client_class: "summoner"` in `auth.handshake`, ACL keyed on class, tray class keep its existing method set. Without that line, S21 is aspirational. Answers review question 3.

  **NIT-1 — "v1" terminology collision.** §5.4, §6, §7, S17 use "v1" to mean *product v1*; the whole document's drama is *brief v1 vs v2*. In §7 ("消息正文…v1 可笨") this reads like it contradicts S12 ("P0 不搜消息正文"). Rename product-v1 to "GA" or "P0+1".

  **NIT-2 — S19 error-string token hygiene.** §10 already forbids `BROWSER_*` hitting `classifyError` recoverable branches; make it testable: the `BROWSER_UNAVAILABLE` message must not contain any token in `security.ts:950-1019` ("timeout", "disconnected", "not found", "unavailable" is safe today but the list grows). One unit test name in the spike plan suffices.

  **NIT-3 — `composer.lease` frames.** Acknowledged OPEN (§14); fine for brief stage, must be minimal-fields-complete before the ADR, as synthesis §6.2 says.

  ## Review questions, answered

  1. **Overlay still called home?** Yes — once, §3 diagram "OS home" (MAJOR-1). Nowhere else.
  2. **S19 sufficient vs `createToolExecutor(originatingWs)`?** Sufficient as law. The executor closure also uses the originating ws for MCP session cache and confirm `originWs` binding; S19 correctly scopes itself to the actuator path, and S6's "禁止解绑非 outbound 的 originWs" covers the rest. LOCK.
  3. **S21 hybrid → superuser?** No, but enforcement key unspecified (MAJOR-4).
  4. **S6 vs N2 remaining overlay Allow?** None in P0; P1 roadmap contradicts "N2 不改" (MAJOR-2).
  5. **P0 falsification still theater?** No. Observable gates (≥6/8 no-Chrome completion, `history.db` zero auto-L1, IME 5/5, dual-surface single-composer) and real kill criteria (≥50% self-open Chrome, ≥3/8 "不像对话"). The C-M7 fold (IME = product gate, not strategic gate) is correctly applied. Not theater.
  6. **S10 OPEN acceptable?** Yes. One SHA256 gate / one binary is LOCK; process model is precisely what the spike exists to resolve, with the IME gate as the falsifier. Shipping the P0 spike with S10 process OPEN is correct.
  7. **ADR-020 copy freeze?** Right call — see MAJOR-3 for the one contradicting sentence.
  8. **Unamended v1 sentences contradicting v2 laws?** The three in MAJOR-1/2/3. No others found.

  ## S1–S24 stances (only where I disagree with v2's implicit LOCK)

  - **S6 — AMEND**: add phase qualifier "P0 徽章/深链 only；任何 overlay 确认面 = 显式 N2 AMEND at P1" (fold MAJOR-2).
  - **S17 — AMEND (light)**: keep single origin, but permit an in-handshake client-class discriminator (fold MAJOR-4).
  - **S21 — AMEND**: specify ACL keyed on declared client class, not Origin; state tray's existing method set is unaffected (fold MAJOR-4).
  - **S2 — LOCK** (law text correct; the violation is the §3 diagram, MAJOR-1).
  - **S10 — OPEN** stands. **S24 — LOCK** (fix §9.5.28 text, not the law).
  - All others (S1, S3–S5, S7–S9, S11–S16, S18–S20, S22, S23): **LOCK**.

  ## ADR-020 checklist

  Axes fit (Surface L0 capture, Composition index-only, single autonomy, same SHA256 trust, community channel) — yes. Pack-first not violated (S8 control cap). No new confirm dialect (S6) — with the MAJOR-2 caveat. Trust monotonicity untouched; S13 keeps god-mode/auto_approve away from the opener. originWs binding explicitly preserved. No new runtime (S1). Capability declaration present and matches the fold.

  ## Scores

  - **Outcome**: P0 is landable and falsifiable without lying — after the four folds above. The technical claims the brief makes about today's code are all true (verified above).
  - **Trajectory**: genuine fold, not adversary-ignore. X1–X9 each trace to a named law or section (S19/S20/S21/S22/S23/S24, §5.1 binary states, §11 observable gates); the fold log is accurate against the synthesis.
  - **Component**: S19 lands on the right seam (`createToolExecutor` actuator split); S21 lands on the right seam but missing its key; S6/N2 is the one misaligned component (P1 roadmap).

  ## Residual before spike plan

  1. Delete "OS home" from §3 diagram.
  2. Reconcile §5.5 + P1 MinimalConfirm bullet with S6/"N2 不改" (drop or mark N2-AMEND).
  3. Amend §9.5.28 to match the S24 freeze (experiment line only, one-liner at P2).
  4. S21: define client-class discriminator + tray-class method set.
  5. `composer.lease` minimal frame fields (already OPEN).
  6. Rename product-"v1" usages; add `BROWSER_UNAVAILABLE` token-hygiene unit test.

  All six are one-to-few-line folds; none requires re-architecture or re-litigation of the locked identity.

  VERDICT: APPROVE_WITH_NITS

To resume this session: kimi -r session_b407a5f6-2938-4704-b92c-2422d101656c
