# Windows Voice-Pack Closeout · S62 项目总结与经验沉淀（2026-08-09）

**PR:** [#161](https://github.com/nehcuh/cmspark/pull/161) **MERGED**  
**Merge commit:** `57bad96`  
**Main tip after handoff:** `75f257b`（session-end memory）→ 本文件提交后更新 tip  
**Branch (historical):** `review/voice-pack-windows-closeout`  
**Product version:** 0.5.0  

---

## 1. 本波交付摘要

| 主题 | 结果 |
|------|------|
| Windows SEA 打包 | MCP/notifier 进 bundle；whisper **旁路** `bin/` + DLL；`build-windows-exe.ps1` 可一键重编 |
| 本机 Whisper | auto-fetch pin；continuous `privacy_ack_v2`；large 模型 skip partial；spawn 加固 |
| WS 生产 fail-closed | 核心消息类型 + `skill.import-*` 注册 |
| launch.bat | Companion 未起时 **fail-closed**（exit 1，避免假成功） |
| **shell_exec / netsec L2 token** | `validateTokenFor` 与 `issueTokenFor` 绑定同形（command+cwd / targets+ports） |
| 门禁 | multi-adversarial + dual（Claude/Pi）APPROVE_WITH_NITS；CI build green 后 merge |

### 关键 commit（相对 #160 后 voice 线）

| Commit | 说明 |
|--------|------|
| `358bc08` | SEA-bundle MCP/notifier；win whisper pin+DLLs |
| `59ba8bd` | whisper binary auto-download（pack + settings） |
| `1498e77` | production WS fail-closed 注册核心类型 |
| `ba2c942` | continuous local STT 发 `privacy_ack_v2` |
| `f6291ba` | whisper spawn 加固；large-model skip partial |
| `4d07368` | launch fail-closed + closeout nits |
| `32ab576` | **shell_exec/netsec `validateTokenFor`** |
| `7375f65` | package-lock `engines.node >=20` |
| `57bad96` | Merge #161 → main |

---

## 2. 经验沉淀（可复用）

### E1 — L2 token：issue 与 validate 必须同一 binding

- **症状：** 企业 auto / full-autonomy 下 `Invalid or expired security token for shell_exec`（刚 issue 即 fail）
- **根因：** `issueTokenFor` → `bindingPayloadFor` 生成 `shell|cmd|cwd=...`，执行路径却 `validateToken(token, tool, bareCommand)`
- **纪律：** 成对使用 `issueTokenFor` / `validateTokenFor(params)`；改 `bindingPayloadFor` 时全仓同步；单测覆盖 cwd 非空路径
- **知识库：** `memory/project-knowledge.md` · Technical Pitfalls（S62）
- **Instinct：** `l2-token-issue-validate-same-binding`

### E2 — Windows SEA：先杀进程再 restage

- **症状：** `Copy-Item` / 打包「正由另一进程使用」；或源码已修用户仍跑旧 exe
- **纪律：** `Stop-Process cmspark-agent` → 再 `build-windows-exe.ps1`；用 `LastWriteTime` 对照 `companion\dist` 与 `dist-package`
- **Instinct：** `windows-sea-stop-before-restage`

### E3 — 听写三层勿混（延续 S56）

1. **权重** `~/.cmspark-agent/models/whisper/`  
2. **运行时** `bin/cmspark-whisper-*.exe`（不进 SEA 内部）  
3. **麦克风** getUserMedia  

报「听写坏」先分层，再改代码。

### E4 — 合 main 后本地 ≠ 远程的判断

- `git fetch` + `origin/main..HEAD` / `HEAD..origin/main`  
- `gh pr view` 的 `mergedAt` 为空 = 尚未进 main  
- 功能分支超前 ≠ main 已含修复（本波 #161 合前 main 无 token 修）

---

## 3. 项目状态（0.5.0 切点 · S62 后）

| 轴 | 状态 |
|----|------|
| Side Panel ↔ Companion | 交付 |
| Trust / Confirm / Pack / MCP / Multi-agent | 交付 |
| 无人值守桌面 | **on main** #160（L2+re-L2 静默） |
| 听写+ / Whisper / 会议 | 交付；**Windows SEA+bin sidecar on main #161** |
| shell_exec L2 token 绑定 | **on main** #161 |
| Health + deep-diagnosis | **on main** #159 + #160 |

**本地验收包（不入库）：**

```
dist-package\cmspark-windows-x64\          # 便携目录
dist-package\CMspark-v0.5.0-windows-x64.zip
```

重编：

```bat
build-package.bat
```

或：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows-exe.ps1 -SkipInstall -SkipNsis
```

---

## 4. 未结 / 下次

- [ ] 真机：新 exe 下 enterprise/全自动 `shell_exec`
- [ ] 真机：听写 continuous / hold（指南 §4）
- [ ] Mac 武装值守 smoke（#160）
- [ ] Whisper multi-arch **real** SHA256 pins
- [ ] God-file 拆分（`server.ts` / `message-router.ts`）
- [ ] Developer ID / Authenticode

**勿 commit：** `.tmp-ci-*` · `.tmp-diagnosis-report.json`

---

## 5. 相关 SoT

| 类型 | 路径 |
|------|------|
| 用户指南 | `docs/meeting-and-dictation-user-guide.md` |
| ADR 听写/会议 | ADR-023 / ADR-024 |
| 值守 | `docs/adr/021-unattended-desktop-session.md` |
| 双路/对抗产物 | `docs/audit/reviews/voice-pack-windows-closeout-*` |
| Session | `memory/session.md` S62 |
| Handoff | `PROJECT_CONTEXT.md` |
| Overview | `memory/overview.md` |

---

## 6. 一句话总结

> Windows 听写打包闭环合入 main 后，真机仍报 shell_exec token 失效的根因是 **L2 签发与校验绑定字符串不一致**；修必须进 SEA 并替换正在运行的 exe。产品 0.5.0 在 Windows 侧具备可重编便携包 + 本机 Whisper sidecar + 企业 shell 可用路径。
