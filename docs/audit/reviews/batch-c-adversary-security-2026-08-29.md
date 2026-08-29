# Batch C lane — security

**LANE:** security  
**VERDICT:** PASS_WITH_CHANGES  
**HEAD:** e36176a5 · #247 strawman

See synthesis: `batch-c-adversary-synthesis-2026-08-29.md`

BLOCK (folded into spec):
- C1 preview honesty / HMAC vs execute / no last-cache / no substring / 规范 URL = full Chrome tab URL
- C2 do not wholesale USER_ENV_DENYLIST; loader keys + DYLD_* prefix; preview keys never values
- C3 deny on parsed argv in policy gate; parse-null not fail-open; keep attached forms
- C5 bind + apply allow/deny/intent; sort JSON; HARD_DENY stays

KEEP: evaluate/osascript default L2; AppleScript JS-in-tab only; worker HARD_DENY; Darwin dual opt-in clone for C4; issueTokenFor/validateTokenFor pair.

NEVER: SUMMONER_ALLOW / overlay Allow/Deny / #228; split message-router; Batch D/E; live config; do shell script; NODE_ENV as Win allow path.
