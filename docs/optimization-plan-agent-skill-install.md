# 后续优化方向：Agent 下载并安装外部 Skill（CMspark 可用）

> **日期**: 2026-08-01  
> **状态**: Backlog — **未实现**  
> **触发**: 用户场景 + 会话 #au4dch（装 Black-cat / pentest-redteam）  
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
| **LLM 一等 tool** 安装 skill（path/zip/url → 固定写入用户 skills + refresh） | ❌ |
| Agent 仅靠 shell 猜路径时易装错目录 | 痛点（#au4dch） |

`skill.import*` 现为 **UI ↔ Companion WS**，不在 LLM tool 表中。

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

## 5. 变更日志

| 日期 | 变更 |
|------|------|
| 2026-08-01 | 初版 backlog：用户场景记录；P0 skill_install；挂 Composition |
