# CMspark — Product Context (Impeccable)

> Written 2026-08-11 for design harnesses. **Refreshed 2026-08-26**: home is logged-in Chrome + hard gates, not the Side Panel.  
> Version lock: companion/extension **0.5.3**.  
> Remaining work is GitHub Issues: [#228](https://github.com/nehcuh/cmspark/issues/228) T1 bake-off · [#229](https://github.com/nehcuh/cmspark/issues/229) summoner P2 · [#230](https://github.com/nehcuh/cmspark/issues/230) residuals. New requirement designs **must** open an Issue first.
> Form SoT: [docs/superpowers/specs/2026-08-26-product-form-deepening-design.md](docs/superpowers/specs/2026-08-26-product-form-deepening-design.md)

## One sentence

**CMspark** is the local **logged-in Chrome hand**: summon with a hotkey, operate the browser you already have open and signed into, confirm danger on the 确认台, and let Codex (or any coding agent) **rent that same hand** through Outbound MCP. Home is **logged-in Chrome + hard gates** — not the Side Panel.

副句：侧栏是人盯着 Chrome 时的操作面。人在别的 Agent 里时，操作在后台进行，确认台才出来。不是第二套 Codex，也不是给每家 AI 再装一只扩展。

## Audience & scene

| Who | Scene |
|-----|--------|
| Primary | Builders who live in Chrome **or** in a coding agent and need the **already-logged-in** browser |
| Frequency | Daily / multi-hour sessions; many threads; parallel workers |
| Constraint | Chinese-first chrome; local Companion; Side Panel is ~320px **when the human is watching the page** — it is not the only door |

## Jobs

1. **Capture** — hotkey, say it, attach, steer; dialogue can grow in the summoner  
2. **Operate** — do the work on logged-in pages (Side Panel if watching; background CDP if not)  
3. **Confirm** — danger stops at 确认台 / tray; overlay never Allow/Deny  
4. **Rent the hand（租手）** — Codex / Claude Code / Grok rent the same Chrome (curated L1, `cmg_` grant). Not ACP 编程接力.

## Surfaces

| Surface | Mode | Notes |
|---------|------|--------|
| 召唤器 | **Capture** | Mac hotkey still collapsed bar (旧壳; expand = **展开对话**, not a five-rail workbench). Win/Linux HTML float = same ChatShell copy, whole face, **no** page chip. Entry = toolbar C, **not** a tab-strip pill. Never claim CMspark sits beside the tab bar. |
| Side Panel | **Operate** | ChatShell empty: **要对这页做什么** / **当前页：** / 3 template chips. Top bar **弹出对话框** opens the HTML float. 装配 stays outside the shell. Watching Chrome; ~320px. |
| Background CDP | **Operate** | When the human is in summoner or a coding agent; extension must be connected |
| 确认台 / Cockpit + Mac tray | **Confirm** | Allow/Deny lives here. Overlay never. Win/Linux: open Chrome 确认台, never skip |
| Outbound MCP | **租手** | They → our Chrome. Tools `cmspark__*` · grant `cmg_`. Experimental, not default-on |
| Thread graph tab | Explore | Full-page; already shipped separately |

ACP 编程接力 is the **reverse** door (we → their coding agent). Do not call it 租手.

## Brand / anti-references

- **Visual world (2026-08-18):** Consumer AI assistant **canon**. Quality bar = **知乎看山**, executed at full fidelity — no irony, no smuggled instrument chrome, no 条漫 overlay.  
- **Wanted:** character presence on empty, large conversational greeting, sentence-length invitation rows, quiet rounded composer, obvious new-chat, soft elevated surface  
- **Avoid:** Precision Instrument gray admin (11px pills, 15px empty title, status landfill), Inter-purple SaaS glow, copying 看山’s fox, decorative chrome that crowds the 320px stream  
- **Avoid (2026-08-26):** summoner as WorkBuddy five-rail workbench; 租手 as “that's just MCP, not the product”; copy that says 去侧栏批准; competing as Chrome Gemini (Connected Apps, per-tab native assistant)  
- **Identity:** Mode ontology (聊/网页/计算机) and 装配 / 确认台 / 急停 stay. Presentation is companion-grade, not instrument-grade. Character is original CMspark presence, not a 看山 clone.  
- **Cockpit:** same world at night — still companion craft, still a confirm stage, never a second design system.

## Constraints (non-negotiable)

- ADR-020 axes; Pack-first for scenarios  
- Confirm / 急停 never buried under decorative chrome  
- Chat stream density budget: idle ≥55% / worst ≥40% @640px  
- No new L2 tools from a “redesign” PR  
- Chinese product chrome; emoji only in message content  
- Overlay never Allow/Deny; no second Chrome extension; grant `cmg_` ≠ `ws_secret`  
- Companion never `chrome.sidePanel.open` (F-I-4)

## Success

A first-time user hits the hotkey and can talk. When work needs the page, the **already-logged-in Chrome** moves, and danger lands on 确认台 — not on the floating window. A Codex user can rent that hand without being told CMspark is “not our product.” Side Panel empty still **meets someone** and can type; pretty that cannot fit the task is a failed canon.
