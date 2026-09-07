---
name: development-trace-guide
description: 研发关联的带来源材料流程与缺项处理
type: prompt_template
---

# 研发关联

1. 确认用户希望处理的对象与环境，使用 `development_trace.v1` 创建草稿；创建参数只是候选，不是事实证明。
2. 首次创建会锁定当前会话的 `pilot-contract.json` 快照。配置由试点负责人维护，模型不能自行授权、改来源绑定或扩大范围。未配置仍可存草稿，但不能判齐备。
3. 通过已有网页读取工具获取材料，保存返回的 `observation_id`。只使用当前会话的成功读取；截图、粘贴 URL、用户报告或外部助手成功消息不自动成为已核实事实。
4. `draft_read` 返回字段类型与必需关系。标量提交 `value/citations`；集合提交唯一成员数组、含 `member_index` 的成员引用及 `coverage_citations`。摘录必须精确，码点 start/end 为 NFC 和换行规范化后的半开区间。不能从 non-prod 截出 prod。
5. 登记范围完整且来源明确表示为空时才提交 `[]`。截断/分页/虚拟化未知不能证明全部；静态范围声明需要真实试点验证。缺值用 null，保留缺项。
6. `draft_update` 使用最近 revision 和新的 request_id；失败后读取最新状态再决定是否修改。响应丢失重试须保留原 request_id 及全部参数，禁止伪造核实状态。
7. 需要审阅代码时，在代码平台打开 unified/raw diff 页面，使用 `get_page_text` 采集，再用 `code_review_create` 引用实际差异并指定仓库和完整 base/head SHA。此路径不依赖外部 Agent；普通 split view 尚未适配，不编造增删行。`code_review_read` 返回来源、代码行与未证明的覆盖范围，不能据此声称评审完成。
8. 创建审阅时用 `business_context` 选择真实需求/开发任务/测试观察，用 `materials` 锁定草稿编号和版本。基于网页的评语用 `code_review_assess` 保存，不冒充外部 Agent；如需外部 Agent，由用户点击工具结果旁的终端入口确认后自行操作并回传。
9. 调用 `draft_render` 输出基础材料；已关联代码审阅时最后使用 `code_review_render` 输出补充 Markdown/JSON 和合并缺项。版本、环境、引用关系或业务时间有冲突时不自行猜测解决。

## 研发关联必需材料

- requirement：需求 ID、revision 和完整验收标准原文集合。
- story：单独 story_draft_text 是创作文字，明确标“故事草稿”；story.requirement_id/acceptance_criteria 仍引用真实需求来源，不能声称已在平台创建。
- code：代码平台 repository、commit、requirement 引用；PR 可选，但提供时需引用对应 head commit。用户本地写码可以继续使用原编辑器，不要求安装终端 Agent。
- tests：用例集合、需求/commit、run、outcome、源更新时间及标准到用例的映射。只有试点 pass_values 中的结果才满足材料齐备条件。
- defects：状态、完整缺陷 ID 集合、需求引用。没有找到缺陷不能推断“无缺陷”。
- tests.criteria_mapping 成员使用 JSON.stringify([criterionId, caseId]) 的标准编码。先核实需求和标准，再用 draft_read 返回的 criteria_catalog 取得 criterionId，不需要终端或模型计算 hash。它是本地派生 ID；引用必须支持完整标准原文与用例 ID，不能要求网页出现本地 hash。没有可用目录时保留映射缺项。
- story_requirement、criteria_cases 由核对器推导，不能通过 relations 提交。其余关系需要锁定来源绑定或已有人工映射。

资料齐备和测试通过不代表研发完成。CMspark 负责跨平台信息关联及回到网页核实，不冒充已经开发、提交或发布代码。
