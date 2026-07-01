# Project Context

## Session Handoff

<!-- handoff:start -->
### 2026-07-01 (session-end)
- 交付 Side Panel Mermaid 图表渲染：` ```mermaid ` 块 → SVG 图（全类型，各自懒加载 chunk）。流程：grilling 5 题设计树 → CSP runtime spike（验证 strict CSP 可客户端直跑，无 sandbox/offscreen/server）→ 5 阶段实现 + kimi 门
- 已合并 main：PR #9 代码（squash 999a307）+ PR #10 文档（squash 94ca77e）。两分支已清理，本地 main 同步 94ca77e
- 关键决策：客户端直跑 strict CSP；纵深防御净化（securityLevel:'strict' + htmlLabels:false 纯 SVG → DOMPurify SVG profile 二次过，特权页面下不可信 SVG 绝不绕过）；仅落定消息渲染（renderMermaid prop，流式当代码块）；响应式缩放 + 点击新标签页开全尺寸（Blob URL）；懒加载 + idle/流式双预取；坏语法回退代码块
- bug 修复：DOMPurify SVG profile 剥 foreignObject + mermaid 默认 htmlLabels:true → 节点文字消失；`htmlLabels:false` 修复（用户 live 验证通过）
- 打包坑：`@mermaid-js/parser@1.2.0` exports 只有 import（无 default）→ Plasmo/Parcel build 失败 → `package.json` 加 alias 指向其 dist
- 详见 docs/adr/009-mermaid-rendering.md（CLAUDE.md A7 / GOAL / arch §6 同步）
- Next: 无未决项；可选后续 = 全局 style-src CSP 硬化（C3，独立议题）/ mermaid 锁版本关注上游 CVE

### 2026-06-28 (session-end)
- 根因定位+修复: tray↔daemon WebSocket skill.list 请求/响应死循环 → 两进程空闲 ~60%/45% CPU、本地 socket 29MB/s、累计 ~108GB。daemon 响应不带请求 id,tray 把响应误当 push 再发请求
- 已合并 main: PR #4 (squash, 3e60cc5)。两处互补修复: server.ts 响应透传 id + companion-client.ts 移除 skill.list push 误触发 + 守卫注释。bug 在共享 TS → Windows/Linux 同样中招,一份修复覆盖全平台
- 验证: kimi 改动前复审 APPROVE×2、tsc 绿、ws-roundtrip 5/5、部署后实测 CPU 60%→0
- 部署坑: .app 不能只换 bundle(node_modules 依赖漂移,缺 @modelcontextprotocol/sdk)→ 必须 make package-macos 整机重打包
- 沉淀: 个人技能 kimi-gated-fix(~/.config/skills/kimi-gated-fix/)——定点修复改动前 kimi 复审的动态工作流
- Next: 确认稳定后删旧 app 备份;Windows/Linux 出包重装(make package-windows/linux)
<!-- handoff:end -->
