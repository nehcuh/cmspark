# grok 第四路 — 未完成（API 停滞，操作者终止）

**状态：无 VERDICT，不计入裁决。**

## 运行记录

grok 共尝试 4 次，前 3 次因操作者自身失误失败，第 4 次因 grok 侧 API 停滞终止：

| 跑次 | 结果 | 根因 |
|---|---|---|
| 1 | `GROK_EXIT=127` | 操作者 runner 脚本重设 PATH 时漏掉 `~/.grok/bin` → `command not found` |
| 2 | 288 字节实质输出后中断 | **操作者误判**：把 `--output-format plain` 的整段缓冲落盘当成"卡死"，主动 `Stop-Process`。文件里的 `EXIT=127` 是 kill 造成的，非 grok 失败 |
| 3 | 472 字节后 mtime 冻结 120s | runner PATH 漏 `Git/cmd`，grok 自述「PowerShell 找不到 `git`」；子代理被拦 |
| 4 | **587 字节后 mtime 冻结 11 分钟**（00:44:50 → 00:55:51），进程存活但 CPU 仅 4.5 秒 | grok 侧等待 API 响应停滞。PATH 已修好（`git` / `grok` 均可解析），子代理已用 `--no-subagents` 关闭 |

第 4 跑与第 2 跑的区别是操作者判定"真卡"的依据：第 2 跑的 mtime 恰等于 kill 时刻（说明是操作者杀的），
第 4 跑在操作者**未干预**的情况下 mtime 冻结 11 分钟且 CPU 几乎不涨（说明在等网络）。

## 第 4 跑已产出的部分内容（保留作证据）

> 我按对抗评审来做：先核对提交范围、实现者声明和操作者的功能发现，再对着 HEAD 上的真实代码逐条找能证明的问题。不会改任何文件。提交范围和 HEAD 对得上。接下来按并发、信任边界和功能发现三条线读 HEAD 上的实现，不拿 diff 当结论。符号都定位到了。我先读 abort、排队 kick 和 `stop_all` 这几段，看取消和释放的顺序有没有窗口。F1 的取消顺序大体对得上，但 **`holders.has` 早退和 drain 还有疑点**。我接着核对租约、handback 和 outbound 确认。

## 这段部分输出的价值：一次意外交叉验证

grok 在**未接触任何其他评审路输出**的前提下（四路互不通信），独立对
「`holders.has` 早退」和「drain」提出疑点 —— 而这两点恰是：

- **claude 的 NIT 1**：`llm-loop-gate.ts:87-94` 稳态相撞时 `holders.has(id)` 早退，
  `run` 永不入队、`expert_team.kick_skipped_active` 日志永不触发，返回值却声称 `started:true`；
  CHANGELOG「占线则排队让位，不再丢弃 kick」只在瞬态窗口成立
- **claude 的 NIT 2**：`kick-abort-map.test.ts` 只造 abort map、不造 gate 槽位，锁的是 probe 分支
- **kimi 的 NIT**：`llm-loop-gate.ts:95-118` paused 检查只在 drain 路径（`:181`），直发路径无防护

两路（grok 独立 + claude）在**同一处**产生疑点，提升了这条 NIT 的可信度 ——
它可能比 claude 定的 nit 级别更值得关注，建议 follow-up 时优先处理。

**但这不构成裁决证据**：grok 未给出 file:line 级论证、未给 VERDICT，
上述交叉验证仅是方向性佐证，不是独立确认。

## 若需补第四路

改跑其它 CLI（如换 grok 的 `--output-format json` 或 streaming 以便观察进度），
或换时段重试避开 API 停滞。提示词在 `review-prompt.md`，无需改动。
