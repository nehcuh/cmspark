import test from "node:test"
import assert from "node:assert/strict"
import { TaskTabs } from "../src/background/task-tabs"
import { browserSiteTarget } from "../src/background/browser-site-target"
import { taskTabHasEdits } from "../src/background/task-tabs"
import vm from "node:vm"

const owner = { thread_id: "task-one", execution_id: "11111111-1111-4111-8111-111111111111" }

async function fixture() {
  let current: any = { id: 17, url: "https://example.test/source?private=one", active: false, pinned: false, audible: false }
  let edits = false, busy = false, calls = 0, beforeEdit: (() => void) | undefined
  const guard = new TaskTabs({ tab: async () => ({ ...current }), remove: async () => { calls++ },
    edited: async () => { beforeEdit?.(); return edits }, busy: () => busy })
  const token = guard.created(17, owner)
  const navigation_key = (await browserSiteTarget(17, current.url))!.navigation_key
  return { guard, request: { token, navigation_key, automatic: true }, calls: () => calls,
    tab: (patch: any) => { current = { ...current, ...patch } }, edited: () => { edits = true },
    busy: () => { busy = true }, duringInspection: (fn: () => void) => { beforeEdit = fn } }
}

test("owned background tab closes once; an old claim cannot close another tab lifetime", async () => {
  const f = await fixture()
  assert.deepEqual(await f.guard.close(17, f.request, owner), { success: true })
  assert.equal(f.calls(), 1)
  f.guard.created(17, owner)
  assert.equal((await f.guard.close(17, f.request, owner)).success, false)
  assert.equal(f.calls(), 1)
})

test("foreground, pinned, audible, adopted, edited and in-flight pages stay open", async () => {
  for (const kind of ["active", "pinned", "audible", "adopted", "edited", "busy"] as const) {
    const f = await fixture()
    if (["active", "pinned", "audible"].includes(kind)) f.tab({ [kind]: true })
    if (kind === "adopted") f.guard.adopt(17)
    if (kind === "edited") f.edited()
    if (kind === "busy") f.busy()
    assert.equal((await f.guard.close(17, f.request, owner)).success, false, kind)
    assert.equal(f.calls(), 0, kind)
  }
})

test("explicit release can close its foreground tab but still preserves user adoption and edits", async () => {
  const f = await fixture(); f.tab({ active: true })
  assert.equal((await f.guard.close(17, { ...f.request, automatic: false }, owner)).success, true)
  for (const change of ["adopted", "edited"] as const) {
    const next = await fixture(); if (change === "adopted") next.guard.adopt(17); else next.edited()
    assert.equal((await next.guard.close(17, { ...next.request, automatic: false }, owner)).success, false)
  }
})

test("query-only navigation, other tasks and browser adoption during inspection invalidate cleanup", async () => {
  const f = await fixture(); f.tab({ url: "https://example.test/source?private=two" })
  assert.equal((await f.guard.close(17, f.request, owner)).data?.reason, "TARGET_CHANGED")
  assert.equal(f.calls(), 0)
  const other = await fixture(); other.guard.observe(17, { ...owner, execution_id: "22222222-2222-4222-8222-222222222222" })
  assert.equal((await other.guard.close(17, other.request, owner)).success, false)
  const late = await fixture(); late.duringInspection(() => late.guard.adopt(17))
  assert.equal((await late.guard.close(17, late.request, owner)).success, false)
  assert.equal(late.calls(), 0)
})

test("a forged owner, missing creation claim, restarted worker or failed close never reports success", async () => {
  const f = await fixture()
  assert.equal((await f.guard.close(17, f.request, { ...owner, thread_id: "other" })).success, false)
  assert.equal((await f.guard.close(18, f.request, owner)).success, false)
  f.guard.forget(17)
  assert.equal((await f.guard.close(17, f.request, owner)).success, false)
  const broken = new TaskTabs({ tab: async () => ({ id: 17, url: "https://example.test/source" } as chrome.tabs.Tab),
    remove: async () => { throw Error("browser disappeared") }, edited: async () => false, busy: () => false })
  const token = broken.created(17, owner), target = (await browserSiteTarget(17, "https://example.test/source"))!
  assert.equal((await broken.close(17, { token, navigation_key: target.navigation_key, automatic: true }, owner)).success, false)
})

test("the production edit probe protects plaintext editing and normalizes untouched browser form defaults", async () => {
  const previous = (globalThis as any).chrome
  class Input {
    type = "text"; value = ""; defaultValue = ""; checked = false; defaultChecked = false; files: unknown[] = []
    cloneNode() {
      const type = this.type
      return { set value(value: string) { this.normalized = type === "range" && value === "" ? "50" : value },
        get value() { return this.normalized }, normalized: "" }
    }
  }
  class Textarea { value = ""; defaultValue = "" }
  class Select { multiple = false; size = 0; selectedIndex = 0
    options = [{ selected: true, defaultSelected: false, disabled: false }, { selected: false, defaultSelected: false, disabled: false }] }
  let editable: any[] = [], controls: any[] = []
  ;(globalThis as any).chrome = { scripting: { executeScript: async ({ func }: any) => [{ frameId: 0, result:
    vm.runInNewContext("(" + func.toString() + ")()", { document: {
      querySelectorAll: (selector: string) => selector === "[contenteditable]" ? editable : controls,
    }, window: { length: 0 }, HTMLInputElement: Input, HTMLTextAreaElement: Textarea, HTMLSelectElement: Select }) }] } }
  try {
    const dropdown = new Select(); controls = [dropdown]
    assert.equal(await taskTabHasEdits(17), false, "browser's implicit first option is an untouched default")
    dropdown.selectedIndex = 1
    assert.equal(await taskTabHasEdits(17), true)
    const range = new Input(); range.type = "range"; range.value = "50"; controls = [range]
    assert.equal(await taskTabHasEdits(17), false, "normalized range default is not a user edit")
    range.value = "75"; assert.equal(await taskTabHasEdits(17), true)
    controls = []
    for (const contentEditable of ["plaintext-only", "TRUE", ""]) {
      editable = [{ contentEditable, isContentEditable: true }]
      assert.equal(await taskTabHasEdits(17), true, contentEditable)
    }
    editable = [{ contentEditable: "false", isContentEditable: false }]
    assert.equal(await taskTabHasEdits(17), false)
  } finally { (globalThis as any).chrome = previous }
})

test("iframe edits are protected and an uninspected child frame retains the page", async () => {
  const previous = (globalThis as any).chrome
  let results: any[] = [{ frameId: 0, result: { edited: false, child_frames: 1 } },
    { frameId: 17, result: { edited: true, child_frames: 0 } }]
  ;(globalThis as any).chrome = { scripting: { executeScript: async ({ target }: any) => {
    assert.equal(target.allFrames, true); return results
  } } }
  try {
    assert.equal(await taskTabHasEdits(17), true)
    results = [{ frameId: 0, result: { edited: false, child_frames: 1 } }]
    let failure: unknown
    try { await taskTabHasEdits(17) } catch (error) { failure = error }
    assert.equal((failure as Error)?.message, "EDIT_STATE_UNAVAILABLE")
  } finally { (globalThis as any).chrome = previous }
})
