// Controlled actual-App fixture. No live configuration, capture, provider or notification.
// First: companion npm run build; node scripts/render-workspace-fixture.cjs <output>.
// Then: node scripts/personal-workspace-ui-fixture.cjs <output>; stdout prints loopback URL.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-personal-ui-data-'))
process.env.CMSPARK_DATA_DIR = data
delete process.env.DEEPSEEK_API_KEY
const root = path.resolve(__dirname, '../..'), output = path.resolve(process.argv[2])
const { ActivityService } = require(path.join(root, 'companion/dist/activity'))
const { parseExtractedCandidates } = require(path.join(root, 'companion/dist/activity/adapters'))
const { SettingsAssistant } = require(path.join(root, 'companion/dist/settings-assistant'))
const recorded = JSON.parse(fs.readFileSync(path.join(root, 'companion/tests/fixtures/activity-752.json'), 'utf8'))
const source = recorded.source.source, image = Buffer.from(source.image_data_url.split(',')[1], 'base64')
const activity = new ActivityService({ dataDir: data, platform: process.env.CMSPARK_FIXTURE_ACTIVITY_PLATFORM || 'darwin', recorder: { ocrImage: async () => 'PROJECT ALPHA\nSEND REPORT FRIDAY（受控本地 OCR）', capture: async () => null, listApps: async () => recorded.apps.apps }, notify: async () => {}, extract: async () => [] })
const first = activity.store.addSource({ app_id: source.app_id, app_name: source.app_name, window_title: source.window_title, captured_at: new Date().toISOString(), ocr_text: source.ocr_text }, image)
const raw = { candidates: [{ title: '提交季度方案（测试）', owner: '', feedback_to: '项目群', feedback_required: true, quote: source.ocr_text, group: '项目群', sender: '', message_time: '' }] }
activity.store.addCandidates(first, parseExtractedCandidates(JSON.stringify(raw), first))
const candidate = activity.state().candidates[0]
activity.store.confirm(candidate.id, candidate.revision, { title: '提交季度方案（测试）', owner: '我', due_at: new Date(Date.now() + 3600000).toISOString(), remind_at: new Date(Date.now() + 1800000).toISOString(), feedback_required: true, feedback_to: '项目群' }, new Date().toISOString())
const second = activity.store.addSource({ app_id: 'com.alibaba.DingTalkMac', app_name: '钉钉', window_title: '交付项目群（测试）', captured_at: new Date().toISOString(), ocr_text: '陈明：请明天给出验收清单，完成后在交付群反馈。' }, image)
activity.store.addCandidates(second, parseExtractedCandidates(JSON.stringify({ candidates: [{ title: '整理验收清单（测试）', quote: second.ocr_text, group: '交付群', sender: '陈明', feedback_to: '交付群', feedback_required: true }] }), second))
let config = { history_retention_days: 30, log_retention_days: 14, coding_handoff: { auto_suggest: true } }
const assistant = new SettingsAssistant({ read: () => structuredClone(config), save: async patch => { config = { ...config, ...patch } }, extract: async (_system, content) => {
  const description = JSON.parse(content).description
  if (/语音|错字/.test(description)) return JSON.stringify({ intent: '改善语音识别准确度（受控模型响应）', candidates: [{ title: '检查听写后纠错', reason: '先核对当前听写偏好', tradeoffs: '纠错可能发送转写文本到模型', changes: [{ settingId: 'voice.asrCorrection', after: true, reason: '在原设置中核对并启用' }] }] })
  return JSON.stringify({ intent: '减少主动建议（受控模型响应）', candidates: [{ title: '按需使用编程助手', reason: '减少主动建议', tradeoffs: '需要自行打开助手', changes: [{ settingId: 'coding.autoSuggest', after: false, reason: '仅关闭建议，保留能力入口' }] }, { title: '减少日志保留', reason: '缩短本机保留周期', tradeoffs: '旧日志到期清理不可撤销', changes: [{ settingId: 'logs.retentionDays', after: 7, reason: '只保留近期排障记录' }] }] })
} })
const bootstrap = `<script>window.fixtureResponse=(m,cb)=>{if(!/^(activity\\.|todo\\.|settings\\.assistant\\.)/.test(m.type))return;fetch('/fixture',{method:'POST',body:JSON.stringify(m)}).then(r=>r.json()).then(reply=>window.emitRuntime(reply));const ack={ok:true};cb?.(ack);return Promise.resolve(ack)};</script>`
const server = http.createServer(async (request, response) => {
  if (request.method === 'POST' && request.url === '/fixture') {
    try {
      let bytes = ''; for await (const chunk of request) { bytes += chunk; if (bytes.length > 8_389_000) throw Error('fixture request too large') }
      const { require_connected: _hint, ...frame } = JSON.parse(bytes)
      const result = frame.type.startsWith('settings.assistant.') ? await assistant.handle(frame, 'fixture') : await activity.handle(frame)
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result))
    } catch { response.statusCode = 500; response.end('{}') }
    return
  }
  const url = new URL(request.url, 'http://localhost'), asset = path.basename(url.pathname)
  if (asset === 'app.js' || asset === 'app.css') { response.setHeader('Content-Type', asset.endsWith('.js') ? 'text/javascript' : 'text/css'); response.end(fs.readFileSync(path.join(output, asset))); return }
  response.setHeader('Content-Type', 'text/html'); response.end(fs.readFileSync(path.join(output, 'index.html'), 'utf8').replace('<script src="app.js">', bootstrap + '<script src="app.js">'))
})
server.listen(0, '127.0.0.1', () => console.log(`http://127.0.0.1:${server.address().port}/tabs/workspace.html`))
async function close() { await activity.stop(); server.close(); fs.rmSync(data, { recursive: true, force: true }) }
process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close())
