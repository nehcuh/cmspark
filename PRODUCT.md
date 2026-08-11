# CMspark — Product Context (Impeccable)

> Written 2026-08-11 for design harnesses. Product truth for Side Panel redesign.
> Version lock: companion/extension **0.5.0**.

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

- **Wanted:** quiet confidence, precise, local-tool seriousness, indigo “spark” not purple SaaS glow  
- **Avoid:** Inter-purple gradient cards, nested card cages, emoji toolbar chrome, Material status dots, noisy multi-strip status landfill  
- **Identity:** Mode ontology (聊/网页/计算机), 装配 vs 确认台, Quiet Premium tokens  

## Constraints (non-negotiable)

- ADR-020 axes; Pack-first for scenarios  
- Confirm / 急停 never buried under decorative chrome  
- Chat stream density budget: idle ≥55% / worst ≥40% @640px  
- No new L2 tools from a “redesign” PR  
- Chinese product chrome; emoji only in message content  

## Success for this redesign

A first-time power user opens the panel and immediately sees: **where am I (mode/connection), what can I type, what is running** — without scanning three competing status strips and a glassmorphism toy composer.
