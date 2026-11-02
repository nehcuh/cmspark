# 设计 C 独立复审（实施前审批）

## 六个 probe 证据核验

| 证据 | 核验结论 | 对最终 C 的支撑 |
|---|---|---|
| BASELINE_SOURCE_ONLY_REFRESH | 属实：config 不变、rev 7→8、旧 guard 拒绝、0 发写 | 复现核心支持路径缺陷，坐实点1隔离需求 |
| CANDIDATE_FRESH_STATE | 属实：用最新 revision 8 提交、后台成功 | 证明链路终点（父组件用新 revision→后台接受）。注意：probe 以注入 controller.snapshot **模拟** fresh read，真实读取代码属实施 DoD，不是本证据已覆盖 |
| CANDIDATE_NO_REFRESH | 属实：缓存 rev7 vs 后台 8 → REVISION_CONFLICT | 证明"仅换 guard"不足，坐实点2 fresh read 必要性 |
| CANDIDATE_CONFIG_CHANGED | 属实：真实 configure 改 interval → 指纹变、0 发写 | 指纹能发现真实配置变化 |
| CANDIDATE_MODEL_KEY_CHANGED | 属实：公开 config 不变、target id 变、拒绝 | 证明指纹**必须含 model_target_ids**（遮蔽后 key 不进 config），组合充分 |
| CANDIDATE_POST_READ_RACE | 属实：读后写前再增来源 → REVISION_CONFLICT、无误报成功 | 后台 expected_revision 原子校验保持，点3后端语义成立 |

两个 false coverage 输出按最终窄口径裁定：
- `ocrMainChangeDetected=false`：按点5属**已明确接受的 legacy 边界**（OCR 目标固定 `ocr`、沿用"当前配置主模型"授权语义），本设计不承诺检测、不修改。验收不得声称已覆盖/已修复。非 blocker。
- `standaloneVisionAuthChangeDetected=false`：这是**真实可达缺口**——standalone vision 的 auth_style/extra_headers/anthropic_version 等被 `resolveVisionLlmConfig` 实际使用但未进 hash，换鉴权后旧 `image_ai_consent` 仍有效。点6/7已在设计层正确覆盖（真实继承条件 + `inherited?.field ?? standalone` 优先级）；当前仍未实施，必须列入 M4 DoD。非本门 blocker。

## 两个最小改动与校准流程关系

- **指纹 guard** 直接消除核心路径：5s 预览等待 + 画框 + 标题 OCR 期间 3s 采集推进共享 revision → 保存被拒（证据1+3对照）。校准草稿存于编辑器 useState，快照刷新不重置，与现有 ChatScopeEditor 的 version/abort 生命周期无冲突。
- **fresh read** 与校准无耦合：`activity.state` 不占用 service `pending`、不触发 fence，校准 BUSY 语义不受影响；校准结果只进草稿、保存时随 patch 提交。
- **图片 auth hash** 只影响 `hasActivityImageConsent` 授权有效性，不触碰校准几何；实施后需覆盖"校准保存后鉴权变化→指纹经 model_target_ids 发现→要求重开/重授权"路径。

## 模块裁定

**M1 基线与来源更新隔离 — APPROVE**
DoD：仓库化测试——打开编辑器→真实 `service.addSource`×N→刷新 props→apps/interval/chat_scopes/画框矩形/已识别标题全保留、无"设置已变化"、指纹仍等于新快照 `[config, model_target_ids]`；win32 分支含已添加 profile 的草稿保留。

**M2 fresh read→onSave第三参→parent→backend 链 — APPROVE**
DoD：提交触发恰好一次 activity.state（计数断言）；onSave 第三参 === 该回执 revision；父 payload.expected_revision === 第三参（非轮询 snapshot.revision）；无交错写时真实代码保存成功（CANDIDATE_FRESH_STATE 的真实版）；父回调缺第三参时 fail-fast 而非回落缓存值（防回归断言，对应设计自警"不能只改子组件"）。

**M3 submit/busy/cancel/unmount/late-read/peer 隔离 — APPROVE**
DoD：读失败/超时/abort → 0 次 configure、草稿保留、显示错误；unmount（收起）或 `thread.mutation.connection` 丢失后晚到读不触发 onSave；双击提交至多 1 次 configure（writing.current/peer 兜底已存在，须断言）；REVISION_CONFLICT → 编辑器保持打开、chat_scopes 完好、无自动重试、无成功 notice。

**M4 图片 auth 有效继承优先级、hash、旧授权失效 — APPROVE**
DoD（真实 model-config 对照 resolveVisionLlmConfig 矩阵）：
- standalone（未继承）：auth_style/client_header_profile/claude_code_compat_version/extra_headers/anthropic_version 任一变化 → id 变 → 旧 `image_ai_consent` 失效。
- use_main_auth + endpointsMatch + 同协议：main 变→id 变；被继承覆盖的 standalone 同字段变→id 不变。
- use_main_auth + endpoint/协议不匹配：main auth 变→id 不变（修正现网误绑）；该 cohort 会一次性重授权，需在回归与发布说明确认。
- 全部 auth 字段缺省的老配置：新旧 hash 相同，不发生大规模授权失效。
- extra_headers 排序稳定序列化；OCR 主模型变化仍断言 id='ocr'（不扩大承诺）。

**M5 证据核验与回归门 — APPROVE**
DoD：六场景从 /tmp 固化为仓库回归（保留源码标记断言防探针漂移）；追加 fresh read 失败不提交、M4 auth 矩阵、真实 Windows 构建上"3s 采集进行中完成 5s 预览+双矩形校准→保存成功或如实冲突"；后续任何改 hash 输入或父 onSave 签名的 PR 必须重跑该套件。

## 三层检查

- **outcome**：草稿/校准保留、保存用新鲜 revision、冲突如实不误报、鉴权变化使旧图片授权失效——方向均有证据或明确设计覆盖。
- **trajectory**：读→比→写每步受 AbortSignal/liveness/peer 约束，后端原子校验为最后防线（证据6）。
- **component**：子 guard + 父回调签名 + hash 公式三处最小改动；无新 config_revision/迁移/队列/前端真实 Key，符合限定。

## Blocker

无。未发现新的"具体可达触发→支持路径→验收实际影响"缺口；两个 false coverage 分别归入已接受 legacy 边界与设计已覆盖/实施待验证项。

## Nits（不阻塞）

1. extra_headers 键序稳定序列化，避免同内容键序漂移引发多余重授权（失效方向安全，故仅 nit）。
2. use_main_auth + 端点/协议不匹配 cohort 的一次性重授权需显式回归与说明。
3. fresh read 进行中禁用提交按钮（并发写已有 writing.current 兜底，避免重复读）。
4. 父回调对缺失第三参 fail-fast。
5. 探针场景入库，不留在 /tmp。

VERDICT: APPROVE_WITH_NITS
