# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-03 (session-end)
- 审核并修复 cmspark config API key 同步问题：`DEEPSEEK_API_KEY` env var 强制覆盖用户通过 UI/Tray 设置的 key，导致 Tray 与 Extension 配置不一致
- 已推送到远程 main：commit `944dbea`。改动包括：
  - `companion/src/config.ts`：新增 `isUserProvidedApiKey()` + `resolveApiKey()`，优先级 = 新非 masked key > 当前用户 key > env var；env var 仅在等于当前值时落盘为空
  - 导出统一 `isMaskedApiKey()` 并在 `settings-web.ts` 复用；`chrome-extension` 两端实现同步，支持 `sk-****xyz` 短格式
  - `message-router.ts`：所有硬编码 `"***"` 检查替换为 `isMaskedApiKey()`；`config.test` 识别 `sk-placeholder` 与 masked key，修复 2 个既有失败测试
  - `saveConfig` 对 `vision.api_key` 应用同样的 masked key 过滤
  - 新增 `companion/tests/config.test.ts`：17 个用例覆盖 key 优先级、env var 不落盘、vision key 保护
- 验证：companion + chrome-extension 构建通过；相关测试 105/105 通过
- Next: 无未决项；可观察用户是否仍有 UI 与文件配置不同步的反馈

### 2026-07-01 (session-end)
- 交付 Side Panel Mermaid 图表渲染：` ```mermaid ` 块 → SVG 图（全类型，各自懒加载 chunk）。流程：grilling 5 题设计树 → CSP runtime spike（验证 strict CSP 可客户端直跑，无 sandbox/offscreen/server）→ 5 阶段实现 + kimi 门
- 已合并 main：PR #9 代码（squash 999a307）+ PR #10 文档（squash 94ca77e）。两分支已清理，本地 main 同步 94ca77e
- 关键决策：客户端直跑 strict CSP；纵深防御净化（securityLevel:'strict' + htmlLabels:false 纯 SVG → DOMPurify SVG profile 二次过，特权页面下不可信 SVG 绝不绕过）；仅落定消息渲染（renderMermaid prop，流式当代码块）；响应式缩放 + 点击新标签页开全尺寸（Blob URL）；懒加载 + idle/流式双预取；坏语法回退代码块
- bug 修复：DOMPurify SVG profile 剥 foreignObject + mermaid 默认 htmlLabels:true → 节点文字消失；`htmlLabels:false` 修复（用户 live 验证通过）
- 打包坑：`@mermaid-js/parser@1.2.0` exports 只有 import（无 default）→ Plasmo/Parcel build 失败 → `package.json` 加 alias 指向其 dist
- 详见 docs/adr/009-mermaid-rendering.md（CLAUDE.md A7 / GOAL / arch §6 同步）
- Next: 无未决项；可选后续 = 全局 style-src CSP 硬化（C3，独立议题）/ mermaid 锁版本关注上游 CVE
<!-- handoff:end -->
