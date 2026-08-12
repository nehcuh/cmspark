# 四路对立对抗复审 — thread-id + large skill zip + download recovery

**日期**: 2026-08-12  
**范围**: 未提交工作树（相对 `HEAD`）  
**阶段**: 内部对抗（四 agent）→ 待 Claude+Pi 双路外审

## 变更摘要

| 轨 | 文件 | 意图 |
|----|------|------|
| UI | ThreadList / StatusRail / thread-timeline | 常驻 `#id`、点击复制、搜索含 tldr/bullets |
| skill | skill-engine / skill-install | 大 ZIP 预算上调；monorepo 只装 SKILL 子树；FromPath 免 base64 |
| download | browser-download-handler | DOWNLOAD_TIMEOUT 后扫 chrome.downloads 恢复 |

## 四路裁决

| 路 | 焦点 | 裁决 |
|----|------|------|
| A 安全 | zip / L2 / timeout recovery | **REJECT** |
| B 正确性 | skill_install / monorepo / 测试 | **REJECT** |
| C 下载恢复 | BD-WAITER vs cache recovery | **REJECT** |
| D UI | 编号可见性 / 搜索 / a11y | **CONDITIONAL PASS** |

**内部综合**: **REQUEST CHANGES**（不可直接 merge-ready）。UI 轨可随主修复一并收尾；skill + download 有 HIGH 级正确性/安全问题。

---

## 合并阻塞项（HIGH / P1）

### B1. L2 预览 SKILL.md 选择 ≠ 安装选择
- **预览** `skillInstallOverwritePreview`: `entries.find` 第一个 `SKILL.md`
- **安装** `pickSkillMdEntry`: 优先 `skills/` + 最深路径
- **影响**: 确认弹窗 name/overwrite 与真实安装不一致；token `ow=` 绑定错名
- **修**: 共享 `pickSkillMdEntry`；多候选 fail-closed 或显式选择

### B2. DOWNLOAD_TIMEOUT 恢复可返回陈旧 complete（且无视 force_redownload）
- recovery = 无时间窗的 prefer_existing
- 与 BD-WAITER「禁止 latch 预注册 complete」对立
- 测试用 `force_redownload: true` 断言 cache 成功 → 固化错误语义
- **修**: 仅当 `startTime/endTime ≥ registeredAt`；`force_redownload` 时不做 cache recovery；多匹配失败

### B3. 覆盖安装失败会先删旧 skill
- `rmSync(dest)` 后 extract；失败清 partial → 旧 skill 丢失
- **修**: 解到 `*.tmp` 再 rename

### B4. 生产 FromPath 路径几乎无测
- stub 无 `importSkillFolderFromPath` → 永远走 base64 假路径
- **修**: 真实 AdmZip + FromPath spy / integration

---

## 中优先级

| ID | 项 |
|----|-----|
| M1 | 多 `skills/*/SKILL.md` 静默 deepest-wins |
| M2 | 文本钮 `Download ZIP` 无 hint 时 recovery 无效；半截 hint 过宽匹配 |
| M3 | 历史「日」分组搜索时仍折叠 → 复制编号搜索可能看不见行 |
| M4 | 剪贴板失败静默；execCommand false 仍「已复制」 |
| M5 | zip header size=0 时 getData 先撑内存 |
| M6 | path 导入 UTF-8 读二进制资源会坏（hint 却建议 path=） |

---

## UI 路（可随修）

- 列表/顶栏 `#id` + 复制 bare id：**成立**
- 搜索字段扩展：**成立**；日折叠与「未命名」可搜性为 nits

---

## 建议修序（双路后）

1. B2 download recovery 时间窗 + force_redownload 门控 + 改测试  
2. B1 统一 pickSkillMdEntry 进 preview  
3. B3 原子覆盖  
4. B4 / monorepo 多候选 + M3 日展开  

---

## 残留风险（接受则文档化）

- 大 skill 仍整包进进程内存（100MB 级）  
- L2 后 skill 内容仍不可信（prompt 面）  
- 非 `browser_download` 的 `navigate` 到 zip 仍不挂 waiter  

**内部 VERDICT: REJECT / REQUEST CHANGES**
