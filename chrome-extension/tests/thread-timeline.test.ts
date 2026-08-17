import test from "node:test"
import assert from "node:assert/strict"
import {
  groupThreadsByCalendar,
  filterThreadsByQuery,
  formatRelativeTime,
  formatThreadIdBadge,
  localDayKey,
  localMonthKey,
  localYesterdayKey,
  selectionState,
  toggleGroupSelection,
  displayThreadTitle,
  displayThreadEvidence,
  acpOutcomeChip,
  formatClockTime,
  formatThreadListTime,
  countAliases,
  threadIdsInMonth,
  aliasFromFirstUserText,
  buildTagIndex,
  parseThreadListExpand,
  DEFAULT_THREAD_LIST_EXPAND,
  isPinnedGroupOpen,
  isMonthGroupOpen,
  isUntaggedForExtract,
  shouldForceDigestExtract,
  selectUntaggedForExtract,
  batchNeedsForceExtract,
  collapseTagKeys,
  displayDigestTldr,
  EXTRACT_DIGEST_MAX,
  TAG_CLOUD_MAX_VISIBLE,
  parseDigestQuota,
  remainingDigestQuota,
  selectLazyDigestCandidates,
  showDigestStaleBadge,
  digestQuotaDayKey,
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

test("filterThreadsByQuery: digest tldr and bullets", () => {
  const threads = [
    {
      id: "a1",
      alias: "会话甲",
      digest: {
        tldr: "敲定了 Q3 预算上限",
        bullets: ["采用分阶段上线", "保留本地 Whisper"],
        tags: ["预算"],
      },
    },
    {
      id: "b2",
      alias: "会话乙",
      first_user_preview: "无关内容",
      digest: { tldr: "修 UI 间距", bullets: ["ThreadList"] },
    },
  ]
  assert.equal(filterThreadsByQuery(threads, "预算上限").length, 1)
  assert.equal(filterThreadsByQuery(threads, "Whisper").length, 1)
  assert.equal(filterThreadsByQuery(threads, "分阶段").length, 1)
  assert.equal(filterThreadsByQuery(threads, "ThreadList").length, 1)
  assert.equal(filterThreadsByQuery(threads, "不存在的词").length, 0)
  // id still works with leading #
  assert.equal(filterThreadsByQuery(threads, "#a1").length, 1)
  assert.equal(filterThreadsByQuery(threads, "a1").length, 1)
})

test("formatThreadIdBadge: always #id for list display", () => {
  assert.equal(formatThreadIdBadge("abc123"), "#abc123")
  assert.equal(formatThreadIdBadge("#xyz"), "#xyz")
  assert.equal(formatThreadIdBadge("  def  "), "#def")
  assert.equal(formatThreadIdBadge(""), "")
  assert.equal(formatThreadIdBadge(null), "")
  assert.equal(formatThreadIdBadge(undefined), "")
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
  // Id lives in list badge (formatThreadIdBadge), not inlined into title
  assert.equal(displayThreadTitle({ id: "abcdefgh", alias: "  " }), "未命名")
  assert.equal(displayThreadTitle({ id: "x", alias: "Hello" }), "Hello")
})

test("displayThreadTitle hygiene ladder (P-B1)", () => {
  assert.equal(displayThreadTitle({ id: "2b8ckp", alias: "", message_count: 0 }), "空会话")
  assert.equal(
    displayThreadTitle({
      id: "rny77t",
      alias: "",
      message_count: 2,
      user_message_count: 0,
      acp_list: { outcome: "fail", agent_id: "pi" },
    }),
    "编程接力",
  )
  assert.equal(
    displayThreadTitle({
      id: "4j6l6f",
      alias: "p1-wl",
      message_count: 1,
      user_message_count: 0,
      acp_list: { outcome: "fail", agent_id: "pi" },
    }),
    "p1-wl",
  )
  assert.equal(
    displayThreadTitle({
      id: "x",
      alias: "",
      message_count: 2,
      user_message_count: 0,
    }),
    "无用户消息",
  )
  assert.ok(!/未命名\s*·/.test(displayThreadTitle({ id: "rny77t", alias: "" })))
})

test("acpOutcomeChip + evidence never inlines handback body", () => {
  const t = {
    id: "rny77t",
    alias: "",
    message_count: 2,
    user_message_count: 0,
    acp_list: { outcome: "fail" as const, agent_id: "pi" },
  }
  assert.equal(acpOutcomeChip(t), "失败")
  const ev = displayThreadEvidence(t)
  assert.equal(ev, "编程接力 · pi · 失败")
  assert.ok(!String(ev).includes("No API key"))
})

test("duplicate alias uses clock time", () => {
  const now = new Date(2026, 7, 17, 15, 0, 0)
  const threads = [
    { id: "a", alias: "p1-wl", updated_at: new Date(2026, 7, 17, 14, 32).toISOString() },
    { id: "b", alias: "p1-wl", updated_at: new Date(2026, 7, 17, 11, 8).toISOString() },
  ]
  const counts = countAliases(threads)
  assert.equal(counts.get("p1-wl"), 2)
  assert.match(formatThreadListTime(threads[0], now, counts), /今天 14:32/)
  assert.match(formatClockTime(threads[1].updated_at, now), /今天 11:08/)
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

// ─── Wave A: untagged extract helpers (GAP-11..15 / S1–S5 / S10) ───────────

test("isUntaggedForExtract: !digest OR empty tags", () => {
  assert.equal(isUntaggedForExtract({ id: "a" }), true)
  assert.equal(isUntaggedForExtract({ id: "b", digest: null }), true)
  assert.equal(isUntaggedForExtract({ id: "c", digest: {} }), true)
  assert.equal(isUntaggedForExtract({ id: "d", digest: { tags: [] } }), true)
  assert.equal(isUntaggedForExtract({ id: "e", digest: { tags: ["x"] } }), false)
  // Stale-with-tags is NOT untagged
  assert.equal(
    isUntaggedForExtract({ id: "f", digest: { tags: ["x"], stale: true } }),
    false,
  )
})

test("shouldForceDigestExtract: only empty-tags digests need force", () => {
  assert.equal(shouldForceDigestExtract({ id: "a" }), false)
  assert.equal(shouldForceDigestExtract({ id: "b", digest: null }), false)
  assert.equal(shouldForceDigestExtract({ id: "c", digest: { tags: [] } }), true)
  assert.equal(shouldForceDigestExtract({ id: "d", digest: {} }), true)
  assert.equal(shouldForceDigestExtract({ id: "e", digest: { tags: ["ok"] } }), false)
})

test("selectUntaggedForExtract: skips busy + worker; cap 20; force true", () => {
  const threads = [
    { id: "w1", agent_role: "worker" as const },
    { id: "o1", agent_role: "orchestrator" as const },
    { id: "n1", agent_role: "normal" as const },
    { id: "busy1" },
    { id: "tagged", digest: { tags: ["alpha"] } },
    { id: "emptyTags", digest: { tags: [] as string[] } },
    { id: "n2" },
  ]
  const sel = selectUntaggedForExtract(threads, {
    busyIds: { busy1: true },
    max: EXTRACT_DIGEST_MAX,
  })
  // worker + busy + tagged out; orch/normal/emptyTags/n2 in
  assert.deepEqual(sel.ids.sort(), ["emptyTags", "n1", "n2", "o1"].sort())
  assert.equal(sel.force, true)
  assert.ok(!sel.ids.includes("w1"))
  assert.ok(!sel.ids.includes("busy1"))
  assert.ok(!sel.ids.includes("tagged"))
})

test("selectUntaggedForExtract: empty batch when nothing eligible", () => {
  const threads = [
    { id: "w1", agent_role: "worker" as const },
    { id: "t1", digest: { tags: ["x"] } },
    { id: "b1" },
  ]
  const sel = selectUntaggedForExtract(threads, { busyIds: new Set(["b1"]) })
  assert.deepEqual(sel.ids, [])
  assert.equal(sel.force, false)
})

test("selectUntaggedForExtract: respects max cap", () => {
  const threads = Array.from({ length: 30 }, (_, i) => ({ id: `t${i}` }))
  const sel = selectUntaggedForExtract(threads, { max: 20 })
  assert.equal(sel.ids.length, 20)
  assert.equal(sel.force, true)
})

test("selectUntaggedForExtract: can include workers when excludeWorkers=false", () => {
  const threads = [
    { id: "w1", agent_role: "worker" as const },
    { id: "n1" },
  ]
  const sel = selectUntaggedForExtract(threads, { excludeWorkers: false })
  assert.deepEqual(sel.ids.sort(), ["n1", "w1"].sort())
})

test("batchNeedsForceExtract: true when any empty-tags digest in selection", () => {
  const threads = [
    { id: "a", digest: { tags: ["x"] } },
    { id: "b", digest: { tags: [] as string[] } },
    { id: "c" },
  ]
  assert.equal(batchNeedsForceExtract(threads, ["a"]), false)
  assert.equal(batchNeedsForceExtract(threads, ["a", "b"]), true)
  assert.equal(batchNeedsForceExtract(threads, ["c"]), false) // no digest → no force needed
  assert.equal(batchNeedsForceExtract(threads, []), false)
})

test("collapseTagKeys: folds past maxVisible", () => {
  const keys = Array.from({ length: 20 }, (_, i) => `t${i}`)
  const folded = collapseTagKeys(keys, false, TAG_CLOUD_MAX_VISIBLE)
  assert.equal(folded.visible.length, TAG_CLOUD_MAX_VISIBLE)
  assert.equal(folded.hiddenCount, 20 - TAG_CLOUD_MAX_VISIBLE)
  const open = collapseTagKeys(keys, true, TAG_CLOUD_MAX_VISIBLE)
  assert.equal(open.visible.length, 20)
  assert.equal(open.hiddenCount, 0)
})

test("displayDigestTldr: one-line ellipsis", () => {
  assert.equal(displayDigestTldr({ id: "x" }), null)
  assert.equal(displayDigestTldr({ id: "x", digest: { tldr: "  short  " } }), "short")
  const long = "字".repeat(150)
  const out = displayDigestTldr({ id: "x", digest: { tldr: long } }, 120)
  assert.ok(out)
  assert.ok(out!.endsWith("…"))
  assert.ok(out!.length <= 121)
})

// ─── Wave B: lazy digest + stale badge ─────────────────────────────────────

test("parseDigestQuota resets on new day", () => {
  const now = new Date(2026, 7, 11, 12, 0, 0)
  const day = digestQuotaDayKey(now)
  assert.equal(parseDigestQuota(JSON.stringify({ day, count: 5 }), now).count, 5)
  assert.equal(
    parseDigestQuota(JSON.stringify({ day: "2000-01-01", count: 99 }), now).count,
    0,
  )
  assert.equal(remainingDigestQuota({ day, count: 5 }, 20), 15)
  assert.equal(remainingDigestQuota({ day, count: 20 }, 20), 0)
})

test("selectLazyDigestCandidates: idle untagged/stale, skip fresh+worker", () => {
  const now = new Date(2026, 7, 11, 12, 0, 0)
  const old = new Date(2026, 7, 9, 12, 0, 0).toISOString()
  const fresh = new Date(2026, 7, 11, 11, 0, 0).toISOString()
  const threads = [
    { id: "fresh", updated_at: fresh },
    { id: "old", updated_at: old },
    { id: "stale", updated_at: old, digest: { tags: ["x"], stale: true } },
    { id: "worker", agent_role: "worker" as const, updated_at: old },
    { id: "tagged", updated_at: old, digest: { tags: ["ok"] } },
  ]
  const sel = selectLazyDigestCandidates(threads, {
    now,
    onIdleHours: 24,
    max: 20,
  })
  assert.ok(sel.ids.includes("old"))
  assert.ok(sel.ids.includes("stale"))
  assert.ok(!sel.ids.includes("fresh"))
  assert.ok(!sel.ids.includes("worker"))
  assert.ok(!sel.ids.includes("tagged"))
  assert.equal(sel.force, true)
})

test("showDigestStaleBadge: time view only non-today", () => {
  const now = new Date(2026, 7, 11, 12, 0, 0)
  const today = new Date(2026, 7, 11, 10, 0, 0).toISOString()
  const yday = new Date(2026, 7, 10, 10, 0, 0).toISOString()
  assert.equal(
    showDigestStaleBadge({ id: "a", digest: { stale: true }, updated_at: today }, "time", now),
    false,
  )
  assert.equal(
    showDigestStaleBadge({ id: "b", digest: { stale: true }, updated_at: yday }, "time", now),
    true,
  )
  assert.equal(
    showDigestStaleBadge({ id: "c", digest: { stale: true }, updated_at: today }, "tags", now),
    true,
  )
  assert.equal(showDigestStaleBadge({ id: "d", digest: { tags: ["x"] } }, "tags", now), false)
})
