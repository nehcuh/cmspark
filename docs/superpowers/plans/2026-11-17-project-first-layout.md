# 侧栏项目优先布局 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 点「项目」就看到可点击的已注册项目，并按项目、最近对话、工具、设置分层；默认恢复上次有效对话。

**Architecture:** 决定放在纯函数里。侧栏渲染只走生产组件。键盘、焦点和 `details` 用本机 Chrome 的 Playwright 覆盖，不自造 `document` 替身。`project.list` 与 `thread.project.set` 仍走现有 `requestProject` / `matchingProjectReply`。不改 Companion 的项目存储、协议和权限。

**Tech Stack:** Chrome 扩展 React 18、`node:test`、`tsc -p tsconfig.test.json`、现有 `uv run --no-project --with playwright`（不写入 `package.json`）。

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
- 键盘、焦点和 `details` 只用 `chrome-extension/scripts/test-project-navigation-ui.py` 里的 `page.keyboard.press`。不新增 `interaction-dom.ts`、jsdom 或 happy-dom，也不把 `dispatchEvent(KeyboardEvent)` 当成浏览器默认 click。
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
  executionConnecting: "执行状态：正在连接",
  connectingMove: "正在连接，归属整理已停用。",
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

export type ListApplyReason = "applied" | "older-revision"

export function sameListGeneration(_requestGeneration: number, _currentGeneration: number): boolean {
  throw new Error("not implemented")
}

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

export function bumpListGeneration(current: number): number {
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
  bumpListGeneration,
  membershipEnabled,
  parseProjectListCache,
  sameListGeneration,
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

test("revision decides the snapshot; generation equality is the caller's gate", () => {
  const current: ListSnapshot = { revision: 5, projects: [active], fetchedAt: "t5", generation: 2 }
  const newerRevision = applyProjectListResult(current, { ...current, revision: 6, generation: 3, fetchedAt: "t6" })
  assert.equal(newerRevision.applied, true)
  assert.equal(newerRevision.snapshot?.revision, 6)
  const older = applyProjectListResult(current, { ...current, revision: 4, generation: 9, fetchedAt: "old" })
  assert.equal(older.applied, false)
  assert.equal(older.reason, "older-revision")
  assert.equal(older.snapshot?.fetchedAt, "t5")
  assert.equal(sameListGeneration(1, 2), false)
  const late: ListSnapshot = { ...current, revision: 9, generation: 1, projects: [{ ...active, name: "Zed" }], fetchedAt: "late" }
  const kept = sameListGeneration(late.generation, current.generation) ? applyProjectListResult(current, late).snapshot : current
  if (!kept) throw new Error("missing snapshot")
  assert.equal(kept.projects[0].name, "Alpha")
})

test("reconnect bumps the ref so an older request is not equal", () => {
  const ref = bumpListGeneration(1)
  assert.equal(sameListGeneration(1, ref), false)
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
  const connecting = sessionContextLines({ projectName: "Alpha", threadTitle: "笔记", connection: "connecting", workspaceRoot: "/work/alpha", busy: false, pending: false })
  assert.equal(connecting.execution, projectCopy.executionConnecting)
  assert.equal(connecting.execution.includes("离线"), false)
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

export function sameListGeneration(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration
}

export function applyProjectListResult(current: ListSnapshot | null, incoming: ListSnapshot): { snapshot: ListSnapshot | null; applied: boolean; reason: ListApplyReason } {
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

export function bumpListGeneration(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0) throw new Error("bad generation")
  return current + 1
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
  const workspace = input.connection === "disconnected"
    ? (root ? `${root}，${projectCopy.workspaceUnrefreshed}` : projectCopy.workspaceStale)
    : input.connection === "connecting"
      ? (root ? `${root}，${projectCopy.workspaceUnrefreshed}` : projectCopy.workspaceStale)
      : (root ? root : projectCopy.workspaceUnbound)
  const execution = input.connection === "disconnected"
    ? projectCopy.executionOffline
    : input.connection === "connecting"
      ? projectCopy.executionConnecting
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

- Create: `chrome-extension/scripts/test-project-navigation-ui.py`
- Create: `chrome-extension/scripts/render-project-navigation-fixture.cjs`
- Modify: `chrome-extension/src/sidepanel/components/ProjectListView.tsx`
- Modify: `chrome-extension/src/sidepanel/components/ProjectPanel.tsx`
- Modify: `chrome-extension/src/sidepanel/ui/workspace-styles.ts`
- Test: `chrome-extension/tests/project-list-model.test.ts`（Task 1 已有）

**Interfaces:**

- Consumes: `visibleProjects`、`sameListGeneration`、`applyProjectListResult`、`parseProjectListCache`、`projectCopy`。
- Produces: `ProjectListView`。请求把 `{ id, generation }` 留在 ref 里。回执先过 `sameListGeneration(requestGeneration, ref.current)`，不相等就返回，不调用 `applyProjectListResult`。

不创建 `chrome-extension/tests/support/interaction-dom.ts`。`chrome-extension/tests/use-modal-dialog.test.ts` 已写明不自造 DOM，因为 happy-dom 会带进 `@types/node`。本任务沿用 [docs/TESTING.md](../../TESTING.md) 的临时 Playwright，不把 Playwright 写进 `package.json`。

- [ ] **Step 1: Write the failing browser test**

`render-project-navigation-fixture.cjs` 用现有 `render-workspace-fixture.cjs` 的 esbuild 方式打包生产 `ProjectNavigationRoot`。`chrome.storage.local.get` 在 `--hold-storage` 时把 `{ key, generation, callback }` 推进 `window.storageWaiters`。同一个 key 可以有多条，用 generation 区分。`launch` 只释放 `cmspark.project.list.v1` 的最新一条。恢复测试只释放 `cmspark.navigation.lastThreadId`。合成 `useWebSocket` 不读 `lastThreadId`，也不代替 `decideActiveThreadList` 的 node 测试。

`chrome-extension/scripts/test-project-navigation-ui.py`：

```python
"""Real Chrome keyboard coverage for the project list. No package.json dependency.

cd chrome-extension && nvm use 22
uv run --no-project --with playwright python scripts/test-project-navigation-ui.py
"""
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
LIST_KEY = "cmspark.project.list.v1"
THREAD_KEY = "cmspark.navigation.lastThreadId"
alpha = {"id": "11111111-1111-4111-8111-111111111111", "name": "Alpha", "created_at": "t", "updated_at": "t", "archived_at": None}
archived = {**alpha, "id": "33333333-3333-4333-8333-333333333333", "name": "旧项目", "archived_at": "t2"}

def release_generation(page, key, generation, seed):
    page.wait_for_function(
        "(arg) => window.storageWaiters.some(item => item.key === arg.key && item.generation === arg.generation)",
        {"key": key, "generation": generation},
    )
    released = page.evaluate(
        """(arg) => {
          const index = window.storageWaiters.findIndex(item => item.key === arg.key && item.generation === arg.generation)
          if (index < 0) return false
          const item = window.storageWaiters.splice(index, 1)[0]
          item.callback(arg.seed)
          return true
        }""",
        {"key": key, "generation": generation, "seed": seed},
    )
    assert released

def release_latest(page, key, seed):
    page.wait_for_function("(key) => window.storageWaiters.some(item => item.key === key)", key)
    generation = page.evaluate("(key) => window.storageWaiters.filter(item => item.key === key).at(-1).generation", key)
    release_generation(page, key, generation, seed)

def launch(playwright, directory, storage, level="chat"):
    subprocess.run(["node", "scripts/render-project-navigation-fixture.cjs", directory, "--hold-storage", f"--level={level}"], cwd=root, check=True)
    browser = playwright.chromium.launch(channel="chrome", headless=True)
    page = browser.new_page(viewport={"width": 320, "height": 800})
    page.set_default_timeout(6000)
    page.goto((Path(directory) / "index.html").as_uri())
    release_latest(page, LIST_KEY, storage)
    return browser, page

def test_stale_startup(page):
    page.wait_for_function("(key) => window.storageWaiters.some(item => item.key === key)", THREAD_KEY)
    held = page.evaluate("(key) => window.storageWaiters.find(item => item.key === key).generation", THREAD_KEY)
    before = page.evaluate("window.fixtureState.activeThreadId")
    page.evaluate("() => window.dispatchUI({type:'SET_THREADS', threads: window.demoThreads})")
    page.wait_for_function(
        "(arg) => window.storageWaiters.some(item => item.key === arg.key && item.generation !== arg.generationHeld)",
        {"key": THREAD_KEY, "generationHeld": held},
    )
    release_generation(page, THREAD_KEY, held, {THREAD_KEY: "demo-0"})
    assert page.evaluate("window.fixtureState.activeThreadId") == before
    assert page.evaluate("!window.sent.some(m => m.type==='thread.select')")

def test_breadcrumb(page):
    page.evaluate("""() => window.dispatchUI({type:'SET_THREADS', threads:[{id:'demo-0', alias:'笔记', project_id:'11111111-1111-4111-8111-111111111111', trashed_at:null, created_at:'t', updated_at:'t', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]}]})""")
    release_latest(page, THREAD_KEY, {THREAD_KEY: "demo-0"})
    page.get_by_role("banner", name="会话位置").get_by_role("button", name="Alpha", exact=True).click()
    page.get_by_role("region", name="项目详情").wait_for()
    assert page.evaluate("!window.sent.some(m => m.type==='thread.project.set')")

def test_bind(page):
    page.get_by_role("button", name="项目内新对话", exact=True).click()
    page.wait_for_function("window.sent.some(m => m.type==='thread.create')")
    created = page.evaluate("() => window.sent.find(m => m.type==='thread.create')")
    page.evaluate("(msg) => window.emitRuntime({type:'thread.created', id: msg.id, thread:{id: msg.id, alias:'新项目对话', project_id:null, created_at:'t', updated_at:'t', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]}})", created)
    page.wait_for_function("window.sent.some(m => m.type==='thread.project.set')")
    ok = page.evaluate("() => window.sent.find(m => m.type==='thread.project.set')")
    page.evaluate("(msg) => window.emitRuntime({type:'project.changed', id: msg.id, operation_id: msg.operation_id, revision: msg.expected_revision + 1, thread_id: msg.thread_id, project_id: msg.project_id, thread:{id: msg.thread_id, project_id: msg.project_id}})", ok)
    page.locator(f"[data-project-threads] [data-thread-id='{ok['thread_id']}']").wait_for()
    page.get_by_text("新对话已归入这个项目").wait_for()
    before = page.evaluate("() => window.sent.filter(m => m.type==='thread.create').length")
    page.get_by_role("button", name="项目内新对话", exact=True).click()
    page.wait_for_function(f"() => window.sent.filter(m => m.type==='thread.create').length > {before}")
    created2 = page.evaluate("() => window.sent.filter(m => m.type==='thread.create').at(-1)")
    page.evaluate("(msg) => window.emitRuntime({type:'thread.created', id: msg.id, thread:{id: msg.id, alias:'新项目对话', project_id:null, created_at:'t', updated_at:'t', config_override:{}, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[]}})", created2)
    page.wait_for_function("window.sent.filter(m => m.type==='thread.project.set').length >= 2")
    bad = page.evaluate("() => window.sent.filter(m => m.type==='thread.project.set').at(-1)")
    page.evaluate("(msg) => window.emitRuntime({type:'project.error', id: msg.id, operation_id: msg.operation_id, error:'rejected'})", bad)
    page.get_by_text("新对话已创建在项目外；归入尚未确认").wait_for()
    body = page.locator("body").inner_text()
    assert "新对话已归入这个项目" in body
    assert page.locator(f"[data-project-threads] [data-thread-id='{bad['thread_id']}']").count() == 0
    assert page.locator(f"[data-project-threads] [data-thread-id='{ok['thread_id']}']").count() == 1

def test_tools(page):
    page.set_viewport_size({"width": 960, "height": 800})
    nav = page.get_by_role("navigation", name="工作区")
    nav.get_by_role("button", name="工具", exact=True).click()
    current = page.get_by_role("group", name="当前任务")
    assert current.get_by_role("button").all_inner_texts()[:3] == ["技能", "知识", "历史"]
    assert current.get_by_role("button", name="设置", exact=True).count() == 0
    nav.get_by_role("button", name="设置", exact=True).click()
    page.get_by_role("dialog", name="设置", exact=True).wait_for()
    css = "".join(page.locator("style").all_inner_texts())
    assert "28dvh" not in css and "cm-navigation-disclosure" not in css
    assert page.locator(".cm-navigation-disclosure").count() == 0

def test_browser_tools(playwright, directory):
    browser, page = launch(playwright, directory, {}, level="browser")
    page.set_viewport_size({"width": 960, "height": 800})
    page.get_by_role("navigation", name="工作区").get_by_role("button", name="工具", exact=True).click()
    assert page.get_by_role("group", name="当前任务").get_by_role("button").all_inner_texts()[:2] == ["浏览器标签页", "技能"]
    assert page.get_by_role("navigation", name="工作区").get_by_role("button", name="设置", exact=True).count() == 1
    browser.close()

with tempfile.TemporaryDirectory(prefix="cmspark-project-nav-") as directory:
    with sync_playwright() as playwright:
        cache = {LIST_KEY: json.dumps({"format": 1, "revision": 2, "fetchedAt": "t", "projects": [alpha, archived]})}
        browser, page = launch(playwright, directory, cache)
        page.get_by_role("button", name="项目", exact=True).focus()
        page.keyboard.press("Enter")
        alpha_row = page.get_by_role("button", name="Alpha", exact=True)
        alpha_row.wait_for()
        assert page.get_by_role("button", name="旧项目", exact=True).count() == 0
        assert page.evaluate("!window.sent.some(m => m.type==='project.state')")
        name = page.get_by_role("textbox", name="新项目名称", exact=True)
        assert name.evaluate("el => el !== document.activeElement")
        create = page.locator("details").filter(has_text="新建项目")
        assert create.evaluate("el => el.open === false")
        create.locator("summary").focus()
        page.keyboard.press("Enter")
        assert create.evaluate("el => el.open === true")
        alpha_row.focus()
        page.keyboard.press("Enter")
        assert page.evaluate("!window.sent.some(m => m.type==='thread.project.set')")
        page.get_by_role("button", name="返回", exact=True).click()
        page.get_by_role("textbox", name="搜索项目", exact=True).fill("zzz")
        assert page.get_by_role("button", name="Alpha", exact=True).count() == 0
        assert "没有匹配的项目" in page.locator("[aria-label=项目]").inner_text()
        page.get_by_role("button", name="清除搜索", exact=True).click()
        page.get_by_role("button", name="Alpha", exact=True).wait_for()
        page.get_by_role("button", name="查看归档", exact=True).click()
        page.get_by_role("button", name="旧项目", exact=True).wait_for()
        assert page.get_by_role("button", name="Alpha", exact=True).count() == 0
        page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'disconnected'})")
        page.evaluate("() => window.dispatchUI({type:'SET_CONNECTION', state:'connected'})")
        page.wait_for_function("window.sent.filter(m => m.type==='project.list').length >= 2")
        listed = page.evaluate("() => window.sent.filter(m => m.type==='project.list')[0]")
        page.evaluate("(msg) => window.emitRuntime({id: msg.id, type:'project.state', revision: 9, projects:[{id:'11111111-1111-4111-8111-111111111111', name:'Zed', created_at:'t', updated_at:'t', archived_at:null}]})", listed)
        assert page.get_by_role("button", name="旧项目", exact=True).count() == 1
        assert page.get_by_role("button", name="Zed", exact=True).count() == 0
        test_stale_startup(page)
        test_breadcrumb(page)
        test_bind(page)
        test_tools(page)
        browser.close()
        browser, page = launch(playwright, directory, {LIST_KEY: "{not-json"})
        page.get_by_role("button", name="项目", exact=True).focus()
        page.keyboard.press("Enter")
        text = page.locator("[aria-label=项目]").inner_text()
        assert "还没有项目" not in text
        assert "无法取回项目列表" in text or "正在读取项目" in text
        browser.close()
        browser, page = launch(playwright, directory, {LIST_KEY: json.dumps({"format": 1, "revision": 1, "fetchedAt": "t", "projects": [alpha]})})
        page.get_by_role("button", name="项目", exact=True).focus()
        page.keyboard.press("Enter")
        page.get_by_role("button", name="查看归档", exact=True).click()
        assert "没有归档项目" in page.locator("[aria-label=项目]").inner_text()
        assert page.get_by_role("button", name="Alpha", exact=True).count() == 0
        browser.close()
        test_browser_tools(playwright, directory)
print("project navigation ui ok")
```

这一份就是完整脚本：辅助函数先定义，主流程再调用 `test_stale_startup`、`test_breadcrumb`、`test_bind`、`test_tools`、`test_browser_tools`，最后一行打印 `project navigation ui ok`。错的 `project_id` 不发 `project.changed`，因为 `matchingProjectReply` 会忽略它直到 15 秒超时，而页面超时是 6 秒。失败回执用同一个 id 的 `project.error`。


Expected: FAIL。当前 `ProjectPanel` 把项目放在 `select` 里，`get_by_role("button", name="Alpha")` 找不到。不要另写 DOM 替身。

请求记下的代际和当前 ref 不相等时，生产监听器在调用 `applyProjectListResult` 之前返回。上面这条 revision 9 的回执用的是第一次 `project.list` 的 id；重连或再次刷新已经把 ref 增加之后，按钮保持「旧项目」。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && nvm use 22 && uv run --no-project --with playwright python scripts/test-project-navigation-ui.py`

Expected: FAIL。当前 `ProjectPanel` 把项目放在 `select` 里，`get_by_role("button", name="Alpha")` 找不到。失败不是缺少 DOM 方法；不要补一个替身。

- [ ] **Step 3: Write minimal implementation**

`ProjectListView` 用 Task 1 的 `visibleProjects` 和 `projectCopy` 渲染 `button`。`archiveView` 为真时只渲染归档项目；归档集合为空时显示「没有归档项目」。搜索无匹配显示「没有匹配的项目」和「清除搜索」。清除后查询变回空字符串，未归档按钮重新出现。

`ProjectPanel` 删除三个项目 `<select>` 和第 71 行的 `nameInput.current?.focus()`。「新建项目」是默认关闭的 `details`，名称框的可访问名是「新项目名称」。打开「项目」不调用 `focus()`。

列表 ref 从 0 开始。每次 `refresh` 和连接变为 `connected` 时 `ref.current = bumpListGeneration(ref.current)`，并把这个数和 `requestProject` 的 `id` 一起记下。`chrome.runtime.onMessage` 里先 `sameListGeneration`，不相等则返回。相等才 `applyProjectListResult`。因此 ref 为 2 时，代际 1 且 revision 9 的回执不改变按钮。

打开时先 `chrome.storage.local.get(PROJECT_LIST_CACHE_KEY, callback)`。`parseProjectListCache` 成功就先画出按钮，再发 `project.list`。解析失败则没有快照，文案是「正在读取项目」或失败后的「无法取回项目列表」，不是「还没有项目」。成功回执再 `chrome.storage.local.set`。

`workspace-styles.ts` 去掉 `.cm-project-controls` 的 `max-height:42dvh;overflow:auto`。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd chrome-extension && nvm use 22 && uv run --no-project --with playwright python scripts/test-project-navigation-ui.py`

Expected: 打印 `project navigation ui ok`，退出码 0。

再跑纯函数：`cd chrome-extension && rm -rf .test-dist && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/project-list-model.test.js .test-dist/tests/project-metadata-641.test.js`

Expected: `# fail 0`。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/scripts/test-project-navigation-ui.py chrome-extension/scripts/render-project-navigation-fixture.cjs chrome-extension/src/sidepanel/components/ProjectListView.tsx chrome-extension/src/sidepanel/components/ProjectPanel.tsx chrome-extension/src/sidepanel/ui/workspace-styles.ts
git commit -m "feat: show registered projects as buttons in Chrome"
```

节点 1 到这里停，做独立对抗评审。PASS 后再进 Task 3。

### Task 3: 恢复、层导航和归属

**Files:**

- Create: `chrome-extension/src/sidepanel/navigation/startup-destination.ts`
- Create: `chrome-extension/src/sidepanel/navigation/useNavigationStartup.ts`
- Modify: `chrome-extension/src/sidepanel/store/agentStore.tsx`（只加 `COMMIT_NAVIGATION`）
- Modify: `chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx`
- Modify: `chrome-extension/src/sidepanel/components/SessionContextBar.tsx`
- Modify: `chrome-extension/src/sidepanel/hooks/useWebSocket.ts`（第 1454–1496 行）
- Modify: `chrome-extension/scripts/test-project-navigation-ui.py`
- Test: `chrome-extension/tests/startup-destination.test.ts`

**Interfaces:**

- Produces: `commitStartupNavigation`。返回 `{ ignored: true, reason: "stale-generation" }` 或 `{ ignored: false, layer, activeThreadId, selectThread, homeCopy, remembered }`。
- `useNavigationStartup` 是唯一的 `cmspark.navigation.lastThreadId` 读者。`WorkspaceFrame` 只渲染 `state.navigationLayer` 和 `state.navigationHomeCopy`。

- [ ] **Step 1: Write the failing test**

`startup-destination.ts` 的导出函数先 `throw new Error("not implemented")`。`chrome-extension/tests/startup-destination.test.ts` 断言：

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { projectCopy } from "../src/sidepanel/navigation/project-copy"
import { RESIDENT_MIN_WIDTH, navigationMode } from "../src/sidepanel/navigation/navigation-mode"
import { commitStartupNavigation, decideActiveThreadList } from "../src/sidepanel/navigation/startup-destination"

test("a stale startup callback does not clear or select", () => {
  const decision = commitStartupNavigation({ commitGeneration: 1, currentGeneration: 2, rememberedThreadId: "older", threads: [{ id: "newer", trashed_at: null }], activeThreadId: "newer", connection: "connected", listArrived: true })
  assert.deepEqual(decision, { ignored: true, reason: "stale-generation" })
})

test("project home clears the active thread and does not select", () => {
  const missing = commitStartupNavigation({ commitGeneration: 1, currentGeneration: 1, rememberedThreadId: null, threads: [{ id: "newer", trashed_at: null }], activeThreadId: null, connection: "connected", listArrived: true })
  assert.equal(missing.ignored, false)
  if (!missing.ignored) {
    assert.equal(missing.layer, "projects")
    assert.equal(missing.activeThreadId, null)
    assert.equal(missing.selectThread, false)
    assert.equal(missing.homeCopy, projectCopy.restoreNone)
  }
  const invalid = commitStartupNavigation({ commitGeneration: 1, currentGeneration: 1, rememberedThreadId: "gone", threads: [], activeThreadId: "newer", connection: "connected", listArrived: true })
  if (!invalid.ignored) {
    assert.equal(invalid.homeCopy, projectCopy.restoreInvalid)
    assert.equal(invalid.activeThreadId, null)
    assert.equal(invalid.selectThread, false)
  }
})

test("disconnect and connecting keep a remembered session", () => {
  for (const connection of ["disconnected", "connecting"] as const) {
    const decision = commitStartupNavigation({ commitGeneration: 1, currentGeneration: 1, rememberedThreadId: "older", threads: [], activeThreadId: null, connection, listArrived: false })
    assert.equal(decision.ignored, false)
    if (!decision.ignored) {
      assert.equal(decision.layer, "session")
      assert.equal(decision.homeCopy, null)
      assert.equal(decision.selectThread, false)
      assert.equal(decision.remembered, "older")
    }
  }
})

test("a connected cold start keeps the remembered id until the list arrives", () => {
  const decision = commitStartupNavigation({ commitGeneration: 1, currentGeneration: 1, rememberedThreadId: "older", threads: [], activeThreadId: null, connection: "connected", listArrived: false })
  assert.equal(decision.ignored, false)
  if (!decision.ignored) {
    assert.equal(decision.layer, "session")
    assert.equal(decision.activeThreadId, "older")
    assert.equal(decision.remembered, "older")
    assert.equal(decision.selectThread, false)
    assert.equal(decision.homeCopy, null)
  }
})

test("an empty active list does not create or select the first row", () => {
  const incoming = [{ id: "newer", trashed_at: null }]
  const empty = decideActiveThreadList({ activeThreadId: null, rememberedThreadId: null, incoming: [], listScope: "active" })
  assert.equal(empty.createBlank, false)
  assert.equal(empty.selectIncomingFirst, false)
  assert.equal(empty.activeThreadId, null)
  assert.equal(empty.selectThread, false)
  assert.equal(empty.homeCopy, projectCopy.restoreNone)
  const populated = decideActiveThreadList({ activeThreadId: null, rememberedThreadId: null, incoming, listScope: "active" })
  assert.equal(populated.createBlank, false)
  assert.equal(populated.selectIncomingFirst, false)
  assert.equal(populated.selectThread, false)
  assert.equal(populated.activeThreadId, null)
  assert.notStrictEqual(populated.activeThreadId, incoming[0].id)
})

test("resident navigation starts at 960 on every surface", () => {
  assert.equal(RESIDENT_MIN_WIDTH, 960)
  for (const surface of ["sidepanel", "popout", "workspace"] as const) {
    for (const innerWidth of [320, 400, 759]) assert.equal(navigationMode({ surface, innerWidth }), "layered")
    for (const innerWidth of [960, 1200]) assert.equal(navigationMode({ surface, innerWidth }), "resident")
  }
})
```

把下面断言加进 `test-project-navigation-ui.py`，仍用 `page.keyboard.press` 和真实 Chrome。测试不计算 layer 再塞进组件。它只释放 storage callback，然后读生产 `ProjectNavigationRoot` 画出的文字。



项目内新对话不新增绕过函数。按钮调用现有 `requestProjectThread`，再用 `requestProject("thread.project.set")`。`matchingProjectReply` 拒绝错的 `project_id`。父组件只在 promise resolve 时 `onBindResult(ok)` 并把线程放进当前项目；reject 时不放。本地回执和父组件已有的 `bindNotice` 同时留在页面上。Playwright 用 `locator.wait_for` 等这两次往返，不用单次 `Promise.resolve()`。



- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && rm -rf .test-dist && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/startup-destination.test.js`

Expected: FAIL，`not implemented`。

浏览器脚本在生产接线完成前，`没有可恢复的上次对话` 不会出现。Expected: FAIL。

- [ ] **Step 3: Write minimal implementation**

```ts
export function commitStartupNavigation(input: {
  commitGeneration: number
  currentGeneration: number
  rememberedThreadId: string | null
  threads: Array<{ id: string; trashed_at?: string | null }>
  activeThreadId: string | null
  connection: "connected" | "connecting" | "disconnected"
  listArrived: boolean
}): { ignored: true; reason: "stale-generation" } | { ignored: false; layer: "session" | "projects"; activeThreadId: string | null; selectThread: false | string; homeCopy: string | null; remembered: string | null } {
  if (input.commitGeneration !== input.currentGeneration) return { ignored: true, reason: "stale-generation" }
  const usable = (id: string | null) => !!id && input.threads.some(thread => thread.id === id && !thread.trashed_at)
  if (!input.listArrived && input.rememberedThreadId) {
    return { ignored: false, layer: "session", activeThreadId: input.rememberedThreadId, selectThread: false, homeCopy: null, remembered: input.rememberedThreadId }
  }
  if (usable(input.rememberedThreadId) && input.rememberedThreadId) {
    return { ignored: false, layer: "session", activeThreadId: input.rememberedThreadId, selectThread: input.connection === "connected" && input.activeThreadId !== input.rememberedThreadId ? input.rememberedThreadId : false, homeCopy: null, remembered: input.rememberedThreadId }
  }
  if (input.listArrived && input.rememberedThreadId) {
    return { ignored: false, layer: "projects", activeThreadId: null, selectThread: false, homeCopy: projectCopy.restoreInvalid, remembered: null }
  }
  return { ignored: false, layer: "projects", activeThreadId: null, selectThread: false, homeCopy: projectCopy.restoreNone, remembered: null }
}

export function decideActiveThreadList(input: {
  activeThreadId: string | null
  rememberedThreadId: string | null
  incoming: Array<{ id: string; trashed_at?: string | null }>
  listScope: "active" | "trash" | "all"
}): { createBlank: false; selectIncomingFirst: false; activeThreadId: string | null; selectThread: false | string; homeCopy: string | null } {
  if (input.listScope !== "active") {
    return { createBlank: false, selectIncomingFirst: false, activeThreadId: input.activeThreadId, selectThread: false, homeCopy: null }
  }
  const usable = input.incoming.filter(thread => !thread.trashed_at)
  if (input.activeThreadId && usable.some(thread => thread.id === input.activeThreadId)) {
    return { createBlank: false, selectIncomingFirst: false, activeThreadId: input.activeThreadId, selectThread: false, homeCopy: null }
  }
  if (input.rememberedThreadId && usable.some(thread => thread.id === input.rememberedThreadId)) {
    return { createBlank: false, selectIncomingFirst: false, activeThreadId: input.rememberedThreadId, selectThread: input.rememberedThreadId, homeCopy: null }
  }
  if (input.rememberedThreadId) {
    return { createBlank: false, selectIncomingFirst: false, activeThreadId: null, selectThread: false, homeCopy: projectCopy.restoreInvalid }
  }
  return { createBlank: false, selectIncomingFirst: false, activeThreadId: null, selectThread: false, homeCopy: projectCopy.restoreNone }
}
```

`chrome-extension/src/sidepanel/navigation/navigation-mode.ts`

```ts
export const RESIDENT_MIN_WIDTH = 960
export type NavigationSurface = "sidepanel" | "popout" | "workspace"
export function navigationMode(input: { surface: NavigationSurface; innerWidth: number }): "layered" | "resident" {
  return input.innerWidth >= RESIDENT_MIN_WIDTH ? "resident" : "layered"
}
```

`useWebSocket.ts` 第 1454–1496 行整段换成对 `decideActiveThreadList` 的调用。函数本身不读 storage。hook 不写 `thread.create`，也不读取 `incoming[0]`。

```ts
const decision = decideActiveThreadList({
  activeThreadId: activeThreadRef.current,
  rememberedThreadId: navigationRememberedRef.current,
  incoming,
  listScope: "active",
})
creatingBlankThreadRef.current = false
if (typeof decision.selectThread === "string") {
  dispatch({ type: "SET_ACTIVE_THREAD", threadId: decision.selectThread })
  chrome.runtime.sendMessage({ type: "thread.select", threadId: decision.selectThread })
} else if (decision.activeThreadId === null) {
  dispatch({
    type: "COMMIT_NAVIGATION",
    decision: { ignored: false, layer: "projects", activeThreadId: null, selectThread: false, homeCopy: decision.homeCopy, remembered: null },
  })
}
```

现有 `SET_ACTIVE_THREAD` 的 `threadId` 类型是 `string`，不能传 `null`。首页清空只走 `COMMIT_NAVIGATION`。

`navigationRememberedRef` 只镜像 `COMMIT_NAVIGATION` 已经写下的 remembered，不是第二次 `chrome.storage.local.get`。合成 WebSocket fixture 不能代替这个 node 测试。

`useNavigationStartup` 仍是唯一读取 `cmspark.navigation.lastThreadId` 的函数。它每次读取先 `bumpListGeneration`，callback 调用 `commitStartupNavigation`。`ignored` 时不 dispatch、不 `thread.select`。否则 `COMMIT_NAVIGATION`。只有 `selectThread` 是字符串时才 `thread.select`。首页决策的 `remembered` 为 null 时才把 storage 写成 null。

`SessionContextBar` 渲染为：

```tsx
<header role="banner" aria-label="会话位置">
  <p>{projectName ? <button type="button" onClick={onProject}>{projectName}</button> : projectCopy.outside}{` / ${threadTitle}`}</p>
  <p>{lines.workspace}</p>
  <p>{lines.execution}</p>
</header>
```

`ProjectNavigationRoot` 把 `onProject` 接到 `onLayer("project")` 和 `onOpenProject(projectId)`，不调用 `onAssign`。归属按钮在 `connecting` 时禁用，文案是 `projectCopy.connectingMove`，不是 `projectCopy.offlineMove`。

窄于 960 的导航不再渲染 `.cm-navigation-disclosure`。`workspace-styles.ts` 删除 `28dvh` 和这个 class。

- [ ] **Step 4: Run test to verify it passes**

Run: `cd chrome-extension && nvm use 22 && uv run --no-project --with playwright python scripts/test-project-navigation-ui.py && rm -rf .test-dist && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/startup-destination.test.js .test-dist/tests/project-list-model.test.js`

Expected: 浏览器脚本退出码 0，node 测试 `# fail 0`。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/navigation/startup-destination.ts chrome-extension/src/sidepanel/navigation/useNavigationStartup.ts chrome-extension/src/sidepanel/store/agentStore.tsx chrome-extension/src/sidepanel/components/WorkspaceFrame.tsx chrome-extension/src/sidepanel/components/SessionContextBar.tsx chrome-extension/src/sidepanel/hooks/useWebSocket.ts chrome-extension/scripts/test-project-navigation-ui.py chrome-extension/tests/startup-destination.test.ts chrome-extension/src/sidepanel/ui/workspace-styles.ts
git commit -m "feat: restore the last session from one startup commit"
```

节点 2 到这里停，做独立对抗评审。PASS 后再进 Task 4。

### Task 4: 工具、设置和全量回归

**Files:**

- Create: `chrome-extension/src/sidepanel/navigation/tool-groups.ts`
- Modify: `chrome-extension/src/sidepanel/components/ProjectNavigationRoot.tsx`
- Modify: `chrome-extension/scripts/test-project-navigation-ui.py`
- Test: `chrome-extension/tests/tool-groups.test.ts`

**Interfaces:**

- Produces: `toolGroups(level)`，顺序等于 `contextBarTabsForLevel(level)` 然后 `contextBarOverflowTabsForLevel(level)`。

- [ ] **Step 1: Write the failing test**

```ts
import test from "node:test"
import assert from "node:assert/strict"
import { CONTEXT_PANEL_TABS } from "../src/sidepanel/components/ContextPanelHost"
import { contextBarOverflowTabsForLevel, contextBarTabsForLevel } from "../src/sidepanel/mode/mode-controller"
import { toolGroups } from "../src/sidepanel/navigation/tool-groups"

test("tool groups keep the existing primary order", () => {
  assert.deepEqual(toolGroups("chat")[0].ids, ["skills", "knowledge", "history"])
  assert.deepEqual(toolGroups("browser")[0].ids, ["tabs", "skills"])
  for (const level of ["chat", "browser", "computer"] as const) {
    assert.deepEqual(toolGroups(level)[0].ids, contextBarTabsForLevel(level))
    assert.deepEqual(toolGroups(level)[1].ids, contextBarOverflowTabsForLevel(level))
    const ids = toolGroups(level).flatMap(group => group.ids)
    assert.deepEqual([...ids].sort(), CONTEXT_PANEL_TABS.map(tab => tab.id).sort())
    assert.equal((ids as string[]).includes("shell"), false)
  }
})
```

`test_tools` 在点「工具」之后才读「当前任务」。chat 前三项是「技能」「知识」「历史」。它再点导航里的「设置」并等待 `dialog[name=设置]`。`test_browser_tools` 先点「工具」，前两项是「浏览器标签页」「技能」，「设置」仍在 `navigation[name=工作区]`。样式断言已经在 `test_tools` 里。

- [ ] **Step 2: Run test to verify it fails**

Run: `cd chrome-extension && rm -rf .test-dist && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/tool-groups.test.js`

Expected: FAIL，`not implemented`。

- [ ] **Step 3: Write minimal implementation**

```ts
import { contextBarOverflowTabsForLevel, contextBarTabsForLevel, type ContextBarTabId } from "../mode/mode-controller"
import type { CapabilityLevel } from "../types"

export function toolGroups(level: CapabilityLevel): { title: "当前任务" | "其他工具"; ids: ContextBarTabId[] }[] {
  return [
    { title: "当前任务", ids: contextBarTabsForLevel(level) },
    { title: "其他工具", ids: contextBarOverflowTabsForLevel(level) },
  ]
}
```

导航删除 `filter(t => t.id !== "history")`。不新增 shell 开关。

- [ ] **Step 4: Run test to verify it passes**

```bash
cd chrome-extension && nvm use 22
uv run --no-project --with playwright python scripts/test-project-navigation-ui.py
node scripts/check-sidepanel-raw-colors.mjs
rm -rf .test-dist && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/*.test.js
npx tsc --noEmit
cd ../companion && npm test
```

Expected: Playwright 退出码 0；颜色检查退出码 0；扩展测试 `# fail 0`；两处 tsc 退出码 0；companion 失败数为 0。

同一 head 的十个检查都绿才算节点 3 通过。workflow 名以 GitHub 检查标题为准：

- CI `build`
- CI `smoke (ubuntu-latest)`
- CI `smoke (macos-latest)`
- CI `smoke (windows-latest)`
- CI `smoke (windows-native)`
- CI `activity (Linux X11 native)`（job id 是 `activity-linux-x11`，验收看这个标题）
- CI `acp-history-restart`
- ARM acceptance `Affected CPU controls (Linux ARM64)`
- Linux integration ARM `Linux integration controls (ARM64)`
- Session save recovery `Windows session persistence`

不触发 Release，不触发 Build installers。

- [ ] **Step 5: Commit**

```bash
git add chrome-extension/src/sidepanel/navigation/tool-groups.ts chrome-extension/src/sidepanel/components/ProjectNavigationRoot.tsx chrome-extension/scripts/test-project-navigation-ui.py chrome-extension/tests/tool-groups.test.ts
git commit -m "feat: group existing tools without adding a shell switch"
```

节点 3 评审 PASS 后，才按仓库门禁正常合并。本计划的文档 PR 不包含以上功能提交。
