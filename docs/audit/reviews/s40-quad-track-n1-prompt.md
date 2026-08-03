# Pi node review — S40 Track 1+3+4+2 (N1)

## Scope

AFK quad-track on branch `feat/s40-quad-track-ux-skill-shell-mcp`:

1. **ST-4 FocusBand** active tools + **DL-4** download conflict hints + skill_install path hints  
2. **skill_install** LLM tool → `~/.cmspark-agent/skills`  
3. **shell_exec P1b** `tryParseSimpleArgv` + `shell:false` when safe  
4. **Outbound MCP Phase 0** spike plan + profile/facade gate (no full WS bridge)

## DoD (must verify)

- FocusBand priority: Confirm > L2 > Fleet > thread_tools > L1; secondaryTools height-safe  
- skill_install cannot write outside user skills (engine dest); no new Side Panel entry  
- shell argv: metachar / $VAR / glob → null; spawn_mode reported  
- outbound: forbid shell/cookies/host; exfil tools need disclosure  

## Ask

Inspect real code under chrome-extension/src/sidepanel and companion/src/{capability,skills,outbound-mcp,server}.  
Reject if security regression or incomplete claims.

End with exactly one VERDICT line.
