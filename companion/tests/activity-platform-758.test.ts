import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { ActivityService } from '../src/activity/service'
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
    if(script==='activity-windows.ps1')return JSON.stringify(args.includes('Apps')?{ok:true,windows:[win(),{...win(),exe:'c:\\1password.exe',app_name:'1password'}]}:{ok:true,window:probes++===0?win():changes.after===undefined?win():changes.after})
    if(script==='computer-probe.ps1')return JSON.stringify({desktop:changes.desktop||'Default',pid:100,ownIl:8192,targetIl:changes.targetIl??8192})
    if(script==='computer-capture.ps1'){fs.writeFileSync(args[args.indexOf('-OutPath')+1],png);changes.abort?.abort();return JSON.stringify({ok:true,restoredFromIconic:false,observation_quality:'ok',occludedBy:[]})}
    if(script==='computer-ocr.ps1')return JSON.stringify({ok:true,words:[{text:'OWNED TEXT'}]})
    throw Error('UNEXPECTED_SCRIPT')
  }
  return {adapter:new WindowsPassiveRecorder(dir,run,name=>name),calls}
}
test('Windows app enumeration projects only app id/name, excluding sensitive paths and all titles', async () => {
  const dir=fresh();try{const d=windowsDouble(dir),apps=await d.adapter.listApps(new AbortController().signal);assert.deepEqual(apps,[{app_id:id,app_name:'Owned Chat'}]);assert.equal(JSON.stringify(apps).includes('exe'),false);assert.equal(d.calls.length,1)}finally{fs.rmSync(dir,{recursive:true,force:true})}
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
