# Verdict: Site-knowledge hostname auto-load fix

**Date:** 2026-07-28  
**Reviewers:** Claude + Pi (local CLI)  
**Plan:** `site-knowledge-hostname-fix-plan-2026-07-28.md`

## Dual-review consensus

| Reviewer | Verdict |
|----------|---------|
| Claude | **APPROVE-WITH-AMENDS** |
| Pi | **APPROVE-WITH-AMENDS** |

### Required amends (both)

1. **Mandatory** companion-side hostname case normalization (RFC 4343)
2. Pass **only `hostname`** (not full `url`) on the wire
3. **No** pinned-tab fallback
4. Include **`file.upload`** path (Claude L4)
5. Validator type-check optional `hostname` string

### Applied in implementation

- Extension: `getActiveTabHostname()` → `chat.create` / `regenerate` / `file.upload` / quickAction
- Companion: `normalizeChatHostname` + `matchSite`/`normalizeHostname` case-insensitive
- `file.upload` now resolves skill + knowledge IDs like chat
- Validators on chat.create, chat.regenerate, file.upload
- Tests: site-matcher case-insensitivity; hostnameFromTabUrl pure helper

## Implementation status

**Done.** Companion rebuilt and restarted. Reload Chrome extension to pick up background SW changes.
