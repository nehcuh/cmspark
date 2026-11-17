# 侧栏项目优先布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点「项目」就看到可点击的已注册项目，并按项目、最近对话、工具、设置分层；默认恢复上次有效对话。

**Architecture:** 决定放在纯函数里，展示组件只接收这些决定并渲染按钮。`ProjectPanel` 和新建的 `SidePanelLayers` 负责把现有 `project.list`、`thread.project.set` 和线程存储接上。不改 Companion 的项目存储、协议和权限。

**Tech Stack:** Chrome 扩展 React 18、`node:test`、`tsc -p tsconfig.test.json`、现有 `chrome.runtime` 项目请求。

## Global Constraints

- 追踪 GitHub #857。实现 PR 写 `Refs #857`，不关闭 #857、#753、#476、#853。
- 基线 `4b1f4891db39d945c31b2b226bfa7eb58db0337d`。不改版本号、tag、Release、CHANGELOG 版本标题。
- 不修改、不合并 PR #856。它合入 main 后用 merge 同步，不 rebase 已推送提交。
- 不把项目改成目录，不扫文件夹，不迁移旧对话，不改项目 id、`projects.json`、OCC、忙门、capability、命令授权或 L2。
- enterprise 始终提供 shell，命令授权仍独立。不改 #853 的设置开关。
- 已有项目行是 `button`，不是 `<option>`。新建和管理默认关闭，打开列表时不 `focus()` 名称框。
- 浏览不发送 `thread.project.set`，不改 `workspace_root` 或授权。
- 断连、执行中、待确认时禁用改归属；浏览仍可用。断连清掉 `threadBusyById` 后也不能重新启用改归属。
- 项目内新对话仍是 create 然后 set 的两步。set 回执匹配前不算归入。
- 不自动 `thread.create`，不把 `thread.list` 的第一项当成上次对话。
- 窄于 960px 一次一层；960px 及以上导航常驻。删除 28dvh 弹层和 42dvh 项目嵌套滚动。
- 交互验收用 `react-dom/client` 点击和键盘。不用 `renderToStaticMarkup` 代替这些断言。
- 颜色继续走 `tokens`。不新增 raw hex。
- 每个节点独立对抗评审。FAIL 先改再评。节点 3 才跑全量和同 SHA 的十个 CI 检查。

---

### Task 1: 项目列表决定

**Files:**

- Create: `chrome-extension/src/sidepanel/navigation/project-copy.ts`
- Create: `chrome-extension/src/sidepanel/navigation/project-list-model.ts`
- Test: `chrome-extension/tests/project-list-model.test.ts`

**Interfaces:**

- Consumes: `Project` 与 `isProject`，来自 `chrome-extension/src/sidepanel/utils/project-request.ts`。
- Produces: `projectCopy`、`visibleProjects`、`applyProjectListResult`、`parseProjectListCache`、`membershipEnabled`、`sessionContextLines`。后续组件只从这里取文案和决定。

- [ ] **Step 1: Write the failing test**

把下面三个文件写成所述内容。生产函数先 `throw new Error("not implemented")`，让测试在运行时失败，而不是停在找不到模块。

`chrome-extension/src/sidepanel/navigation/project-copy.ts`

```ts
export const projectCopy = {
  loading: "正在读取项目",
  updating: "正在更新项目列表",
  empty: "还没有项目",
  archiveEmpty: "没有归档项目",
  noMatch: "没有匹配的项目",
  listFailed: "项目列表没有取回",
  saveFailed: "项目没有保存",
  offlineEmpty: "无法取回项目列表",
  emptyProject: "这个项目还没有对话",
  bindFailed: "新对话已创建在项目外；归入尚未确认",
  bindOk: "新对话已归入这个项目",
  createFailed: "新对话尚未确认创建，请刷新核实。",
  restoreInvalid: "上次对话已不在，已回到项目首页",
  restoreNone: "没有可恢复的上次对话",
  offline: "离线",
  busyMove: "先结束执行或处理待确认操作，再整理。",
  offlineMove: "连接断开，归属整理已停用。",
  workspaceUnbound: "未绑定工作目录",
  workspaceStale: "工作目录暂时无法刷新",
  workspaceUnrefreshed: "未能刷新",
  executionOffline: "执行状态：离线",
  executionIdle: "执行状态：空闲",
  executionBusy: "执行状态：执行中",
  executionPending: "执行状态：待确认",
  showArchived: "查看归档",
  showActive: "返回未归档",
  clearSearch: "清除搜索",
  createSummary: "新建项目",
  manageSummary: "管理项目",
  moveLegend: "更改当前会话归属",
  moveOut: "移出项目",
  back: "返回",
  projects: "项目",
  recent: "最近对话",
  tools: "工具",
  settings: "设置",
  currentTools: "当前任务",
  otherTools: "其他工具",
  outside: "项目外",
  inProject: "项目内新对话",
} as const

export function offlineCached(fetchedAt: string): string {
  return `离线，列表更新于 ${fetchedAt}`
}

export function falseEmptyCopy(text: string): boolean {
  return text.includes(projectCopy.empty) || text.includes("没有会话")
}
```

`chrome-extension/src/sidepanel/navigation/project-list-model.ts`

```ts
import type { Project } from "../utils/project-request"

export interface VisibleProjectInput {
  projects: Project[]
  query: string
  archiveView: boolean
}

export function visibleProjects(_input: VisibleProjectInput): Project[] {
  throw new Error("not implemented")
}

export interface ListSnapshot {
  revision: number
  projects: Project[]
  fetchedAt: string
  generation: number
}

export type ListApplyReason = "applied" | "stale-generation" | "older-revision"

export function applyProjectListResult(_current: ListSnapshot | null, _incoming: ListSnapshot): { snapshot: ListSnapshot | null; applied: boolean; reason: ListApplyReason } {
  throw new Error("not implemented")
}

export interface StoredProjectList {
  format: 1
  revision: number
  projects: Project[]
  fetchedAt: string
}

export const PROJECT_LIST_CACHE_KEY = "cmspark.project.list.v1"

export function parseProjectListCache(_raw: string | null): StoredProjectList | null {
  throw new Error("not implemented")
}

export function membershipEnabled(_input: {
  connection: "connected" | "connecting" | "disconnected"
  busy: boolean
  pendingConfirmations: number
  metadataUnavailable: boolean
  hasThread: boolean
}): boolean {
  throw new Error("not implemented")
}

export function sessionContextLines(_input: {
  projectName: string | null
  threadTitle: string
  connection: "connected" | "connecting" | "disconnected"
  workspaceRoot: string | null | undefined
  busy: boolean
  pending: boolean
}): { breadcrumb: string; workspace: string; execution: string } {
  throw new Error("not implemented")
}
```

`chrome-extension/tests/project-list-model.test.ts`

```ts
import test from "node:test"
import assert from "node:assert/strict"
import type { Project } from "../src/sidepanel/utils/project-request"
import { falseEmptyCopy, offlineCached, projectCopy } from "../src/sidepanel/navigation/project-copy"
import {
  applyProjectListResult,
  membershipEnabled,
  parseProjectListCache,
  sessionContextLines,
  visibleProjects,
  type ListSnapshot,
} from "../src/sidepanel/navigation/project-list-model"

const active: Project = { id: "11111111-1111-4111-8111-111111111111", name: "Alpha", created_at: "2026-11-17T00:00:00.000Z", updated_at: "2026-11-17T00:00:00.000Z", archived_at: null }
const emptyNamed: Project = { ...active, id: "22222222-2222-4222-8222-222222222222", name: "空项目" }
const archived: Project = { ...active, id: "33333333-3333-4333-8333-333333333333", name: "旧项目", archived_at: "2026-11-17T01:00:00.000Z" }

test("visible projects keep empty unarchived rows and hide archived rows", () => {
  const rows = visibleProjects({ projects: [active, emptyNamed, archived], query: "", archiveView: false })
  assert.deepEqual(rows.map(row => row.name), ["Alpha", "空项目"])
})

test("search miss is not the empty-project state and can be cleared by an empty query", () => {
  assert.deepEqual(visibleProjects({ projects: [active], query: "没有这个", archiveView: false }), [])
  assert.equal(visibleProjects({ projects: [active], query: "  alpha ", archiveView: false })[0].id, active.id)
})

test("archive view shows only archived projects", () => {
  assert.deepEqual(visibleProjects({ projects: [active, archived], query: "", archiveView: true }).map(row => row.id), [archived.id])
})

test("stale generation and older revision do not replace the newer snapshot", () => {
  const current: ListSnapshot = { revision: 5, projects: [active], fetchedAt: "t5", generation: 2 }
  const stale = applyProjectListResult(current, { ...current, revision: 9, generation: 1, fetchedAt: "late" })
  assert.equal(stale.applied, false)
  assert.equal(stale.reason, "stale-generation")
  assert.equal(stale.snapshot?.fetchedAt, "t5")
  const older = applyProjectListResult(current, { ...current, revision: 4, generation: 3, fetchedAt: "old" })
  assert.equal(older.reason, "older-revision")
  assert.equal(older.snapshot?.revision, 5)
  const next = applyProjectListResult(current, { ...current, revision: 6, generation: 3, fetchedAt: "t6" })
  assert.equal(next.applied, true)
  assert.equal(next.snapshot?.fetchedAt, "t6")
})

test("corrupt cache is absence, not an empty project list", () => {
  assert.equal(parseProjectListCache(null), null)
  assert.equal(parseProjectListCache("{"), null)
  assert.equal(parseProjectListCache(JSON.stringify({ format: 1, revision: 1, fetchedAt: "t", projects: [{ ...active, workspace_root: "/tmp" }] })), null)
  const parsed = parseProjectListCache(JSON.stringify({ format: 1, revision: 2, fetchedAt: "t2", projects: [active, archived] }))
  assert.equal(parsed?.revision, 2)
  assert.equal(parsed?.projects.length, 2)
})

test("membership stays disabled after disconnect even when busy was cleared", () => {
  assert.equal(membershipEnabled({ connection: "disconnected", busy: false, pendingConfirmations: 0, metadataUnavailable: false, hasThread: true }), false)
  assert.equal(membershipEnabled({ connection: "connected", busy: true, pendingConfirmations: 0, metadataUnavailable: false, hasThread: true }), false)
  assert.equal(membershipEnabled({ connection: "connected", busy: false, pendingConfirmations: 1, metadataUnavailable: false, hasThread: true }), false)
  assert.equal(membershipEnabled({ connection: "connected", busy: false, pendingConfirmations: 0, metadataUnavailable: false, hasThread: true }), true)
})

test("session lines do not call a disconnected known directory unbound or idle", () => {
  const offline = sessionContextLines({ projectName: "Alpha", threadTitle: "笔记", connection: "disconnected", workspaceRoot: "/work/alpha", busy: false, pending: false })
  assert.equal(offline.breadcrumb, "Alpha / 笔记")
  assert.equal(offline.workspace, "/work/alpha，未能刷新")
  assert.equal(offline.execution, projectCopy.executionOffline)
  const unknown = sessionContextLines({ projectName: null, threadTitle: "笔记", connection: "disconnected", workspaceRoot: null, busy: false, pending: false })
  assert.equal(unknown.breadcrumb, "项目外 / 笔记")
  assert.equal(unknown.workspace, projectCopy.workspaceStale)
  const idle = sessionContextLines({ projectName: null, threadTitle: "笔记", connection: "connected", workspaceRoot: "", busy: false, pending: false })
  assert.equal(idle.workspace, projectCopy.workspaceUnbound)
  assert.equal(idle.execution, projectCopy.executionIdle)
  assert.equal(falseEmptyCopy(offlineCached("t2")), false)
  assert.equal(falseEmptyCopy(projectCopy.offlineEmpty), false)
  assert.equal(offlineCached("t2"), "离线，列表更新于 t2")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && rm -rf .test-dist && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/project-list-model.test.js`

Expected: FAIL，消息含 `not implemented`。

- [ ] **Step 3: Write minimal implementation**

用下面的函数替换 `project-list-model.ts` 里每个 throw。保留文件顶部的 import 和类型。

```ts
import { isProject, type Project } from "../utils/project-request"
import { projectCopy } from "./project-copy"

export function visibleProjects(input: VisibleProjectInput): Project[] {
  const query = input.query.trim().toLocaleLowerCase()
  return input.projects.filter(project => {
    const archived = project.archived_at !== null
    if (input.archiveView !== archived) return false
    if (!query) return true
    return project.name.toLocaleLowerCase().includes(query)
  })
}

export function applyProjectListResult(current: ListSnapshot | null, incoming: ListSnapshot): { snapshot: ListSnapshot | null; applied: boolean; reason: ListApplyReason } {
  if (current && incoming.generation < current.generation) return { snapshot: current, applied: false, reason: "stale-generation" }
  if (current && incoming.revision < current.revision) return { snapshot: current, applied: false, reason: "older-revision" }
  return { snapshot: incoming, applied: true, reason: "applied" }
}

export function parseProjectListCache(raw: string | null): StoredProjectList | null {
  if (!raw) return null
  let value: unknown
  try { value = JSON.parse(raw) } catch { return null }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  if (record.format !== 1 || !Number.isSafeInteger(record.revision) || Number(record.revision) < 0) return null
  if (typeof record.fetchedAt !== "string" || !Array.isArray(record.projects) || record.projects.length > 256) return null
  if (!record.projects.every(isProject)) return null
  return { format: 1, revision: Number(record.revision), projects: record.projects, fetchedAt: record.fetchedAt }
}

export function membershipEnabled(input: {
  connection: "connected" | "connecting" | "disconnected"
  busy: boolean
  pendingConfirmations: number
  metadataUnavailable: boolean
  hasThread: boolean
}): boolean {
  return input.connection === "connected" && input.hasThread && !input.busy && input.pendingConfirmations === 0 && !input.metadataUnavailable
}

export function sessionContextLines(input: {
  projectName: string | null
  threadTitle: string
  connection: "connected" | "connecting" | "disconnected"
  workspaceRoot: string | null | undefined
  busy: boolean
  pending: boolean
}): { breadcrumb: string; workspace: string; execution: string } {
  const root = typeof input.workspaceRoot === "string" ? input.workspaceRoot.trim() : ""
  const workspace = input.connection !== "connected"
    ? (root ? `${root}，${projectCopy.workspaceUnrefreshed}` : projectCopy.workspaceStale)
    : (root ? root : projectCopy.workspaceUnbound)
  const execution = input.connection !== "connected"
    ? projectCopy.executionOffline
    : input.pending ? projectCopy.executionPending : input.busy ? projectCopy.executionBusy : projectCopy.executionIdle
  return { breadcrumb: `${input.projectName ?? projectCopy.outside} / ${input.threadTitle}`, workspace, execution }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd chrome-extension && rm -rf .test-dist && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/project-list-model.test.js`

Expected: PASS，`# fail 0`。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/navigation/project-copy.ts chrome-extension/src/sidepanel/navigation/project-list-model.ts chrome-extension/tests/project-list-model.test.ts
git commit -m "test: lock project list visibility and stale snapshots"
```

### Task 2: 可点击项目列表

**Files:**

- Create: `chrome-extension/tests/support/interaction-dom.ts`
- Create: `chrome-extension/src/sidepanel/components/ProjectListView.tsx`
- Modify: `chrome-extension/src/sidepanel/components/ProjectPanel.tsx`
- Modify: `chrome-extension/src/sidepanel/ui/workspace-styles.ts`（`.cm-project-controls` 那一行）
- Test: `chrome-extension/tests/project-list-interaction.test.ts`

**Interfaces:**

- Consumes: Task 1 的 `visibleProjects`、`projectCopy`、`offlineCached`、`falseEmptyCopy`。
- Produces: `ProjectListView`。`onOpen(projectId: string)` 只表示查看。`ProjectPanel` 的行点击不得调用 `onFilter` 或 `thread.project.set`。

- [ ] **Step 1: Write the failing test**

先写支持层和会失败的组件外壳，再写测试。`ProjectListView` 先渲染空的 `div`，让断言失败。

`chrome-extension/tests/support/interaction-dom.ts`

```ts
type Handler = (event: DomEvent) => void
interface Listener { capture: boolean; fn: Handler }
export interface DomEvent {
  type: string
  bubbles: boolean
  cancelable: boolean
  target: DomNode | null
  currentTarget: DomNode | null
  key: string
  defaultPrevented: boolean
  stopped: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

export class DomNode extends EventTarget {
  nodeType = 1
  nodeName: string
  tagName: string
  namespaceURI = "http://www.w3.org/1999/xhtml"
  ownerDocument: InteractionDocument | null = null
  parentNode: DomNode | null = null
  childNodes: DomNode[] = []
  attributes: Record<string, string> = {}
  style: Record<string, string> & { setProperty: (name: string, value: string) => void } = { setProperty: () => undefined }
  className = ""
  value = ""
  disabled = false
  open = false
  textData = ""
  listeners: Record<string, Listener[]> = {}
  constructor(tag: string) {
    super()
    this.tagName = tag.toUpperCase()
    this.nodeName = this.nodeType === 3 ? "#text" : this.tagName
  }
  get firstChild() { return this.childNodes[0] ?? null }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null }
  get nextSibling() {
    const siblings = this.parentNode?.childNodes ?? []
    return siblings[siblings.indexOf(this) + 1] ?? null
  }
  get textContent(): string {
    if (this.nodeType === 3) return this.textData
    return this.childNodes.map(child => child.textContent).join("")
  }
  set textContent(value: string) {
    const text = new DomNode("#text")
    text.nodeType = 3
    text.nodeName = "#text"
    text.textData = String(value)
    text.ownerDocument = this.ownerDocument
    text.parentNode = this
    this.childNodes = value === "" ? [] : [text]
  }
  appendChild<T extends DomNode>(node: T): T {
    return this.insertBefore(node, null)
  }
  insertBefore<T extends DomNode>(node: T, reference: DomNode | null): T {
    if (node.parentNode) node.parentNode.removeChild(node)
    node.parentNode = this
    node.ownerDocument = this.ownerDocument
    const index = reference ? this.childNodes.indexOf(reference) : -1
    if (reference && index >= 0) this.childNodes.splice(index, 0, node)
    else this.childNodes.push(node)
    return node
  }
  removeChild<T extends DomNode>(node: T): T {
    const index = this.childNodes.indexOf(node)
    if (index < 0) throw new Error("node is not a child")
    this.childNodes.splice(index, 1)
    node.parentNode = null
    return node
  }
  setAttribute(name: string, value: string) { this.attributes[name] = String(value) }
  getAttribute(name: string) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null }
  removeAttribute(name: string) { delete this.attributes[name] }
  setAttributeNS(_namespace: string, name: string, value: string) { this.setAttribute(name, value) }
  contains(node: DomNode | null): boolean {
    let current = node
    while (current) {
      if (current === this) return true
      current = current.parentNode
    }
    return false
  }
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this }
  addEventListener(type: string, fn: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) {
    const capture = options === true || (typeof options === "object" && !!options.capture)
    const listener = typeof fn === "function" ? fn : fn.handleEvent.bind(fn)
    this.listeners[type] = this.listeners[type] ?? []
    this.listeners[type].push({ capture, fn: listener as Handler })
  }
  removeEventListener(type: string, fn: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) {
    const capture = options === true || (typeof options === "object" && !!options.capture)
    this.listeners[type] = (this.listeners[type] ?? []).filter(item => item.fn !== fn || item.capture !== capture)
  }
  emit(type: string, extra: Partial<DomEvent> = {}): DomEvent {
    const event: DomEvent = {
      type, bubbles: true, cancelable: true, target: this, currentTarget: this, key: "", defaultPrevented: false, stopped: false,
      preventDefault() { event.defaultPrevented = true },
      stopPropagation() { event.stopped = true },
      ...extra,
      target: this,
    }
    const chain: DomNode[] = []
    let cursor: DomNode | null = this
    while (cursor) { chain.push(cursor); cursor = cursor.parentNode }
    for (const node of [...chain].reverse()) {
      event.currentTarget = node
      for (const listener of node.listeners[type] ?? []) if (listener.capture) listener.fn(event)
      if (event.stopped) return event
    }
    for (const node of chain) {
      event.currentTarget = node
      for (const listener of node.listeners[type] ?? []) if (!listener.capture) listener.fn(event)
      if (event.stopped) return event
    }
    if (type === "keydown" && this.tagName === "BUTTON" && (event.key === "Enter" || event.key === " ") && !event.defaultPrevented) this.emit("click")
    if (type === "click" && this.tagName === "SUMMARY" && this.parentNode?.tagName === "DETAILS") {
      this.parentNode.open = !this.parentNode.open
      this.parentNode.emit("toggle")
    }
    return event
  }
  click() { this.emit("click") }
  querySelector(selector: string): DomNode | null { return this.querySelectorAll(selector)[0] ?? null }
  querySelectorAll(selector: string): DomNode[] {
    const [head, ...rest] = selector.trim().split(/\s+/)
    const matched = this.descendants().filter(node => node !== this && matches(node, head))
    if (!rest.length) return matched
    return matched.flatMap(node => node.querySelectorAll(rest.join(" ")))
  }
  descendants(): DomNode[] { return this.childNodes.flatMap(child => [child, ...child.descendants()]) }
}

function matches(node: DomNode, selector: string): boolean {
  if (selector.startsWith("[") && selector.endsWith("]")) {
    const body = selector.slice(1, -1)
    const eq = body.indexOf("=")
    if (eq < 0) return node.getAttribute(body) !== null
    return node.getAttribute(body.slice(0, eq)) === body.slice(eq + 1).replace(/^"|"$/g, "")
  }
  return node.tagName.toLowerCase() === selector.toLowerCase()
}

export class InteractionDocument extends DomNode {
  nodeType = 9
  nodeName = "#document"
  body: DomNode
  documentElement: DomNode
  activeElement: DomNode | null = null
  defaultView = globalThis
  constructor() {
    super("#document")
    this.ownerDocument = this
    this.documentElement = new DomNode("html")
    this.body = new DomNode("body")
    this.documentElement.ownerDocument = this
    this.body.ownerDocument = this
    this.appendChild(this.documentElement)
    this.documentElement.appendChild(this.body)
  }
  createElement(tag: string) { return this.bind(new DomNode(tag)) }
  createElementNS(_namespace: string, tag: string) { return this.createElement(tag) }
  createTextNode(text: string) {
    const node = this.bind(new DomNode("#text"))
    node.nodeType = 3
    node.nodeName = "#text"
    node.textData = text
    return node
  }
  createComment() { const node = this.bind(new DomNode("#comment")); node.nodeType = 8; return node }
  createDocumentFragment() { const node = this.bind(new DomNode("#fragment")); node.nodeType = 11; return node }
  private bind(node: DomNode) { node.ownerDocument = this; return node }
}

export function installInteractionDom(): InteractionDocument {
  const document = new InteractionDocument()
  const globals = globalThis as typeof globalThis & {
    document: InteractionDocument
    window: typeof globalThis
    HTMLElement: typeof DomNode
    Element: typeof DomNode
    Node: typeof DomNode
    Document: typeof InteractionDocument
    navigator: { userAgent: string }
  }
  globals.document = document
  globals.window = globalThis
  globals.HTMLElement = DomNode
  globals.Element = DomNode
  globals.Node = DomNode
  globals.Document = InteractionDocument
  globals.navigator = { userAgent: "node-test" }
  return document
}

installInteractionDom()
```

`chrome-extension/src/sidepanel/components/ProjectListView.tsx`

```tsx
export function ProjectListView() {
  return <div />
}
```

`chrome-extension/tests/project-list-interaction.test.ts`

```ts
import "./support/interaction-dom"
import test from "node:test"
import assert from "node:assert/strict"
import { createElement } from "react"
import { createRoot } from "react-dom/client"
import { act } from "react-dom/test-utils"
import type { Project } from "../src/sidepanel/utils/project-request"
import type { Thread } from "../src/sidepanel/types"
import { falseEmptyCopy, projectCopy } from "../src/sidepanel/navigation/project-copy"
import { ProjectListView } from "../src/sidepanel/components/ProjectListView"
import { ProjectPanel } from "../src/sidepanel/components/ProjectPanel"
import { AgentStoreProvider, initialState } from "../src/sidepanel/store/agentStore"

const alpha: Project = { id: "11111111-1111-4111-8111-111111111111", name: "Alpha", created_at: "t", updated_at: "t", archived_at: null }
const archived: Project = { ...alpha, id: "33333333-3333-4333-8333-333333333333", name: "旧项目", archived_at: "t2" }

async function mount(props: Record<string, unknown>) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(createElement(ProjectListView, props)) })
  return {
    container,
    root,
    async rerender(next: Record<string, unknown>) { await act(async () => { root.render(createElement(ProjectListView, next)) }) },
  }
}

function baseProps(over: Record<string, unknown> = {}) {
  return {
    projects: [alpha, archived], query: "", archiveView: false, phase: "ready", fetchedAt: "t", hasSnapshot: true,
    onQuery: () => undefined, onClearQuery: () => undefined, onToggleArchive: () => undefined, onOpen: () => undefined,
    ...over,
  }
}

test("ready list renders project buttons and keeps archived rows out", async () => {
  const opened: string[] = []
  const view = await mount(baseProps({ onOpen: (id: string) => opened.push(id) }))
  const row = view.container.querySelector(`[data-project-id="${alpha.id}"]`) as HTMLElement
  assert.equal(row.tagName, "BUTTON")
  assert.equal(view.container.querySelectorAll("select").length, 0)
  assert.equal(view.container.querySelector(`[data-project-id="${archived.id}"]`), null)
  await act(async () => { (row as unknown as { emit: (type: string, extra?: { key: string }) => void }).emit("keydown", { key: "Enter" }) })
  assert.deepEqual(opened, [alpha.id])
  view.root.unmount()
})

test("loading, empty, search, failure, and offline copies stay distinct", async () => {
  const loading = await mount(baseProps({ projects: [], phase: "loading", hasSnapshot: false, fetchedAt: null }))
  assert.equal(loading.container.textContent?.includes(projectCopy.loading), true)
  assert.equal(falseEmptyCopy(loading.container.textContent ?? ""), false)
  await loading.rerender(baseProps({ projects: [], phase: "ready" }))
  assert.equal(loading.container.textContent?.includes(projectCopy.empty), true)
  await loading.rerender(baseProps({ query: "zzz", phase: "ready" }))
  assert.equal(loading.container.textContent?.includes(projectCopy.noMatch), true)
  assert.equal(loading.container.textContent?.includes(projectCopy.clearSearch), true)
  await loading.rerender(baseProps({ phase: "list-error" }))
  assert.equal(loading.container.textContent?.includes(projectCopy.listFailed), true)
  assert.equal(loading.container.querySelector(`[data-project-id="${alpha.id}"]`)?.tagName, "BUTTON")
  await loading.rerender(baseProps({ phase: "offline" }))
  assert.equal(loading.container.textContent?.includes("离线，列表更新于 t"), true)
  assert.equal(falseEmptyCopy(loading.container.textContent ?? ""), false)
  await loading.rerender(baseProps({ projects: [], phase: "offline", hasSnapshot: false, fetchedAt: null }))
  assert.equal(loading.container.textContent?.includes(projectCopy.offlineEmpty), true)
  assert.equal(falseEmptyCopy(loading.container.textContent ?? ""), false)
  loading.root.unmount()
})

test("opening projects focuses neither the name field nor a select, and browsing does not assign", async () => {
  const sent: Array<Record<string, unknown>> = []
  const listeners = new Set<(message: Record<string, unknown>) => void>()
  const filters: string[] = []
  ;(globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onMessage: { addListener: (fn: (message: Record<string, unknown>) => void) => listeners.add(fn), removeListener: (fn: (message: Record<string, unknown>) => void) => listeners.delete(fn) },
      sendMessage: (message: Record<string, unknown>) => { sent.push(message); return Promise.resolve({ ok: true }) },
    },
    storage: { local: { get: (_key: string, callback: (value: Record<string, unknown>) => void) => callback({}), set: () => undefined } },
  }
  const thread = { id: "thread-a", alias: "笔记", created_at: "t", updated_at: "t", project_id: null, config_override: {}, tool_whitelist: null, pinned_tabs: [], active_skill_ids: [] } as Thread
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(AgentStoreProvider, { initialState: { ...initialState, connectionState: "connected", threads: [thread], activeThreadId: thread.id } },
      createElement(ProjectPanel, { filter: "*", onFilter: (id: string) => filters.push(id) })))
  })
  const summary = [...container.querySelectorAll("summary")].find(node => node.textContent === projectCopy.projects) as unknown as { emit: (type: string) => void }
  await act(async () => { summary.emit("click") })
  const listRequest = sent.find(message => message.type === "project.list")
  await act(async () => {
    listeners.forEach(listener => listener({ id: listRequest?.id, type: "project.state", revision: 1, projects: [alpha] }))
    await Promise.resolve()
  })
  const name = container.querySelector("input")
  assert.notEqual(document.activeElement, name)
  assert.equal(container.querySelector("select"), null)
  const row = container.querySelector(`[data-project-id="${alpha.id}"]`) as unknown as { emit: (type: string) => void }
  await act(async () => { row.emit("click") })
  assert.equal(sent.some(message => message.type === "thread.project.set"), false)
  assert.deepEqual(filters, [])
  const move = [...container.querySelectorAll("button")].find(node => node.textContent === "移入 Alpha") as unknown as { emit: (type: string) => void }
  await act(async () => { move.emit("click") })
  assert.equal(sent.filter(message => message.type === "thread.project.set").length, 1)
  root.unmount()
})
```

红的原因是找不到 `data-project-id`。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && rm -rf .test-dist && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/project-list-interaction.test.js`

Expected: FAIL，`row` 为 `null`，断言 `tagName` 抛错。如果 `createRoot` 因缺 DOM 方法抛错，把缺的方法补进 `interaction-dom.ts` 的同名节点上，直到失败变成断言失败。不要改成 `renderToStaticMarkup`。

- [ ] **Step 3: Write minimal implementation**

替换 `ProjectListView.tsx`：

```tsx
import { projectCopy, offlineCached } from "../navigation/project-copy"
import { visibleProjects } from "../navigation/project-list-model"
import type { Project } from "../utils/project-request"

export function ProjectListView({ projects, query, archiveView, phase, fetchedAt, hasSnapshot, onQuery, onClearQuery, onToggleArchive, onOpen }: {
  projects: Project[]
  query: string
  archiveView: boolean
  phase: "loading" | "refreshing" | "ready" | "list-error" | "offline"
  fetchedAt: string | null
  hasSnapshot: boolean
  onQuery: (value: string) => void
  onClearQuery: () => void
  onToggleArchive: () => void
  onOpen: (projectId: string) => void
}) {
  const rows = hasSnapshot ? visibleProjects({ projects, query, archiveView }) : []
  const status = !hasSnapshot && phase === "loading" ? projectCopy.loading
    : phase === "refreshing" ? projectCopy.updating
    : phase === "offline" && hasSnapshot && fetchedAt ? offlineCached(fetchedAt)
    : phase === "offline" ? projectCopy.offlineEmpty
    : phase === "list-error" && !hasSnapshot ? projectCopy.listFailed
    : null
  const detail = hasSnapshot && rows.length === 0 && query.trim() ? projectCopy.noMatch
    : hasSnapshot && rows.length === 0 && phase !== "loading" && phase !== "offline" && archiveView ? projectCopy.archiveEmpty
    : hasSnapshot && rows.length === 0 && phase === "ready" && !archiveView ? projectCopy.empty
    : null
  return <section aria-label={projectCopy.projects}>
    {status && <p role="status">{status}</p>}
    {phase === "list-error" && hasSnapshot && <p role="alert">{projectCopy.listFailed}</p>}
    <label>搜索项目<input aria-label="搜索项目" value={query} onChange={event => onQuery(event.target.value)} /></label>
    {query.trim() && <button type="button" onClick={onClearQuery}>{projectCopy.clearSearch}</button>}
    <button type="button" onClick={onToggleArchive}>{archiveView ? projectCopy.showActive : projectCopy.showArchived}</button>
    <div role="list">
      {rows.map(project => <button type="button" role="listitem" key={project.id} data-project-id={project.id} onClick={() => onOpen(project.id)}>{project.name}</button>)}
    </div>
    {detail && <p role="status">{detail}</p>}
  </section>
}
```

然后改 `ProjectPanel.tsx`：

- 删除第 71 行 `nameInput.current?.focus()`。
- 删除「项目筛选」「管理项目」「当前对话归属」三个 `<select>`。
- 在说明文字下渲染 `ProjectListView`。`onOpen` 只 `setSelected(id)` 并设置改名草稿，不调用 `onFilter`，不调用 `mutate`。
- 列表请求开始时如果已有 snapshot，保留它，`phase` 用 `refreshing`；没有 snapshot 用 `loading`。失败时不把已有 snapshot 设成 `null`，只设 `list-error`。断连且有 snapshot 用 `offline`。断连且无 snapshot 用 `offline` 且 `hasSnapshot` 为 false。
- 「新建项目」和「管理项目」各自包在默认关闭的 `<details>` 中。管理里的改名、归档、恢复和项目内新对话仍走现有 `mutate`。
- 当前会话归属改成 `membershipEnabled(...)` 为真时才可点的按钮。按钮文案是 `移入 {name}` 和 `移出项目`。点击才 `mutate("thread.project.set", ...)`。禁用时显示 `projectCopy.busyMove` 或 `projectCopy.offlineMove`。
- 成功应用 `project.list` 时调用 `chrome.storage.local.set({ [PROJECT_LIST_CACHE_KEY]: JSON.stringify({ format: 1, revision, projects, fetchedAt: new Date().toISOString() }) })`。打开时用回调形式 `chrome.storage.local.get(PROJECT_LIST_CACHE_KEY, callback)`，再 `parseProjectListCache`；损坏则当没有快照。代际用 `useRef(0)`，每次 `refresh` 加一，回执只在代际仍相等时调用 `applyProjectListResult`。

`workspace-styles.ts` 第 6 行去掉 `max-height:42dvh;overflow:auto;`。项目行按钮使用已有的 `min-height:32px` 规则，不写 hex。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd chrome-extension && rm -rf .test-dist && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/project-list-model.test.js .test-dist/tests/project-list-interaction.test.js .test-dist/tests/project-metadata-641.test.js`

Expected: PASS，`# fail 0`。其中面板测试要看到项目按钮、名称框不是焦点、浏览没有 `thread.project.set`，点「移入 Alpha」后恰好一条。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/tests/support/interaction-dom.ts chrome-extension/src/sidepanel/components/ProjectListView.tsx chrome-extension/src/sidepanel/components/ProjectPanel.tsx chrome-extension/src/sidepanel/ui/workspace-styles.ts chrome-extension/tests/project-list-interaction.test.ts
git commit -m "feat: show registered projects as buttons"
```

节点 1 到这里停，做独立对抗评审。PASS 后再进 Task 3。

### Task 3: 恢复、层导航和归属

**Files:**

- Create: `chrome-extension/src/sidepanel/navigation/startup-destination.ts`
- Create: `chrome-extension/src/sidepanel/navigation/navigation-mode.ts`
- Create: `chrome-extension/src/sidepanel/navigation/project-thread-bind.ts`
- Create: `chrome-extension/src/sidepanel/components/SessionContextBar.tsx`
- Create: `chrome-extension/src/sidepanel/components/SidePanelLayers.tsx`
- Modify: `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx`（第 31–33、61–77、119–122、140–185 行的导航分支）
- Modify: `chrome-extension/src/sidepanel/hooks/useWebSocket.ts`（第 1454–1496 行）
- Modify: `chrome-extension/src/sidepanel/components/StatusRail.tsx`（第 223 行仍发 `cmspark:toggle-navigation`，窄层用它回到导航层，不再打开 28dvh 弹层）
- Test: `chrome-extension/tests/startup-destination.test.ts`
- Test: `chrome-extension/tests/project-navigation-interaction.test.ts`

**Interfaces:**

- Consumes: `projectCopy.restoreInvalid`、`projectCopy.restoreNone`、`sessionContextLines`、`membershipEnabled`、`bind` 结果的 `ok/reason`。
- Produces:
  - `resolveStartupDestination({ rememberedThreadId, threads, connection })`
  - `nextRememberedThreadId({ remembered, active, threads, listArrived })`
  - `applyActiveThreadList(...)` 的 `createBlank` 恒为 `false`
  - `navigationMode({ surface, innerWidth })`
  - `RESIDENT_MIN_WIDTH = 960`
  - `bindNewProjectThread(...)`
  - `SidePanelLayers` 的层：`nav | projects | project | recent | session | tools | settings`

- [ ] **Step 1: Write the failing test**

`chrome-extension/src/sidepanel/navigation/startup-destination.ts`、`navigation-mode.ts`、`project-thread-bind.ts` 先导出同名函数并 `throw new Error("not implemented")`。`SidePanelLayers` 与 `SessionContextBar` 先 `return <div />`。

`chrome-extension/tests/startup-destination.test.ts`

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { projectCopy } from "../src/sidepanel/navigation/project-copy"
import { RESIDENT_MIN_WIDTH, navigationMode } from "../src/sidepanel/navigation/navigation-mode"
import { bindNewProjectThread } from "../src/sidepanel/navigation/project-thread-bind"
import { applyActiveThreadList, nextRememberedThreadId, resolveStartupDestination } from "../src/sidepanel/navigation/startup-destination"

const older = { id: "older", trashed_at: null }
const newer = { id: "newer", trashed_at: null }

test("a remembered live thread restores while disconnected and when connected", () => {
  for (const connection of ["connected", "disconnected"] as const) {
    assert.deepEqual(resolveStartupDestination({ rememberedThreadId: "older", threads: [newer, older], connection }), { kind: "session", threadId: "older", reason: "restored" })
  }
})

test("disconnect before the thread list arrives keeps the remembered session", () => {
  assert.deepEqual(resolveStartupDestination({ rememberedThreadId: "older", threads: [], connection: "disconnected" }), { kind: "session", threadId: "older", reason: "restored" })
})

test("a missing remembered thread goes home and does not select the first row", () => {
  const destination = resolveStartupDestination({ rememberedThreadId: "gone", threads: [newer, older], connection: "connected" })
  assert.deepEqual(destination, { kind: "project-home", reason: "invalid-remembered-session" })
  assert.notEqual("threadId" in destination ? destination.threadId : "", newer.id)
})

test("threads without a remembered id are not a restored session", () => {
  assert.deepEqual(resolveStartupDestination({ rememberedThreadId: null, threads: [newer], connection: "connected" }), { kind: "project-home", reason: "no-valid-session" })
})

test("trash and all list scopes do not create or retarget", () => {
  for (const listScope of ["trash", "all"] as const) {
    const decision = applyActiveThreadList({ activeThreadId: "older", rememberedThreadId: "newer", incoming: [newer], listScope })
    assert.equal(decision.activeThreadId, "older")
    assert.equal(decision.createBlank, false)
    assert.equal(decision.reason, "scoped-list")
  }
})

test("an empty active list does not create a blank thread", () => {
  const decision = applyActiveThreadList({ activeThreadId: null, rememberedThreadId: null, incoming: [], listScope: "active" })
  assert.equal(decision.createBlank, false)
  assert.equal(decision.homeCopy, projectCopy.restoreNone)
})

test("memory waits for the list before clearing a missing id", () => {
  assert.equal(nextRememberedThreadId({ remembered: "older", active: null, threads: [], listArrived: false }), "older")
  assert.equal(nextRememberedThreadId({ remembered: "gone", active: null, threads: [newer], listArrived: true }), null)
})

test("resident navigation starts at 960 for every surface", () => {
  assert.equal(RESIDENT_MIN_WIDTH, 960)
  for (const surface of ["sidepanel", "popout", "workspace"] as const) {
    for (const innerWidth of [320, 400, 759]) assert.equal(navigationMode({ surface, innerWidth }), "layered")
    for (const innerWidth of [960, 1200]) assert.equal(navigationMode({ surface, innerWidth }), "resident")
  }
})

test("project binding succeeds only after the matching set receipt", async () => {
  let generation = 1
  const created = await bindNewProjectThread({
    projectId: "p1", generation, currentGeneration: () => generation,
    create: async () => ({ id: "thread-1" }),
    setProject: async () => ({ thread: { id: "thread-1", project_id: "p1" } }),
  })
  assert.deepEqual(created, { ok: true, threadId: "thread-1", projectId: "p1" })
  const unbound = await bindNewProjectThread({
    projectId: "p1", generation, currentGeneration: () => generation,
    create: async () => ({ id: "thread-2" }),
    setProject: async () => { throw new Error("rejected") },
  })
  assert.deepEqual(unbound, { ok: false, createdThreadId: "thread-2", projectId: "p1", reason: "bind-failed" })
  const missing = await bindNewProjectThread({
    projectId: "p1", generation, currentGeneration: () => generation,
    create: async () => { throw new Error("unavailable") },
    setProject: async () => ({ thread: { id: "x", project_id: "p1" } }),
  })
  assert.deepEqual(missing, { ok: false, createdThreadId: null, projectId: "p1", reason: "create-failed" })
  const stale = await bindNewProjectThread({
    projectId: "p1", generation, currentGeneration: () => generation,
    create: async () => { generation = 2; return { id: "thread-3" } },
    setProject: async () => ({ thread: { id: "thread-3", project_id: "p1" } }),
  })
  assert.equal(stale.ok, false)
  if (!stale.ok) assert.equal(stale.reason, "bind-failed")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && rm -rf .test-dist && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/startup-destination.test.js`

Expected: FAIL，`not implemented`。

- [ ] **Step 3: Write minimal implementation**

`startup-destination.ts`

```ts
import { projectCopy } from "./project-copy"

export interface StartupThread { id: string; trashed_at?: string | null }
export type StartupDestination =
  | { kind: "session"; threadId: string; reason: "restored" }
  | { kind: "project-home"; reason: "no-valid-session" | "invalid-remembered-session" }

function usable(threads: StartupThread[], id: string | null): boolean {
  return !!id && threads.some(thread => thread.id === id && !thread.trashed_at)
}

export function resolveStartupDestination(input: {
  rememberedThreadId: string | null
  threads: StartupThread[]
  connection: "connected" | "connecting" | "disconnected"
}): StartupDestination {
  if (usable(input.threads, input.rememberedThreadId) && input.rememberedThreadId) {
    return { kind: "session", threadId: input.rememberedThreadId, reason: "restored" }
  }
  if (input.connection !== "connected" && input.rememberedThreadId && input.threads.length === 0) {
    return { kind: "session", threadId: input.rememberedThreadId, reason: "restored" }
  }
  if (input.rememberedThreadId && input.threads.length > 0) return { kind: "project-home", reason: "invalid-remembered-session" }
  return { kind: "project-home", reason: "no-valid-session" }
}

export function nextRememberedThreadId(input: { remembered: string | null; active: string | null; threads: StartupThread[]; listArrived: boolean }): string | null {
  if (usable(input.threads, input.active)) return input.active
  if (!input.listArrived) return input.remembered
  if (usable(input.threads, input.remembered)) return input.remembered
  return null
}

export function applyActiveThreadList(input: {
  activeThreadId: string | null
  rememberedThreadId: string | null
  incoming: StartupThread[]
  listScope: "active" | "trash" | "all"
}): { activeThreadId: string | null; destination: "session" | "project-home"; createBlank: false; reason: string; homeCopy: string | null } {
  if (input.listScope !== "active") {
    return { activeThreadId: input.activeThreadId, destination: input.activeThreadId ? "session" : "project-home", createBlank: false, reason: "scoped-list", homeCopy: null }
  }
  if (usable(input.incoming, input.activeThreadId) && input.activeThreadId) {
    return { activeThreadId: input.activeThreadId, destination: "session", createBlank: false, reason: "keep-active", homeCopy: null }
  }
  const startup = resolveStartupDestination({ rememberedThreadId: input.rememberedThreadId, threads: input.incoming, connection: "connected" })
  if (startup.kind === "session") return { activeThreadId: startup.threadId, destination: "session", createBlank: false, reason: "restored", homeCopy: null }
  return {
    activeThreadId: null,
    destination: "project-home",
    createBlank: false,
    reason: startup.reason,
    homeCopy: startup.reason === "invalid-remembered-session" ? projectCopy.restoreInvalid : projectCopy.restoreNone,
  }
}
```

`navigation-mode.ts`

```ts
export const RESIDENT_MIN_WIDTH = 960
export type NavigationSurface = "sidepanel" | "popout" | "workspace"
export function navigationMode(input: { surface: NavigationSurface; innerWidth: number }): "layered" | "resident" {
  return input.innerWidth >= RESIDENT_MIN_WIDTH ? "resident" : "layered"
}
```

`project-thread-bind.ts`

```ts
export async function bindNewProjectThread(input: {
  projectId: string
  generation: number
  currentGeneration: () => number
  create: () => Promise<{ id: string }>
  setProject: (threadId: string) => Promise<{ thread: { id: string; project_id: string | null } }>
}): Promise<{ ok: true; threadId: string; projectId: string } | { ok: false; createdThreadId: string | null; projectId: string; reason: "create-failed" | "bind-failed" }> {
  let createdThreadId: string | null = null
  try {
    const created = await input.create()
    createdThreadId = created.id
    if (input.currentGeneration() !== input.generation) return { ok: false, createdThreadId, projectId: input.projectId, reason: "bind-failed" }
    const bound = await input.setProject(created.id)
    if (input.currentGeneration() !== input.generation || bound.thread.id !== created.id || bound.thread.project_id !== input.projectId) {
      return { ok: false, createdThreadId, projectId: input.projectId, reason: "bind-failed" }
    }
    return { ok: true, threadId: created.id, projectId: input.projectId }
  } catch {
    return { ok: false, createdThreadId, projectId: input.projectId, reason: createdThreadId ? "bind-failed" : "create-failed" }
  }
}
```

`SidePanelLayers.tsx` 是受控组件。resident 时四个 `data-nav` 按钮和主区域同时在；layered 只渲染当前层。`data-back` 在 project 层调用 `onLayer("projects")`，在 projects、recent、session、tools、settings 层调用 `onLayer("nav")`。项目行使用已有 `ProjectListView`，它的 `onOpen` 调 `onOpenProject`。详情里的线程按钮带 `data-thread-id`，只包含 `project_id === projectId` 且没有 `trashed_at` 的线程。没有这样的线程时显示 `projectCopy.emptyProject`。`data-assign` 用 `membershipEnabled` 决定 `disabled`，点击才 `onAssign`。`bindNotice` 原样放进 `role="status"`。工具层用 `toolGroups(toolLevel)` 和 `CONTEXT_PANEL_TABS` 的 label，点击 `onOpenTool(id)`。设置按钮只调用 `onOpenSettings`。

`SessionContextBar.tsx`：

```tsx
import { projectCopy } from "../navigation/project-copy"
import { sessionContextLines } from "../navigation/project-list-model"

export function SessionContextBar({ projectName, threadTitle, connection, workspaceRoot, busy, pending, onProject }: {
  projectName: string | null
  threadTitle: string
  connection: "connected" | "connecting" | "disconnected"
  workspaceRoot: string | null | undefined
  busy: boolean
  pending: boolean
  onProject: () => void
}) {
  const lines = sessionContextLines({ projectName, threadTitle, connection, workspaceRoot, busy, pending })
  return <header aria-label="会话位置">
    <p>{projectName ? <button type="button" onClick={onProject}>{projectName}</button> : projectCopy.outside}{` / ${threadTitle}`}</p>
    <p>{lines.workspace}</p>
    <p>{lines.execution}</p>
  </header>
}
```

`WorkspaceFrame.tsx`：删除 `min-width: 760px` 和 `.cm-navigation-disclosure` 分支。用 `navigationMode` 和窗口宽度选择 `SidePanelLayers`。`workspace.html` 的 `WORKSPACE_DESTINATIONS` 原样保留。`workspace-styles.ts` 删除 `@media(max-width:759px)` 里的 `.cm-navigation-disclosure` 规则。

`useWebSocket.ts` 在 `incoming.length === 0` 到自动选择第一项的整段（现第 1454–1496 行）换成下面的回调。上面的 `isScopedList` 提前 return 保持不动。不新增 store action，不调用 `thread.create`，不读取 `incoming[0]`。

```ts
chrome.storage.local.get("cmspark.navigation.lastThreadId", stored => {
  const remembered = typeof stored?.["cmspark.navigation.lastThreadId"] === "string" ? stored["cmspark.navigation.lastThreadId"] : null
  const decision = applyActiveThreadList({
    activeThreadId: activeThreadRef.current,
    rememberedThreadId: remembered,
    incoming,
    listScope: "active",
  })
  creatingBlankThreadRef.current = false
  if (decision.destination === "session" && decision.activeThreadId && decision.activeThreadId !== activeThreadRef.current) {
    dispatch({ type: "SET_ACTIVE_THREAD", threadId: decision.activeThreadId })
    chrome.runtime.sendMessage({ type: "thread.select", threadId: decision.activeThreadId })
  }
  const nextRemembered = nextRememberedThreadId({
    remembered,
    active: decision.activeThreadId,
    threads: incoming,
    listArrived: true,
  })
  chrome.storage.local.set({ "cmspark.navigation.lastThreadId": nextRemembered })
})
```

- [ ] **Step 4: Run test to verify it passes**

`chrome-extension/tests/project-navigation-interaction.test.ts` 第一行 import `./support/interaction-dom`，再 import `createElement`、`createRoot`、`act`、`projectCopy`、`SidePanelLayers`、`SessionContextBar`。`mount` 如下，默认有项目 Alpha、线程「笔记」，以及空回调。

```ts
const alpha = { id: "11111111-1111-4111-8111-111111111111", name: "Alpha", created_at: "t", updated_at: "t", archived_at: null }
const thread = { id: "thread-1", alias: "笔记", project_id: alpha.id, trashed_at: null, workspace_root: "/work/alpha" }
async function mount(over: Record<string, unknown> = {}) {
  const props = {
    mode: "layered", layer: "nav", projectId: null, projects: [alpha], threads: [thread], activeThreadId: thread.id,
    connection: "connected", busy: false, pending: 0, metadataUnavailable: false, homeCopy: null,
    query: "", archiveView: false, phase: "ready", fetchedAt: "t", hasSnapshot: true, recentFilter: "*", bindNotice: null,
    onLayer: () => undefined, onOpenProject: () => undefined, onOpenThread: () => undefined, onAssign: () => undefined,
    onCreateInProject: () => undefined, onRecentFilter: () => undefined, onQuery: () => undefined, onClearQuery: () => undefined,
    onToggleArchive: () => undefined, onOpenTool: () => undefined, onOpenSettings: () => undefined, toolLevel: "chat",
    ...over,
  }
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(createElement(SidePanelLayers, props)) })
  return { container, root, async rerender(next: Record<string, unknown>) { await act(async () => { root.render(createElement(SidePanelLayers, { ...props, ...next })) }) } }
}
```

受控层测试接着写：

```ts
test("narrow project browsing is one layer and does not assign the session", async () => {
  const calls: string[] = []
  const view = await mount({ mode: "layered", layer: "nav", onAssign: () => calls.push("assign"), onLayer: (layer: string) => calls.push(layer), onOpenProject: (id: string) => calls.push(id) })
  assert.equal(view.container.querySelectorAll("[data-nav]").length, 4)
  await act(async () => { (view.container.querySelector("[data-nav='projects']") as unknown as { emit: (type: string) => void }).emit("click") })
  await view.rerender({ layer: "projects" })
  assert.equal(view.container.querySelector("[data-nav]"), null)
  await act(async () => { (view.container.querySelector("[data-project-id='11111111-1111-4111-8111-111111111111']") as unknown as { emit: (type: string) => void }).emit("click") })
  await view.rerender({ layer: "project", projectId: "11111111-1111-4111-8111-111111111111" })
  assert.equal(view.container.textContent?.includes(projectCopy.back), true)
  assert.equal(view.container.textContent?.includes("笔记"), true)
  await act(async () => { (view.container.querySelector("[data-back]") as unknown as { emit: (type: string) => void }).emit("click") })
  assert.equal(calls.filter(call => call === "projects").length, 2)
  assert.deepEqual(calls.filter(call => call === "assign"), [])
})

test("wide navigation remains while a project is open", async () => {
  const view = await mount({ mode: "resident", layer: "project", projectId: "11111111-1111-4111-8111-111111111111" })
  assert.equal(view.container.querySelectorAll("[data-nav]").length, 4)
})

test("disconnect disables assignment while project rows still open", async () => {
  let opened = ""
  const view = await mount({ mode: "layered", layer: "session", connection: "disconnected", busy: false, onOpenProject: (id: string) => { opened = id } })
  const move = view.container.querySelector("[data-assign]") as HTMLButtonElement
  assert.equal(move.disabled, true)
  await view.rerender({ layer: "projects" })
  await act(async () => { (view.container.querySelector("[data-project-id='11111111-1111-4111-8111-111111111111']") as unknown as { emit: (type: string) => void }).emit("click") })
  assert.equal(opened, "11111111-1111-4111-8111-111111111111")
})

test("bind failure stays outside the project and success is visible only after ok", async () => {
  const failed = await mount({ mode: "layered", layer: "project", projectId: "11111111-1111-4111-8111-111111111111", bindNotice: projectCopy.bindFailed, threads: [{ id: "thread-2", alias: "未归入", project_id: null, trashed_at: null }] })
  assert.equal(failed.container.textContent?.includes(projectCopy.bindFailed), true)
  assert.equal(failed.container.querySelector("[data-thread-id='thread-2']"), null)
  const ok = await mount({ mode: "layered", layer: "project", projectId: "11111111-1111-4111-8111-111111111111", bindNotice: projectCopy.bindOk, threads: [{ id: "thread-1", alias: "笔记", project_id: "11111111-1111-4111-8111-111111111111", trashed_at: null }] })
  assert.equal(ok.container.textContent?.includes(projectCopy.bindOk), true)
  assert.equal(ok.container.querySelector("[data-thread-id='thread-1']")?.textContent, "笔记")
})

test("session context keeps a known directory offline without calling it idle", async () => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(createElement(SessionContextBar, { projectName: "Alpha", threadTitle: "笔记", connection: "disconnected", workspaceRoot: "/work/alpha", busy: false, pending: false, onProject: () => undefined })) })
  assert.equal(container.textContent?.includes("/work/alpha"), true)
  assert.equal(container.textContent?.includes(projectCopy.executionOffline), true)
  assert.equal(container.textContent?.includes(projectCopy.workspaceUnbound), false)
  assert.equal(container.textContent?.includes(projectCopy.executionIdle), false)
  root.unmount()
})
```

`mount` 的默认 props 含一个未归档项目 Alpha、一条 `project_id` 匹配的线程「笔记」、`connection: "connected"`、`busy: false`、`pending: 0`。`data-nav` 只在 `mode === "resident"` 或 `layer === "nav"` 时渲染。`data-back` 只在 layered 的非 nav 层渲染，点击调用 `onLayer` 回到上一层：project 回到 projects，projects 回到 nav。`data-assign` 是会话层的「移入 Alpha」。`data-thread-id` 只渲染 `project_id` 等于当前项目的未回收线程。

Run: `cd chrome-extension && rm -rf .test-dist && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/startup-destination.test.js .test-dist/tests/project-navigation-interaction.test.js .test-dist/tests/project-list-interaction.test.js`

Expected: PASS。

再跑生产类型检查：`cd chrome-extension && npx tsc --noEmit`

Expected: 退出码 0。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/navigation/startup-destination.ts chrome-extension/src/sidepanel/navigation/navigation-mode.ts chrome-extension/src/sidepanel/navigation/project-thread-bind.ts chrome-extension/src/sidepanel/components/SessionContextBar.tsx chrome-extension/src/sidepanel/components/SidePanelLayers.tsx chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx chrome-extension/src/sidepanel/hooks/useWebSocket.ts chrome-extension/src/sidepanel/ui/workspace-styles.ts chrome-extension/tests/startup-destination.test.ts chrome-extension/tests/project-navigation-interaction.test.ts
git commit -m "feat: restore the last session and layer narrow navigation"
```

节点 2 到这里停，做独立对抗评审。PASS 后再进 Task 4。

### Task 4: 工具、设置和全量回归

**Files:**

- Create: `chrome-extension/src/sidepanel/navigation/tool-groups.ts`
- Modify: `chrome-extension/src/sidepanel/components/SidePanelLayers.tsx`（工具层）
- Modify: `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx`（去掉 `t.id !== "history"` 的过滤；设置按钮仍 `SET_SETTINGS_OPEN`）
- Test: `chrome-extension/tests/tool-groups.test.ts`

**Interfaces:**

- Consumes: `contextBarTabsForLevel`、`contextBarOverflowTabsForLevel`、`CONTEXT_PANEL_TABS`。
- Produces: `toolGroups(level)`，返回 `{ title: "当前任务" | "其他工具"; ids: ContextBarTabId[] }[]`。九个 id 各一次。

- [ ] **Step 1: Write the failing test**

`tool-groups.ts` 先 `throw new Error("not implemented")`。

`chrome-extension/tests/tool-groups.test.ts`

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { CONTEXT_PANEL_TABS } from "../src/sidepanel/components/ContextPanelHost"
import { toolGroups } from "../src/sidepanel/navigation/tool-groups"

test("every current context panel appears once and shell is absent", () => {
  for (const level of ["chat", "browser", "computer"] as const) {
    const groups = toolGroups(level)
    const ids = groups.flatMap(group => group.ids)
    assert.deepEqual(groups.map(group => group.title), ["当前任务", "其他工具"])
    assert.deepEqual([...ids].sort(), CONTEXT_PANEL_TABS.map(tab => tab.id).sort())
    assert.equal(new Set(ids).size, ids.length)
    assert.equal((ids as string[]).includes("shell"), false)
  }
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && rm -rf .test-dist && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/tool-groups.test.js`

Expected: FAIL，`not implemented`。若 `ContextPanelHost` 把测试编译拉进无关类型错误，修的是导入边界，不删掉九个 id 的断言。

- [ ] **Step 3: Write minimal implementation**

```ts
import { contextBarTabsForLevel, type ContextBarTabId } from "../mode/mode-controller"
import type { CapabilityLevel } from "../types"

const ORDER: ContextBarTabId[] = ["tabs", "history", "skills", "knowledge", "packs", "meeting", "board", "mcp", "apps"]

export function toolGroups(level: CapabilityLevel): { title: "当前任务" | "其他工具"; ids: ContextBarTabId[] }[] {
  const current = new Set<string>(contextBarTabsForLevel(level))
  return [
    { title: "当前任务", ids: ORDER.filter(id => current.has(id)) },
    { title: "其他工具", ids: ORDER.filter(id => !current.has(id)) },
  ]
}
```

`SidePanelLayers` 的工具层按这个分组渲染 `CONTEXT_PANEL_TABS` 的 label，点击仍调用现有 `openPanelForce(id)`。设置层只触发现有设置打开，不渲染新的 shell 开关。导航里删除 `filter(t => t.id !== "history")`。

交互测试追加：工具层能按到九个 label；设置按钮的点击回调不是 `openPanelForce`。

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
cd chrome-extension && node scripts/check-sidepanel-raw-colors.mjs
cd chrome-extension && rm -rf .test-dist && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/*.test.js
cd chrome-extension && npx tsc --noEmit
cd companion && npm test
```

Expected: 颜色检查退出码 0；扩展测试 `# fail 0`；两处 tsc 退出码 0；companion 测试失败数为 0。

同一 head 的 CI 十个检查都绿，才算节点 3 通过：

- CI `build`
- CI `smoke (ubuntu-latest)`
- CI `smoke (macos-latest)`
- CI `smoke (windows-latest)`
- CI `smoke (windows-native)`
- CI `activity-linux-x11`
- CI `acp-history-restart`
- ARM acceptance `Affected CPU controls (Linux ARM64)`
- Linux integration ARM `Linux integration controls (ARM64)`
- Session save recovery `Windows session persistence`

不触发 Release，不触发 Build installers。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/navigation/tool-groups.ts chrome-extension/src/sidepanel/components/SidePanelLayers.tsx chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx chrome-extension/tests/tool-groups.test.ts chrome-extension/tests/project-navigation-interaction.test.ts
git commit -m "feat: group existing tools without adding a shell switch"
```

节点 3 评审 PASS 后，才按仓库门禁正常合并。本计划的文档 PR 不包含以上功能提交。
