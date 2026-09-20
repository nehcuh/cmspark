# 502-B 归档省略 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.
>
> GitHub: #502 · Spec §3 · Pi `out-pi.md` 归档三层
> Blast: **T2** · persist 边界 · 不改 live LLM 上下文

**Goal:** 默认磁盘只留 tool stub（名 + 成败 + len + sha256）；设置打开才写 redact 后的正文。tool **行**永不删。cookie/shell/host/osascript/MCP 密钥始终 redact，开关加不开。

**Architecture:** `createToolResultMessage` 是唯一写盘构造器。在那里读 `config.persist_full_tool_history`（默认 `false`）。false → 非敏感工具也走已有 `collapseResult` 形状。true → 现有 #255 路径（read-tier 前缀、exec 仍 collapse）。`redactAssistantToolCallsForPersistence` 在 false 时把 arguments 收成 `{_stub:true,len}`。不回溯旧线程。

**Tech Stack:** companion config + tool-batch-heal + tool-persistence-redact · Settings「文件与知识」一开关 · node:test

**NEVER:** 删 `role=tool` 行；放松 cookie/shell redact；改 history.db / logs（本票文档写明不管）；开关打开承诺恢复已省略正文；L2 确认记录走这条省略。

---

### Task 1: companion 默认 stub（TDD）

**Files:**
- Modify: `companion/src/config.ts` — `CompanionConfig` 加 `persist_full_tool_history?: boolean`，`defaultConfig` 为 `false`
- Modify: `companion/src/llm/tool-batch-heal.ts` `createToolResultMessage`
- Modify: `companion/src/security/tool-persistence-redact.ts` — 导出或新增 `stubToolResultForArchive(toolName, params, result, persistFull: boolean)`
- Create: `companion/tests/archive-stub-persist.test.ts`

默认（persistFull=false）断言：

```ts
const row = createToolResultMessage("t", { id: "1", function: { name: "get_page_text" } }, { success: true, data: "hello world".repeat(100) }, { url: "https://x" })
const parsed = JSON.parse(row.content)
assert.equal(parsed.redacted, true)
assert.equal(typeof parsed.sha256, "string")
assert.equal(typeof parsed.len, "number")
assert.equal(row.role, "tool")
assert.equal(row.tool_calls[0].tool_name, "get_page_text")
assert.ok(!JSON.stringify(row).includes("hello world"))
```

cookie 工具即使 persistFull=true 也不得出现 cookie value 明文。

shell_exec / host_computer 即使 persistFull=true 仍 collapse（沿用 EXEC_FOLD）。

persistFull=true + get_page_text：仍可有 prefix（#255），不得全文 18k。

createToolResultMessage 必须读 **当时** getConfig()，不要把 config 缓存进模块顶层。

- [ ] 测试先红
- [ ] 实现
- [ ] `nvm use 22 && npm --prefix companion test -- tests/archive-stub-persist.test.ts`
- [ ] 现有 redact 测试仍绿：`npm --prefix companion test -- tests/tool-persistence-redact.test.ts`（若文件名不同，grep 后跑原套件）
- [ ] Commit `feat(persist): default tool archive to stubs (#502 B)`

---

### Task 2: 设置开关

**Files:**
- Modify: `chrome-extension/src/sidepanel/types.ts` 加 `persist_full_tool_history?: boolean`
- Modify: `chrome-extension/src/sidepanel/utils/normalize-config.ts` 扁平化该字段，缺省 false
- Modify: `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` — 「文件与知识」页、`thread_digest` 附近：

文案：
- 标题：保存完整操作史
- 说明：默认关。只留工具名、成败、内容指纹。打开后仍脱敏 cookie / 本机命令 / 密钥。已经省略的正文不会因打开而恢复。
- 开关默认关；`config.set` `{ persist_full_tool_history: true/false }`

- Modify: `chrome-extension/tests/sidepanel-state.test.ts` 仿 thread_digest flatten 测默认 false

config.set 路径已有通用 patch。companion 端 `saveConfig` / deepMerge 必须接受该键（Task 1 的 config 类型）。

- [ ] 测试
- [ ] Commit `feat(settings): persist_full_tool_history toggle (#502 B)`

---

### Task 3: assistant.tool_calls.arguments 同步 stub

**Files:**
- Modify: `redactAssistantToolCallsForPersistence`：persistFull=false 时 arguments 为 `JSON.stringify({ redacted:true, len })`，保留 function.name 与 id（rebuild 配对靠 id）。

测试：persist 后的 assistant 行 JSON 不含原始 selector/HTML。

- [ ] Commit `fix(persist): stub assistant tool_call arguments when archive is compact (#502 B)`

---

### Task 4: 验收

- [ ] 新线程默认磁盘无 get_page_text 全文
- [ ] 仍有 role=tool 行（rebuild / heal 不造 INTERRUPTED 假事实）
- [ ] cookie 两种开关都无 value 明文
- [ ] 源码/文档注明 history.db 与 logs 本票不关
- [ ] 不回溯改写已有 threads/*.json
- [ ] 开关打开文案不承诺恢复旧正文
- [ ] 写 `B-DONE.md`

不在本 PR：history.db、logs、切片 A UI、G1。
