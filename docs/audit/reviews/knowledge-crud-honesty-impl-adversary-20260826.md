# Independent adversary — Knowledge CRUD Honesty Wave 3 impl

> 2026-08-26 · explore subagent · VERDICT after fold recorded below

## Initial VERDICT: REJECT

### BLOCKs (must fold)

1. README Wave 3 copy used 双链/图谱 even as negation (`README.md` 导入节).
2. `updateKnowledge` set `data.name = ident` where `ident = id || name` — destroys legacy name when `id !== name`.
3. Router `handleKnowledgeCrud` / `knowledge.delete` did not re-check `user_gesture` (validate-only).

Nits listed in session (delete name fallback, save confirm, byte vs char cap, double get) — fold cheap ones with BLOCKs.

## After fold

1. README 改为「注入用的背景资料」——diff 用户可见 copy 无 图谱/双链。
2. `updateKnowledge` 写 `data.name = skill.name`、`data.id = ident`；测 `updateKnowledge keeps legacy name when id differs`。
3. `handleKnowledgeCrud` / `knowledge.delete` 再校验 `user_gesture`；测 router 无手势报错。
4. get 截断改 `Buffer.byteLength`；保存加 `confirm()`；去掉 ContextPanelHost 二次 get；delete 不再接受 name。

Machine: knowledge-crud + files.test 87 pass.

Folded VERDICT for dual: treat as **APPROVE_WITH_NITS** remaining: list ··· 下载无 512KiB disable；无扩展 delete payload 单测；sheet 未复用 Modal 组件。
