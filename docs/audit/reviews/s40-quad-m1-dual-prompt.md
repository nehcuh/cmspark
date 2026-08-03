# Dual-review M1 — S40 Quad Track

## Scope

Complete AFK delivery of four tracks on `feat/s40-quad-track-ux-skill-shell-mcp`:

1. ST-4 FocusBand + DL-4 conflicts + skill_install hints  
2. skill_install LLM tool → user skills root  
3. shell_exec P1b argv (win32 only .exe/.com; Pi N1→N1c fixed .bat EINVAL)  
4. Outbound MCP Phase 0 spike plan + profile/facade  

## Prior gates

- Pi N1 REJECT (win32 argv regression)  
- Pi N1b REJECT (bat/cmd still argv)  
- Pi N1c **APPROVE_WITH_NITS** (`s40-quad-n1c-verdict-pi-20260803-233113.json`)

## Review focus

Security regressions, incomplete DoD, win32 shell spawn, outbound profile holes, tests.

VERDICT must be APPROVE | APPROVE_WITH_NITS | REJECT.
