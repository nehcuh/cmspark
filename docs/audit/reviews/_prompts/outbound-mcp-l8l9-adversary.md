# Independent adversary review — Outbound MCP L8 + L9

You are an **independent adversarial reviewer**, NOT the implementer.  
Inspect real code with Read/Grep/Bash. Do not rubber-stamp.

## Capability declaration (ADR-020)

```text
Surface:      L1 (outbound curated)
L2-classes:   (none via outbound default)
Compose:      outbound-mcp-server (ADR-022 L8/L9)
Autonomy:     single (dual-entry with Side Panel)
Trust:        domain + L2 confirm; tray/fan-out; tab lease dual-entry; Side Panel wins
Channel:      community
```

## Scope (focus)

Primary commit: `6d5790f` (L8/L9). Related: `companion/src/outbound-mcp/dual-entry.ts`, `companion-http.ts`, `server.ts` confirm fan-out + side_panel_wins, tests `outbound-mcp-dual-entry*`, `outbound-mcp-companion-http*`, `outbound-mcp-http-e2e*`.

Also verify integration with earlier P0c bridge (HTTP invoke, disclosure) is not regressed.

## DoD to attack

### L8 — Confirm without Side Panel focus

| Claim | Attack |
|-------|--------|
| Confirm fans out to all authenticated WS | Still only one socket? Unauth peers? |
| origin unbound for outbound (any auth peer may respond) | Weaker than originWs — is this acceptable? Abuse by second paired client? |
| Tray preferred with `[Outbound]` label | Host_computer/nonce still origin-bound when NOT outbound? |
| OS notify best-effort | Fail-closed if no tray? |
| Timeout → `OUTBOUND_CONFIRM_REQUIRED` | False positives on other errors containing "timeout"? |

### L9 — Dual-entry tab lease

| Claim | Attack |
|-------|--------|
| Interactive tools require tabId | list_tabs exempt? Bypass via string tabId? |
| Holder `outbound_mcp:<caller>` | Cap collision with max_tabs_leased_per_worker? |
| Side Panel holds tab → MCP blocked with queue_disclosure | Can MCP force-release Side Panel? |
| Side Panel tool on outbound-held tab → force-release (Side Panel wins) | Does outbound still thrash mid-tool? Pending CDP? |
| Double-acquire avoided for outbound in multi path | Skip multi lease only when isOutboundMcpCall? |

## Three layers

1. **Outcome** — ADR-022 L8/L9 letter met?  
2. **Trajectory** — L2 export? Grant skip? Cookie tools?  
3. **Component** — file:line for every finding  

## Non-goals (do not REJECT solely for these)

- Live human bake-off not run  
- P1 per-caller grant not done  
- Linux tray may be no-op (documented fail-closed + notify)  

## Output

1. Executive summary  
2. Blockers (file:line) if any  
3. Nits (file:line)  
4. Residual bake-off risks  
5. Final line exactly one of:

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```
