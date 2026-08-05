# 后续优化方向：Agent 下载并安装外部 Skill（CMspark 可用）

> **日期**: 2026-08-01  
> **状态**: P0 `skill_install` **已实现**；**源路径产品语义 2026-08-05 已优化**（见 §5）  
> **触发**: 用户场景 + 会话 #au4dch / #tj6y24（装 Black-cat / reverse-skill）  
> **轴**: [ADR-020](adr/020-capability-model-three-axes.md) **Composition**（Skills）+ 少量 **Surface L1**（browser_download）  
> **相关**: [optimization-plan-au4dch-ux-shell-download.md](optimization-plan-au4dch-ux-shell-download.md)（下载去重已部分落地）；[README · 技能系统](../README.md#技能系统skills)

---

## 0. 产品场景（用户意图）

```text
Chrome Side Panel 驱动 Agent
  → 在网页上下载 skill 包（GitHub release / ZIP / 文件夹）
  → 配置进「本插件」技能库
  → 列表 / 语义匹配 / /name 使用
```

**正确落点**：`~/.cmspark-agent/skills/`（Windows：`%USERPROFILE%\.cmspark-agent\skills\`）  
**不是**：仓库 `Projects/cmspark/skills/`、`~/.claude/skills`、仅 Downloads 不解压。

---

## 1. 现状缺口

| 能力 | 状态 |
|------|------|
| UI 导入（.md / ZIP / 文件夹 / URL）→ 写入用户 skills 目录 | ✅ |
| README 写明存储路径 `~/.cmspark-agent/skills/` | ✅ |
| `browser_download` / `downloads_find` / prefer_existing | ✅（#au4dch Wave） |
| **LLM 一等 tool** `skill_install`（path/zip/content → 用户 skills + refresh + L2） | ✅ |
| 源路径：用户主目录（含 `~/Projects`）经 L2 可装；系统路径硬拒 | ✅（2026-08-05） |
| Agent 仅靠 shell 猜路径时易装错目录 | 已缓解（tool 文案 + dest 固定用户库） |

`skill.import*` 仍为 **UI ↔ Companion WS**；`skill_install` 为 LLM 一等 tool。

---

## 2. 建议交付（实现时）

### P0 — 一等安装 tool

- 新增例如 `skill_install`（或复用命名空间 `skill.install` 经 adapter 暴露）：
  - `path`：本机已下载/解压目录（含 `SKILL.md`）
  - `zip_path` 或 extension 侧 zip
  - `url`：可选（SSRF 门与现有 `skill.import` 一致）
- 内部复用 `SkillEngine.importSkillFromPath` / `importSkillFolder` / `importSkill`
- **强制** `dest = getConfigDir()/skills`；成功后 `refresh` + 返回 `name` + 绝对路径
- 结果提示：勿写入仓库 `skills/` 或 Claude 目录

### P1 — 与下载闭环

- `browser_download` 若 `filenameHint` 像 skill 包，tool result 可带 `next_step_hint_zh`：请 `skill_install` 或面板导入
- 系统/browse skill 片段：装外部 skill 时 **先 find Downloads → skill_install**，禁止默认拷到项目根 `skills/`

### P2 — 文案

- Skills 面板：补充「手动：放入 `~/.cmspark-agent/skills` 后点刷新」
- README「导入/导出」与 Agent 路径对齐

### 非目标

- 不把 Claude Code `~/.claude/skills` 与 CMspark 目录合并  
- 不新开 Side Panel 一级入口（Pack-first / ADR-020）  
- 不静默执行不可信 zip 内脚本（仅落盘 markdown 技能树；现有 import 语义）

---

## 3. 能力声明草稿（落地 PR 时填）

| 轴 | 声明 |
|----|------|
| Surface | L1 仅既有下载；安装为 Companion 本地写用户 skills |
| Composition | Skills 一等安装，非新 Agent runtime |
| Autonomy | 无 auto-spawn |
| Trust | URL 安装走既有 SSRF/大小门；路径 containment 在用户 skills 根下 |

---

## 4. 验收剧本

1. Agent 从 GitHub 下载 `*.tar.gz` / zip → `skill_install` → Skills 列表出现，可 `/name`  
2. 文件已在 Downloads → find + install，无二次下载  
3. 误指向仓库 `skills/` 时仍可 path install（若 path 合法），且文档/工具描述优先引导 cmspark 目录  
4. 装完无需重启 Companion（refresh 即可）

---

## 5. 源路径 Trust（2026-08-05 产品优化）

**用户反馈**：硬拦 `~/Projects` 不合理——(1) 需要权限应弹窗授权；(2) 特权/全自动巡航不应再替用户决定路径。

| 源区域 | 行为 |
|--------|------|
| Downloads / 下载 / OS temp / `~/.cmspark-agent` | **default** — 允许 |
| 用户主目录（含 `~/Projects`） | **user_home** — 允许；**L2 确认 = 用户授权**（非硬拒） |
| 主目录外且非 default | **denied** — 硬拒（避免系统路径进技能库）；L2 前预检，不弹无意义确认 |
| 全自动巡航（`auto_approve_dangerous` + `auto_approve_enterprise_tools` + `allow_all_schemes`） | 与其它 critical 工具一致：**免 L2**；源区域规则仍生效 |

实现：`companion/src/skills/skill-install.ts`（`classifySkillInstallSource`）+ `server.ts` L2 预检 / `source_tier` 预览。

## 6. 变更日志

| 日期 | 变更 |
|------|------|
| 2026-08-01 | 初版 backlog：用户场景记录；P0 skill_install；挂 Composition |
| 2026-08-05 | 源路径：主目录可装 + L2 授权；系统路径仍拒；巡航与 forceConfirm 代数对齐说明 |
