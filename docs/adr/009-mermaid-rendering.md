# ADR-009: Side Panel Mermaid 图表渲染

**日期**: 2026-07-01 | **状态**: 已确认（PR #9 已合并）

## 背景

Side Panel 用 `marked` + KaTeX 扩展把 LLM 输出渲染成 HTML，再经 `DOMPurify` 白名单净化后 `dangerouslySetInnerHTML` 注入（见 `sidepanel/components/ChatView.tsx` 的 `MarkdownRenderer`）。`react-markdown`/remark 生态因 ESM + Node 依赖在扩展上下文崩溃，故渲染栈固定在 `marked`。

LLM 经常产出 ` ```mermaid ` 围栏块（流程图/时序图/gantt/类图/ER/状态机…），但此前只当代码块原样显示，无可读图形。需要把 mermaid 块渲染成 SVG 图。

四条硬约束：

1. **MV3 strict CSP**：扩展页面默认 `script-src 'self'; object-src 'self'`，**禁止 eval / `new Function` / 内联脚本**（manifest 未做任何放宽）。
2. **特权页面 + 不可信输入**：Side Panel 持有 `cookies`/`tabs`/`debugger`/`<all_urls>`；mermaid 源是 LLM 输出，且 agent 会读不可信网页 → 提示注入可控。SVG XSS = 扩展上下文任意 JS = 整个扩展沦陷。
3. **320px 窄面板**：可用内容宽 ~227px，而 mermaid 图原生宽度普遍 400–1000px+。
4. **实时流式**：`StreamingMarkdown` 每 60ms 对**完整累积内容**重跑 `marked.parse`+净化。

## 决策

### 1. 客户端渲染，strict CSP 下直跑（spike 验证）

不引入 sandbox page / offscreen document / companion 端预渲染。mermaid 11.16 客户端 `import` 后 `mermaid.render()` 直出 SVG。

**证据（`[executed]` spike）**：prod 构建（CSP `undefined` = MV3 默认）下渲染流程图成功，**无 `securitypolicyviolation`**。静态扫描 mermaid 全量 bundle：`eval` / `new Function` / string-timer / `.constructor.constructor` 全为 0；唯一的 `Function("return this")()` 是 lodash `_root.js` 取全局的写法，在浏览器被 `self`（`=window`）短路、永不执行。

### 2. 纵深防御净化（决策 C1）

| 层 | 手段 |
|---|---|
| ① mermaid 初始化 | `securityLevel:'strict'`（关 `foreignObject`/HTML 标签 + click 交互）+ `htmlLabels:false`（强制 `<text>`/`<tspan>`，**见下 §5 关键坑**）→ 产出**纯 SVG** |
| ② 我们的 DOMPurify | 对 mermaid 产出的 SVG 串**二次过** `DOMPurify.sanitize(svg, { USE_PROFILES: { svg:true, svgFilters:true } })`（DOMPurify 维护的完整 SVG 白名单，无需手维护） |

两层独立 DOMPurify（mermaid 内置那版 + 我们的），剥 `<script>`/`on*`/`foreignObject`/`use`/`animate`。**特权页面上不可信 SVG 必须过净化，绝不绕过。**

> 残留：`<style>`/`<image>` 的 CSS / 外链资源外泄面 —— 现有 markdown 渲染器本就允许 `style` 属性，mermaid 不新增此面；全局 `style-src` 硬化（决策 C3）留作独立议题。

### 3. 仅落定消息渲染（方案 A）

`MarkdownRenderer` 加 `renderMermaid: boolean` prop：`MessageRow`/`CollapsibleMarkdown` 传 `true`，`StreamingMarkdown` 传 `false`（默认）。流式期间 ` ```mermaid ` 当代码块显示，`chat.done` 落定后由 `useEffect` 后处理成图。

理由：半成品图无可读性；逐 token 重渲染会闪烁/解析错误/烧 CPU。

### 4. 响应式缩放 + 点击放大（方案 F3）

SVG `width:100%; height:auto`（mermaid 自带 viewBox 等比缩放）+ `max-height:60vh` 纵向滚动兜底。点击图 → `Blob` URL → `chrome.tabs.create({url})` 在新标签页开全尺寸（`blob:` 顶层导航在 MV3 允许，不像 `data:` 被禁）。320px 纯缩放会致文字 5–7pt 半残，"点击放大"是可读性的兜底，几乎零代码（无 overlay 组件）。

### 5. 懒加载 + 双预取（方案 G3）

`ensureMermaid()` 用模块级 `mermaidPromise` once-guard `import('mermaid')` + `initialize`。预取两条非关键路径：`ChatView` mount 后 `requestIdleCallback`（覆盖打开历史 thread 直接含图的场景）+ `StreamingMarkdown` 首个 token（覆盖新对话场景）。面板秒开，首图不 stall。各 diagram 类型本就是 Parcel 自动 code-split 的懒加载 chunk，启用全部类型零成本。

### 6. 失败兜底

`mermaid.render` 抛错（LLM 常吐坏 mermaid）→ 保留原代码块 + 注入 "⚠️ 图表语法错误，显示源码"，绝不空白。

## 关键坑（grilling + kimi 门 + 实测产出）

- **`@mermaid-js/parser` 的 Parcel 解析失败**：mermaid 11 把 parser 拆成 `@mermaid-js/parser@1.2.0`，其 `package.json` `exports` **只有 `import` 条件、缺 `default`**，Plasmo 0.90.5 的 Parcel resolver 解析不了 → build 报 `Failed to resolve '@mermaid-js/parser'`。修：`package.json` 加 `"alias": { "@mermaid-js/parser": "@mermaid-js/parser/dist/mermaid-parser.core.mjs" }`。
- **`htmlLabels:false` 是 mandatory**：mermaid 默认 `htmlLabels:true` 把**节点**标签渲成 `<foreignObject><div>…`，而 DOMPurify SVG profile **剥 `foreignObject`** → 节点文字消失（只有 `<text>` 的边/箭头标签存活，表现为"有些字有、有些没有"）。设 root-level `htmlLabels:false` 强制纯 `<text>`，与 §2 的纯 SVG 假设一致。代价：标签失去富文本样式（加粗/斜体），降级为普通 SVG 文本。
- **React 异步 effect 竞态**：`renderMermaidBlocks` 异步改 DOM（在 `dangerouslySetInnerHTML` 之外）。守护：进入循环即同步置 `dataset.mermaidRendered='pending'`（防同一 `<pre>` 并发重复渲染），`await` 后复查 `pre.isConnected`（React 重注入会 detach 旧 `<pre>`，此时跳过），`done`/`error` 标记后置。SVG id 用模块级 `renderSeq` 计数器保证唯一。

## 后果

**正面**：mermaid 全类型图表在 Side Panel 可读渲染；CSP-safe 客户端直跑（无 sandbox/offscreen/server 的架构债）；特权页面下不可信 SVG 双层净化；面板秒开 + 首图不 stall；坏语法优雅降级。

**权衡 / 后续**：
- `htmlLabels:false` 牺牲节点标签富文本样式（可读性优先）。
- 残留 `<style>`/`<image>` 资源外泄面（与现有 markdown 渲染器同面），全局 `style-src` 硬化（C3）为独立议题。
- 图源仍依赖 mermaid 库自身的 parser 正确性；锁版本 `^11.16` + 关注上游 CVE。
- Obsidian 导出路径**不受影响**（序列化原始 markdown 含 ` ```mermaid `，面板渲染仅为视图层；vault 端由 Obsidian 自身渲染）。
