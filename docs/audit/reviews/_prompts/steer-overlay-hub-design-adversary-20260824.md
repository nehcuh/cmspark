# Design adversary — steer/nextRun UI + overlay L0 hub

You are an INDEPENDENT reviewer, not the author. Do not rubber-stamp.
Repo: /Users/huchen/Projects/cmspark
Spec: docs/superpowers/specs/2026-08-24-steer-nextrun-overlay-hub-design.md
READ live code the spec cites. Design-only: no production edits.

## Capability (claimed)

```
Surface:      L0
L2-classes:   none — overlay not Allow/Deny
Compose:      pack.apply overlay allowTrust:false
Autonomy:     existing steer/nextRun
Trust:        monotonic — overlay MUST NOT write Trust B
Channel:      summoner ACL +pack.list +pack.apply; mcp.add denied
```

## DoD (external)

PR1: busy Enter = chat.steer not supersede; queue/Shift+Enter = enqueue; idle = chat.create; Stop = abort.
PR2: overlay left rail threads + mcp.list + eligible pack apply without Trust write; ineligible gray.

## Hunt

- Trust B via overlay despite allowTrust:false (user_gesture, allowTrust client lie, spawn path)
- overlay-eligible heuristic false-positive (empty whitelist pentest pack)
- busy-state SoT wrong (SET_THREAD_BUSY vs abortControllers vs lease)
- Shift+Enter vs newline collision in InputArea
- steer as chat.user confusing pairing
- pack.apply mid-run + tool_whitelist changing live tools
- Swift 200pt rail vs capture-window size / Windows no-op honesty

Write report to the path given in your task prompt.
End with exactly:
VERDICT: APPROVE
or
VERDICT: APPROVE_WITH_NITS
or
VERDICT: REJECT
