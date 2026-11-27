import './helpers/require-isolated-config-825'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { getConfig, saveConfig } from '../src/config'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFileSync } from 'node:child_process'
import { ActivityService } from '../src/activity/service'
import { activityVisionConfig } from '../src/activity/model-config'
import { DEFAULT_ACTIVITY_CONFIG } from '../src/activity/types'
import { WindowsPassiveRecorder, LinuxPassiveRecorder, platformSupport, resolveLinuxRecorder } from '../src/activity/platform'
import { validatePng } from '../src/activity/image'
import { validateActivityMessage } from '../src/activity/validation'
import { validateWsMessage } from '../src/ws/validate'
import { handlePersonalWorkspaceMessage } from '../src/message-router/handlers/personal-workspace'
import { parseExtractedCandidates } from '../src/activity/adapters'
import { submitWindowsReminder, resolveWindowsToast } from '../src/activity/notifications'
import type { PsRunner } from '../src/host-use/win/powershell'

// Real Xvfb -> XRes-backed recorder PNG, containing only the owned test window.
const png = fs.readFileSync(path.resolve('tests/fixtures/activity-linux-758.png'))
const fresh = () => fs.mkdtempSync(path.join(os.tmpdir(), 'activity758-'))
const id = 'win.' + 'a'.repeat(64)
const config = { ...DEFAULT_ACTIVITY_CONFIG, allowed_apps: [id], ocr_language: 'en-US' as const }
// Explicit inert native doubles. Actual PS fields are also exercised by the hosted native family.
const win = () => ({ hwnd: 42, pid: 100, started: '12345678', app_id: id, app_name: 'Owned Chat', exe: 'c:\\owned\\chat.exe', title: 'Owned test chat', geometry: '0,0,800,300', safe: true })

test('capability matrix refuses Wayland/XWayland and headless automatic capture, while Windows and genuine X11 are selectable', () => {
  assert.equal(platformSupport('win32', {}).supported, true)
  assert.equal(platformSupport('darwin', {}).supported, true)
  assert.equal(platformSupport('linux', { DISPLAY: ':1', XDG_SESSION_TYPE: 'x11' }).supported, true)
  for (const env of [{}, { DISPLAY: 'x11-unknown' }, { DISPLAY: 'localhost:10.0', XDG_SESSION_TYPE: 'x11' }, { DISPLAY: 'remote.example:0', XDG_SESSION_TYPE: 'x11' }, { DISPLAY: ':1', WAYLAND_DISPLAY: 'wayland-0' }, { DISPLAY: ':1', XDG_SESSION_TYPE: 'wayland' }]) {
    assert.equal(platformSupport('linux', env).supported, false)
    assert.equal(platformSupport('linux', env).capture_mode, 'manual-only')
  }
  assert.ok(fs.existsSync(resolveLinuxRecorder()))
})
test('actual service constructor chooses the Windows/Linux recorder without executing a native tool or enabling capture', async () => {
  const dir=fresh()
  try{
    for(const platform of ['win32','linux']){
      const service=new ActivityService({dataDir:path.join(dir,platform),platform})
      assert.ok((service as any).recorder instanceof (platform==='win32'?WindowsPassiveRecorder:LinuxPassiveRecorder))
      assert.equal(service.state().config.enabled,false);assert.equal(service.state().config.ocr_ai_enabled,false)
      await service.stop()
    }
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('import protocol is closed, below the existing 10MB WS budget, and does not accept paths, consent or fabricated app identity', () => {
  const request = { type: 'activity.import', id: 'owned758', image_base64: png.toString('base64') }
  assert.equal(validateWsMessage(request).valid, true)
  for (const extra of [{ file: '/etc/passwd' }, { app_id: 'com.claimed.chat' }, { userConfirmed: true }, { enabled: true }]) assert.equal(validateActivityMessage({ ...request, ...extra }), false)
  for (const image_base64 of ['', 'abcd=', 'data:image/png;base64,abc', 'a'.repeat(8_388_612)]) assert.equal(validateActivityMessage({ ...request, image_base64 }), false)
  assert.equal(validateActivityMessage({ type: 'activity.configure', expected_revision: 0, patch: { ocr_language: 'en-US' } }), true)
  assert.equal(validateActivityMessage({ type: 'activity.configure', expected_revision: 0, patch: { ocr_language: '../../eng' } }), false)
  for(const app of ['win.fake','linux.fake'])assert.equal(validateActivityMessage({type:'activity.configure',expected_revision:0,patch:{allowed_apps:[app]}}),false)
  for (const image of [Buffer.from('not a PNG'), Buffer.alloc(8*1024*1024+1), (() => { const b=Buffer.from(png); b.writeUInt32BE(99999, 16); return b })()]) assert.throws(() => validatePng(image))
  validatePng(png)
})
test('untrusted peers cannot import a screenshot before authenticated panel authority', async () => {
  for (const session of [undefined, { surface: 'summoner', origin: 'cmspark-tray://local', panelId: 'x', isCurrentSession: () => true }, { surface: 'panel', origin: 'https://example.invalid', panelId: 'x', isCurrentSession: () => true }]) {
    const result = await handlePersonalWorkspaceMessage({ type: 'activity.import', image_base64: png.toString('base64') }, session)
    assert.equal(result.error_code, 'WORKSPACE_METHOD_DENIED'); assert.equal('state' in result, false)
  }
})
test('manual source calls only local OCR even when model consent exists; identity and times remain unverified', async () => {
  const dir=fresh(); let ocr=0, models=0, captures=0
  const service=new ActivityService({ dataDir: dir, platform: 'freebsd', recorder: { capture: async () => { captures++; return null }, ocrImage: async (image, language) => { assert.deepEqual(image,png); assert.equal(language,'en-US'); ocr++; return 'PROJECT ALPHA\nSEND REPORT FRIDAY' } }, extract: async () => { models++; return [] } })
  try {
    await service.handle({ type:'activity.configure', expected_revision:0, patch:{ocr_ai_enabled:true,ocr_language:'en-US'} })
    const result=await service.handle({type:'activity.import',image_base64:png.toString('base64')})
    assert.equal(result.ok,true); assert.equal(ocr,1); assert.equal(models,0); assert.equal(captures,0)
    const state=service.state(); assert.equal(state.config.enabled,false); assert.equal(state.sources[0].origin,'manual_import'); assert.equal(state.sources[0].app_id,'manual.screenshot'); assert.equal(state.candidates.length,0); assert.equal(state.todos.length,0)
    const source=service.store.sourceMetadata(state.sources[0].id)
    const guesses=parseExtractedCandidates(JSON.stringify({candidates:[{title:'Send report',quote:'SEND REPORT FRIDAY',due_at:'2026-10-23T10:00:00Z'}]}),source)
    assert.equal(guesses.length,1);assert.equal(guesses[0].due_at,null,'import time is not message time')
    const task=service.store.create(state.sources[0].id,state.revision,{title:'Owned task',owner:'Me'},new Date().toISOString())
    assert.equal(task.evidence.sender,''); assert.equal(task.evidence.group,''); assert.equal(task.evidence.message_time,'')
    assert.equal((await service.handle({type:'activity.import',image_base64:png.toString('base64')})).ok,true)
    assert.equal(service.state().sources.length,1)
  } finally { await service.stop(); fs.rmSync(dir,{recursive:true,force:true}) }
})
test('revocation or source cleanup while local OCR waits cannot resurrect an imported source', async () => {
  for (const revoke of ['session','delete'] as const) {
    const dir=fresh(); let finish!: (s:string)=>void, current=true
    const service=new ActivityService({dataDir:dir, recorder:{capture:async()=>null,ocrImage:()=>new Promise(r=>{finish=r})}})
    try {
      const request=service.handle({type:'activity.import',image_base64:png.toString('base64')},()=>current)
      if(revoke==='session')current=false;else await service.handle({type:'activity.delete'})
      finish('Owned text'); const result=await request
      assert.equal(result.ok,false); assert.equal(service.state().sources.length,0)
      assert.deepEqual(fs.readdirSync(service.store.root).filter(file=>file.endsWith('.png')),[])
    } finally {await service.stop();fs.rmSync(dir,{recursive:true,force:true})}
  }
})

function windowsDouble(dir:string, changes: { after?: any; desktop?: string; targetIl?: number; abort?: AbortController } = {}) {
  const calls:Array<{script:string;args:string[]}>=[];let probes=0
  const run:PsRunner=async(script,args)=>{
    calls.push({script,args})
    if(script==='activity-windows.ps1')return JSON.stringify(args.includes('Apps')?{ok:true,apps:[{app_id:id,app_name:'Owned Chat',window_state:'visible'},{app_id:'win.'+'b'.repeat(64),app_name:'1password',window_state:'none'}]}:{ok:true,window:probes++===0?win():changes.after===undefined?win():changes.after})
    if(script==='computer-probe.ps1')return JSON.stringify({desktop:changes.desktop||'Default',pid:100,ownIl:8192,targetIl:changes.targetIl??8192})
    if(script==='computer-capture.ps1'){fs.writeFileSync(args[args.indexOf('-OutPath')+1],png);changes.abort?.abort();return JSON.stringify({ok:true,restoredFromIconic:false,observation_quality:'ok',occludedBy:[]})}
    if(script==='computer-ocr.ps1')return JSON.stringify(args.includes('-ActivityText') ? {ok:true,lines:['OWNED TEXT']} : {ok:true,words:[{text:'OWNED TEXT'}]})
    throw Error('UNEXPECTED_SCRIPT')
  }
  return {adapter:new WindowsPassiveRecorder(dir,run,name=>name),calls}
}

test('Windows captured PNG reaches the consented main, shared independent, and dedicated HTTP model', { timeout: 15000 }, async () => {
  const dir = fresh(), original = getConfig()
  const native = windowsDouble(dir)
  const service = new ActivityService({ dataDir: dir, platform: 'win32', recorder: native.adapter })
  const requests: Array<{ path: string; model: string; credential?: string; image: string }> = []
  const server = createServer(async (request, response) => {
    let payload = ''
    for await (const chunk of request) payload += chunk
    const body = JSON.parse(payload), part = body.messages[0].content[0]
    requests.push({ path: request.url!, model: body.model, credential: request.headers.authorization ?? request.headers['x-api-key'] as string,
      image: part.image_url?.url ?? part.source?.data })
    const content = JSON.stringify({ transcript: '请核对报告', candidates: [] })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(part.type === 'image' ? { content: [{ type: 'text', text: content }], stop_reason: 'end_turn' }
      : { choices: [{ finish_reason: 'stop', message: { content } }] }))
  })
  try {
    await once(server.listen(0, '127.0.0.1'), 'listening')
    const address = server.address()
    assert.ok(address && typeof address === 'object')
    const base = 'http://127.0.0.1:' + address.port
    const vision = { ...original.vision!, enabled: true, reuse_main_model: true, base_url: base + '/shared/v1', model_name: 'shared-vl', api_key: 'shared-key', cache_ttl_seconds: 0 }
    saveConfig({ llm: { ...original.llm, model_name: 'gpt-4o', base_url: base + '/main/v1', api_key: 'main-key' }, vision }, { llmKey: true, visionKey: true })
    const configure = (patch: object) => service.handle({ type: 'activity.configure', expected_revision: service.store.revision(),
      expected_model_target: service.state().runtime.model_target_ids!.vision, patch })
    assert.equal((await configure({ enabled: true, allowed_apps: [id], extraction_mode: 'vision', image_ai_enabled: true })).ok, true)
    await service.scan()
    const source = service.state().sources[0]
    const image = png.toString('base64'), dataUrl = 'data:image/png;base64,' + image
    assert.deepEqual(requests, [{ path: '/main/v1/chat/completions', model: 'gpt-4o', credential: 'Bearer main-key', image: dataUrl }])
    saveConfig({ vision: { ...vision, reuse_main_model: false } }, { visionKey: true })
    assert.equal(service.state().config.image_ai_enabled, false)
    await assert.rejects(service.analyze(source.id))
    assert.equal(requests.length, 1)
    assert.equal((await configure({ image_ai_enabled: true })).ok, true)
    await service.analyze(source.id)
    assert.deepEqual(requests[1], { path: '/shared/v1/chat/completions', model: 'shared-vl', credential: 'Bearer shared-key', image: dataUrl })
    saveConfig({ vision: { ...vision, enabled: false } })
    assert.equal(service.state().config.image_ai_enabled, false)
    assert.equal((await configure({ extraction_mode: 'dedicated', image_ai_enabled: true, dedicated_vision: {
      base_url: base + '/dedicated/v1', model_name: 'dedicated-vl', api_key: 'dedicated-key', protocol: 'anthropic' } })).ok, true)
    await service.analyze(source.id)
    assert.deepEqual(requests[2], { path: '/dedicated/v1/messages', model: 'dedicated-vl', credential: 'dedicated-key', image })
    assert.equal(requests.length, 3)
    assert.equal(native.calls.some(call => call.script === 'computer-ocr.ps1'), false)
    assert.equal(service.store.sourceMetadata(source.id).recognition?.status, 'complete')
    assert.equal(service.store.sourceMetadata(source.id).ocr_text, '请核对报告')
  } finally {
    await service.stop()
    await new Promise<void>(resolve => server.close(() => resolve()))
    saveConfig({ vision: original.vision, llm: original.llm }, { llmKey: true, visionKey: true })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('reimporting the same screenshot after switching from the main to the independent image model uses its new authorization', async () => {
  const dir = fresh(), original = structuredClone(getConfig())
  const models: string[] = []
  const service = new ActivityService({ dataDir: dir, extractImage: async (source, image, config) => {
    assert.deepEqual(image, png)
    const model = activityVisionConfig(config).model_name
    models.push(model)
    const actions = ['整理报告', '核对清单', '归档记录', '检查附录']
    const transcript = '小陈和小周整理报告、核对清单、归档记录、检查附录。'
    const candidates = (model === 'main-vl' ? actions : actions.slice(0, 3)).map(title => ({
      title, quote: transcript, action_quote: title, owner: model === 'main-vl' ? '小陈' : '小周',
    }))
    const entries = parseExtractedCandidates(JSON.stringify({ candidates }),
      { ...source, ocr_text: transcript })
    return { transcript, entries }
  } })
  const authorize = (target: string) => service.handle({ type: 'activity.configure', expected_revision: service.store.revision(),
    expected_model_target: target, patch: { extraction_mode: 'vision', image_ai_enabled: true } })
  async function intake(target: string) {
    const reply = await service.handle({ type: 'activity.import', expected_model_target: target, image_base64: png.toString('base64') })
    await new Promise<void>(resolve => setImmediate(resolve)) // Let the queued in-memory extractor commit its result.
    return reply
  }
  try {
    const vision = { ...original.vision!, enabled: true, reuse_main_model: true, model_name: 'independent-vl', base_url: 'http://127.0.0.1:1234/v1' }
    saveConfig({ llm: { ...original.llm, model_name: 'main-vl', native_vision: 'on' }, vision })
    const first = service.state().runtime.model_target_ids!.vision!
    assert.equal((await authorize(first)).ok, true)
    const imported = await intake(first)
    assert.equal(imported.ok, true)
    const id = String(imported.source_id)
    assert.equal(service.store.sourceMetadata(id).recognition?.status, 'complete')
    assert.deepEqual(models, ['main-vl'])
    const drafts = service.state().candidates
    const confirm = drafts.find(item => item.title === '核对清单')!, dismiss = drafts.find(item => item.title === '归档记录')!
    assert.equal((await service.handle({ type: 'todo.confirm', candidate_id: confirm.id, expected_revision: confirm.revision,
      task: { title: '已核对的清单', owner: '小陈' } })).ok, true)
    assert.equal((await service.handle({ type: 'todo.dismiss', candidate_id: dismiss.id, expected_revision: dismiss.revision })).ok, true)
    const decisions = service.state().candidates.filter(item => item.status !== 'pending'), todos = service.state().todos

    saveConfig({ vision: { ...vision, reuse_main_model: false } })
    const second = service.state().runtime.model_target_ids!.vision!
    assert.notEqual(first, second)
    assert.equal((await intake(second)).error_code, 'MODEL_TARGET_CHANGED')
    assert.equal((await authorize(second)).ok, true)
    assert.equal((await intake(first)).error_code, 'MODEL_TARGET_CHANGED')
    assert.deepEqual(models, ['main-vl'])
    assert.equal((await intake(second)).source_id, id)
    assert.deepEqual(models, ['main-vl', 'independent-vl'])
    assert.equal(service.store.sourceMetadata(id).recognition?.status, 'complete')
    const updated = service.state()
    assert.deepEqual(updated.candidates.filter(item => item.status === 'pending').map(item => [item.evidence.source_id, item.title, item.owner]),
      [[id, '整理报告', '小周']])
    assert.deepEqual(updated.candidates.filter(item => item.status !== 'pending'), decisions)
    assert.deepEqual(updated.todos, todos)
    assert.equal((await intake(second)).source_id, id)
    assert.deepEqual(models, ['main-vl', 'independent-vl'])
    assert.equal(service.state().sources.length, 1)
  } finally {
    await service.stop()
    saveConfig({ vision: original.vision, llm: original.llm }, { llmKey: true, visionKey: true })
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('saving dedicated settings with the stored key keeps queued screenshots and their authorization', async () => {
  const dir = fresh(), service = new ActivityService({ dataDir: dir, platform: 'win32' })
  try {
    const model = { base_url: 'http://127.0.0.1:1234/v1', model_name: 'owned-vl', protocol: 'openai', api_key: 'owned-key' }
    const configure = (dedicated_vision: typeof model) => service.handle({ type: 'activity.configure', expected_revision: service.store.revision(),
      patch: { extraction_mode: 'dedicated', image_ai_enabled: true, dedicated_vision } })
    assert.equal((await configure(model)).ok, true)
    const target = service.state().runtime.model_target_id!
    const receipt = { status: 'queued' as const, target, automatic: true }
    const source = service.store.addSource({ recognition: receipt, app_id: id, app_name: 'Owned Chat', window_title: 'Owned',
      origin: 'foreground', ocr_text: '', captured_at: new Date().toISOString() }, png)!
    assert.equal((await configure({ ...model, api_key: '' })).ok, true)
    assert.equal(service.state().config.image_ai_enabled, true)
    assert.deepEqual(service.store.sourceMetadata(source.id).recognition, receipt)
    assert.equal((await configure({ ...model, model_name: 'new-vl' })).ok, true)
    assert.equal(service.store.sourceMetadata(source.id).recognition?.status, 'saved')
  } finally { await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})
test('Windows process enumeration projects identity/name/state, excluding sensitive paths and all titles', async () => {
  const dir=fresh();try{const d=windowsDouble(dir),apps=await d.adapter.listApps(new AbortController().signal);assert.deepEqual(apps,[{app_id:id,app_name:'Owned Chat',window_state:'visible'}]);assert.equal(JSON.stringify(apps).includes('exe'),false);assert.equal(d.calls.length,1)}finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('Windows real adapter requires Passive for pixel fallback, fixed local OCR and same identity after capture; pending files always removed', async () => {
  const dir=fresh();try{
    const d=windowsDouble(dir),result=await d.adapter.capture(config,new AbortController().signal)
    assert.equal(result!.ocr_text,'OWNED TEXT');validatePng(result!.image)
    const capture=d.calls.find(c=>c.script==='computer-capture.ps1')!
    assert.ok(capture.args.includes('-Passive'));assert.ok(capture.args.includes('-AllowFallback'))
    assert.deepEqual(d.calls.find(c=>c.script==='computer-ocr.ps1')!.args.slice(-2),['-Language','en-US'])
    assert.deepEqual(fs.readdirSync(dir),[])
    assert.equal(d.calls.some(c=>/input|invoke|select/.test(c.script)),false)
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('Windows changed PID/start/title/geometry or password/unknown focus refuses source and never runs OCR', async () => {
  for(const after of [null,{...win(),pid:101},{...win(),started:'reused'},{...win(),title:'changed'},{...win(),geometry:'1,1,2,2'},{...win(),safe:false}]){
    const dir=fresh();try{const d=windowsDouble(dir,{after});assert.equal(await d.adapter.capture(config,new AbortController().signal),null);assert.equal(d.calls.some(c=>c.script==='computer-ocr.ps1'),false);assert.deepEqual(fs.readdirSync(dir),[])}finally{fs.rmSync(dir,{recursive:true,force:true})}
  }
})
test('Windows secure desktop, invalid integrity and cancellation cannot save or proceed to OCR', async () => {
  for(const changes of [{desktop:'Winlogon'},{targetIl:12288},{targetIl:-1}]){
    const dir=fresh();try{const d=windowsDouble(dir,changes);await assert.rejects(d.adapter.capture(config,new AbortController().signal));assert.equal(d.calls.some(c=>c.script==='computer-capture.ps1'),false)}finally{fs.rmSync(dir,{recursive:true,force:true})}
  }
  const dir=fresh();try{const abort=new AbortController(),d=windowsDouble(dir,{abort});await assert.rejects(d.adapter.capture(config,abort.signal));assert.deepEqual(fs.readdirSync(dir),[]);assert.equal(d.calls.some(c=>c.script==='computer-ocr.ps1'),false)}finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('Linux adapter only uses fixed local Python/Tesseract argv; local import does not invoke desktop capture', async () => {
  const dir=fresh();const calls:Array<{bin:string;args:string[]}>=[]
  try{
    const adapter=new LinuxPassiveRecorder(dir,async(bin,args)=>{calls.push({bin,args});assert.equal(bin,'/usr/bin/tesseract');assert.deepEqual(args.slice(-4),['-l','chi_sim+eng','--psm','3']);assert.deepEqual(fs.readFileSync(args[0]),png);return 'OWNED OCR'},()=>{throw Error('NO_DESKTOP_HELPER_ON_IMPORT')})
    assert.equal(await adapter.ocrImage(png,'zh-Hans',new AbortController().signal),'OWNED OCR');assert.equal(calls.length,1);assert.deepEqual(fs.readdirSync(dir),[])
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('Windows notification uses the bundled binary with fixed argv; missing helper/failure cannot be reported submitted', async () => {
  assert.match(resolveWindowsToast('x64'),/snoretoast-x64\.exe$/)
  assert.match(resolveWindowsToast('ia32'),/snoretoast-x86\.exe$/)
  assert.ok(fs.existsSync(resolveWindowsToast('x64')))
  await submitWindowsReminder(async(file,args,options)=>{assert.equal(file,'owned.exe');assert.equal(args[0],'-t');assert.equal(args[args.length-1],'-silent');assert.equal(options.timeout,10000);assert.equal(options.windowsHide,true)},'owned.exe')
  for(const code of [1,2,3,4,5])await submitWindowsReminder(async()=>{throw {code}},'owned.exe')
  for(const code of ['ENOENT',-1,7])await assert.rejects(submitWindowsReminder(async()=>{throw {code}},'owned.exe'),error=>(error as any).code==='NOTIFICATION_FAILED')
  await assert.rejects(submitWindowsReminder(async()=>{throw {killed:true,signal:'SIGTERM'}},'owned.exe'),error=>(error as any).code==='NOTIFICATION_UNKNOWN')
})

test('900 Linux manual import reports a missing language even if Tesseract can read English, then retries locally', {
  skip: process.platform !== 'linux' || !fs.existsSync('/usr/bin/tesseract'),
}, async t => {
  const languages = execFileSync('/usr/bin/tesseract', ['--list-langs'], { encoding: 'utf8' }).split(/\s+/)
  if (!languages.includes('eng')) return t.skip('English OCR pack unavailable')
  const missing = !languages.includes('chi_tra') ? 'zh-Hant' : !languages.includes('chi_sim') ? 'zh-Hans' : undefined
  const dir = fresh(), service = new ActivityService({ dataDir: dir, platform: 'linux' })
  try {
    service.store.configure(0, { ocr_language: missing || 'en-US' })
    const png = fs.readFileSync(path.resolve('tests/fixtures/activity-linux-758.png'))
    const imported = await service.handle({ type: 'activity.import', image_base64: png.toString('base64') })
    const item = service.state().sources[0]
    if (missing) {
      assert.equal(imported.error_code, 'OCR_LANGUAGE_MISSING')
      assert.ok(item.recognition?.status === 'failed' && item.recognition.code === 'OCR_LANGUAGE_MISSING')
      await service.handle({ type: 'activity.configure', expected_revision: service.store.revision(), patch: { ocr_language: 'en-US' } })
      await service.analyze(item.id)
    } else assert.equal(imported.ok, true)
    assert.match(service.store.source(item.id).ocr_text, /PROJECT ALPHA\s+SEND REPORT FRIDAY/i)
    assert.equal(service.state().config.enabled, false)
    assert.equal(service.state().sources.length, 1)
    assert.equal(service.state().candidates.length, 0)
  } finally { await service.stop(); fs.rmSync(dir, { recursive: true, force: true }) }
})
