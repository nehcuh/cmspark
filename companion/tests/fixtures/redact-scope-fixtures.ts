/**
 * #255 golden fixtures — shared corpus consumed by the lock-step parity test
 * (tests/redact-scope-lockstep.test.ts) so BOTH redactors (thread JSON +
 * history.db) must agree on fold vs release for every entry.
 *
 * expectFold=true  → full collapse stub (any gate hit, or exec/cookie tier)
 * expectFold=false → read-tier release; expectTruncated marks the >8000-char
 *                    prefix-envelope case (thread JSON only — history.db
 *                    summaries are pre-capped at 500 chars by the adapter).
 */
export interface RedactScopeFixture {
  name: string
  tool: string
  params: Record<string, unknown>
  result: { success: boolean; data?: unknown; error?: string }
  expectFold: boolean
  expectTruncated?: boolean
  /**
   * NIT-2 documented divergence: the history.db redactor gates on the
   * adapter's pre-capped ≤500-char summary (the only bytes it stores), while
   * the thread-JSON redactor gates on the full payload. A tail secret beyond
   * 500 chars therefore folds the thread row but lets history keep a benign
   * prefix — safe by construction (the stored prefix cannot contain the tail
   * secret). Set expectFoldStore to override the shared expectFold for the
   * history side only.
   */
  expectFoldStore?: boolean
}

const JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvbiBEb2UifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJVadQssw5c"
const PEM = "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIBAAKCAQEA...\n-----END RSA PRIVATE KEY-----"
const BEARER = "Authorization: Bearer abcdef1234567890abcdef"
const OPENAI_KEY = "sk-1234567890abcdefghijklmnop"

export const REDACT_SCOPE_FIXTURES: readonly RedactScopeFixture[] = [
  // --- Read tier: release (gates pass) ---
  {
    name: "evaluate benign code keeps small data",
    tool: "evaluate",
    params: { code: "document.title", security_token: "tok-1" },
    result: { success: true, data: "Hello page" },
    expectFold: false,
  },
  {
    name: "evaluate benign code truncates large data",
    tool: "evaluate",
    params: { code: "document.body.innerText" },
    result: { success: true, data: "x".repeat(20000) },
    expectFold: false,
    expectTruncated: true,
  },
  {
    name: "get_page_text benign keeps text",
    tool: "get_page_text",
    params: { tabId: 1 },
    result: { success: true, data: { text: "一篇普通的文章正文", threats_removed: 0 } },
    expectFold: false,
  },
  {
    name: "get_page_html benign truncates large html",
    tool: "get_page_html",
    params: { tabId: 1 },
    result: { success: true, data: { html: "<div>hello</div>".repeat(2000), truncated: false } },
    expectFold: false,
    expectTruncated: true,
  },
  // --- Read tier: fold (gate hits — red tests) ---
  {
    name: "evaluate document.cookie payload folds (gate 2)",
    tool: "evaluate",
    params: { code: "document.cookie", security_token: "tok-abc" },
    result: { success: true, data: "sid=abcdef; theme=light" },
    expectFold: true,
  },
  {
    name: "evaluate localStorage read folds (gate 2)",
    tool: "evaluate",
    params: { code: "localStorage.getItem('token')" },
    result: { success: true, data: "not-a-secret-shape" },
    expectFold: true,
  },
  {
    name: "evaluate password-input .value read folds (gate 2)",
    tool: "evaluate",
    params: { code: "document.querySelector('input[type=password]').value" },
    result: { success: true, data: "hunter2" },
    expectFold: true,
  },
  {
    name: "evaluate csrf meta read folds (gate 2)",
    tool: "evaluate",
    params: { code: "document.querySelector('meta[name=csrf-token]').content" },
    result: { success: true, data: "opaque-csrf-value" },
    expectFold: true,
  },
  {
    name: "evaluate JWT-shaped result folds (gate 1)",
    tool: "evaluate",
    params: { code: "window.__STATE__" },
    result: { success: true, data: { token_state: JWT } },
    expectFold: true,
  },
  {
    name: "evaluate Bearer-shaped result folds (gate 1)",
    tool: "evaluate",
    params: { code: "document.title" },
    result: { success: true, data: BEARER },
    expectFold: true,
  },
  {
    name: "evaluate PEM-shaped result folds (gate 1)",
    tool: "evaluate",
    params: { code: "document.body.innerText" },
    result: { success: true, data: PEM },
    expectFold: true,
  },
  {
    name: "evaluate api-key-prefixed result folds (gate 1)",
    tool: "evaluate",
    params: { code: "document.body.innerText" },
    result: { success: true, data: `found key ${OPENAI_KEY} on page` },
    expectFold: true,
  },
  {
    name: "get_page_text JWT in page text folds (gate 3 = gate 1 on read tools)",
    tool: "get_page_text",
    params: { tabId: 2 },
    result: { success: true, data: { text: `debug dump: ${JWT}`, threats_removed: 0 } },
    expectFold: true,
  },
  {
    name: "get_page_html PEM in page source folds (gate 3)",
    tool: "get_page_html",
    params: { tabId: 2 },
    result: { success: true, data: { html: `<pre>${PEM}</pre>` } },
    expectFold: true,
  },
  // --- Post-review MAJOR/NIT red payloads ---
  {
    name: "evaluate bracket-notation document[\"cookie\"] folds (MAJOR-1)",
    tool: "evaluate",
    params: { code: 'document["cookie"]' },
    result: { success: true, data: "sid=SECRETCOOKIEVALUE" },
    expectFold: true,
  },
  {
    name: "evaluate bracket-notation document['cookie'] folds (MAJOR-1)",
    tool: "evaluate",
    params: { code: "document['cookie']" },
    result: { success: true, data: "sid=SECRETCOOKIEVALUE" },
    expectFold: true,
  },
  {
    name: "evaluate window[\"localStorage\"] bracket read folds (MAJOR-1)",
    tool: "evaluate",
    params: { code: 'window["localStorage"].getItem("token")' },
    result: { success: true, data: "opaque" },
    expectFold: true,
  },
  {
    name: "evaluate cookie-jar result string folds (MAJOR-1 result side)",
    tool: "evaluate",
    params: { code: "document.title" },
    result: { success: true, data: "sid=abcdef123; theme=light; cart=9" },
    expectFold: true,
  },
  {
    name: "evaluate single well-known cookie name= folds (MAJOR-1 result side)",
    tool: "evaluate",
    params: { code: "document.title" },
    result: { success: true, data: "session=zzzz-not-jwt-shaped" },
    expectFold: true,
  },
  {
    name: "evaluate result with password key folds (MAJOR-2 key-name scan)",
    tool: "evaluate",
    params: { code: "window.__STATE__" },
    result: { success: true, data: { password: "hunter2" } },
    expectFold: true,
  },
  {
    name: "evaluate result with Authorization key folds (MAJOR-2)",
    tool: "evaluate",
    params: { code: "window.__STATE__" },
    result: { success: true, data: { Authorization: "secret-value-no-bearer-prefix" } },
    expectFold: true,
  },
  {
    name: "evaluate result with api_key key folds (MAJOR-2)",
    tool: "evaluate",
    params: { code: "window.__STATE__" },
    result: { success: true, data: { api_key: "not-sk-shaped-value" } },
    expectFold: true,
  },
  {
    name: "get_page_text result with token key folds (MAJOR-2)",
    tool: "get_page_text",
    params: { tabId: 3 },
    result: { success: true, data: { text: "hi", token: "session-abc-not-jwt" } },
    expectFold: true,
  },
  {
    name: "Bearer without whitespace separator folds (NIT-3)",
    tool: "evaluate",
    params: { code: "document.title" },
    result: { success: true, data: "Authorization:Bearersupersecrettoken12" },
    expectFold: true,
  },
  {
    name: "lowercase PEM header folds (NIT-3)",
    tool: "evaluate",
    params: { code: "document.title" },
    result: { success: true, data: "-----begin rsa private key-----\nMIIE..." },
    expectFold: true,
  },
  {
    name: "surrogate-boundary truncation reports honest kept (NIT-1)",
    tool: "evaluate",
    params: { code: "document.body.innerText" },
    // '"' + 7998 x's puts the emoji HIGH SURROGATE exactly at index 7999 of the
    // serialized JSON → safeSlice drops it → prefix.length 7999, kept must
    // equal 7999, not 8000.
    result: { success: true, data: "x".repeat(7998) + "😀" + "y".repeat(100) },
    expectFold: false,
    expectTruncated: true,
  },
  {
    name: "tail-JWT beyond 500 chars: thread folds, history keeps benign prefix (NIT-2)",
    tool: "evaluate",
    params: { code: "document.body.innerText" },
    result: { success: true, data: "a".repeat(600) + " " + JWT },
    expectFold: true,
    expectFoldStore: false,
  },
  // --- Exec tier: always fold (unchanged) ---
  {
    name: "shell_exec stays folded even with benign output",
    tool: "shell_exec",
    params: { command: "ls -la" },
    result: { success: true, data: { stdout: "file1.txt" } },
    expectFold: true,
  },
  {
    name: "host_read stays folded",
    tool: "host_read",
    params: { path: "/tmp/notes.txt", security_token: "tok-host-xyz" },
    result: { success: true, data: "plain notes" },
    expectFold: true,
  },
  {
    name: "workspace_read_file stays folded",
    tool: "workspace_read_file",
    params: { path: "src/index.ts" },
    result: { success: true, data: "const a = 1" },
    expectFold: true,
  },
]

export { JWT, PEM, BEARER, OPENAI_KEY }
