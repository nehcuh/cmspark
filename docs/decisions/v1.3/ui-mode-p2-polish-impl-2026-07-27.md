# UI Mode P2 Polish Implementation

| Field | Value |
|-------|--------|
| Date | 2026-07-27 |
| Status | Implemented (primary surfaces) |
| Spec | three-mode redesign §6 P2 + adversarial final P2 |

## Delivered

1. **Semantic tokens expanded** (`tokens.ts`)
   - `darkWarning` / `darkWarningBg` / `darkSuccess`
   - chat bubble tokens, `transitionFast` / `transition`
   - helpers: `riskColor`, `riskColorDark`, `riskLabel`, `statusColor`
   - Acceptance helpers tested in `tests/tokens-helpers.test.ts`

2. **ChatView polish**
   - User/assistant bubbles, tool cards, markdown CSS → tokens
   - Mode-aware empty state (L0 welcome / L1 web / L2 computer)
   - Processing labels without emoji chrome
   - Tool status geometry (✓ / ! / …) not emoji

3. **Composer capsule**
   - Attach + textarea + send in one rounded surface
   - File chips / errors use tokens

4. **MinimalConfirm**
   - Risk colors via `riskColorDark` + `darkWarning` queue hint

5. **Cockpit**
   - Root/title/live badge/abort use dark tokens
   - Close while LIVE → confirm dialog (task continues)

6. **a11y / motion**
   - `prefers-reduced-motion` in sidepanel globalCSS
   - ModeBadge already `aria-live="polite"`

7. **BottomBar** high-traffic history/skill colors → tokens

## Explicit deferred (monotone debt)

Still Material-heavy: SettingsSlideout, AppsPanel, McpPanel, KnowledgeSubPanel, NotebooklmImporter, SkillCraftPanel, ComputerTaskBar (unmounted). Migrate next passes — do not reintroduce hex on primary path.

## Verify

```bash
npm --prefix chrome-extension test
```

## Accept mapping

| Spec P2 | Status |
|---------|--------|
| L1 expand never auto from step count | Held (P1 ContextStrip user-only) |
| New components use tokens | ContextStrip / MinimalConfirm / Chat empty / composer |
| Reduced-motion / AA | prefers-reduced-motion; risk labels with color |
