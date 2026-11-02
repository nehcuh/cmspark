# #825 CI 命令契约增量 GLM-Claude 回执

- 范围：仅两个 750 exact-consumer 脚本（9 增 1 删），不更改 workflow、产品、权限或时限。
- Base：`d990d3986540dd38daa452449dadb50d744e0a18`。
- 两 source 路径 diff SHA256：`27bd8fd8116d80d79206c253c2b3ee274929562f0c6f5ce7ff9b8d76578dda12`；形成回执时 source 未变。独立审计新增不计入此 source 摘要。
- Prompt SHA256：`490c015329b663422d0c30f7b768300aa6b1a431c087560c00effcd77f62cf86`，136216 bytes。
- 实际 reviewer：Claude Code 2.1.153 / `open.bigmodel.cn` / modelUsage 仅 `glm-5.3`；process exit 0，is_error=false，耗时 74935 ms。
- 结构化裁决 **APPROVE** 依据实际模型原文“通过。”“无 blocker。”“允许 commit 这两个脚本并重跑最终 CI。”归纳。模型未输出标准末行 VERDICT；按协调者指示保留原措辞，不为格式增加 API 调用。
- 仅批准提交两脚本并重跑 CI。此前 Windows 新原生步骤因前置契约失败未实际执行；本回执不宣称 native、CI 或 Release 已成功。

以下为实际 GLM-Claude 完整原文（未改写、未补写模型 VERDICT）：

---

## 结论

通过。冻结的两文件改动(9增1删)是最小且正确的消费者适配：契约在 sealed #758 producer 的 clone 上做带锚计数的精确字符串手术，仅追加既审阅的两个 #825 参数，整对象 deepEqual、compile+1、旧 pin 全部保留；三条删除负例覆盖三个必要 case 并走完整 matcher。独立 probe(修前拒绝/仅删两参数旧契约通过/修后接受并拒绝三删)与 115 pass/0 fail/0 skip 日志一致支持。无 blocker。

## 实际核对

**1) 修复精确性**
- sealed `activity-platform-758-workflow.json` 未动(sha256 `edf65201…` 与 HEAD 声明一致)；contract 顶部 canonical hash 断言(`401ffbb6…`)原样保留，producer 完整性仍由加载时校验。
- `oldRun` 锚含尾随 `\n`,`split(oldRun).length === 2` 保证锚恰好出现一次(0 次→1、≥2 次→3 均拒绝)；随后 replace 只可能命中该唯一锚。
- 手术结果串 = `cd companion\n` + 原 758 首参数 + apps825 + scope825 固定顺序 + 尾 `\n`,与当前真实 workflow 该 step 的 YAML 解析 run 逐字节一致；`deepEqual(additions[0], nativeStep)` 仍覆盖 name/`if`(native lane)/`shell: bash`/`CMSPARK_ACTIVITY_NATIVE_758`/run 全部属性，任何 continue-on-error、timeout、条件、shell、env 改动仍被拒绝。
- 原 758 保持首参数;`compile + 1` 断言未变；移除该 addition 后旧 baseline 顺序/基数检查不受影响。无 workflow 文件改动、无任何放宽。

**2) 三条负例**
- 三条 mutation 分别删除 ` .test-dist/tests/activity-platform-native-758.test.js`、` .test-dist/tests/activity-apps-825.test.js`、` .test-dist/tests/activity-scope825-native.test.js`;三个参数串在 run 中各仅出现一次且互不为子串，删除后必然不等于期望精确串，deepEqual 拒绝。
- 沿用既有完整 matcher 路径：先 validate 真实 workflow、mutate、`printWorkflow750` 后对 LF 与 CRLF 双份 `assert.throws`。独立完整 log 中 ok 53/54/55 实证三条拒绝。

**3) 调用路径遗漏**
- 真实调用路径仅两条：NSIS CI 步直接执行 `windows-ci-feedback-750.test.mjs`,以及 `native-ci-stages-760.test.mjs` 经共享的 `validateWindowsCiFeedback750`(本次 CI 失败 stack 即此路径)；修复位于共享 contract，两消费者同时修复，导出签名未变。
- 顺序互换/多余参数/额外命令/改尾换行均因精确 deepEqual 而在正向合同即被拒绝，无执行缺口；规格只要求三条删除负例，满足。
- 未发现当前可达、影响本验收的缺陷。

## Blockers

未发现。

## 允许下一步与仍待 CI 门

- 允许 commit 这两个脚本并重跑最终 CI。
- 本门不批准 CI/native/release 成功：重跑后需确认 Windows native lane 三个 native 用例实际执行(非前置 fail 导致的 SKIP)、全量 CI 绿，再交后续 native/release 门。
