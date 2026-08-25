I've now reviewed the full code diff against the live working tree (patch matches `git diff HEAD` — not stale), run the full companion test suite (3529 pass / 0 fail), typechecked the extension (clean), and verified each DoD item and rejection gate. Summary of findings:

## Verified correct

**Wave 0b (confirm import)**
- `knowledge.preview` → `previewKnowledge()` (no disk write; test-locked), confirm modal requires explicit button (`user_gesture: true`), main UI path no longer sends bare `knowledge.import` — `KnowledgeSubPanel.tsx:204-224` (file) and `:244-258` (URL) both go preview-first.
- `parseFile` reused for both preview and import (`message-router.ts` `loadKnowledgePayload`) — no second parser.
- F-S-4 frontmatter allowlist drops `site: "*.com"`, `entries`, etc. — test-locked (`skill-engine.test.ts` "allowlists frontmatter and drops *.com site").
- Overlay untouched: `summoner-web.ts` `SUMMONER_WEB_DISPATCH_ALLOW` still has zero `knowledge.*` (R2 clear).

**Wave 1 (retrieved_sources / chips)**
- Ledger built only in `buildSystemPromptWithSources` from actually-injected docs; heading is exactly `## Knowledge: {title} [{id}]`; `chars` = post-sanitize length; `chat.done` carries it and text-answer turns persist it to the thread message (`adapter.ts:1054-1055, 1127`).
- Chips render only `msg.retrieved_sources` (companion-ledger); fake model-authored filenames can't become chips — test-locked ("ledger is subset of injected ids", "fake-invented.md").
- No `query_knowledge` tool anywhere.
- RAG chunk, entries, and `searchKnowledge` paths all sanitize; I verified the RAG sanitize test is **non-vacuous** (the injection phrase genuinely appears in retrieved chunks and is removed).

**Identity / write-safety (Wave 0)**
- `{id, filename, title}` split; CJK → stable `k-<sha256-10>`; `CON`/`../x`/empty hash; 0o600 writes; symlink/junction skipping in walks and zip extraction; `get()` matches id and legacy name; `loadContent` refuses knowledge docs; F-I-6 (knowledge id can't steal skill name) test-locked.

**ADR-020**: capability declaration present and correct (Compose knowledge + L0 Surface chips, no L2, no new confirm family, no originWs surface, trust monotonicity *strengthened* — knowledge no longer reachable via `use_skill`). No Project/graph/taxonomy smuggled (R5 clear), no trust elevation (R4 clear).

## Nits (non-blocking)

1. **Chip click is a dead interaction** — `ChatView.tsx:791` dispatches `cmspark:open-knowledge`, but no listener exists anywhere in the extension. Chips display the ledger but "点击打开知识面板该条" (spec Wave 1 #3) isn't wired.
2. **Stuck "正在解析…" on parse failure** — `useWebSocket.ts:1815` error regex `/knowledge|预览|parseFile|fetch knowledge/i` doesn't match `parseFile` errors like `不支持的文件类型:` / `文件 "x" 过大`, so the preview modal stays "正在解析…" with no failure message.
3. **Directory re-import loses idempotency** — `nameOverride` (vault-relative path, e.g. `docs/README`) is passed as `preferredId`, but `asciiSlug` rejects `/`, so **every** directory-imported doc gets an opaque `k-<hash>` id, and repeat imports of the same vault pile up `k-…`, `k-…-2`, `k-…-3` instead of updating in place (safe per F-I-5's anti-overwrite mandate, but a behavior regression for existing vault workflows).
4. **`skill.craft` collision wrinkle** — `message-router.ts:3635-3637`: if the crafted skill's name already exists, `importSkill` writes `name-2.md` but `activate(thread_id, skill.name)` activates the *old* skill.
5. **Misleading status** — `KnowledgeSubPanel.tsx:222-224`: after preview-only, status reads "完成：导入 1" though nothing was persisted.
6. **No extension-side chip test** — the `chips ⊆ ledger` invariant is tested companion-side only (extension has no test runner in this diff).

VERDICT: APPROVE_WITH_NITS
