// W1e fix verification: replay the two adversarial vectors + neighbors
//
// Regression evidence for PR #261 (shell allowlist W1e quote/join fail-closed).
// Replays the two independently-found bypass vectors from the 2026-08-31
// 4-lane adversarial review (c39d7d3e..26949cbb):
//   vector A (correctness lane): wildcard forces tokenize-null → quoted '-c'
//     slipped the whitespace fallback scan
//   vector B (security lane): mid-token empty quotes (-""c) defeated flag
//     comparison; /bin/sh quote-join reassembled -c at exec time
// Run: companion/node_modules/.bin/tsx scratch/w1e-replay.ts
import {
  commandMatchesAllowlistEntry,
  hasShellAllowlistMetachar,
  tokenizeSimpleArgv,
} from "../companion/src/capability/shell.ts"

const cases: Array<{ cmd: string; entry: string; expectAllow: boolean; note: string }> = [
  // Vector A (correctness lane): wildcard forces tokenize-null → quoted '-c' slips raw scan
  { cmd: "bash '-c' 'echo PWNED' '*'", entry: "bash", expectAllow: false, note: "vector A: quoted -c + glob" },
  { cmd: "pwsh '-c' 'ls' '*'", entry: "pwsh", expectAllow: false, note: "vector A: pwsh variant" },
  // Vector B (security lane): mid-token empty quotes
  { cmd: 'bash -""c "echo pwned" ~', entry: "bash", expectAllow: false, note: "vector B: -\"\"c + ~" },
  { cmd: 'python3 -""c "import os" ~', entry: "python3", expectAllow: false, note: "vector B: python3" },
  { cmd: 'sh -""c "id" ~', entry: "sh", expectAllow: false, note: "vector B: sh" },
  { cmd: 'pwsh -""c "ls" ~', entry: "pwsh", expectAllow: false, note: "vector B: pwsh" },
  { cmd: 'deno eva""l "1+1" ~', entry: "deno", expectAllow: false, note: "vector B: deno" },
  // Neighbors from commit message
  { cmd: '"-"c "echo x"', entry: "bash", expectAllow: false, note: "adjacent-quote join" },
  { cmd: "bash -\\c 'echo x'", entry: "bash", expectAllow: false, note: "backslash escape" },
  { cmd: "ENV=1 bash '-c' 'echo x' '*'", entry: "bash", expectAllow: false, note: "env prefix + quoted -c + glob" },
  // Sanity: legit uses must stay allowed
  { cmd: "bash -e ./build.sh", entry: "bash", expectAllow: true, note: "legit: bash -e script" },
  { cmd: "bash ./scripts/foo.sh", entry: "bash", expectAllow: true, note: "legit: positional script (declared residual, allow)" },
  { cmd: "python3 script.py", entry: "python3", expectAllow: true, note: "legit: python script" },
  { cmd: "grep -ic foo bar.txt", entry: "grep", expectAllow: true, note: "legit: grep -ic not interpreter-scoped" },
]

let fail = 0
for (const c of cases) {
  const allow = commandMatchesAllowlistEntry(c.cmd, c.entry)
  const ok = allow === c.expectAllow
  if (!ok) fail++
  console.log(`${ok ? "PASS" : "FAIL"}  allow=${allow} expect=${c.expectAllow}  ${c.note}  ::  ${c.cmd}`)
}
console.log(fail === 0 ? `\nALL ${cases.length} PASS` : `\n${fail} FAILURES`)
process.exit(fail === 0 ? 0 : 1)
