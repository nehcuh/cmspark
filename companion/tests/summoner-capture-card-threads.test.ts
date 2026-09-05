/**
 * GitHub: #243 — 浮窗 Capture 卡：新对话 + 历史会话（狗食）
 * 票面四条用户可见项逐条验收钉 + rail 仍 hidden。
 * 实现复用 #246 落地的顶栏/盖层；本文件把验收从「存在」钉到「接线链」。
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { CHAT_SHELL_TITLE_NONE } from "../src/summoner/client"
import { SUMMONER_WEB_DISPATCH_ALLOW } from "../src/summoner-web"

const ROOT = path.resolve(__dirname, "..", "..")
function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

const web = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")

test("#243 ① 顶栏是文案按钮「历史」「新对话」，不是神秘 +", () => {
  assert.match(web, /<button type="button" id="historyOpen">历史<\/button>/)
  assert.match(web, /<button type="button" id="newChat">新对话<\/button>/)
  // 唯一的「+」图标按钮（作曲区 #newThreadBar）保持隐藏，顶栏不靠神秘 + 开新对话
  assert.match(web, /#newThreadBar\{display:none\}/)
})

test("#243 ② 「新对话」清空到看山空态（newChat → newThread → create → selectThread → renderMsgs 空）", () => {
  assert.match(web, /\$\("newChat"\)\.onclick=function\(\)\{ \$\("newThread"\)\.click\(\); \};/)
  assert.match(
    web,
    /\$\("newThread"\)\.onclick=function\(\)\{[\s\S]{0,400}?api\("\/api\/threads",\{method:"POST"/,
  )
  assert.match(
    web,
    /method:"POST"[\s\S]{0,300}?showHistory\(false\);[\s\S]{0,200}?selectThread\(id\)/,
  )
  assert.match(
    web,
    /function selectThread\(id\)\{[\s\S]{0,1000}?renderMsgs\(d\.messages\|\|\[\]\)/,
  )
  // 空线程渲染看山空态：山印 + 无任务标题 + 发送提示（不是工作台首页）
  assert.match(
    web,
    /if\(!n\)\{[\s\S]{0,400}?empty\.id="empty";[\s\S]{0,300}?>山<\/div><strong>\$\{CHAT_SHELL_TITLE_NONE\}<\/strong>回车发送。/,
  )
  assert.equal(CHAT_SHELL_TITLE_NONE, "要我帮你做什么？")
})

test("#243 ③ 「历史」盖住卡片列出会话：点选进入、重命名、移到回收站", () => {
  // 盖层几何：铺满整卡（inset:0 于 position:relative 的 .hud），压过作曲区
  assert.match(
    web,
    /\.hud\.history \.list\{[^}]*display:flex!important;position:absolute;inset:0;z-index:5/,
  )
  assert.match(web, /\.composer\{[^}]*z-index:2\}/)
  // 打开即刷新列表；完成按钮收起
  assert.match(
    web,
    /function showHistory\(on\)\{[\s\S]{0,200}?classList\.add\("history"\); refresh\(\);/,
  )
  assert.match(web, /\$\("historyClose"\)\.onclick=function\(\)\{ showHistory\(false\); \};/)
  assert.match(web, /function renderThreads\(filter\)\{[\s\S]{0,300}?threads\.forEach/)

  // 点选进入（selectThread 内含 showHistory(false)，选完收起盖层）
  assert.match(web, /b\.onclick=function\(\)\{selectThread\(t\.id\)\};/)
  assert.match(web, /function selectThread\(id\)\{[\s\S]{0,200}?showHistory\(false\);/)

  // 重命名：prompt → PATCH alias（trim 后上送）→ refresh
  assert.match(web, /window\.prompt\("重命名", title\)/)
  assert.match(
    web,
    /method:"PATCH"[\s\S]{0,200}?body:JSON\.stringify\(\{alias:String\(alias\)\.trim\(\)\}\)/,
  )

  // 移到回收站：confirm → DELETE；删的是当前线程时落到最新一条或新对话
  assert.match(web, /window\.confirm\("把「"\+title\+"」移到回收站？"\)/)
  assert.match(web, /api\("\/api\/thread\?id="\+encodeURIComponent\(t\.id\),\{method:"DELETE"\}\)/)
  assert.match(
    web,
    /threads\[0\]\.id[\s\S]{0,200}?\$\("newThread"\)\.click\(\);/,
  )
})

test("#243 ③' 服务端合同复用：PATCH=thread.update(alias)、DELETE=thread.delete(trash)、list/create 原样", () => {
  assert.match(
    web,
    /dispatchAllowed\("thread\.update", \{ thread_id: id, updates: \{ alias \} \}\)/,
  )
  assert.match(
    web,
    /dispatchAllowed\("thread\.delete", \{ thread_id: id, mode: "trash" \}\)/,
  )
  assert.match(web, /dispatchAllowed\("thread\.list", \{\}\)/)
  assert.match(web, /dispatchAllowed\("thread\.create", \{\}\)/)
  assert.doesNotMatch(web, /mode:\s*"hard"/)
  // 复用既有 dispatch 允许集，不新造通道
  for (const t of ["thread.create", "thread.list", "thread.select", "thread.update", "thread.delete"]) {
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has(t), true, t)
  }
})

test("#243 ④ 第一屏仍是单栏 Capture 卡；rail 仍 hidden（五轨冻结，未重新占格）", () => {
  assert.match(web, /\.rail,\.list\{display:none\}/)
  assert.doesNotMatch(web, /grid-template-columns:\s*var\(--rail\)/)
  // rail 除「对话」外全部 hidden；对话轨本身也不再占格（.rail 整体 display:none）
  for (const sec of ["packs", "knowledge", "skills", "mcp"]) {
    assert.match(web, new RegExp(`data-sec="${sec}"[^>]*hidden`), sec)
  }
  assert.doesNotMatch(web, /data-sec="threads"[^>]*hidden/)
  // 历史是 .list 盖层复活，不是 rail/list 回归占格：盖层规则只在 .hud.history 下生效
  assert.match(web, /\.hud\.history \.list\{\s*display:flex!important/)
})
