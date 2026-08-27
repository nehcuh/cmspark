# Independent adversary — ChatShell 同一张脸 spec (#239)

You did **not** write this spec. Do not rubber-stamp. Read the files. Design dual (no code diff yet).

## Blast
**T2** L0 聊天壳视觉/IA. 无新 L2. overlay ACL 不得涨.

```text
Surface:      ChatShell 共用；钉住=侧栏；弹出=悬浮 Capture；托盘打开同一张脸
L2-classes:   none
Compose:      建议芯片 = 模板填作曲；不新增知识/MCP/Pack 协议
Autonomy:     none
Trust:        overlay 永不 Allow/Deny；F-I-4 Companion 不 sidePanel.open
Channel:      community
```

## Read (required)
1. `docs/superpowers/specs/2026-08-27-chat-shell-same-face-design.md`
2. `docs/design/chat-shell-same-face-wireframes.html`
3. GitHub issue context is #239
4. Must not weaken: `docs/superpowers/specs/2026-08-26-product-form-deepening-design.md` (overlay 无 Allow/Deny, F-I-4, HUD 五轨冻结)
5. `companion/src/ws/summoner-acl.ts` — current overlay allowlist
6. `companion/src/summoner/client.ts` — copy contract (`展开对话`, `打开确认台`, `SUMMONER_ATTACH_FOOTNOTE`)
7. `chrome-extension/src/sidepanel/empty-state-copy.ts` — slice 5 empty
8. `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Claimed design
- One thin ChatShell across sidebar / float / tray
- Greeting + current-tab chip `正在看：` + 3 template chips + composer
- Assembly / Allow-Deny / MCP add stay out of the face
- Engine (Chrome window vs OS HUD) NOT locked this ticket
- No tab-strip pill; no Gemini "sharing tab"

## External DoD (spec)
1. Same empty/greeting/composer/topbar contract on docked + float + tray-open
2. Page chip copy is `正在看：` never `分享`
3. No page → no chip, no 3 suggestions
4. Overlay still no Allow/Deny
5. Companion still cannot `sidePanel.open`
6. Engine not smuggled as "done"

## Job
Your lane is in the spawn prompt. Score outcome / trajectory / component. Cite file:line. Tag [inspected]/[assumed].
Fold blockers vs nits.

Final line exactly:
VERDICT: APPROVE
or VERDICT: APPROVE_WITH_NITS
or VERDICT: REJECT
