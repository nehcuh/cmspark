Implement L4 assistant tool-call argument redaction before thread JSON persist.

Repo: C:\Users\HuChen\Projects\cmspark
ONLY files:
- companion/src/security/tool-persistence-redact.ts
- companion/src/llm/adapter.ts
- companion/tests/redact-scope-lockstep.test.ts (extend) OR new companion/tests/assistant-tool-args-redact.test.ts

Problem: persistAssistantDraft in adapter.ts (~1148–1188) writes raw tool_calls including function.arguments into threads/*.json. Tool-role rows already go through redactToolPayloadForPersistence. Assistant args do not.

Required:
1. Export `redactAssistantToolCallsForPersistence(toolCalls)` from tool-persistence-redact.ts.
   - For each call: parse arguments JSON; run existing `redactToolPayloadForPersistence(name, params, null).params`; JSON.stringify back.
   - Invalid JSON → do not keep raw string; store a stub like `{"_redacted":"invalid_json","len":N}`.
   - Preserve id/type/name.
2. persistAssistantDraft MUST run that helper before addMessage. In-flight LLM rows can stay unredacted in memory; only the object passed to addMessage is redacted.
3. Tests: cookie set_cookie value must not appear in persisted args; shell/host_computer task/code folded; a benign tool (e.g. list_tabs) still keeps non-secret args. Follow existing test isolation (CMSPARK_DATA_DIR / no real home).

Do not change redaction rules' semantics for tool-role rows. Do not expand overlay ACL. Do not bump versions.

When done: VERDICT: DONE
