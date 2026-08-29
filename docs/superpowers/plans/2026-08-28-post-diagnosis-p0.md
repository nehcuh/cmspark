# #245 Capture P0 Implementation Plan (A1–A3 + B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> **GitHub:** [#245](https://github.com/nehcuh/cmspark/issues/245)  
> **Spec:** [2026-08-28-post-diagnosis-opt-path.md](../specs/2026-08-28-post-diagnosis-opt-path.md)  
> **Dual:** Claude AWN + Kimi AWN (`docs/audit/reviews/opt-path-20260828-verdict.json`)

**Goal:** Capture 卡 markdown 打不穿；关卡停 overlay 回路且侧栏不卡；overlay 对话无 CDP 执行器且 MCP 变更路径死；截断知识不能保存丢尾；Darwin estop 不信匿名 `/tmp`。

**Architecture:** One PR, three commits for Batch A (A1 XSS → A2 hide/abort → A3 L0). Batch B separate or same PR after A. Do not change `SUMMONER_ALLOW`. Do not `abortThreadChat(lease.thread_id)`.

**Tech Stack:** Companion Node/TS, `node:test`, existing overlay HTML string.

```text
Surface:      Capture overlay L0 honesty
Blast:        T3
Refs:         #245
```

**How tests run:** `cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/<file>.js`

---

### Task 1: A1 XSS — attribute-safe markdown links + CSP nonce

**Files:**
- Modify: `companion/tests/overlay-md.test.ts`
- Modify: `companion/src/summoner/overlay-md.ts`
- Modify: `companion/src/summoner-web.ts` (CSP header + `<script nonce>` + page `esc` if needed)
- Modify: `companion/tests/summoner-web.test.ts` (CSP assertion; `<script>` regex must still extract body)

**DoD (spec A1-1/2/3):**
- `[x](https://evil/"onclick="alert(1))` 渲染后 **没有** 属性断出（无裸 `onclick=`、href 不含未转义 `"`）
- `javascript:` 仍拒绝；正常 `https://example.com` 仍是 `<a href="https://example.com"`
- GET overlay HTML：`Content-Security-Policy` 的 `script-src` **不是** 裸 `'unsafe-inline'`。用 per-response nonce：`script-src 'nonce-…'`，`<script nonce="…">` 与 header 一致。`style-src 'unsafe-inline'` 可留。
- 禁止 encodeURI 当唯一修法；禁止继续 `href=""+u` 拼未转义 URL。
- 禁止改 `SUMMONER_ALLOW`、禁止动 A2/A3 行为。

- [ ] **Step 1: Write the failing tests**

In `overlay-md.test.ts` add (keep existing tests):

```ts
test("overlay markdown does not break out of href with quote in URL", () => {
  const renderMd = loadRender()
  const html = renderMd('[x](https://evil/"onclick="alert(1))')
  assert.doesNotMatch(html, /onclick=/i)
  assert.doesNotMatch(html, /href="https:\/\/evil\/"/)
  // either no <a>, or href value has no raw quote
  const href = html.match(/href="([^"]*)"/)
  if (href) assert.doesNotMatch(href[1], /"/)
})
```

In `summoner-web.test.ts` near the GET `/` HTML test, after `request(...)` that fetches the page, assert:

```ts
const csp = String(r.headers["content-security-policy"] || "")
assert.match(csp, /script-src 'nonce-[A-Za-z0-9+/=]+'/)
assert.doesNotMatch(csp, /script-src 'unsafe-inline'/)
const nonce = (csp.match(/script-src 'nonce-([^']+)'/) || [])[1]
assert.ok(nonce)
assert.match(r.body, new RegExp(`<script nonce="${nonce.replace(/[+/]/g, "\\$&")}">`))
```

If the existing extractor is `/<script>([\s\S]*)<\/script>/`, change it to `/<script[^>]*>([\s\S]*)<\/script>/` so nonce still parses. Do **not** implement overlay-md/CSP yet.

- [ ] **Step 2: Run tests and watch RED**

```bash
cd companion && npx tsc -p tsconfig.test.json && node --test .test-dist/tests/overlay-md.test.js --test-name-pattern "quote"
```

Expected: FAIL — `onclick=` still in HTML from raw `href=""+u`.

Also run summoner-web GET test (or a new focused test) and confirm CSP assertion fails because header still has `script-src 'unsafe-inline'`.

- [ ] **Step 3: Minimal implementation**

`overlay-md.ts` link replacer: keep `https?:` gate; attribute-escape `u` (`&`, `"`, `'`) before putting in `href="…"`; never concatenate raw `u`. Text `tx` stays HTML-escaped via existing `esc`.

`summoner-web.ts` GET `/`: `crypto.randomBytes(16).toString("base64")` nonce; CSP `script-src 'nonce-${nonce}'` (keep `style-src 'unsafe-inline'`); inject `nonce` onto the page `<script>` tag. `SUMMONER_HTML` is a const — replace a placeholder or `.replace("<script>", \`<script nonce="${nonce}">\`)` only for the main page script.

Page-level `esc()` in the HTML may stay `&<>` only; href escaping lives in `renderMd`.

- [ ] **Step 4: GREEN**

Same test commands. Existing overlay-md tests and summoner-web HTML `new Function(script)` still pass.

- [ ] **Step 5: Commit**

```bash
git add companion/src/summoner/overlay-md.ts companion/src/summoner-web.ts companion/tests/overlay-md.test.ts companion/tests/summoner-web.test.ts
git commit -m "fix(overlay): Capture markdown href 不可引号突破 + CSP nonce

Refs #245"
```

---

### Task 2: A2 hide → closed (lease + overlay abort)

See spec pins 3–4 and DoD A2-1…A2-5. Implement after Task 1 is reviewed. Files: `summoner-web.ts`, `menu-bar-agent.ts`, overlay abort IPC via `companionClient`. **Forbidden:** `abortThreadChat(lease.thread_id)`.

### Task 3: A3 true L0

See spec pins 5–10. Stamp `ChatCreateParams.surface`; adapter offer+exec deny full executor set; kill HTTP/tray/Swift MCP mutate paths; **do not change `SUMMONER_ALLOW`**.

### Task 4: B1 truncated knowledge Save

See spec pin 11. `truncated===true` 禁 body；短未截断替换仍允许。

### Task 5: B2 Darwin estop DATA_DIR

See spec pin 12. Node+Swift lockstep `--socket-path`; flag path also leave `/tmp`; CONNECT≠armed.
