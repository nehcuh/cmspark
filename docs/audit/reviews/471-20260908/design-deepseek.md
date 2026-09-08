**元说明（skill hook 协调）**：本包本身即该 dispatch skill 骨架所产出的"已派发 READ-ONLY 评审 prompt"（`You are an independent … READ-ONLY … + scope` + 狩猎要求），且明确禁止工具与子代理。故不再嵌套派发，改为在单响应内按通道收敛执行同一验收清单（分级 findings、写明 scope、零修改）。无工具调用、未越包读取任何代码；全部结论基于本包文本，标 `[inspected]`。

**Scope**：Issue #471 设计包（召唤器/设置重设计 spec + W1 SettingsSection 壳），Base `4fd4919b`。评审轴：正确性 / a11y / 信任 / 完整性。

---END 元说明---

## VERDICT: **APPROVE_WITH_NITS** · 最高严重度 **MAJOR**（0 BLOCK）

设计本身自洽、范围纪律好（保留 id/协议/状态/确认边界、双独立复审、CI 绿才合入、无发布安装）。所有发现均为"收敛前需要钉死"的完整性/可达性项，无设计性缺陷。

---

## Findings by lane

### CORRECTNESS / 完整性

- **C1 · MAJOR** — 旧深链→新分类映射表未完整成文。`integrations` 只能靠"权限/集成控件保留于安全与信任"推断、`export` 靠"显示为文件与知识"推断；"旧深链继续可用"是硬需求，但没有显式 id 清单+映射（含 `voice` 新增、`export` 是保留 id 还是别名）。不钉死就无法实现、更无法写"旧深链"验证。[inspected]
- **C2 · MAJOR** — "保存/测试只一处常驻"与"各表单已有各自保存处理或统一保存"的衔接未定稿：常驻按钮是聚合保存全部挂载页还是仅当前页？立即生效项目自带按钮是否构成第二处？若理解错，"原有控件保存时机保持"会被破坏。实现前需一句话裁定。[inspected]
- **C3 · NIT** — "模型页仅含模型/视觉/推理预算"意味着有控件迁出，但去处未列（实验/输入语音？），缺迁移清单。
- **C4 · NIT** — `userOpenSections` "formerly persisted"：废弃后旧持久化键的忽略/迁移未写（琐碎，但收敛时写明）。
- **C5 · NIT** — 山 的清除只测了"隔离传输"路径。应加资产路径/文件名 grep 覆盖构建产物、其他嵌入面（如独立设置网页自身），防止残留面。[inspected]

### A11Y

- **A1 · MAJOR**（完整性）— spec 自身把"键盘 DOM 顺序与视觉一致、废除 CSS order"列为硬需求，但验证清单零键盘/焦点项，浅色主题也无对比度检查。需求没有可执行的验收钩子。至少补一行键盘走查 + WCAG 对比度抽查。[inspected]
- **A2 · NIT** — SettingsSection 头按钮缺 `aria-controls`/id 关联；`display:none` + `aria-hidden` 叠加冗余但无害、无焦点陷阱（display:none 已使后代不可聚焦）。
- **A3 · NIT** — 该壳若保留：`forceHint` 用 `tokens.warning` 在新浅色底上的对比度需实测；切分类后焦点落点（tab 是否落在当前页内容）需走查一次。

### SECURITY / TRUST

- **S1 · MAJOR** —（有条件缓解）单页可见模型下挂起确认的**可交互可达性**：keep-mounted 保证"权限确认短语"状态不丢，但状态不丢 ≠ 用户能答复。需写明待确认弹层是否全局渲染（若沿 A4 全局弹窗则风险已闭），否则 armed/挂起确认 + 切分类场景下用户要在 45s 超时内回安全页。徽标承诺部分覆盖，验证清单缺"armed + 切页"一条。[inspected，基于本包条款"]
- **S2 · NIT** — "配对/高权限状态跨分类可见"：需确认窄屏 compact selector 形态下徽标同样渲染（不被选择器控件吞掉）。
- **S3 · 附注（非 finding）** — 保留全部协议/状态/确认边界 + `data-settings-section` 定位钩子 + 双独立复审（Grok4.6/DeepSeekV4Pro）+ 无发布安装，信任门是完整的。

### PRODUCT-UX / ARCHITECTURE

- **P1 · NIT** — 次要动作（会议/打开浏览器）只定了层级未定排布（次要行 vs 溢出）；320px + 无横向溢出的验证已部分覆盖，补一张 320 实拍验收即可。
- **P2 · NIT** — "不替换成其他大图标"是产品断言，验证只查"山不恢复"，未查"无替换大图标"；空态视觉验收补一条。
- **R1 · NIT** — 双导航（宽左导航 / 窄 compact）共用单一 `activeCategory`，深链直达与两处入口要互相同步；"open set"语义应收敛为单选当前页，避免旧 open-set 语义残留。
- **R2 · NIT** — 8 页全挂载的内存/渲染成本可控但不在任何验证项里；生产构建性能快照瞄一眼即可收口。

---

## 收敛要求（合并前）

1. 落一张 **id 映射表**（model/connection/security/integrations/secrets/experimental/export/voice → 8 分类），作为"旧深链继续可用"的实现与测试依据（C1）；
2. 一句话裁定**常驻保存按钮的语义**（C2）；
3. 写明**挂起确认的渲染面**并加"armed + 切页"验证（S1）；
4. 验证清单补 **键盘走查 + 浅色对比度**（A1）。

四项都是文档级收口，不改动设计骨架。按此收敛后再过双路独立复审，预期可过。

*(全程 [inspected]，未执行任何工具，工作树未动。)*
