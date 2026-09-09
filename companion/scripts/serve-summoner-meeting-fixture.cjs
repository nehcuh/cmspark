// #492: real summoner HTTP/ACL, meeting persistence, STT protocol, and minutes parser.
// Only the recognizer service and model extraction are synthetic. All data is temporary.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const Module = require('node:module');
const [dataDir, evidenceFile] = process.argv.slice(2);
if (!dataDir || !evidenceFile) throw new Error('isolated data directory and trace path required');
fs.mkdirSync(dataDir, { recursive: true });
process.env.CMSPARK_DATA_DIR = path.resolve(dataDir);
fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({
  voice: { sttEngine: 'local', localModelId: 'medium' },
  llm: { api_key: 'synthetic-unused', base_url: 'https://unused.invalid', model_name: 'synthetic' },
}));
const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'src', '__summoner_meeting_fixture__.ts');
// Extract the exact production tray adapter without importing the menu-bar process.
const traySource = fs.readFileSync(path.join(root, 'src/menu-bar-agent.ts'), 'utf8');
const adapterStart = traySource.indexOf('function dispatchSummonerWeb(');
const adapterEnd = traySource.indexOf('\nfunction reportOverlayShellUnavailable(', adapterStart);
if (adapterStart < 0 || adapterEnd < 0) throw new Error('production tray adapter boundary changed');
const trayAdapter = traySource.slice(adapterStart, adapterEnd);
const compiled = require('esbuild').buildSync({
  stdin: { contents: `export * from './summoner-web';
    import {summonerVoiceRequestTimeout} from './summoner/voice-input';
    export {handleMeetingMessage} from './meeting/meeting-handlers';
    export {generateMeetingMinutes} from './meeting/meeting-minutes';
    export {handleVoiceSttMessage} from './voice/stt-handlers';
    ${trayAdapter}
    export {dispatchSummonerWeb};`,
    resolveDir: path.join(root, 'src'), loader: 'ts' },
  bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false,
});
const loaded = new Module(filename, module);
loaded.filename = filename;
loaded.paths = Module._nodeModulePaths(path.dirname(filename));
loaded._compile(compiled.outputFiles[0].text, filename);
const production = loaded.exports;
const traces = [];
const controls = { text: '配森将在周五发布。', hold: [], failLlm: false, failStt: false };
const pending = new Map();
let serial = 0;
function record(event) {
  traces.push({ n: ++serial, at: Date.now(), ...event });
  fs.mkdirSync(path.dirname(evidenceFile), { recursive: true });
  fs.writeFileSync(evidenceFile, JSON.stringify(traces, null, 2));
}
async function gate(type) {
  if (controls.hold.includes(type)) {
    record({ phase: 'held', type });
    await new Promise(resolve => pending.set(type, resolve));
  }
}
const service = {
  start() { return { ok: true }; },
  chunk() { return { ok: true }; },
  abort() { return { ok: true }; },
  async partial() { return { ok: true, text: '配森将在', ms: 1, modelId: 'medium' }; },
  async end() {
    if (controls.failStt) return { ok: false, code: 'infer_timeout', message: '合成识别超时' };
    return { ok: true, text: controls.text, ms: 1, modelId: 'medium' };
  },
};
const context = { origin: 'cmspark-tray://local', surface: 'summoner', peerId: 'isolated-native-fixture',
  send: frame => production.pushSummonerWebEvent(frame) };
const dependencies = {
  clearSttSessions() {},
  getLlmConfig: () => ({ api_key: 'synthetic-unused', base_url: 'https://unused.invalid', model_name: 'synthetic' }),
  generate: params => production.generateMeetingMinutes({ ...params, extract: async options => {
    record({ phase: 'llm', userContent: options.userContent, systemPrompt: options.systemPrompt });
    if (controls.failLlm) throw new Error('合成模型不可用');
    const minutes_md = '### TL;DR\n讨论 Python 发布。\n### 决议\n待核对日期。\n### 待办\n- [ ] 确认发布日期。\n### 风险 / 开放问题\n录音与笔记存在分歧。';
    if (!params.referenceNotes?.trim()) return minutes_md;
    return JSON.stringify({ minutes_md,
      corrections: params.transcriptText.includes('配森') && params.referenceNotes.includes('Python')
        ? [{ original: '配森', replacement: 'Python', reference_excerpt: 'Python', reason: '笔记中明确的项目术语' }] : [],
      conflicts: params.transcriptText.includes('周五') && params.referenceNotes.includes('周四')
        ? [{ transcript_excerpt: '周五', reference_excerpt: '周四', reason: '日期不一致，请确认' }] : [],
      reference_supplements: params.referenceNotes.includes('负责人小王')
        ? [{ reference_excerpt: '负责人小王', reason: '仅参考笔记提供，录音未确认' }] : [],
    });
  } }),
};
async function dispatch(message) {
  // Record byte counts, not PCM/base64; fixture text is generated, never user material.
  const request = { ...message };
  if (typeof request.data === 'string') request.data = `<${Buffer.from(request.data, 'base64').length} synthetic PCM bytes>`;
  if (request.file) request.file = { name: request.file.name, type: request.file.type, bytes: Buffer.from(request.file.content, 'base64').length };
  record({ phase: 'request', type: message.type, request });
  await gate(message.type);
  let result;
  if (message.type.startsWith('meeting.')) result = await production.handleMeetingMessage(message, context, dependencies);
  else if (message.type.startsWith('voice.stt.')) {
    result = await production.handleVoiceSttMessage(message, context, { service });
    // Production service traffic can arrive through both SSE and the HTTP reply.
    if (result) production.pushSummonerWebEvent(result);
  } else if (message.type === 'thread.list') result = { type: 'thread.list', threads: [] };
  else if (message.type === 'thread.select') result = { type: 'thread.selected', messages: [], run_status: 'idle' };
  else result = { type: 'ok' };
  record({ phase: 'ack', type: message.type, response: result ?? null });
  return result;
}
const controlServer = http.createServer(async (req, res) => {
  if (req.method === 'POST') {
    let body = ''; for await (const chunk of req) body += chunk;
    const changes = JSON.parse(body || '{}');
    if (changes.release) {
      controls.hold = controls.hold.filter(type => type !== changes.release);
      pending.get(changes.release)?.(); pending.delete(changes.release);
      delete changes.release;
    }
    Object.assign(controls, changes);
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ traces, controls, pending: [...pending.keys()] }));
});
(async () => {
  const client = {
    sendAppRequest: (type, params) => dispatch({ ...params, type }),
    sendAppMessage: (type, params) => {
      void dispatch({ ...params, type }).catch(error => record({ phase: 'transport-error', message: error.message }));
      return true;
    },
  };
  const server = await production.startSummonerWebServer({ preferredPort: 23791,
    dispatch: message => production.dispatchSummonerWeb(client, message),
    attachChrome: () => { throw new Error('fixture must never launch normal Chrome'); },
    hasExtensionPeer: () => false });
  await new Promise(resolve => controlServer.listen(0, '127.0.0.1', resolve));
  console.log(JSON.stringify({ port: server.port, controlPort: controlServer.address().port }));
})().catch(error => { console.error(error); process.exitCode = 1; });
process.on('SIGTERM', () => { production.stopSummonerWebServer(); controlServer.close(); process.exit(0); });
