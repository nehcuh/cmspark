// #427: 低语料图谱 LLM 整理 lane E2E（spec §3.1/§3.2/§3.3/§4/§5/§6 服务端半边）
// 覆盖：organize happy path + 缓存落盘、缓存命中 0 调用、语料漂移 stale、
// 失败不静默（organize_error + 旧缓存保留）、parse 失败、未配置 LLM、
// user_gesture 双闸、summoner 拒绝、n≥20 no-op、lock/unlock round-trip、
// 锁缩容/解散（pi 终验 2）、ack_tf_switch、重启+漂移区携带、single-flight。

import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-k-org-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let initDataDir: typeof import("../src/config").initDataDir
let DATA_DIR: string
let saveConfig: (c: Record<string, unknown>) => unknown
let getConfigDir: typeof import("../src/config").getConfigDir
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let clusters: typeof import("../src/skills/knowledge-clusters")
let kg: typeof import("../src/skills/knowledge-graph")
let handleMessage: typeof import("../src/message-router").handleMessage
let __testSetKnowledgeGraphOrganizeImpl: typeof import("../src/message-router").__testSetKnowledgeGraphOrganizeImpl

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  DATA_DIR = configMod.DATA_DIR
  saveConfig = configMod.saveConfig as never
  getConfigDir = configMod.getConfigDir
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  clusters = await import("../src/skills/knowledge-clusters")
  kg = await import("../src/skills/knowledge-graph")
  const mr = await import("../src/message-router")
  handleMessage = mr.handleMessage
  __testSetKnowledgeGraphOrganizeImpl = mr.__testSetKnowledgeGraphOrganizeImpl
  await initDataDir()
  saveConfig({ llm: { api_key: "sk-test-org", base_url: "http://127.0.0.1:9/v1", model_name: "test-model" } })
})

after(() => {
  __testSetKnowledgeGraphOrganizeImpl()
  fs.rmSync(tempHome, { recursive: true, force: true })
})

const panel = { surface: "panel", sendToExtension: () => {} } as never

function mdDoc(name: string, tags: string[], body: string, description = ""): string {
  return `---\nname: ${name}\ndescription: ${description}\ntags: [${tags.join(", ")}]\ntype: domain_knowledge\n---\n${body}\n`
}

/** n 篇同主题（共享 tag + 正文词 + description），body 带 SECRETBODYTOKEN 供隐私断言。 */
function seedGroup(se: InstanceType<typeof SkillEngine>, n: number, prefix = "doc"): string[] {
  const names: string[] = []
  for (let i = 0; i < n; i++) {
    const name = `${prefix}-${String(i).padStart(3, "0")}`
    names.push(name)
    se.importKnowledge(
      mdDoc(name, ["主题A", `t${i}`], `主题A shared body words SECRETBODYTOKEN9999 unique${i} more text`, `第${i}篇描述`),
    )
  }
  return names
}

function seedOrthogonal(se: InstanceType<typeof SkillEngine>, n: number, prefix: string): string[] {
  const names: string[] = []
  for (let i = 0; i < n; i++) {
    const name = `${prefix}-${String(i).padStart(3, "0")}`
    names.push(name)
    se.importKnowledge(mdDoc(name, [`${prefix}t${i}`], `${prefix} lone body unique${prefix}${i}`, `${prefix}描述${i}`))
  }
  return names
}

function resetKnowledgeState(): void {
  fs.rmSync(path.join(DATA_DIR, "knowledge"), { recursive: true, force: true })
  fs.rmSync(clusters.knowledgeIndexPath(), { force: true })
}

async function settle(ms = 10): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

let configMtimeSeed = Date.now()
/** saveConfig 拒清 api_key —— 直写 config.json + utimes 让 getConfig 重载（诚实模拟未配置）。 */
function setLlmConfigured(configured: boolean): void {
  if (configured) {
    saveConfig({ llm: { api_key: "sk-test-org", base_url: "http://127.0.0.1:9/v1", model_name: "test-model" } })
    return
  }
  const configPath = path.join(getConfigDir(), "config.json")
  const cur = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {}
  cur.llm = { ...(cur.llm || {}), api_key: "" }
  fs.writeFileSync(configPath, JSON.stringify(cur, null, 2))
  configMtimeSeed += 1000
  fs.utimesSync(configPath, new Date(configMtimeSeed), new Date(configMtimeSeed))
}

type OrganizeFrame = {
  type: string
  status: string
  relations?: Array<{ a: string; b: string; reason: string; confidence: number; ai: true }>
  labels: Record<string, { name: string; summary?: string; ai: boolean; locked?: true }>
  nodes: Array<{ id: string; group_key: string }>
  llm_ready: boolean
  organize_error?: string
  stale?: boolean
  lock_dissolved?: boolean
  tf_switch_notice?: boolean
}

function readIndex(): import("../src/skills/knowledge-clusters").KnowledgeIndexFile | null {
  return clusters.readKnowledgeIndexFile(clusters.knowledgeIndexPath())
}

test("#427 AC-1: organize happy path——首响应无产物，settle 推帧带 relations + l: 分组，缓存落盘", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 4)
  const ids = se.getKnowledgeDocsForOrganize().map((d) => d.id).sort()
  assert.equal(ids.length, 4)

  let calls = 0
  let userContent = ""
  const sent: OrganizeFrame[] = []
  __testSetKnowledgeGraphOrganizeImpl(async ({ userContent: uc }) => {
    calls += 1
    userContent = uc
    return JSON.stringify({
      groups: [{ name: "主题A 组", summary: "四篇同主题", ids }],
      relations: [{ a: ids[0], b: ids[1], reason: "同主题互证", confidence: 0.9 }],
    })
  })
  const sess = { surface: "panel", sendToExtension: (d: OrganizeFrame) => sent.push(d) } as never
  const first = (await handleMessage(
    { type: "knowledge.graph", organize: true, user_gesture: true },
    { skillEngine: se } as never,
    sess,
  )) as OrganizeFrame
  assert.equal(first.status, "ok")
  assert.equal(first.llm_ready, true)
  assert.deepEqual(first.relations, [], "首响应不带产物（异步驱动）")
  assert.equal(first.organize_error, undefined)

  // 隐私（§3.2）：prompt 只有 title/tags/description，正文绝不进
  await settle()
  assert.equal(calls, 1)
  assert.ok(userContent.includes(`DOC ${ids[0]} |`))
  assert.ok(userContent.includes("第0篇描述"), "description 进 prompt（frontmatter 字段非正文）")
  assert.equal(userContent.includes("SECRETBODYTOKEN9999"), false, "doc bodies must not leak into the organize prompt")

  const pushes = sent.filter((m) => m.type === "knowledge.graph")
  assert.ok(pushes.length > 0, "organize 完成必须推帧")
  const last = pushes[pushes.length - 1]
  assert.equal(last.status, "ok")
  assert.equal(last.organize_error, undefined)
  assert.equal(last.relations!.length, 1)
  assert.equal(last.relations![0].ai, true)
  assert.equal(last.relations![0].reason, "同主题互证")
  assert.equal(last.relations![0].confidence, 0.9)
  const lKey = kg.lGroupKey(ids)
  assert.equal(last.labels[lKey].name, "主题A 组")
  assert.equal(last.labels[lKey].ai, true)
  assert.equal(last.labels[lKey].locked, undefined, "organize 产物不是锁")
  assert.ok(last.nodes.every((n) => n.group_key === lKey))

  // 缓存落盘：graph_llm 区，fingerprint = 当前 docs 聚合，stale false
  const idx = readIndex()
  assert.ok(idx?.graph_llm)
  assert.equal(idx!.graph_llm!.groups.length, 1)
  assert.deepEqual([...idx!.graph_llm!.groups[0].ids].sort(), ids)
  assert.equal(idx!.graph_llm!.stale, false)
  assert.equal(idx!.graph_llm!.fingerprint, kg.computeGraphLlmFingerprint(se.getKnowledgeDocsForOrganize()))
})

test("#427 AC-2: 缓存命中 0 次 LLM；语料变化 → stale 仍渲染旧缓存且不自动重跑", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 4)
  const ids = se.getKnowledgeDocsForOrganize().map((d) => d.id)
  let calls = 0
  __testSetKnowledgeGraphOrganizeImpl(async () => {
    calls += 1
    return JSON.stringify({ groups: [{ name: "组", ids }], relations: [{ a: ids[0], b: ids[1], reason: "r", confidence: 0.5 }] })
  })
  await handleMessage({ type: "knowledge.graph", organize: true, user_gesture: true }, { skillEngine: se } as never, panel)
  await settle()
  assert.equal(calls, 1)

  // 缓存命中：不再调 LLM
  const second = (await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panel)) as OrganizeFrame
  assert.equal(second.relations!.length, 1)
  assert.equal(calls, 1)

  // 语料变化（新增一篇）→ stale badge + 旧缓存照渲染 + 不自动重跑（手动唯一）
  se.importKnowledge(mdDoc("extra-doc", ["新tag"], "unrelated body words", "新描述"))
  const third = (await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panel)) as OrganizeFrame
  assert.equal(third.stale, true)
  assert.equal(third.relations!.length, 1, "stale 仍渲染旧缓存（不假装新鲜也不丢弃）")
  assert.equal(third.llm_ready, true)
  assert.equal(calls, 1)
  const idx = readIndex()
  assert.equal(idx!.graph_llm!.stale, false, "落盘缓存本身不写 stale（渲染时按指纹现算）")
})

test("#427 §4: organize 失败不静默——推 ok 帧 + organize_error，旧缓存原样保留", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 3)
  const ids = se.getKnowledgeDocsForOrganize().map((d) => d.id)
  const sent: OrganizeFrame[] = []
  const sess = { surface: "panel", sendToExtension: (d: OrganizeFrame) => sent.push(d) } as never
  let fail = false
  __testSetKnowledgeGraphOrganizeImpl(async () => {
    if (fail) throw new Error("llm down")
    return JSON.stringify({ groups: [{ name: "组", ids }], relations: [] })
  })
  await handleMessage({ type: "knowledge.graph", organize: true, user_gesture: true }, { skillEngine: se } as never, sess)
  await settle()
  const cached = readIndex()!.graph_llm!
  assert.equal(cached.groups.length, 1)

  // 再整理失败：错误进帧（不是 status:error），缓存不丢
  fail = true
  await handleMessage({ type: "knowledge.graph", organize: true, user_gesture: true }, { skillEngine: se } as never, sess)
  await settle()
  const pushes = sent.filter((m) => m.type === "knowledge.graph")
  const last = pushes[pushes.length - 1]
  assert.equal(last.status, "ok", "organize 失败 ≠ 图谱加载失败（#356 error 帧合同不修订）")
  assert.equal(last.organize_error, "llm down")
  assert.equal(last.lock_dissolved, undefined)
  const after = readIndex()!.graph_llm!
  assert.deepEqual(after, cached, "失败不得抹掉有效缓存")

  // 下次请求：旧缓存照常服务，错误条不残留
  const next = (await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panel)) as OrganizeFrame
  assert.equal(next.organize_error, undefined)
  assert.ok(next.nodes.some((n) => n.group_key.startsWith("l:")), "旧分组仍着色")
})

test("#427 §3.2: parse 失败 → organize_error=graph_organize_parse_failed，无缓存写入", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 3)
  const sent: OrganizeFrame[] = []
  const sess = { surface: "panel", sendToExtension: (d: OrganizeFrame) => sent.push(d) } as never
  __testSetKnowledgeGraphOrganizeImpl(async () => "前置垃圾 not json 后置")
  await handleMessage({ type: "knowledge.graph", organize: true, user_gesture: true }, { skillEngine: se } as never, sess)
  await settle()
  const last = sent.filter((m) => m.type === "knowledge.graph").pop()!
  assert.equal(last.organize_error, "graph_organize_parse_failed")
  assert.equal(readIndex()?.graph_llm, undefined, "parse 失败不落缓存")
})

test("#427 §3.1: 未配置 LLM → llm_ready:false + organize_error，impl 不被调", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 3)
  let calls = 0
  __testSetKnowledgeGraphOrganizeImpl(async () => {
    calls += 1
    return "{}"
  })
  setLlmConfigured(false)
  try {
    const resp = (await handleMessage(
      { type: "knowledge.graph", organize: true, user_gesture: true },
      { skillEngine: se } as never,
      panel,
    )) as OrganizeFrame
    assert.equal(resp.status, "ok")
    assert.equal(resp.llm_ready, false, "llm_ready 缺省为 true 是 ext 侧约定；companion 必须显式 false")
    assert.equal(resp.organize_error, "companion_llm_not_configured")
    await settle()
    assert.equal(calls, 0)
  } finally {
    setLlmConfigured(true)
  }
})

test("#427 双闸：organize / lock_group / unlock_group / ack_tf_switch 缺 user_gesture 全拒", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 3)
  const noGesture = await handleMessage(
    { type: "knowledge.graph", organize: true },
    { skillEngine: se } as never,
    panel,
  )
  assert.equal(noGesture.type, "error")
  assert.match(String(noGesture.error), /user_gesture/)

  const lockNo = await handleMessage({ type: "knowledge.graph", lock_group: "l:x" }, { skillEngine: se } as never, panel)
  assert.equal(lockNo.type, "error")
  assert.match(String(lockNo.error), /user_gesture/)

  const unlockNo = await handleMessage({ type: "knowledge.graph", unlock_group: "l:x" }, { skillEngine: se } as never, panel)
  assert.equal(unlockNo.type, "error")
  assert.match(String(unlockNo.error), /user_gesture/)

  const ackNo = await handleMessage({ type: "knowledge.graph", ack_tf_switch: true }, { skillEngine: se } as never, panel)
  assert.equal(ackNo.type, "error")
  assert.match(String(ackNo.error), /user_gesture/)
})

test("#427 surface 门：summoner 连 organize/lock 一起拒", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 3)
  for (const msg of [
    { type: "knowledge.graph", organize: true, user_gesture: true },
    { type: "knowledge.graph", lock_group: "l:x", user_gesture: true },
    { type: "knowledge.graph", ack_tf_switch: true, user_gesture: true },
  ]) {
    const resp = await handleMessage(msg, { skillEngine: se } as never, { surface: "summoner", sendToExtension: () => {} } as never)
    assert.equal(resp.type, "error")
    assert.match(String(resp.error), /panel/)
  }
})

test("#427 AC-7: n≥20 organize no-op——impl 不调，relations 字段不上帧", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 20)
  let calls = 0
  __testSetKnowledgeGraphOrganizeImpl(async () => {
    calls += 1
    return "{}"
  })
  const resp = (await handleMessage(
    { type: "knowledge.graph", organize: true, user_gesture: true },
    { skillEngine: se } as never,
    panel,
  )) as OrganizeFrame
  assert.equal(resp.status, "ok")
  assert.equal(resp.relations, undefined, "≥20 帧永不携带 relations（客户端漏藏按钮也偷渡不进）")
  assert.equal(resp.organize_error, undefined)
  await settle()
  assert.equal(calls, 0)
  assert.equal(resp.tf_switch_notice, false, "无 LLM 历史 → 无跨 20 notice")
})

test("#427 §5: lock_group/unlock_group round-trip——locked 标、graph_lock 落盘、幂等", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 4)
  const ids = se.getKnowledgeDocsForOrganize().map((d) => d.id).sort()
  __testSetKnowledgeGraphOrganizeImpl(async () => JSON.stringify({ groups: [{ name: "主题A 组", summary: "摘要", ids }], relations: [] }))
  await handleMessage({ type: "knowledge.graph", organize: true, user_gesture: true }, { skillEngine: se } as never, panel)
  await settle()
  const lKey = kg.lGroupKey(ids)

  const locked = (await handleMessage(
    { type: "knowledge.graph", lock_group: lKey, user_gesture: true },
    { skillEngine: se } as never,
    panel,
  )) as OrganizeFrame
  assert.equal(locked.status, "ok")
  assert.ok(locked.nodes.every((n) => n.group_key === lKey))
  assert.equal(locked.labels[lKey].locked, true)
  assert.equal(locked.labels[lKey].ai, true)
  assert.equal(locked.labels[lKey].name, "主题A 组")
  const lockOnDisk = readIndex()!.graph_lock
  assert.ok(lockOnDisk)
  assert.deepEqual(lockOnDisk!.groups[0].ids, ids, "成员快照 = 锁时刻的渲染真值")
  assert.equal(lockOnDisk!.groups[0].summary, "摘要")

  // 解锁：锁区清空；分组本身还在（organize 缓存仍是结构）
  const unlocked = (await handleMessage(
    { type: "knowledge.graph", unlock_group: lKey, user_gesture: true },
    { skillEngine: se } as never,
    panel,
  )) as OrganizeFrame
  assert.equal(unlocked.labels[lKey].locked, undefined)
  assert.equal(unlocked.labels[lKey].ai, true, "解锁后回到 LLM 分组着色")
  assert.equal(readIndex()?.graph_lock, undefined)
  // 幂等：再解一次 no-op 成功
  const again = await handleMessage({ type: "knowledge.graph", unlock_group: lKey, user_gesture: true }, { skillEngine: se } as never, panel)
  assert.equal(again.status, "ok")
})

test("#427 §5: lock_group 拒未分组堆/未知键/小组", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 3)
  const ungrouped = await handleMessage({ type: "knowledge.graph", lock_group: "u:ungrouped", user_gesture: true }, { skillEngine: se } as never, panel)
  assert.equal(ungrouped.type, "error")
  assert.match(String(ungrouped.error), /ungrouped/)

  const unknown = await handleMessage({ type: "knowledge.graph", lock_group: "l:deadbeef", user_gesture: true }, { skillEngine: se } as never, panel)
  assert.equal(unknown.type, "error")
  assert.match(String(unknown.error), /unknown|too-small/)
})

test("#427 §5 + pi 终验 2: 锁缩容——同锁条目跨删除仍生效（键随成员变），<2 解散一次性提示", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 4)
  const ids = se.getKnowledgeDocsForOrganize().map((d) => d.id).sort()
  __testSetKnowledgeGraphOrganizeImpl(async () => JSON.stringify({ groups: [{ name: "锁源组", ids }], relations: [] }))
  await handleMessage({ type: "knowledge.graph", organize: true, user_gesture: true }, { skillEngine: se } as never, panel)
  await settle()
  const lKey4 = kg.lGroupKey(ids)
  await handleMessage({ type: "knowledge.graph", lock_group: lKey4, user_gesture: true }, { skillEngine: se } as never, panel)

  // 删 1 篇：锁缩到 3，仍生效——渲染键随成员集变化，同一条目
  se.deleteKnowledge(ids[3])
  const g3 = (await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panel)) as OrganizeFrame
  const lKey3 = kg.lGroupKey([ids[0], ids[1], ids[2]])
  assert.notEqual(lKey3, lKey4, "缩容后 l:hash 已变")
  assert.ok(g3.nodes.filter((n) => n.id !== undefined && [ids[0], ids[1], ids[2]].includes(n.id)).every((n) => n.group_key === lKey3), "同一锁仍把剩余成员锁成一组")
  assert.equal(g3.labels[lKey3].locked, true)
  assert.equal(g3.labels[lKey3].name, "锁源组", "锁的身份是条目：名字/摘要随条目存活")
  assert.equal(g3.lock_dissolved, undefined)
  assert.deepEqual(readIndex()!.graph_lock!.groups[0].ids.sort(), [ids[0], ids[1], ids[2]], "落盘锁条目已剪枝（键无关）")

  // 删到只剩 1 篇成员：解散——lock_dissolved 一次性 boolean
  se.deleteKnowledge(ids[2])
  se.deleteKnowledge(ids[1])
  const g1 = (await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panel)) as OrganizeFrame
  assert.equal(g1.lock_dissolved, true, "ext wire 合同：boolean（组名不上 wire）")
  assert.equal(readIndex()?.graph_lock, undefined, "解散锁已清（提示不重现）")
  const g1b = (await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panel)) as OrganizeFrame
  assert.equal(g1b.lock_dissolved, undefined)
})

test("#427 §6: 跨 20——notice 持续 true 直到显式 ack_tf_switch，之后 false", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 4)
  const ids = se.getKnowledgeDocsForOrganize().map((d) => d.id)
  __testSetKnowledgeGraphOrganizeImpl(async () => JSON.stringify({ groups: [{ name: "组", ids }], relations: [] }))
  await handleMessage({ type: "knowledge.graph", organize: true, user_gesture: true }, { skillEngine: se } as never, panel)
  await settle()

  // 语料长到 21：TF lane + graph_llm 历史在 → notice
  seedOrthogonal(se, 17, "zeta")
  const grown = (await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panel)) as OrganizeFrame
  assert.equal(grown.nodes.length, 21)
  assert.equal(grown.relations, undefined, "≥20 帧无 relations")
  assert.equal(grown.tf_switch_notice, true)
  const again = (await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panel)) as OrganizeFrame
  assert.equal(again.tf_switch_notice, true, "未 ack 前每帧都带（读路径不自动落 ack）")

  const acked = (await handleMessage(
    { type: "knowledge.graph", ack_tf_switch: true, user_gesture: true },
    { skillEngine: se } as never,
    panel,
  )) as OrganizeFrame
  assert.equal(acked.tf_switch_notice, false, "显式 false 抑制 ext 本地回退")
  assert.equal(readIndex()?.graph_tf_switch_ack, true)

  // 再长也不重现
  seedOrthogonal(se, 1, "eta")
  const post = (await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panel)) as OrganizeFrame
  assert.equal(post.tf_switch_notice, false)
})

test("#427 §3.3: 重启 + 磁盘漂移——graph_llm/graph_lock/ack 区携带到重建后的新索引", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 4)
  const ids = se.getKnowledgeDocsForOrganize().map((d) => d.id).sort()
  __testSetKnowledgeGraphOrganizeImpl(async () => JSON.stringify({ groups: [{ name: "组", ids }], relations: [{ a: ids[0], b: ids[1], reason: "r", confidence: 0.5 }] }))
  await handleMessage({ type: "knowledge.graph", organize: true, user_gesture: true }, { skillEngine: se } as never, panel)
  await settle()
  await handleMessage({ type: "knowledge.graph", lock_group: kg.lGroupKey(ids), user_gesture: true }, { skillEngine: se } as never, panel)
  await handleMessage({ type: "knowledge.graph", ack_tf_switch: true, user_gesture: true }, { skillEngine: se } as never, panel)

  // 绕过引擎直写磁盘（新 .md）：磁盘索引指纹 stale，重启后 ensure 必须重建
  fs.writeFileSync(
    path.join(DATA_DIR, "knowledge", "global", "raw-extra.md"),
    mdDoc("raw-extra", ["rawtag"], "raw lone body", "直写描述"),
    { mode: 0o600 },
  )

  const se2 = new SkillEngine()
  const resp = (await handleMessage({ type: "knowledge.graph" }, { skillEngine: se2 } as never, panel)) as OrganizeFrame
  assert.equal(resp.nodes.length, 5, "重建捕获直写文档")
  assert.equal(resp.relations!.length, 1, "graph_llm 区在重启+漂移重建后存活")
  assert.equal(resp.stale, true, "指纹已漂 → stale")
  const lKey = kg.lGroupKey(ids)
  assert.equal(resp.labels[lKey].locked, true, "graph_lock 区同样携带")
  const idx = readIndex()
  assert.equal(idx!.graph_tf_switch_ack, true, "ack 区携带")
})

test("#427 single-flight：在飞的 organize 不被并发请求复制", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedGroup(se, 3)
  const ids = se.getKnowledgeDocsForOrganize().map((d) => d.id)
  let calls = 0
  let release!: () => void
  const gate = new Promise<void>((r) => (release = r))
  __testSetKnowledgeGraphOrganizeImpl(async () => {
    calls += 1
    await gate
    return JSON.stringify({ groups: [{ name: "组", ids }], relations: [] })
  })
  const sess = { surface: "panel", sendToExtension: () => {} } as never
  await handleMessage({ type: "knowledge.graph", organize: true, user_gesture: true }, { skillEngine: se } as never, sess)
  await handleMessage({ type: "knowledge.graph", organize: true, user_gesture: true }, { skillEngine: se } as never, sess)
  release()
  await settle()
  assert.equal(calls, 1)
})
