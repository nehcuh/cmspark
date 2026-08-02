# Adversary Synthesis — Trust IA / God-mode / 长程自治

**Date**: 2026-08-02  
**Trigger**: 用户反馈权限入口过多；God-mode 心智应为「长程自行运行、自负后果」  
**Agents**: Product/UX · Security · Compat/ADR · Autonomy long-run（并行，独立）  
**Status**: Internal pass → design SoT + plan → dual external (Pi + Claude)

---

## 1. Consensus (all four)

| Claim | Verdict |
|-------|---------|
| 入口过多、层级看起来平行却正交 | **True** — 产品债，非用户蠢 |
| God-mode 名过卖（像全开） | **True** — 实际是 `allow_all_schemes` 协议 + 部分网页 L2 |
| 把 God **语义扩到** shell/CU/spawn 全跳 L2 | **REJECT**（安全/Compat/产品三重否决） |
| 需要**一条**长程 JTBD 入口 | **Agree** |
| 实现上保留正交 wire keys | **Agree**（审计/CLI/升级安全） |
| Autopilot 是 **Trust packaging**，不是第 4 轴 / 新 Surface | **Agree**（ADR-020） |

## 2. Scheme scoreboard

| Scheme | Product | Security | Compat | Autonomy | Synthesis |
|--------|---------|----------|--------|----------|-----------|
| A Rename + IA only | Kill as end-state | Least dangerous | **P0 GO** | Fails JTBD alone | **P0 slice only** |
| B Opaque multi-flag umbrella | Kill pure form | High risk | Conditional | — | **Only as D shell** |
| C God expands all L2 | Kill | **Catastrophic** | Hard ADR break | Tempting but contract-breaking | **REJECT forever as silent expand** |
| D Hybrid: protocol rename + Autopilot levels | **Winner** | **Winner** | **P1 projection** | Maps to Autonomy「全自动巡航」 | **Ship target** |

Autonomy agent labeled packaging **C**；其余三方 hybrid 为 **D** — **同一产品形态**，字母冲突仅命名。

## 3. Locked product law (post-adversarial)

1. **God UI 退役产品名词** → **协议解锁**（wire: `allow_all_schemes` 不变）。  
2. **主 JTBD 入口** = **运行自主度 / 长程自治**（Autopilot levels），不是三个平行 checkbox。  
3. Autopilot = **UI 合成**现有 `auto_approve_dangerous` ± `auto_approve_enterprise_tools` ± `allow_all_schemes`（可选），**bool 为 SoT**。  
4. **Hard floors (v1 不可被 Autopilot 静默跳过)**：  
   - `host_computer` **任务级首确认**（桌面巡航为 P1 可选，且每 App 首次仍 L2）  
   - `spawn_worker` **默认仍 L2**（预算内 skip = P1+，需单独写进武装契约）  
   - cookie `trusted_domains`、workspace 绑定、pack whitelist、netsec allowlist/task-auth、evaluate critical API / MCP critical、`ask_user` / `board_complete`  
5. **Enterprise skip** 仍受 scope ∩；Autopilot 不扩大 allowlist、不启用 module。  
6. **Pack 禁写**一切 arm 键。  
7. **短语 step-up** 每个 false→true 危险 flag（可一次武装多 flag，但审计逐 flag）。  
8. **Status chrome**：武装态须在侧栏 SafetyStrip/FocusBand 可见，不得只活在设置深处。  
9. **升级安全**：禁止给既有 `allow_all_schemes:true` 安装**静默**增加 shell/CU 跳过。

## 4. Phased path

| Phase | Scope | Gate algebra | Risk |
|-------|--------|--------------|------|
| **P0** | IA 重组 + God 改名 + 真理矩阵前置 + 文档锁步；高级区保留独立闸门 | **不变** | Low |
| **P1** | 运行自主度武装向导（双写 bool）+ 武装徽章/解除 + 审计 package_arm | 不变；合成写 flag | Med |
| **P2** | 可选：会话作用域武装、TTL、spawn 预算、含桌面巡航 | 可能新键；需 ADR | High |

## 5. Open tensions (resolved for design SoT)

| Tension | Resolution |
|---------|------------|
| 用户「God=全开」vs ADR Trust | **不改编故事去贴用户错词**；用 Autopilot 接 JTBD，God 改名降级 |
| Autonomy 要 spawn skip | **P0/P1 不做**；P2 才考虑预算契约 |
| Security 偏好只做 A | A 作 P0；JTBD 在 P1 交付，否则产品半残 |
| 单 phrase 武装 enterprise+browser | P1 允许一次 phrase 多 flag，**后果矩阵强制展示**；R14 要求矩阵含 host RCE 披露 |

## 6. Artifacts

- Design SoT: `docs/superpowers/specs/2026-08-02-trust-ia-autopilot-design.md`  
- Impl plan: `docs/superpowers/plans/2026-08-02-trust-ia-autopilot-impl.md`  
- Dual prompt: `docs/audit/reviews/trust-ia-autopilot-dual-review-prompt-20260802.md`
