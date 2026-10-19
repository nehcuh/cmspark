# #464 GitHub 完整双点比较切片：合同候选

状态：root 已批准有限实施；源码待两非作者评审，真实浏览器验收 NOT_RUN。沿用原 Issue #464 / 2026-09-07 spec 的网页独立路径；不建新 Issue，不触及可选 Agent 人工确认 JSON 回传。此合同只补一个有限平台的 comparison 身份和完整变更范围来源，不能关闭 #464 或企业双场景。

## 1. 单一可实施范围

唯一适配器 `github_compare_two_dot.v1`：已获准浏览器 top document 当前显示 `https://github.com/<owner>/<repo>/compare/<base40>..<head40>`，两端不同、完整小写 40hex、同一仓库的直接树比较、unified 视图、1..128 个普通文本增删改文件。只读取当前已加载 DOM；不 fetch、点击展开、滚动、刷新、导航或使用 REST 凭据。三点、PR/MR、fork、分支/tag/缩写、64hex、query/fragment/credentials/非443端口、其他域及页面布局，均继续通用未知或明确不支持，不猜 merge-base。用户可在正常获准浏览器操作中自行打开该明确 URL；本适配器不替用户操作。

第一版不支持 rename/copy/mode-only/binary/image/submodule/quoted 或含歧义路径。通用 raw unified reader 已支持的明确文本 rename 不回退；它仍用原适配器，不能借此新的完整性合同升级。普通 unchanged context 的 Expand Up/Down 不等于隐藏 changed hunks；不得因它们存在而拒绝每个正常 GitHub diff，也不得以它们证明全文件正文。

GitHub 官方说明直接比较提交的双点 URL；官方同时列出 compare/PR diff 的平台截断限制。这里不以 HTTP200、URL、合法 hunk、无可见 warning 任一单项证明完整。只接受下述同次结构、清单、计数和行合同全部成立的窄形状。

## 2. 实际现状与最小必要 seam（明确是新字段）

现 `pageReadSnapshot` 只返回 `content,url`；`readPageText` 得到 body.innerText，经 sanitizer 后交给 `readWithProvenance`；`captureLocalPageResult` 仅在认证 local extension 的 pending result 后入库，拒 multi-call DOM fallback；`EvidenceStore.capture` 白名单固定 scope/channel/frame/truncated 与 unknown coverage。`CodeReviewService.snapshot` 只接受存储中 get_page_text 的 exact citation 并解析统一 diff，身份文字出现不等于 comparison 语义。现 `review_ready=false` 是有意边界，不能删常量造绿。

因此需要有限字段扩展，而非新 authority：

1. **浏览器内部响应**：`PageReadSnapshot` 和 page-read payload 增加可选 `codeComparison`，仅同一同步 snapshot 的固定 GitHub extractor 产生。get_page_text 参数、普通返回 text、sanitizeText 与现 provenance 的所有 target-before/observed/after 校验原样；模型不能提供/选择 selector、URL、清单、complete 或 schema。非匹配页面不产出它。
2. **server-owned Observation 可选 extension**：新增严格 `code_comparison`，只在现 authenticated local capture 边界核验、规范化并保存；它的 canonical SHA 单独存储并重算，不替换旧 content digest。旧 schema1 观察无该字段仍按原 unknown 读取；未知或损坏新 extension 不能提升状态。原普通内容与新 extension 合计仍在既有 64KiB observation 限制内，原4MiB scope、64 observations 不增。
3. **create 选择引用**：仅新增可选 `comparison_observation_id`（现 Observation id 字符串同既有引用边界），与 `diff` 互斥。它只选择当前 server chat scope 中一个已保存 typed capture；不携带平台、URL、路径、SHA 或 readiness。请求 repository/base/head 仍必须与派生结果逐字一致。Agent-only 两者均省略仍允许。现 strict schema 拒绝其他键；普通 diff 引用和旧记录不变。此新 selector 是必要协议增量，须 root 审批，不伪称当前已存在。

本切片不扩展 MCP grant、跨会话观察或普通 router forwarding；网页内容仍不可信数据，扩展 peer 身份不代表网页/仓库代码可信。页面恶意构造的代码不能逃逸固定比较容器去充当导航/TOC元数据。

## 3. 同次 producer 的硬合同

同一个同步顶层 snapshot 采样 location、repository/header 和已插入 files_bucket。身份从 host-controlled compare header/ref selectors/alternate link 与 URL相互核对，不从任何 diff 内容、注释、代码或模型参数获取。必须见唯一 direct-comparison 状态、唯一 base/head ref-selector 的 full SHA 解码值、唯一同 repo 的 text/x-diff alternate 精确匹配双点范围。重名根、引用为 branch、URL变更、root/schema 不识别均拒。

已取得的匿名公开 HTTP 形状仅作候选 selector 校准：`#files_bucket` 初始含 `include-fragment[aria-label="Loading Files"]`，实际 file-list 在 `#diff` 内含 `#toc .toc-diff-stats`、TOC直接列表以及 `#files .js-diff-progressive-container` 的 `.file.js-file[data-tagsearch-path]`；file header `data-path`/anchor、table data-diff-anchor、hunk header/row data-hunk、side `data-line-number` 和 code marker。它们不是 GitHub 保证的 API，所有缺失/冲突要 fail closed，不能模糊找一个近似节点。声称此适配器真实交付前须用实际浏览器 producer 记录确认同一已支持形状；不能照 HTTP 自造已登录 DOM。

完整性同时要求：

- 单一完整 TOC 公布 N files、总 additions/deletions；N为1..128，每项固定 anchor/路径/status 与每文件 +/- 统计唯一。TOC集合、文件容器集合、解析文件集合完全一一对应，不能只比数量。标题/路径不得从模板、comment 或代码子树读取；排除 templates。
- unified 选中明确；无 active file filter、whitespace-ignore、folded/collapsed文件、隐藏变更、加载中/错误/too-large/截断/分页/虚拟化占位或未知动态容器。未知 file status 拒绝。普通未改 context expansion 不计为丢失 changed lines。
- 每文件恰一已支持的文本表、唯一 anchor；文件头 path 与 TOC一致，增删文件的 null side 必须有结构来源，不能依内容猜。第一版 filename 必须通过原 validDiffPath，任何 rename/status unsupported 拒绝整比较，不静默丢一个文件。
- hunk 范围来自结构 hunk header；只读取其直属 code rows 的 exact textContent/marker 与 side line numbers，不读 innerText 自动换行。拒复制按钮/tooltip文字、未知子结构、多义BR、新增/删除双侧都空、非整数/0/重复/逆序/缺行、hunk计数不守恒。普通语法高亮span仅展开文本；无法保真时拒。
- 每文件 additions/deletions 必须精确等于实际 +/- row 计数，全部文件求和还须等于TOC总计。缺一个表/一个hunk/一条变更不得完整；零变化文件、未支持的 warning 或hostlimit状态拒。保留原 parser 对容量、行范围、增删等验证，不新写宽松替代parser。
- snapshot 内身份、TOC/file roots在读取前后必须相同且仍 connected；不允许 snapshot 内 fetch/await。外层现 nav target 检查仍执行；CDP/isolated/main 仅原可捕获通道，dom fallback、truncated、scope非document、threats_removed非空/缺失一律不可完整。

这些规则只证明当前 immutable compare 的 **全部 changed files/hunks**，不证明每个文件的全部 unchanged 正文、Git object 内容签名、外部平台业务关系或 Agent 执行。HTML/DOM可被页面或本机扩展篡改，沿现网页证据信任边界，不引入密码学仓库真实性声明。

## 4. 内部 typed payload 与持久化

成功候选字段（严格对象、无额外键）为 `schema_version:1, adapter:"github_compare_two_dot.v1", repository, base, head, semantics:"two_dot_trees", file_count, additions, deletions, diff_text, manifest`。manifest按页面顺序、每项仅 `old_path:string|null,new_path:string|null,additions,deletions`。整数为 safe非负、file_count1..128；每路径用原8192/validDiffPath；diff_text与整个观察总量遵原64KiB、NFC/LF规范化；manifest/count与解析结果重算一致。不接收 `complete:true` 或未知状态字段。

extractor 将已有表的 hunk+行重建为支持的标准 unified 文本，保留字节前的原网页表示说明；它是 DOM派生表示，不冒原Git raw.diff bytes，哈希仍标为 NFC/LF normalized-observation。服务端再次用原 `parseUnifiedDiff` 核语法并以manifest校验全部路径与计数。sanitizer必须对新 diff/元数据应用与原页面读相同的政策；任何改写/威胁移除使 typed comparison 不可用，不允许经新嵌套字段绕过原政策。旧 body.text不改。

server只保存严格归一化成功extension及canonical SHA；失败返回有限 adapter refusal reason，并保留通用页面读（若原来可保存），不造成功extension。save/read都重验 extension hash/identity/count/parser，不信任磁盘新bool。暂停/取消/plan_readonly、线程不存在、入库超限仍原失败/skip，不产生可引用成功封套。rawDOM、cookies、headers、token、credential、script执行内容不得新增持久化/模型出口。

## 5. Code-review 行为与可见结果

只有 `comparison_observation_id` 指向同 chat 的真实 typed Observation，且 repository/base/head、digest/schema、整manifest/hunk均再次核对成功，snapshot 才返回 `adapter=github_compare_two_dot.v1`、`identity_state=host_comparison_verified`、`coverage=complete`、`comparison_semantics=two_dot_trees`；其来源仍含当前 observed URL/id/time/digest，另有 comparison_digest。去除这一路对应 HOST_COMPARISON_UNVERIFIED/WEB_DIFF_COVERAGE_UNKNOWN/CITED_SPAN_ONLY，保全部业务/材料/报告/来源未独立验证状态。外部文字不能增删这些服务端派生结果。

**本叶仍不改 `review_ready=false` / combined_ready 的全局含义**：输出可核的完整比较来源是具体进展，网页代码事实不等于已审阅/需求覆盖/发布批准。今后若要正式推广 readiness 聚合判据，应单列同 Issue 的有限增量，不在本叶偷推 true。generic `unified_diff_text.v1` 永远保其原 unknown/partial、原false和旧间隙；旧保存job不自动换adapter/新capture，不重绑原receipt。

错误为固定枚举（至少 UNSUPPORTED_VIEW/IDENTITY_MISMATCH/FILES_NOT_LOADED/INVENTORY_MISMATCH/HUNK_INCOMPLETE/SOURCE_TRANSFORMED/CAPACITY/TARGET_CHANGED），不反射任意网页错误。新observation/capture或SHA变化必须新immutable job；请求重试/报告幂等/原线程人工JSON接收均原样。无Agent仍可创建、读、评估、渲染；不新增自动ACP typed receipt硬要求。

## 6. 必须真实记录的验收与停止条件

所有下列是待实施门，**本合同未运行/未声称通过**：

1. 用当前允许的真实浏览器 extension producer 在 public owned repo 记录 fullSHA双点小比较，保存 source observer/provenance/typed envelope及代码事实；独立公共Git树差异作期望参考，逐文件/side/行/总+/-核对。真正authenticated extension capture才可验收，匿名HTTP只是selector参考。
2. 由同一已记录 DOM制作明确标synthetic的 cut（删file/hunk/row）、folded、loading/filter/virtualized、wrongbase/three-dot、重复anchor/伪TOC置于代码、threat-transform、nav变化和容量负控。实际 producer→authenticated boundary→EvidenceStore→真实CodeReviewService全链应拒完整性；不得只测试手工构造payload后宣称producer可信。
3. valid完整路径不装Agent也能返回全部事实；wrong repo/base/head、新capture对旧job/receipt、跨thread、伪model payload、修改store/hash、readonly/cancel入库必须拒；原generic和manualAgent回传完整现有测试保留。
4. hosted/获准真实浏览器的必要验收不能在本机禁令下伪造；可先实现/guardedDOM及HMAC桥控制，但其状态只是SOURCE_PASS，真实capture仍NOTRUN。真实Agent兼容/企业两场景另保PARTIAL，不因它们未交而阻止本独立adapter编写。

若实际已支持browser DOM没有可独立验证的全TOC/逐文件统计/完整hunk结构，则停止完整提升、保未知，交付具体缺少的producer字段/actualrecord；不自动启REST/newfetch/CDP网络截获/新permission来补。root批准本合同后才coding；实际源码需两真非作者和唯一必要affected机器，不能作者自批。

## 已有原生证据与有限交付分拆（2026-10-19）

固定 public two-dot 形状已在 PR711 head6b1f52a5 / CI39189613843 取得真实 Chromium 11case；产品9文件及原 harness 两文件与093de278逐字相同。最新093的独立启动/清理红仍 UNKNOWN、原 PR/源/日志保留。本产品叶只叠当前主线的既有产品/测试/文档，保 main 全部四项 CI/原生/安全门，测试专用 harness/workflow 留原未合分支；不将旧 pass 冒新 head 全 CI 或 whole464 完成，不修改本合同权限、界限、readiness、Agent/企业余项。
