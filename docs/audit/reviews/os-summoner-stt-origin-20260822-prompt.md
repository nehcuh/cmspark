# Dual review — summoner surface local STT origin (ADR-023 narrow amend)

READ-ONLY. Inspect the worktree code. Do not edit.

## Capability

```
Surface: L0 overlay (macOS summoner); STT is composition on L0, not L2
L2-classes: none
Compose: local whisper STT only
Trust: origin gate — chrome-extension OR (cmspark-tray://local AND surface=summoner)
Channel: community
```

## What changed

`voice.stt.*` was extension-only. Overlay v2 adds press-hold mic. Gate is now:
- chrome-extension:// allowed
- cmspark-tray://local AND handshake surface===summoner allowed
- tray surface without summoner still origin_denied
- voice.model.* still extension-only
- privacy_ack_v2 still required (mic press counts as gesture)

Hunt:
1. Can cmspark-tray://local with surface=tray run STT? Must NO.
2. Can client spoof surface=summoner on a tray connection? Handshake stamps server-side from auth message — check overwrite.
3. ACL vs handler: denied tools vs origin_denied double gate.
4. Audio/base64 logging.
5. God-mode / auto_approve skipping privacy ack.

VERDICT must be last line: APPROVE | APPROVE_WITH_NITS | REJECT
