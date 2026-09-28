# 独立对抗评审 — 0.6.9 拉取批次（2026-09-27）

## 你的角色

你是一名独立的高级代码评审员，受邀对 CMspark 仓库刚合入 main 的一批提交做**对抗性**评审。
你不是来盖章的。你的默认立场是「这段代码有问题，我要找到它」。
只报告你能用真实代码位置证明的结论。不要编造，不要泛泛而谈。

## 仓库与范围

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash 下 `/c/Users/HuChen/Projects/cmspark`）
- 评审区间：`59931595..b5a7396a`（旧 main HEAD → 当前 main HEAD，12 个提交，版本 0.6.8 → 0.6.9）
- 预生成 diff（仅代码，不含 docs/memory）：`docs/audit/reviews/069-pull-20260927/range-59931595-b5a7396a.patch`（3536 行）
- 完整 diff 请自行运行：`git diff 59931595 b5a7396a -- companion/src companion/tests chrome-extension/src`
- 提交清单：`git log --oneline 59931595..b5a7396a`

**必须实际打开文件读代码。** diff 是线索不是结论 —— 上下文、调用方、被删掉的分支都要在 HEAD 工作树里核对。

## 本批次的 12 个提交

```
b5a7396a fix(loop): switch strategy when a click cannot find the text
ad7f0980 fix(lease): lock a tab only while a worker is changing it
8e74b77b docs(memory): record 0.6.9 session handoff
488252bf fix(release): accept onnxruntime napi-v6 in the linux zip check
b78e0962 release: cut 0.6.9
1f27b988 docs(outbound): record grok re-review APPROVE for #524
da467062 fix(outbound): open the cockpit for tenant confirms
731db945 fix(fleet): adopt re-review NITs — kick disclosure + drain guard test
682c92ba docs(#502): changelog entries for pull-20260921 fix batches + F5/F6
037e1126 fix(fleet): stop/abort never revive a queued kick (grok A P1 follow-up)
0999f5fc fix(board): collect_handback refuses live/queued worker runs (F2)
a82e42b3 fix(fleet): queued kick refuses shared AbortController; drain defers to active run (F1)
```

## 实现者声明（**不要相信，逐条验证**）

CHANGELOG `## [0.6.9]` 声称：

1. **#524 租手确认与 Windows 配置**：外部助手的 `[Outbound]` 确认会把确认台拉到前面（侧栏红条仍可批；普通轻确认不抢焦点）。首次页面外泄正文写明调用方、工具，以及「允许后只在本次 Companion 进程内免再问」。侧栏签发钥匙时 caller_id 与权限是带标签输入，`CMSPARK_OUTBOUND_CALLER_ID` 必须逐字相同。签发命令若印出未展开的 `%LOCALAPPDATA%`，stderr 提示不要复制。
2. **F1 舰队 kick 竞争**：排队的 spawn / expert-team kick 撞上用户手动对话时不再复用对方 AbortController；拒装时丢弃本次 kick（brief 已持久化）；排队项在活跃 run 结束后重排队 drain。
3. **stop/abort 不复活排队 kick**：`abortThreadChat` 先 cancel 再 release；`fleet.stop_all` 在逐 worker abort **之前**统一预取消全部目标的排队 kick；`scheduleWhenLlmSlotAvailable` 槽位有空也先 probe 活跃 run，占线则排队让位；`stop_all_result` 逐 worker 披露 `cancelled_kick`。
4. **F2 collect_handback 盲窗**：worker 的 LLM run 在飞或排队（abort map ∪ llm-loop-gate holders ∪ 排队 kick 三源并集）时不再误收前一轮叙述为 prose 成功，统一 `WORKER_STILL_RUNNING`；谓词抽成命名导出 `buildIsThreadLlmActive` 并逐源单测。
5. **b5a7396a same-tool-guard**：同一工具+同一参数连续调用达阈值时切换策略（告诉模型改读页面/滚动/搜索，而不是再点同一句）。
6. **ad7f0980 tab-lease**：读操作不再持独占租约；click / navigation / evaluate / screenshot 只在**该次调用**期间持锁；worker 或编排器新建的 tab 持 60 秒或直到该持有者导航它。

## 评审重点（按优先级）

### P0 — 并发正确性
- `AbortController` 复用 / 误删：F1 声称修好了。**找出仍然共享或泄漏的路径**。`kick-abort-map.test.ts` 覆盖了什么，没覆盖什么？
- 取消与释放的**顺序**：`abortThreadChat` 先 cancel 后 release。若 release 内部同步 drain，cancel 是否对所有目标都已完成？有没有「部分取消 → drain → 复活」的窗口？
- `stop_all` 的预取消：预取消全部目标后再逐个 abort。这两步之间有新 kick 入队会怎样？
- tab-lease：读不持锁 → **读到一半被另一 worker 导航走**会发生什么？60 秒持有期的到期清理是否有竞态？租约 holder 身份如何判定，能否被伪造/串号？
- `buildIsThreadLlmActive` 的三源并集：三个源的 key 是否一致（threadId vs workerId vs sessionId）？有没有源为空/未初始化时误判为 inactive 的路径？

### P1 — 安全与信任边界（ADR-020）
- outbound 确认的 **trust monotonicity**：「允许后只在本次进程内免再问」——这个免问范围能否被更宽权限的请求搭车复用？caller_id 逐字比对是否大小写/空白敏感？绕过路径？
- `%LOCALAPPDATA%` 未展开的 stderr 提示：是提示还是**阻断**？只提示的话用户仍会粘错，这是不是 over-claiming？
- 确认台抢焦点：`da467062` 让 tenant confirms 打开 cockpit。会不会把**普通轻确认**也抢焦点？声称不会，验证分支条件。
- same-tool-guard 注入的提示词：是否可能被模型上下文里的内容影响（提示注入放大）？阈值是否可被绕过导致死循环？

### P2 — 测试与工程质量
- 新测试是否真的锁住了 bug，还是只锁住了实现细节（改实现就红）？
- `488252bf` 放宽 linux zip 检查接受 onnxruntime napi-v6：这会不会**掩盖**真正缺二进制的问题？fail-open 还是 fail-closed？
- 版本锚是否齐 0.6.9（companion / extension / installer.nsi / lockfile / outbound serverInfo）？自己跑命令核对，不要信 CHANGELOG。
- 有无被删掉的防御性分支、静默 catch、`|| true`、TODO 冒充完成。

## 硬性规则

1. 实际读代码 / 跑命令。可以用 Read、Bash、Grep。**不要修改任何文件，不要提交，不要 push。**
2. 每条 finding 必须带 `文件路径:行号`（HEAD 工作树的行号），并说明**为什么**这是问题、什么条件下触发。
3. 找不到问题就直说找不到，不要为了凑数编 NIT。
4. 明确区分：你**验证过**的、你**推断**的、你**没能验证**的。第三类要单独列出。
5. 若某条实现者声明与代码不符，直接点名为 over-claiming 并给出证据。
6. 应用 ADR-020 能力清单：`docs/audit/reviews/_templates/dual-review-capability-checklist.md`（Surface / Composition / Autonomy；Pack-first；禁止裸写「中层 Agent」；trust monotonicity；新确认要有 originWs）。若实现者提示词缺少 Surface/Compose/Autonomy/Trust/Channel 声明且 diff 不是纯 docs/test/refactor，指出这一点（新增工具/门禁/主 UI 时视为 blocking）。

## 输出格式

先给结论摘要，然后：

```
## BLOCKING（必须修才能发）
- [P0] path/to/file.ts:123 — 问题描述 / 触发条件 / 影响

## NITS（非阻塞）
- path/to/file.ts:45 — ...

## 未能验证
- 声明 N：原因

## 已核实为正确的声明
- 声明 N：证据（file:line + 你跑了什么）
```

**你的最后一行必须恰好是以下三者之一（后面不能有任何内容）：**

```
VERDICT: APPROVE
VERDICT: APPROVE_WITH_NITS
VERDICT: REJECT
```

判定标准：有任一 BLOCKING → REJECT。只有 NITS → APPROVE_WITH_NITS。干净 → APPROVE。
不要把 VERDICT 只写在别的文件里 —— 必须打印在你的最终回复中。

## 已知问题（操作者在本次构建中实测发现，请独立确认并评估严重性）

`npm test` 在 Windows 上**完全跑不起来**，且**零输出静默失败**：

- `companion/scripts/run-tests.mjs` 把全部 418 个编译后测试文件的绝对路径拼进**单条** `spawnSync` argv
- 实测 argv 总长 **36914 字符**，超过 Windows `CreateProcess` 的 **32767** 上限
- 子进程 spawn 失败：`error.code === 'ENAMETOOLONG'`，`r.status === null`
- 但 `runNodeTest` 的返回是 `return r.status ?? 1` —— **`r.error` 被完全丢弃**，
  于是表现为 exit 1 + stdout/stderr 各 0 字节，看起来像「测试全挂了」而非「测试根本没跑」
- `stdio: "inherit"` 也无法救场，因为子进程从未创建

请评估：
1. 这是否 blocking？（`make test` / CI 在 Windows 上等于**无门禁**，fail-open）
2. `r.status ?? 1` 吞掉 `r.error` 是否本身就是应修的缺陷（错误可观测性）？
3. 本批次是否有提交让测试文件数量/路径长度越过这个阈值（即新提交是否是压垮的那根稻草）？
   用 `git log --oneline 59931595..b5a7396a -- companion/tests` 和逐提交统计核实。
4. 418 这个数字是否包含**不该被发现**的文件（walk 未过滤前缀下划线以外的规则）？

自行复现命令（在 `companion/` 下，先 `npx tsc -p tsconfig.test.json`）：

```bash
node -e "const {spawnSync}=require('child_process');const fs=require('fs'),path=require('path'),os=require('os');
const root=process.cwd();function walk(d){let o=[];for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())o.push(...walk(p));else if(e.name.endsWith('.test.js')&&!e.name.startsWith('_'))o.push(p)}return o}
const files=walk(path.join(root,'.test-dist','tests'));const dir=fs.mkdtempSync(path.join(os.tmpdir(),'probe-'));
const r=spawnSync(process.execPath,['--require',path.join(root,'scripts','test-data-dir.cjs'),'--test',...files],{cwd:root,env:{...process.env,CMSPARK_TEST_RUN_DIR:dir}});
console.log('status:',r.status,'errcode:',r.error&&r.error.code,'argvchars:',files.reduce((a,f)=>a+f.length+1,0)+80);"
```

**注意**：不要为了让测试跑起来而修改仓库文件 —— 只读评审。可以分批手动跑测试来验证测试本身是否健康。

## 追加任务：功能验证发现（**必读，且必须独立复核**）

操作者在真实安装的 0.6.9 上做了功能验证，结论写在：

`docs/audit/reviews/069-pull-20260927/functional-findings-20260927.md`

里面有三条发现：
- **发现 A**：Windows 上「内嵌终端」设置开关可交互，但后端四层 darwin-only 门禁必然拒绝 → 用户可达的必然失败入口
- **发现 B**：内嵌终端全页 tab 无「回主对话」入口，而同仓库 `ThreadGraphApp` 有现成模式未复用
- **操作者自纠**：先前「该设置项是 0.6.9 新增」的结论作废（根因是不存在 `v0.6.8` tag，`git show` 静默失败被 `grep -c` 读成 0）

**你必须独立复核这三条，不要采信。** 特别是：

1. 发现 A 的四层门禁行号是否准确？逐条打开文件核对（注意行号可能因你读的版本而偏移，以内容为准）。
   还有没有**第五处**门禁被漏掉？设置页的开关为什么没有平台门禁，是有意还是遗漏？
   查 `git log`/`git blame` 判断这是本批次引入的还是历史遗留。
2. 发现 B：`TerminalApp.tsx` 真的没有任何回侧栏入口吗？会不会通过别的机制（background 消息、
   `window.opener`、tab 关闭后 sidepanel 自动重新获得焦点）实现回主对话，从而让这条发现不成立？
   如果有，直接推翻它并给证据。
3. 自纠那条：`git tag` 确认没有 `v0.6.8`；用 `59931595` 和 `b5a7396a` 两个 commit hash 复核
   `embeddedTerminal` 的出现次数。**如果操作者的更正本身也是错的，指出来。**

4. **证据边界**：功能验证用的是 esbuild fixture + CDP 渲染真实组件树，**不是**真实扩展上下文
   （Chrome 153 忽略 `--load-extension`）。这个边界会不会让发现 A/B 的结论不成立？
   fixture 桩掉了 `chrome.*` API —— 有没有可能桩的行为与真实扩展不同，导致「按钮可见/可点」这个观察本身失真？
   这是你能推翻这两条发现的最有力角度，认真查。

发现 A/B 的严重性定级、是否 blocking，由你独立判断，不要照抄操作者的措辞。
