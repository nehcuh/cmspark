# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-10 (S9 — TODO-skip 修复启动，未完成)
- 目标：修复 CI coverage 解封后遗留的 10 个 `test.skip` + TODO 真实 bug。
- 已建立 10 个顺序 task，切入 worktree `fix-ci-coverage-todos`。
- Task 1 诊断完成：`tab-resolver.ts` pinned tab 反向迭代导致测试 "first available pinned tab" 失败；需改为正向迭代。
- 阻塞：kimi-gated-fix 复审需使用 `kimi-2.7 code` 模型重跑。
- 临时文件已清理，worktree 保留待续。
- **Next**：用 `kimi-2.7 code` 跑 task 1 复审 → apply → 验证 → 依次处理 task 2-10。

### 2026-07-10 (session-end S8 — 10 PR 全合)
- 从 S6 审计(4 Critical/10 High/4.4/C) → S7 开 4 PR → S8 续开 6 PR → **10 PR 全部合入 main**。审计 **4 Critical 全闭环** + **10 High 全修**。
- #11 P0 止血(C1 WS 鉴权/C2 history 落盘/C3 去||true/C4 zip-slip 预检/H1 0o600/H2 evaluate token)
- #12 P1-1 CI 解封(测试隔离=静态 import 读真实 config/teardown hang) → #15 threads-history(单调时间戳+精确 cap+隔离)
- #13 P1-3 持久化(原子写+损坏保留/H5 查证非 bug) → #16 CI 全面覆盖(**glob 修复 106→703 测试** + matchSite 后缀碰撞 bug) → #17 linux CI stdio skip
- #18 **officeparser 4→7**(C4 critical 根除，decompress 依赖移除，API parseOfficeAsync→convert) → #19 **H10 安全弹窗 a11y**(focus trap+Escape+aria-modal)
- **重大发现**：CI 的 glob `tests/**/*.test.js` 因 dash 无 globstar → 只跑子目录(~106 测试)，**盲跑 596 个顶层测试**(含 config/history/file-parser/threads-history 等)。修 glob 用 `find` → 703 全跑 + 暴露 10 确定性失败(skip+TODO) + 1 IPC 崩溃(settings-web 隔离运行)。npm audit **0 critical**(原 2)。
- CI 状态：全面 703 测试，0 fail，11 skip(TODO 追踪)。main = 32847d4。
- Next: P1-5 签名/SBOM(证书长杆)/M18 其他 modal a11y/10 个 TODO-skip(真实 bug 逐个诊断)/P1-6 evaluate AST 门

### 2026-07-09 (session-end S6 — 审计)
- Fuck My Shit Mountain full 审计：`audit-report-cmspark-2026-07-09.md`（55 findings，4.4/C）+ remediation-plan + Kimi 独立复核
- 4 Critical：C1 WS 无鉴权·C2 history 不落盘·C3 CI 绿-on-red·C4 供应链。10 High。修复见 S7/S8 的 10 个 PR
<!-- handoff:end -->
