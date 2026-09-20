# 子任务身份 · 设计简报（讨论稿）

> 不是实现。落地须先开 GitHub Issue（Issue-first）。父票 #502 E Glance/Inspect 已锁透视档，**没锁** ThreadList 把 worker 当平级对话。

## 现状（代码）

- `spawn_worker` 创建真正的 ADR-015 **thread**。这是机制，UI 不能假装它们不存在。
- ThreadList `renderThreadRow` 对所有 thread 一视同仁；`roleBadge` 只贴英文 `worker` / `orch`。
- 清理扫描 `include_workers: false`，说明产品已经知道 worker **不是**普通历史对话。
- Glance / FleetWorkerListPortal / Inspect（不切线程）/「进入子任务」（切线程）已在 #502 E。
- 进入 worker 后 StatusRail 标题 = `displayThreadTitle`（常是短 id / alias），没有「属于哪次主任务」。
- Overlay 不做确认；禁止新 BottomBar Tab；禁止 vis 大屏进 320px。

## 产品句

子任务是主对话下面的执行切片，不是新开的一摞平级对话。

人默认看的是主任务的答案。要盯一只手，从 Glance 看；要钻进去，才切线程，且必须能一眼回到主任务。

## 推荐方向（方案 A）

**ThreadList / 最近对话默认不列出 `agent_role=worker`。**

- 有子任务的主对话行右侧安静标注 `3 子任务`（活着可用点；点开已有 Fleet portal，不新开 Tab）。
- 主对话打开时 Glance 仍是 SoT（#502 E）。Inspect 继续不抢主 transcript。
- 「进入子任务」保留，但是 **降级路径**：StatusRail 变成面包屑  
  `← 主任务` + 标题 `子任务 · 论文精读`。composer 仍按现有 worker 限制。
- 搜索：worker 可出现，但必须写成 `子任务 · 属于「……」`，不得看起来像独立聊天。
- 完成后：主行变成 `3 子任务 · 已完成`；仍不把三只 worker 摊进最近对话。

## 不选

- **方案 B 缩进树**：320px 最近对话里再嵌三行，和 Glance 重复，密度打穿 #497 对话优先。
- **方案 C 新「舰队」Tab**：#502 E NEVER。
- Observatory / 蜂群动画 / overlay 确认。

## 约束

```text
Surface:      Side Panel ThreadList + StatusRail + 已有 Fleet portal
L2-classes:   none
Compose:      Fleet 仍是 ADR-015 threads（不改存储）
Autonomy:     不改 spawn / L2 / arm
Trust:        Inspect 仍不转发 stdout_tail
Channel:      community
```

## 请 kimi / claude 裁决

1. 方案 A 是否正确（默认隐藏 worker 行）？若否，给可在 320px 成立的替代。
2. 「进入子任务」是否保留？还是只允许 Inspect（不切线程）？
3. 已完成的 worker 线程是否允许从搜索进入？标题怎么写？
4. 有没有 BLOCK：误藏 orchestrator、误藏用户手动打开过的 worker、与 #497 宽屏导航冲突。

VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT 方案 A
