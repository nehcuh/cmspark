# Pi review — PR #114 merge gate

## Context

PR https://github.com/nehcuh/cmspark/pull/114 branch `feat/s40-quad-track-ux-skill-shell-mcp` → main.

Scope (all commits on PR):
1. ST-4 FocusBand active tools + DL-4 download conflicts
2. skill_install (COMPANION_TOOLS + Downloads/tmp/data allowlist)
3. shell_exec P1b argv (win32 only .exe/.com)
4. Outbound MCP Phase0 facade + spike plan
5. downloads_find broad-search fallback for GitHub zips
6. npm audit fix high (mcp-sdk / fast-uri / ip-address)

## Prior gates

- Pi N1/N1b REJECT → N1c APPROVE_WITH_NITS
- Dual M1/M1b REJECT → Pi M1c APPROVE_WITH_NITS
- CI must be green before this review is used for merge

## Ask

Inspect real code + tests. Reject if:
- security regression (skill_install FS scope, shell win32 EINVAL, outbound profile holes)
- dead tool routing
- build break
- incomplete DoD for the four tracks

Nits OK under APPROVE_WITH_NITS.

End with exactly one VERDICT line: APPROVE | APPROVE_WITH_NITS | REJECT.
