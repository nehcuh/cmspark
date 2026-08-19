# file: L2 + 路径笼子 — 三路独立对抗合成

**日期**: 2026-08-19  
**Strawman**: `docs/superpowers/specs/2026-08-19-file-scheme-l2-path-cage-design.md`  
**车道**: A Security **REJECT** · B Product **REJECT** · C Chrome **APPROVE_WITH_NITS**  
**确认序**: 本文件只锁定实现合同。实现后须再跑独立对抗 + Pi，实现会话不得自评放行。

## 交叉后仍成立的锁（实现必须服从）

| ID | 来源 | 锁 |
|----|------|-----|
| L1 | A1/A2/C-02 | `file:` **禁止**落入现有 `skipUrlConfirmation`。`auto_approve_dangerous`、`auto_approved_domains`（含 `localhost` / `*`）**不得**跳过。唯一 skip = `allow_all_schemes`。 |
| L2 | A3/C-02 | `relevantDomains` 字面 `[]`。集成测：`file://localhost/…` + 伪造 `add_to_whitelist:["localhost","*"]` 不得写入 config。 |
| L3 | A4 | 不要再 OR `isFullAutonomyCruise`。巡航已含 `allow_all_schemes`。 |
| L4 | A5/C-01/C-11 | 新文件 `tool/file-url-admission.ts`；`fileURLToPath` + `path.resolve`。**禁止** `extractPathCandidate` / `resolveAllowDirToOffer`。 |
| L5 | A6 | 笼子含 `SENSITIVE_PATH_SEGMENTS` **和** `SENSITIVE_HOME_PREFIXES`。 |
| L6 | A7 | **v1 仅 home 内**（realpath 后 `path.relative(home)`）。Downloads 发票在范围内；`/tmp` `/opt` `/Volumes` 硬拦。 |
| L7 | C-03 | 笼子按**路径形状**判 POSIX ∪ Windows 树，不看 `process.platform`。`/etc/passwd` 在 win32 CI 也硬拦。 |
| L8 | C-07 | `file://C:/Users/…` 的 hostname `c` 当盘符，不当 UNC。 |
| L9 | B3/C-08 | scheme/cage 走 `image_fetch_file_requires_cruise` 同款「这不是确认弹窗」旁路，禁止套「若你已拒绝弹窗」。 |
| L10 | B1/B5 | 读内容 ≠ 浏览器打开。`adapter` + `create_tab` 描述：未明确「在浏览器打开」时不要用 `create_tab(file:)` 读 PDF；请用户拖入。确认 `code` 用人话，不用假工具名 `open_local_file`。 |
| L11 | B2 | 确认 `toolName` = `打开本地文件（仅这一次）`。无 `relevant_domains` 时紧凑条不得写「白名单在确认台」。 |
| L12 | A8 | **本 PR 不改** evaluate/get_page_html。诚实残余：home 内 HTML 经一次点击可能被 `get_page_html` 读进 LLM。 |

## 降级 / 不采纳

- B1「本轮只改文案、不做 L1→L2」：用户已拍 `file:` 确认通道；读内容用 prompt 分流，不砍掉 L2。
- 路径持久白名单：三路均未要求；保持每次询问。
- 申请 `file:///*` / 引导文件网址权限：不在 v1。
- 单独 cruise skip API：拒绝（L3）。

## 实现后闸门

MACHINE: `url-cookie-admission` + `file-url-admission` + `user-gate-copy` + `security-gates` item 12 + extension `gate-error-copy`。  
然后独立对抗（读 diff）→ Pi 复审。MERGE 仅当两路 APPROVE*。
