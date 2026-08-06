import test from "node:test"
import assert from "node:assert/strict"
import {
  groupThreadsByCalendar,
  filterThreadsByQuery,
  formatRelativeTime,
  localDayKey,
  localMonthKey,
  localYesterdayKey,
  selectionState,
  toggleGroupSelection,
  displayThreadTitle,
  threadIdsInMonth,
  aliasFromFirstUserText,
  buildTagIndex,
  parseThreadListExpand,
  DEFAULT_THREAD_LIST_EXPAND,
  isPinnedGroupOpen,
  isMonthGroupOpen,
} from "../src/sidepanel/utils/thread-timeline"

/** Build ISO in local timezone for year/month/day/hour. */
function localIso(y: number, m: number, d: number, h = 12, min = 0): string {
  return new Date(y, m - 1, d, h, min, 0, 0).toISOString()
}

test("localDayKey / localMonthKey use local calendar", () => {
  const d = new Date(2026, 7, 6, 15, 30, 0) // Aug 6 2026 local
  assert.equal(localDayKey(d), "2026-08-06")
  assert.equal(localMonthKey(d), "2026-08")
})

test("localYesterdayKey is previous calendar day", () => {
  const now = new Date(2026, 7, 6, 12, 0, 0)
  assert.equal(localYesterdayKey(now), "2026-08-05")
  // month boundary
  const sep1 = new Date(2026, 8, 1, 10, 0, 0)
  assert.equal(localYesterdayKey(sep1), "2026-08-31")
})

test("groupThreadsByCalendar: today + yesterday + history month→day", () => {
  const now = new Date(2026, 7, 6, 18, 0, 0) // 2026-08-06
  const threads = [
    { id: "t1", alias: "today-a", updated_at: localIso(2026, 8, 6, 10) },
    { id: "t2", alias: "today-b", updated_at: localIso(2026, 8, 6, 16) },
    { id: "y1", alias: "yest", updated_at: localIso(2026, 8, 5, 20) },
    { id: "t3", alias: "july-28", updated_at: localIso(2026, 7, 28, 9) },
    { id: "t4", alias: "july-15", updated_at: localIso(2026, 7, 15, 9) },
    { id: "t5", alias: "june", updated_at: localIso(2026, 6, 1, 9) },
  ]
  const model = groupThreadsByCalendar(threads, now)
  assert.equal(model.today.length, 2)
  assert.equal(model.today[0].id, "t2")
  assert.equal(model.yesterday.length, 1)
  assert.equal(model.yesterday[0].id, "y1")
  // yesterday must NOT appear inside months
  for (const m of model.months) {
    for (const d of m.days) {
      assert.ok(!d.threads.some((t) => t.id === "y1"))
    }
  }
  assert.equal(model.months.length, 2)
  assert.equal(model.months[0].monthKey, "2026-07")
  assert.equal(model.months[0].count, 2)
  assert.deepEqual(threadIdsInMonth(model.months[0]).sort(), ["t3", "t4"])
})

test("groupThreadsByCalendar: cross-midnight boundary (local)", () => {
  const now = new Date(2026, 7, 6, 0, 30, 0)
  const threads = [
    { id: "after", updated_at: localIso(2026, 8, 6, 0, 10) },
    { id: "before", updated_at: localIso(2026, 8, 5, 23, 50) },
  ]
  const model = groupThreadsByCalendar(threads, now)
  assert.deepEqual(model.today.map((t) => t.id), ["after"])
  assert.deepEqual(model.yesterday.map((t) => t.id), ["before"])
  assert.equal(model.months.length, 0)
})

test("groupThreadsByCalendar: prefers updated_at over created_at", () => {
  const now = new Date(2026, 7, 6, 12, 0, 0)
  const threads = [
    {
      id: "old-created-touched-today",
      created_at: localIso(2026, 1, 1),
      updated_at: localIso(2026, 8, 6, 8),
    },
  ]
  const model = groupThreadsByCalendar(threads, now)
  assert.equal(model.today.length, 1)
  assert.equal(model.yesterday.length, 0)
  assert.equal(model.months.length, 0)
})

test("parseThreadListExpand: defaults + legacy months array + object", () => {
  assert.deepEqual(parseThreadListExpand(null), {
    months: [],
    today: true,
    yesterday: false,
  })
  assert.deepEqual(parseThreadListExpand(JSON.stringify(["2026-07", "2026-06"])), {
    months: ["2026-07", "2026-06"],
    today: true,
    yesterday: false,
  })
  assert.deepEqual(
    parseThreadListExpand(
      JSON.stringify({ months: ["2026-07"], today: false, yesterday: true }),
    ),
    { months: ["2026-07"], today: false, yesterday: true },
  )
  assert.equal(DEFAULT_THREAD_LIST_EXPAND.today, true)
  assert.equal(DEFAULT_THREAD_LIST_EXPAND.yesterday, false)
})

test("isPinnedGroupOpen / isMonthGroupOpen: search force-expand", () => {
  const state = { months: [] as string[], today: false, yesterday: false }
  assert.equal(isPinnedGroupOpen("today", state, { searchActive: false, hasMatches: true }), false)
  assert.equal(isPinnedGroupOpen("today", state, { searchActive: true, hasMatches: true }), true)
  assert.equal(isPinnedGroupOpen("yesterday", state, { searchActive: true, hasMatches: false }), false)
  assert.equal(
    isMonthGroupOpen("2026-07", { ...state, months: ["2026-07"] }, {
      searchActive: false,
      hasMatches: false,
    }),
    true,
  )
  assert.equal(
    isMonthGroupOpen("2026-06", state, { searchActive: true, hasMatches: true }),
    true,
  )
})

test("filterThreadsByQuery: alias, id, first_user_preview, tags", () => {
  const threads = [
    { id: "abc123", alias: "竞品调研", first_user_preview: "对比三家定价", digest: { tags: ["竞品", "定价"] } },
    { id: "xyz789", alias: "", first_user_preview: "hello world" },
  ]
  assert.equal(filterThreadsByQuery(threads, "竞品").length, 1)
  assert.equal(filterThreadsByQuery(threads, "xyz").length, 1)
  assert.equal(filterThreadsByQuery(threads, "定价").length, 1)
  assert.equal(filterThreadsByQuery(threads, "nope").length, 0)
  assert.equal(filterThreadsByQuery(threads, "  ").length, 2)
})

test("formatRelativeTime buckets", () => {
  const now = new Date("2026-08-06T12:00:00.000Z")
  assert.equal(formatRelativeTime(new Date(now.getTime() - 30_000).toISOString(), now), "刚刚")
  assert.equal(formatRelativeTime(new Date(now.getTime() - 5 * 60_000).toISOString(), now), "5分钟前")
  assert.equal(formatRelativeTime(new Date(now.getTime() - 3 * 3600_000).toISOString(), now), "3小时前")
  assert.equal(formatRelativeTime(new Date(now.getTime() - 2 * 86400_000).toISOString(), now), "2天前")
})

test("selectionState + toggleGroupSelection", () => {
  const ids = ["a", "b", "c"]
  assert.equal(selectionState(ids, new Set()), "none")
  assert.equal(selectionState(ids, new Set(["a"])), "some")
  assert.equal(selectionState(ids, new Set(["a", "b", "c"])), "all")

  let sel = toggleGroupSelection(ids, new Set())
  assert.deepEqual([...sel].sort(), ["a", "b", "c"])
  sel = toggleGroupSelection(ids, sel)
  assert.equal(sel.size, 0)

  sel = toggleGroupSelection(ids, new Set(), new Set(["a", "b"]))
  assert.deepEqual([...sel].sort(), ["a", "b"])
})

test("displayThreadTitle fallback", () => {
  assert.equal(displayThreadTitle({ id: "abcdefgh", alias: "  " }), "未命名 · abcdefgh")
  assert.equal(displayThreadTitle({ id: "x", alias: "Hello" }), "Hello")
})

test("aliasFromFirstUserText strips prefixes and truncates", () => {
  assert.equal(aliasFromFirstUserText("帮我 对比三家 SaaS 定价"), "对比三家 SaaS 定价")
  const long = "请" + "这是一段很长的用户消息用来测试截断效果".repeat(5)
  const a = aliasFromFirstUserText(long, 40)
  assert.ok(a.length <= 42)
  assert.ok(a.length >= 8)
  assert.equal(aliasFromFirstUserText("   "), "")
})

test("buildTagIndex groups by tag and untagged", () => {
  const threads = [
    { id: "1", digest: { tags: ["Alpha", "beta"] } },
    { id: "2", digest: { tags: ["beta"] } },
    { id: "3", alias: "no tags" },
  ]
  const idx = buildTagIndex(threads)
  assert.equal(idx.get("alpha")?.length, 1)
  assert.equal(idx.get("beta")?.length, 2)
  assert.equal(idx.get("__untagged__")?.length, 1)
})
