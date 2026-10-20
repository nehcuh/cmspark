# 网页代码审阅与终端报告回传

关联 #464 / #465 / #466 / #467。当前是开发切片，未通过真实企业平台和
两个首发业务场景验收，不代表 0.7.0 已发布。

## 从网页开始（无需安装编程 Agent）

1. 在当前 CMspark 对话准备变更材料或研发追溯草稿。先确认仓库地址、实际
   比较基线和目标提交。使用完整 40/64 位小写 SHA；PR 三点比较应使用实际
   merge-base 作为基线，不直接把分支当前值当成基线。
2. 在已登录代码平台打开 unified/raw diff 页面，让 CMspark 使用
   `get_page_text` 读取。当前适配 Git unified text diff 的普通文本文件增删改，
   以及带完整变更 hunks、明确且未加引号的文本重命名（保留旧/新路径）。
   纯重命名、copy、带引号路径、二进制、combined diff 仍不支持；split view、
   折叠/分页/虚拟化页面也尚未获得平台适配和全量覆盖证明。即使解析成功，
   网页比较语义和全量覆盖仍未核实。解析失败会明确返回错误，不能用代码链接代替差异。
   开发版本另有 GitHub 完整 40 位 SHA 双点 compare 的有限观察候选。仅当
   实际页面读取返回可用的完整比较观察时，可用 `comparison_observation_id`
   代替 `diff` 引用（两者互斥）；服务端重新核对仓库、两端 SHA 和清单。
   折叠、加载、过滤、缺失 hunk、未知布局均不能标完整。该候选须通过
   真实浏览器验收；源码/离线 DOM 检查不构成交付，整体审阅仍未就绪。

3. 用 `code_review_create` 引用同一次网页观察中的实际 diff，指定仓库、base、
   head，并选择需求、真实开发任务、测试的观察引用（`business_context`）。
   如需材料补充输出，一并指定已稳定的草稿编号和版本（`materials`）。
   网页观察必须未经过文本改写；旧观察未记录该状态时需重新读取。
4. `code_review_read` 返回文件、旧/新行号、规范化差异哈希和来源。CMspark 可
   用这些内容作分析，再用 `code_review_assess` 保存自己的评语。该评语会
   标为 CMspark 判断，不会伪装成外部 Agent 运行回执。
5. 用 `code_review_render` 输出所绑定材料的 Markdown 与 JSON：原字段检查、
   代码事实、实际任务引用、两种评语和所有未核实项分别显示。

差异哈希基于保存的 NFC/LF 文本，不是 Git object hash。有效 hunk 只能证明
所引用片段语法成立，不能证明网站已加载所有文件；当前通用适配始终保留
覆盖和比较语义未核实，不能据此自动批准发布。

## 使用本机编程 Agent（可选）

1. 在设置中启用内嵌终端。当前支持 macOS / Windows（#584），同一时间一个 PTY。
2. 在 `code_review_create` / `code_review_read` 工具结果旁点击
   **在终端审阅并回传**。确认窗口展示原任务绑定的仓库与 base/head。
3. 在终端自行运行已经安装的 Agent。终端加载用户登录 shell，可使用用户
   PATH、shell 配置和已有 Agent 登录状态；它是完整用户 shell，不是只读沙箱。
   初始子进程环境排除 CMspark 内部配对/控制凭据；环境变量表不发给扩展，
   但 shell 或用户打印的内容会显示在终端中。
4. 复制界面上的提示词，粘贴到 Agent 的输入框，**不要粘贴到 shell 命令行**。
   CMspark 不会自动运行 Agent，也不会另起一个隐藏的 ACP 进程。
5. 将 Agent 返回的 JSON 粘贴到报告框，检查完整内容后发送。服务端先校验
   形状、身份、代码位置和所选业务引用，再请求导入确认，确认后复核并保存。
   成功回执写回原对话，即使用户已切换到别的对话，重新打开原对话仍可查询。

也可以不采集网页而创建 Agent-only 审阅范围；此时 diff hash 为空，报告里的
所有代码位置均未独立核实。退出码、终端滚屏、失败或取消都不会产生评审报告。
关闭终端标签页或连接断开会结束 PTY，需要重新确认打开；持久化报告仍保留。

通用 ACP 编程接力的 handback 与此处确认导入的代码评审报告不同。Agent 非零退出时，
会话、handback、原任务保存标题和进度均保留部分输出状态，不以“完成”掩盖失败；
这类文字回传本身不会生成代码评审回执，也不证明引用、覆盖或业务匹配已核实。

## 报告和材料的边界

选定 `business_context` 后，评语若遗漏其中任何完整引用（kind、external_id、citation、可选 commit_id），会保留 `CODE_REPORT_CONTEXT_REFERENCES_MISSING` 缺项；同类或重复映射不能补齐另一个引用。部分评语仍可接收，原 status/未核实标记不变；清单齐全也不证明语义匹配、真实 Agent 运行或业务验收，`review_ready` / `combined_ready` 不因此变为 true。

- 每任务一份 CMspark 评语和一份可选外部报告；同内容重试返回同一结果。
  不同内容不能覆盖旧结论，需要新建审阅任务。
- 新采集、base/head 变化需要新审阅任务。绑定草稿被修改、测试提交不匹配、
  引用过期或缺少真实任务/验收覆盖时，补充材料继续列出缺项。
- 导入确认只代表用户同意保存外部判断，不证明 Agent 执行、测试通过、需求
  覆盖或发布批准。需求/任务/测试 ID 的文本存在，也不等于其业务关系已证明。
- 报告需保持界面模板中的身份信息。`findings` 使用 `severity`、`summary`、
  `path`、`side: old|new`、正数 `line`；文件级无行号意见暂不支持。
  `mappings` 只能评估创建任务时选定的引用，不能临时换成另一个任务。
- 单次请求/报告上限 64 KiB，每对话 16 个审阅任务，总存储上限 2 MiB。
  达到容量不会清除旧证据；新建对话并重新采集后继续。过大提示词会明确说明
  已省略上下文，不截一半 JSON 冒充完整报告。

真实企业代码页面适配、具体 Agent 的交互兼容以及两个首发场景仍由
#450 / #452 / #454 / #455 / #457 跟踪。此切片不修改现有 outbound MCP 权限范围。

GitHub typed comparison 只支持可核对的已展开 unified DOM：代码单元格必须仅含直接代码标记与排版空白，标记内仅展开文本与普通语法高亮 span，空行允许单独 BR；额外可见兄弟节点或未知包装不能标完整；混合 BR、未知/隐藏子结构、隐藏表格或行均保留未知。比较身份节点必须在 diff 子树之外，不能由代码内容中的唯一同名节点形成身份。此处 DOM/文件控制不代替真实浏览器验收，`review_ready` 仍为 false。

表格行仅跳过原 `thead.sr-only` 下固定三列辅助标题；changed/context 行必须是原 old/new/code 三个直接 TD，hunk（含末尾空 expander）必须是原 colspan=2 的行号 expander 与 hunk 两个直接 TD。未知行、混合非 TD 或同一行额外未知 TD 不生成完整比较观察，不能在材料中沿用 complete 覆盖。原 expander 的辅助链接不作为代码，合法代码高亮与单独 BR 空行仍按原规则读取。

本叶真实浏览器证据：PR711 head `6b1f52a5` / run `39189613843` 已完成上述固定公开 GitHub 双点比较的真实 Chromium 11 case；该11 case结果只覆盖当时的旧 producer；本次新增表格行 guard 改变了 producer 字节，目前仅有受控 CPU 验证，不能由旧浏览器证据覆盖，精确新 head/main CI 待验收。后续 head `093de278` 的独立托管启动/清理失败保留为 UNKNOWN，并未改写为通过；其测试专用接线不随本产品叶合入。产品新 head 与合后 main 仍须通过现有全部 CI，#464 整票仍为 Partial。


## GitHub 发布页的当前观测关系（#464，开发中）

仅支持固定英文 GitHub 发布头与单段 ASCII tag（`[A-Za-z0-9_][A-Za-z0-9_.-]*`），不支持含斜杠或 URL 编码的 tag。`get_page_html` 对唯一完整发布元数据行（固定 selector `.Box-body div.d-flex.flex-row.flex-wrap.color-fg-muted.flex-items-end`）可附带 `github_tagged_release.v1`。它仅声明当前采集页的仓库、tag、完整 commit；受原 target、sanitizer 和64KiB预算限制。数字 release.id 不在 header，不能猜；材料仅接受原 scalar 引用真正支持的 tag/确切 URL，以及同 tag/version、同 review.head、同 Observation 的精确引用和当前材料 revision。

匹配只显示 `observed_platform_relation`，同时保留 `RELEASE_BUILD_ARTIFACT_AUTHENTICITY_NOT_VERIFIED`；不会满足 release_artifact、清除其他资料缺项或把 review_ready/combined_ready 改为 true。旧普通页面/Agent 声明仍 unknown。原始HTTP fixture+受控CPU链不是真实浏览器验收，本叶也不能关闭 whole #464。
