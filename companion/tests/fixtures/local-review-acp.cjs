// Synthetic offline ACP server. Never imports downloaded code or uses network.
const fs = require('node:fs')
const readline = require('node:readline')
const send = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n')
let promptId
fs.writeFileSync(process.env.FIXTURE_PID_FILE, String(process.pid))
readline.createInterface({ input: process.stdin }).on('line', line => {
  const msg = JSON.parse(line)
  if (msg.method === 'initialize') {
    if (process.env.FIXTURE_MODE === 'hang-init') return
    send({ id: msg.id, result: { protocolVersion: 1, agentCapabilities: {} } })
  } else if (msg.method === 'session/new') send({ id: msg.id, result: { sessionId: 'synthetic-offline-session' } })
  else if (msg.method === 'session/prompt') {
    promptId = msg.id
    send({ method: 'session/update', params: { update: { sessionUpdate: 'agent_thought_chunk', content: { text: 'excluded reasoning' } } } })
    send({ id: 'permission-fixture', method: 'session/request_permission', params: { title: 'execute postinstall', description: 'must be denied' } })
  } else if (msg.id === 'permission-fixture') {
    fs.writeFileSync(process.env.FIXTURE_PERMISSION_FILE, JSON.stringify(msg.result))
    if (process.env.FIXTURE_MODE === 'hang-prompt') return
    const input = JSON.parse(fs.readFileSync('review-input.json', 'utf8'))
    const report = { job_id: input.job_id, input_digest: input.input_digest, status: 'completed',
      summary: 'Synthetic offline review: dynamic evaluation permits untrusted code execution; install hook requires verification.',
      reviewed_files: input.sources.map(s => s.path), findings: [{ path: 'danger.ts', line: 1, severity: 'major', summary: 'Untrusted input can reach dynamic evaluation.' }],
      gaps: ['SYNTHETIC_AGENT_FIXTURE_NOT_A_MODEL_QUALITY_EVALUATION'] }
    if (process.env.FIXTURE_MODE === 'bad-identity') report.job_id = '11111111-1111-4111-8111-111111111111'
    const text = JSON.stringify(report), middle = Math.floor(text.length / 2)
    for (const chunk of [text.slice(0, middle), text.slice(middle)]) send({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { text: chunk } } } })
    send({ id: promptId, result: { stopReason: 'end_turn' } })
    // Intentionally stays alive; client must reclaim it.
  }
})
