import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { promisify } from 'node:util'
import { withSurface650 } from './fixtures/native-surface-650'
import { WindowsPassiveRecorder, LinuxPassiveRecorder, resolveLinuxRecorder, runLinux, type LinuxRunner } from '../src/activity/platform'
import { resolveWinScript, runPs } from '../src/host-use/win/powershell'
import { DEFAULT_ACTIVITY_CONFIG } from '../src/activity/types'
import { submitReminder } from '../src/activity/adapters'
import { buildOwnedWpf758 } from './helpers/activity-native-fixture-758'
const exec=promisify(execFile)
const enabled=process.env.CMSPARK_ACTIVITY_NATIVE_758==='1'

function receipt(file:string,child:ChildProcess,signal:AbortSignal,diagnostic:()=>string=()=> ''):Promise<any>{
  return new Promise((resolve,reject)=>{
    let finished=false
    const finish=(error?:unknown,value?:any)=>{if(finished)return;finished=true;clearTimeout(timer);watch.close();child.off('close',closed);signal.removeEventListener('abort',aborted);error?reject(error):resolve(value)}
    const check=(allowReady=true)=>{try{
      const failure=path.join(path.dirname(file),'failure.json')
      if(fs.existsSync(failure)){const value=JSON.parse(fs.readFileSync(failure,'utf8'));finish(Error('OWNED_ACTIVITY_FIXTURE_FAILED '+JSON.stringify(value).slice(0,2048)));return}
      if(allowReady&&fs.existsSync(file))finish(undefined,JSON.parse(fs.readFileSync(file,'utf8')))
    }catch(e){finish(e)}}
    const closed=()=>{check(false);if(!finished)finish(Error('OWNED_ACTIVITY_FIXTURE_CLOSED '+diagnostic()))},aborted=()=>finish(signal.reason)
    const watch=fs.watch(path.dirname(file),()=>check()),timer=setTimeout(()=>finish(Error('OWNED_ACTIVITY_FIXTURE_NOT_READY '+diagnostic())),10_000)
    child.once('close',closed);signal.addEventListener('abort',aborted,{once:true});if(signal.aborted)aborted();else check()
  })
}
test('#758 actual desktop foreground identity, passive pixels and local OCR; minimized or occluded targets are refused', {skip:!enabled||!['linux','win32'].includes(process.platform),timeout:90_000}, t=>withSurface650(t,async(owned,lease)=>{
  if(process.platform==='linux')assert.equal(process.env.CMSPARK_ACTIVITY_PRIVATE_BUS_758,'1','use the owned Xvfb/private-bus driver')
  if(process.platform==='win32'){assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_OS,'Windows')}
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cmspark-activity758-原生 with spaces-'))
  const win=process.platform==='win32'
  let binary=''
  try{if(win)binary=await buildOwnedWpf758(dir,owned.signal)}catch(error){fs.rmSync(dir,{recursive:true,force:true});throw error}
  const child=win?spawn(binary,[dir],{windowsHide:false,stdio:['ignore','ignore','pipe']}):spawn('/usr/bin/python3',[path.resolve('tests/fixtures/activity-linux-758.py'),dir],{stdio:['ignore','ignore','pipe']})
  let stderr=Buffer.alloc(0)
  child.stderr?.on('data',(chunk:Buffer)=>{if(stderr.length<4096)stderr=Buffer.concat([stderr,chunk.subarray(0,4096-stderr.length)])}) // keep draining after the finite prefix
  const diagnostic=()=>{
    let phase='UNKNOWN'
    try{const value=JSON.parse(fs.readFileSync(path.join(dir,'phase.json'),'utf8'));if(['SETUP','SHOW_DIALOG','CONTENT_RENDERED','CONTROL'].includes(value.phase))phase=value.phase}catch{}
    return JSON.stringify({phase,stderr:stderr.toString('utf8')})
  }
  lease.retain();let ended=false;const closed=new Promise<void>(resolve=>child.once('close',()=>{ended=true;resolve()}))
  child.on('error',()=>{})
  const write=(name:string,value:any)=>{fs.writeFileSync(path.join(dir,name+'.pending'),JSON.stringify(value),{flag:'wx'});fs.renameSync(path.join(dir,name+'.pending'),path.join(dir,name))}
  try{
    const ready=await receipt(path.join(dir,'ready.json'),child,owned.signal,diagnostic)
    assert.equal(ready.pid,child.pid)
    if(!win){const lock=await receipt(path.join(process.env.CMSPARK_ACTIVITY_LOCK_FIXTURE_758!,'ready.json'),child,owned.signal);assert.equal(lock.bus_name,'org.freedesktop.ScreenSaver')}
    const root=path.join(dir,'records');fs.mkdirSync(root,{mode:0o700})
    if(win){
      // Raw first-party preflight keeps a native script/WinRT setup failure observable.
      const listed=JSON.parse(await runPs(resolveWinScript('activity-windows.ps1'),['-Mode','Apps']))
      assert.equal(listed.ok,true);assert.ok(Array.isArray(listed.windows))
      const image=path.join(dir,'owned OCR 原生.png');fs.copyFileSync(path.resolve('tests/fixtures/activity-linux-758.png'),image)
      const ocr=JSON.parse(await runPs(resolveWinScript('computer-ocr.ps1'),['-ImagePath',image,'-Language','en-US']))
      assert.equal(ocr.ok,true);assert.ok(ocr.words.some((w:any)=>/PROJECT/i.test(w.text)))
    }else{
      await assert.rejects(exec('/usr/bin/python3',['-I',resolveLinuxRecorder(),'probe'],{env:{...process.env,WAYLAND_DISPLAY:'wayland-owned758',XDG_SESSION_TYPE:'wayland'},signal:owned.signal,timeout:5000}),error=>String((error as any).stderr).trim()==='X11_DESKTOP_REQUIRED')
    }
    let linuxAppsRunner758:LinuxRunner=runLinux
    if(!win){
      const observation758=require(path.resolve('scripts/desktop-linux-apps-observation-fixture-758.mjs'))
      const helper758=resolveLinuxRecorder(),original758=fs.readFileSync(helper758,'utf8'),projected758=observation758.desktopLinuxAppsObservation758(original758)
      assert.equal(projected758.inverse,original758,'test-only Linux app observation must restore the entire production helper')
      const observedHelper758=path.join(dir,'linux-apps-observed-758.py');fs.writeFileSync(observedHelper758,projected758.source,{flag:'wx',mode:0o600})
      linuxAppsRunner758=async(executable,args,signal)=>{
        const isApps758=executable==='/usr/bin/python3'&&args.length===3&&args[0]==='-I'&&args[1]===helper758&&args[2]==='apps'
        const output=await runLinux(executable,isApps758?['-I',observedHelper758,'apps']:args,signal)
        if(isApps758){
          let finite758:{status:string;reason?:string;snapshot?:unknown}={status:'UNKNOWN',reason:'INVALID_SNAPSHOT'}
          try{finite758=observation758.projectLinuxAppsObservation758(JSON.parse(output).observation758)}catch{}
          try{t.diagnostic('D758_LINUX_APPS_PHASE '+JSON.stringify(finite758))}catch{}
        }
        return output
      }
    }
    const adapter=win?new WindowsPassiveRecorder(root):new LinuxPassiveRecorder(root,linuxAppsRunner758)
    const apps=await adapter.listApps(owned.signal)
    assert.ok(apps.length>0)
    let native:any
    if(win){native=JSON.parse(await runPs(resolveWinScript('activity-windows.ps1'),['-Mode','Probe'])).window;assert.equal(native.hwnd,ready.hwnd)}
    else{
      native=JSON.parse((await exec('/usr/bin/python3',['-I',resolveLinuxRecorder(),'probe'],{signal:owned.signal,timeout:15000})).stdout).window
    }
    assert.ok(native);assert.equal(native.pid,child.pid)
    assert.ok(apps.some(a=>a.app_id===native.app_id))
    const config={...DEFAULT_ACTIVITY_CONFIG,enabled:true,allowed_apps:[native.app_id],ocr_language:'en-US' as const}
    const before=win?JSON.parse(await runPs(resolveWinScript('activity-windows.ps1'),['-Mode','Probe'])).window.hwnd:native.window
    const captured=await adapter.capture(config,owned.signal)
    assert.ok(captured);assert.equal(captured.app_id,native.app_id)
    assert.match(captured.ocr_text,/PROJECT\s+ALPHA/i);assert.match(captured.ocr_text,/REPORT\s+FRIDAY/i)
    if(win){const after=JSON.parse(await runPs(resolveWinScript('activity-windows.ps1'),['-Mode','Probe'])).window;assert.equal(after.hwnd,before);assert.equal(after.pid,child.pid)}
    else{
      const after=JSON.parse((await exec('/usr/bin/python3',['-I',resolveLinuxRecorder(),'probe'],{signal:owned.signal,timeout:15000})).stdout).window
      assert.equal(after.window,before);assert.equal(after.pid,child.pid)
      // _NET_WM_PID is spoofable: XRes server ownership must continue to name our actual child.
      await exec('/usr/bin/xprop',['-id',String(native.window),'-f','_NET_WM_PID','32c','-set','_NET_WM_PID','1'],{signal:owned.signal,timeout:5000})
      const spoofed=await adapter.capture(config,owned.signal);assert.ok(spoofed);assert.equal(spoofed.app_id,native.app_id)
      const locked=path.join(process.env.CMSPARK_ACTIVITY_LOCK_FIXTURE_758!,'locked');fs.writeFileSync(locked,'1')
      try{await assert.rejects(adapter.capture(config,owned.signal),error=>(error as any).code==='DESKTOP_LOCKED')}
      finally{fs.unlinkSync(locked)}
      await exec('/usr/bin/xset',['s','activate'],{signal:owned.signal,timeout:5000})
      try{await assert.rejects(adapter.capture(config,owned.signal),error=>(error as any).code==='DESKTOP_LOCKED')}
      finally{await exec('/usr/bin/xset',['s','reset'],{timeout:5000})}
      write('control.json',{command:'overlay'})
      await receipt(path.join(dir,'ack.json'),child,owned.signal)
      await assert.rejects(adapter.capture(config,owned.signal))
      fs.unlinkSync(path.join(dir,'ack.json'))
      write('control.json',{command:'clear_overlay'})
      await receipt(path.join(dir,'ack.json'),child,owned.signal);fs.unlinkSync(path.join(dir,'ack.json'))
      const restored=JSON.parse((await exec('/usr/bin/python3',['-I',resolveLinuxRecorder(),'probe'],{signal:owned.signal,timeout:15000})).stdout).window
      assert.equal(restored.window,native.window);assert.equal(restored.pid,child.pid)
    }
    write('control.json',{command:'minimize'})
    const ack=await receipt(path.join(dir,'ack.json'),child,owned.signal);assert.equal(ack.command,'minimize')
    if(win)assert.equal(ack.minimized,true)
    // No restoring minimized windows and no substitute full-screen source.
    let minimizedCapture=null
    try{minimizedCapture=await adapter.capture(config,owned.signal)}catch(error){assert.ok(error instanceof Error)}
    assert.equal(minimizedCapture,null)
    const imported=await adapter.ocrImage(captured.image,'en-US',owned.signal);assert.match(imported,/PROJECT\s+ALPHA/i)
    if(!win){
      const lockRoot=process.env.CMSPARK_ACTIVITY_LOCK_FIXTURE_758!
      fs.writeFileSync(path.join(lockRoot,'stop'),'1')
      assert.equal((await receipt(path.join(lockRoot,'stopped.json'),child,owned.signal)).released,true)
      await assert.rejects(adapter.capture(config,owned.signal),error=>(error as any).code==='LOCK_STATE_UNKNOWN')
    }
    assert.equal(fs.readdirSync(root).filter(name=>name.startsWith('pending-')).length,0)
    await submitReminder()
    if(!win)await exec('/usr/bin/dunstctl',['close-all'],{signal:owned.signal,timeout:5000}) // dedicated private bus only
    console.log(JSON.stringify({capability:'activity758',platform:process.platform,owned_pid:true,foreground_unchanged:true,local_ocr:true,source_after_minimize:false,notification_submission:true}))
  }finally{
    if(!ended)child.kill()
    await closed
    fs.rmSync(dir,{recursive:true,force:true});lease.settled()
  }
}))
