# #825 Apps producer CRLF 锚点修复 GLM-Claude 回执

- 裁决：**APPROVE**；只批准提交单文件测试修复并重跑 CI。
- Base：`ec9edbd417a7889c5a436ac64b158b547e95d565`；source：`companion/tests/activity-apps-825.test.ts`。
- 冻结 source diff SHA256：`69780493fc74939920d5e73b932c7f149fcb31d87915fbe56e49578febccb21d`。
- Prompt SHA256：`080cf64b44a506a19b886478e4f74206051993893fdcc2b21447ebb691c42ae6`，49469 bytes；API 起始 UTC `2026-11-02T17:00:08.150168+00:00`。
- Reviewer：Claude Code 2.1.153 / `open.bigmodel.cn`，实际 modelUsage 仅 `glm-5.3`；process exit=0，is_error=false，耗时 74981 ms。
- 没有额外格式 API 调用；未改测试源码、生产 PS、时限或 native 断言，仅新增本回执。
- 证据界限：旧 Windows head 的三个实际 native 能力用例已通过；producer 控制用例则在执行 PS 前失败（不是 Windows SKIP）。修后本机为 5 PASS / 2 Windows 平台 SKIP，新 LF/CRLF CPU 检查实际执行。模型末段提到的 SKIP 对应本机平台限制；正确 head 仍须在 Windows 跑到 PS 并通过，不能预记最终 CI/release 成功。

以下是实际 GLM-Claude 完整原文（未改写）：

---

## 结论：批准

### 实际关键核对

1. **首错根因与修复对位**：ec9edbd4 唯一活动首错是 producer 控制用例 6.6ms 处 `assert.ok(start >= 0 && end > start)`，旧锚硬编码 `"if ($Mode -eq 'Apps') {\n  # Window observations"` / `'} else {\n  $h ='`。新 helper `appsProducerParts825` 以 `source.includes('\r\n')` 判定实际 EOL 后拼入同一字面锚，锚文本本身逐字符未变、未松化，`start >= 0 && end > start` 与 `functions.includes('function App-Name')` 两断言原样保留。核对真实 PS 源：`function Process-Identity`→`function Window-Info`（含 `function App-Name`）、Apps 块起点、`} else {`+`  $h =` 均唯一且与锚匹配；`end` 起搜点仍为 `start`，Apps 块内 `} else { 'none' }` 为同行内联不会误命中。

2. **字节保留、无生产改写**：helper 仅 `slice` 原始 source，LF checkout 得 LF 片段、CRLF checkout 得 CRLF 片段，无 normalize/replace；生产 `activity-windows.ps1`、`powershell.ts`、`ci.yml` 均不在本 diff 内。写入 tmp `producer.ps1` 的 `${functions}`/`${body}` 与旧代码同源同段，producer 脚本构造（Get-Process 桩、201/4096/4097、session 826 foreign、keepass protected、空 Path、重复条目、ConvertTo-Json）与后缀逐字节未变。

3. **caller 边界/时限/native 断言保留**：30_000 timeout、win32 skip、4097→`APP_LIST_LIMIT_EXCEEDED` 且 raw null、201/4096 计数、`AChat` 首位、全 `none` 状态、payload.apps 与 decoder 定序 deepEqual、Foreign/Protected/Unresolved 排除、三键排序断言、finally 清理全部原样；native 用例 90_000 与 `CMSPARK_ACTIVITY_NATIVE_758`/GITHUB_ACTIONS 门未动。

4. **CPU 反例真实源派生**：新用例经 `resolveWinScript` 读取真实生产脚本，仅在内存 `replace` 生成 LF/CRLF 变体，磁盘生产文件不改；CRLF 分支用 `assert.equal(actual[part], expected[part].replace(/\n/g, eol))` 逐字符比较，若 helper 曾吞 CR 必然红，非复刻手写期望；无 skip，全平台执行（两份官方 runner 日志 `ok 5` 实跑，5 PASS/2 SKIP/0 FAIL 吻合）。

5. **非阻塞观察（不需改动）**：(a) CPU 用例的 `expected` 由同一 helper 在 LF 上派生，区域边界正确性靠独立报告的 ec9 旧 AST 逐字节等价及 Windows 下 PowerShell 实跑断言兜底，EOL 维度本身已真实验证；(b) CRLF checkout 下 producer.ps1 将混排模板 LF 与片段 CRLF，Windows PowerShell 5.1 接受，且 ec9 上整脚本 CRLF 实跑已过，不构成可达缺陷。

### Blockers

未发现。

### 允许范围与待门

允许 commit 该单文件测试修复并重跑 CI。仍待门：Windows hosted CI 上 producer 控制用例从 SKIP 变为真实执行且通过；完整最终 CI 转绿与 release 不在本门批准范围。

VERDICT: APPROVE
