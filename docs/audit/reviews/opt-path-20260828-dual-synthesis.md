# Dual re-review synthesis — 0.5.3 优化路径 #245

Spec: `docs/superpowers/specs/2026-08-28-post-diagnosis-opt-path.md`  
四路: `docs/audit/reviews/opt-path-adversary-synthesis-2026-08-28.md` → **PASS_WITH_CHANGES**  
Claude: `docs/audit/reviews/opt-path-20260828-claude-20260828-195010.md` → **APPROVE_WITH_NITS**  
Kimi: `docs/audit/reviews/opt-path-20260828-kimi-clean.md` → **APPROVE_WITH_NITS**  
`both_ok=true`。nits 已折进 spec。

## 共同结论

路径可实现。四条打回条件都已在 spec 钉死：不改 `SUMMONER_ALLOW`、禁止 `abortThreadChat(lease.thread_id)`、XSS 不是 encodeURI、不能 A1 单独宣称 Capture 闭合。

## 已折 nits

| 来源 | nit | 折法 |
|------|-----|------|
| Claude | A3 绑定点含糊 | 闸在 router overlay 分支；可动 payload policy，不动 ALLOW |
| Claude+Kimi | A2 owner / IPC 未命名 | overlay chat.create 必须 stamp owner；tray `handleSummonerClosed` 经 companionClient abort |
| Claude | `style-src 'unsafe-inline'` | DOM 建链分支可留；禁因此留拼接 href + script-src unsafe-inline |
| Kimi | overlay-md 并无 encodeURI | 改写 spot-check |
| Kimi | skylight socket 是必填 arg | B2：Node 传同一 DATA_DIR path；flag 默认 `/tmp` 另迁 |

无 BLOCK。无漏检 High 级路径谎。

## 实现闸

写码另开 PR，`Refs #245`。A = 一张 PR 三个 commit。实现 agent 不得自评放行。
