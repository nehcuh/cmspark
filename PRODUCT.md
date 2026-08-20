# CMspark — Product Context (Impeccable)

> Written 2026-08-11 for design harnesses. Product truth for Side Panel redesign.
> Version lock: companion/extension **0.5.2**.

## One sentence

**CMspark** is a **local browser AI agent** you drive from a Chrome Side Panel: chat, operate tabs via CDP, and opt into computer/host power — with hard trust gates, not a cloud SaaS chatbot toy.

## Audience & scene

| Who | Scene |
|-----|--------|
| Primary | Power users / builders who live in Chrome and want an agent that **does work** on pages and (opt-in) the desktop |
| Frequency | Daily / multi-hour sessions; many threads; parallel workers |
| Constraint | **~320px** Side Panel; Chinese-first chrome; connection to local Companion required |

## Jobs (Operate)

1. **Talk & act** — send goals, watch tools, stop/confirm safely  
2. **Know status** — mode L0/L1/L2, connection, busy, fleet, confirms at a glance  
3. **Assemble** — skills / packs / MCP / knowledge without burying chat  
4. **Recover** — reconnect, empty states, errors with next step  

## Surfaces

| Surface | Mode | Notes |
|---------|------|--------|
| Side Panel | **Operate** | Default product home; redesign focus |
| Cockpit | Operate (elevated L2) | Dark safety / confirm; keep grammar, not in Phase 1 shell |
| Thread graph tab | Explore | Full-page; already shipped separately |

## Brand / anti-references

- **Visual world (2026-08-18):** Consumer AI assistant **canon**. Quality bar = **知乎看山**, executed at full fidelity — no irony, no smuggled instrument chrome, no 条漫 overlay.  
- **Wanted:** character presence on empty, large conversational greeting, sentence-length invitation rows, quiet rounded composer, obvious new-chat, soft elevated surface  
- **Avoid:** Precision Instrument gray admin (11px pills, 15px empty title, status landfill), Inter-purple SaaS glow, copying 看山’s fox, decorative chrome that crowds the 320px stream  
- **Identity:** Mode ontology (聊/网页/计算机) and 装配 / 确认台 / 急停 stay. Presentation is companion-grade, not instrument-grade. Character is original CMspark presence, not a 看山 clone.  
- **Cockpit:** same world at night — still companion craft, still a confirm stage, never a second design system.

## Constraints (non-negotiable)

- ADR-020 axes; Pack-first for scenarios  
- Confirm / 急停 never buried under decorative chrome  
- Chat stream density budget: idle ≥55% / worst ≥40% @640px  
- No new L2 tools from a “redesign” PR  
- Chinese product chrome; emoji only in message content  

## Success for this redesign

A first-time user opens the panel and **meets someone**, sees they can type, and can start. When work starts, the same 320px column still holds the stream, tool frames, and 确认 / 急停 — pretty that cannot fit the task is a failed canon.
