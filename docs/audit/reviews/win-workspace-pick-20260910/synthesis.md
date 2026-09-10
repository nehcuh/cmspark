# Dual review synthesis — Windows workspace.pick (2026-09-10)

Frozen: `diff.patch` (5 files, HEAD `cd7bf31a`).
Kimi: `dual-kimi.md` **APPROVE_WITH_NITS** (exit 0).
Claude: headless hung three times with empty stdout (stdin 300s SIGTERM; 20KB `-p` argv 90s SIGTERM; short prompt + `--allowedTools Read` 180s SIGTERM). Short `PONG` smoke test succeeded in 12.6s. Same class as S81 Windows `claude -p` hang. Kimi is the completed external lane.

## Kimi MAJOR → verification

| ID | Claim | Verdict |
|----|--------|---------|
| M1 | `pickFolderNativeImpl` not in the diff / might be undefined | **CLOSED** `[inspected]` `message-router.ts:940` `let pickFolderNativeImpl: typeof pickFolderNative = pickFolderNative` + `__testSetPickFolderNative`. Switching `workspace.pick` onto the existing impl is intentional. |
| M2 | `cancelled: true` unhandled by UI | **CLOSED** `[inspected]` `useWebSocket.ts:1478-1491` maps `cancelled` → 「未选择工作区」; `CodingAgentPanel.tsx:369` treats `msg.cancelled` as abort of pending start. |

## NITs

N1–N7 accepted as residual. None block bind/encoding/z-order. POSIX CI vacuity of drive-letter flip (N2) is real but Windows author run covered it.

## Gate

Kimi AWN + M1/M2 independently closed → **land**. Claude artifact appended if the Read-tool retry produces a VERDICT; a hang does not reopen closed findings.
