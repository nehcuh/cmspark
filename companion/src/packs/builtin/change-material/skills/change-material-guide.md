---
name: change-material-guide
description: 变更材料的带来源材料流程与缺项处理
type: prompt_template
---

# 变更材料

1. 确认用户希望处理的对象与环境，使用 `change_material.v1` 创建草稿；创建参数只是候选，不是事实证明。
2. 首次创建会锁定当前会话的 `pilot-contract.json` 快照。配置由试点负责人维护，模型不能自行授权、改来源绑定或扩大范围。未配置仍可存草稿，但不能判齐备。
3. 通过已有网页读取工具获取材料，保存返回的 `observation_id`。只使用当前会话的成功读取；截图、粘贴 URL、用户报告或外部助手成功消息不自动成为已核实事实。
4. `draft_read` 返回字段类型与必需关系。标量提交 `value/citations`；集合提交唯一成员数组、含 `member_index` 的成员引用及 `coverage_citations`。摘录必须精确，码点 start/end 为 NFC 和换行规范化后的半开区间。不能从 non-prod 截出 prod。
5. 登记范围完整且来源明确表示为空时才提交 `[]`。截断/分页/虚拟化未知不能证明全部；静态范围声明需要真实试点验证。缺值用 null，保留缺项。
6. `draft_update` 使用最近 revision 和新的 request_id；失败后读取最新状态再决定是否修改。响应丢失重试须保留原 request_id 及全部参数，禁止伪造核实状态。
7. 需要审阅代码时，在代码平台打开 unified/raw diff 页面，使用 `get_page_text` 采集，再用 `code_review_create` 引用实际差异并指定仓库和完整 base/head SHA。此路径不依赖外部 Agent；普通 split view 尚未适配，不编造增删行。`code_review_read` 返回来源、代码行与未证明的覆盖范围，不能据此声称评审完成。
8. 创建审阅时用 `business_context` 选择真实需求/开发任务/测试观察，用 `materials` 锁定草稿编号和版本。基于网页的评语用 `code_review_assess` 保存，不冒充外部 Agent；如需外部 Agent，由用户点击工具结果旁的终端入口确认后自行操作并回传。
9. 调用 `draft_render` 输出基础材料；已关联代码审阅时最后使用 `code_review_render` 输出补充 Markdown/JSON 和合并缺项。版本、环境、引用关系或业务时间有冲突时不自行猜测解决。

## 变更必需材料

- target：目标业务系统及环境的网页证据。
- release：DevOps 发布 ID、版本、commit、build；引用应同时含当前发布/版本和构建对应关系。
- artifact：制品 ID、版本、digest、build；build 必须与 release 一致。
- architecture：系统 ID、revision、完整依赖集合、精确影响说明。架构系统@revision 是本地派生身份。
- runtime：CMDB 系统、环境、完整资产集合和源业务更新时间。采集时刻不能代替业务更新时间；默认运行态时效 15 分钟。
- release_artifact、architecture_target、runtime_target：锁定来源绑定支持双方身份，或引用已有人工映射。模型不能新建 mapping_id 或用布尔确认。

运行态未采集就是缺失。仅锁定试点契约明确允许不适用且未提交运行态材料时，核对器可显示带理由的不适用；不得填 N/A 绕过。材料不等于变更申请已提交。
