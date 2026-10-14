/** Real production callbacks + stock selection body + actual router receipts; DOM/lease transport seam is inert. */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { randomUUID } from "node:crypto"
import { SUMMONER_PROJECT_HTML, SUMMONER_PROJECT_JS } from "../src/summoner/projects"
const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-641-selection-"))
process.env.CMSPARK_DATA_DIR = root;process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
let tm: import("../src/threads/thread-manager").ThreadManager, router: typeof import("../src/message-router")
let activity: typeof import("../src/threads/project-activity")
const session = { surface: "summoner", sendToExtension() {}, executeTool: async () => { throw new Error("OWNED_EXECUTION_FORBIDDEN") } } as any
before(async () => { await (await import("../src/config")).initDataDir();tm = new (await import("../src/threads/thread-manager")).ThreadManager();router = await import("../src/message-router");activity = await import("../src/threads/project-activity");activity.bindProjectConfirmationProbe(() => 0) })
after(() => { activity.bindProjectConfirmationProbe(null);fs.rmSync(root, { recursive: true, force: true }) })
const call = (type: string, rest: any = {}) => router.handleMessage({ type, ...rest }, { threadManager: tm } as any, session)
const source = fs.readFileSync(path.resolve("src/summoner-web.ts"), "utf8")
const stockSelect = source.slice(source.indexOf("  var selectionRevision=0;"), source.indexOf("  function startPoll(){"))
for (const failure of [false, true]) for (const navigation of ["no-switch", "A-to-B", "A-to-B-to-A"]) {
  test(`actual Summoner ${failure ? "late refusal" : "committed late success"} ${navigation}`, async () => {
    const a = tm.create("OWNED_A"), b = tm.create("OWNED_B")
    const state = await call("project.list")
    const created = await call("project.create", { name: "OWNED_SELECTION", operation_id: randomUUID(), expected_revision: state.revision, user_gesture: true })
    assert.equal(created.type, "project.changed")
    const elements: Record<string, any> = {}
    for (const match of SUMMONER_PROJECT_HTML.matchAll(/id="([^"]+)"/g)) elements[match[1]] = { value: "", textContent: "", disabled: false, hidden: false, options: [], appendChild(option: any) { this.options.push(option) }, replaceChildren() { this.options = [] }, querySelectorAll() { return [] }, addEventListener() {}, focus() {} }
    elements.text = { value: "" }
    let held: { reply: any; release: () => void } | undefined
    const selections: string[] = []
    const context = vm.createContext({ crypto: { randomUUID }, Number, Promise, Object, document: { createElement: () => ({}), getElementById: (id: string) => elements[id] },
      threads: [a, b], threadId: a.id, busy: false, selections, seed: { revision: created.revision, projects: [created.project] },
      renderThreads() {}, clearStreamMsg() {}, showHistory() { selections.push(context.threadId) }, renderMsgs() {}, startPoll() {}, stopPoll() {}, syncBusyUi() {}, setStatus() {}, statusFromEvent() {}, refresh: () => Promise.resolve(),
      api: async (route: string, options?: any) => {
        if (route === "/api/lease") return {} // inert existing lease seam, not an authority assertion
        const fields = options?.body ? JSON.parse(options.body) : {}
        const method = route === "/api/projects" ? "project.list" : route === "/api/threads" ? "thread.create" : route === "/api/thread/project" ? "thread.project.set" : "thread.select"
        if (method === "thread.project.set" && failure) activity.bindProjectConfirmationProbe(() => 1)
        let reply: any
        try { reply = await call(method, fields) } finally { activity.bindProjectConfirmationProbe(() => 0) }
        if (method !== "thread.project.set") return reply
        return new Promise(resolve => { held = { reply, release: () => resolve(reply) } })
      },
    })
    vm.runInContext("function $(id){return document.getElementById(id)}\n" + stockSelect + SUMMONER_PROJECT_JS + "\nprojectSnapshot=seed;renderProjects()", context)
    const pending = vm.runInContext("projectMutate('thread.project.new',{project_id:seed.projects[0].id})", context)
    for (let i = 0; !held && i < 40; i++) await new Promise(resolve => setImmediate(resolve))
    assert.ok(held, "actual second-step response must exist before navigation")
    assert.equal(held!.reply.type, failure ? "project.error" : "project.changed")
    const target = tm.list().find(t => ![a.id, b.id].includes(t.id) && t.created_at > a.created_at)!
    if (navigation !== "no-switch") await vm.runInContext(`selectThread(${JSON.stringify(b.id)})`, context)
    if (navigation === "A-to-B-to-A") await vm.runInContext(`selectThread(${JSON.stringify(a.id)})`, context)
    held!.release();await pending
    assert.equal(context.threadId, navigation === "no-switch" ? target.id : navigation === "A-to-B" ? b.id : a.id)
    if (navigation !== "no-switch") { assert.equal(selections.includes(target.id), false);assert.match(elements.projectNotice.textContent, /刷新核实/) }
    else if (failure) assert.match(elements.projectError.textContent, /新对话已创建在项目外/)
    else assert.match(elements.projectNotice.textContent, /已保存/)
    assert.equal(tm.projects.projectId(target), failure ? null : created.project.id, "UI fencing never rolls back a persisted membership")
  })
}
