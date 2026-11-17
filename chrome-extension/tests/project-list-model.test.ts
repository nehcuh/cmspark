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
