// Inert, owned-filesystem execution of the actual collector CLI. No network or native child.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '../..')
for (const [scenario, stage] of [['download','DOWNLOAD'], ['download-close','DOWNLOAD'], ['download-unlink','DOWNLOAD'], ['download-outer','CLEANUP'], ['download-finally','DOWNLOAD'], ['download-sink','DOWNLOAD'], ['runps','RUN_PS'], ['parse','PARSE'], ['cleanup','CLEANUP'], ['run-cleanup','CLEANUP'], ['close','CLEANUP'], ['rmdir','CLEANUP'], ['unknown','UNKNOWN']]) {
  test(`#70 actual CLI finite failure stage ${scenario}`, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gallery70-stage-'))
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
    const scripts = path.join(dir, 'scripts'), data = path.join(dir, 'companion/src/apps'), dist = path.join(dir, 'companion/dist/host-use/win')
    for (const p of [scripts,data,dist]) fs.mkdirSync(p,{recursive:true})
    const entry = path.join(scripts,'collect-app-gallery-reference-70.mjs')
    fs.copyFileSync(path.join(root,'scripts/collect-app-gallery-reference-70.mjs'),entry)
    fs.copyFileSync(path.join(root,'companion/src/apps/preset-gallery-references.json'),path.join(data,'preset-gallery-references.json'))
    fs.writeFileSync(path.join(dist,'powershell.js'),`exports.runPs=async()=>{if(process.env.CASE==='runps'||process.env.CASE==='run-cleanup')throw Error('SECRET_ERROR_URL_PATH_CERT');return 'SECRET_INVALID_JSON_CERT'};`)
    const preload=path.join(dir,'inert.cjs')
    fs.writeFileSync(preload,`const fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process');
Object.defineProperty(process,'platform',{value:'win32'});require('node:os').tmpdir=()=>${JSON.stringify(dir)};for(const n of ['exec','execFile','execSync','execFileSync','spawn','spawnSync','fork'])cp[n]=()=>{throw Error('CHILD_BLOCKED')};
require('node:net').Socket.prototype.connect=()=>{throw Error('NETWORK_BLOCKED')};process.dlopen=()=>{throw Error('NATIVE_BLOCKED')};
const catalog=JSON.parse(fs.readFileSync(${JSON.stringify(path.join(data,'preset-gallery-references.json'))},'utf8'));let current=0;
global.fetch=async()=>{if(['download','download-close','download-unlink','download-outer','download-sink'].includes(process.env.CASE))throw 'SECRET_ERROR_URL_PATH_CERT';return new Response('inert')};
const oldError=console.error;console.error=(...args)=>{if(process.env.CASE==='download-sink'&&String(args[0]).includes('GALLERY70_DOWNLOAD_OBSERVATION'))throw Error('SECRET_SINK');return oldError(...args)};
crypto.createHash=()=>({update(){return this},digest(){return catalog[current++].reference.packageSHA256}});
const unlink=fs.unlinkSync;let zipUnlinks=0;fs.unlinkSync=(p)=>{if(String(p).endsWith('.zip')){zipUnlinks++;if(process.env.CASE==='download-outer'&&zipUnlinks===2)throw 'SECRET_ERROR_URL_PATH_CERT'}const r=unlink(p);if((process.env.CASE==='cleanup'||process.env.CASE==='run-cleanup'||process.env.CASE==='download-unlink')&&String(p).endsWith('.zip'))throw 'SECRET_ERROR_URL_PATH_CERT';return r};
const open=fs.openSync;let evidenceFd,archiveFd;fs.openSync=(p,...a)=>{const fd=open(p,...a);if(String(p).endsWith('output.json'))evidenceFd=fd;if(String(p).endsWith('.zip'))archiveFd=fd;return fd};
const close=fs.closeSync;let archiveCloses=0;fs.closeSync=(fd)=>{if(fd===archiveFd&&++archiveCloses===1&&process.env.CASE==='download-close')throw 'SECRET_ERROR_URL_PATH_CERT';const r=close(fd);if((process.env.CASE==='close'&&fd===evidenceFd)||(process.env.CASE==='download-finally'&&fd===archiveFd))throw 'SECRET_ERROR_URL_PATH_CERT';return r};
const rmdir=fs.rmdirSync;fs.rmdirSync=(p)=>{const r=rmdir(p);if(process.env.CASE==='rmdir')throw Error('SECRET_ERROR_URL_PATH_CERT');return r};
require('node:module').syncBuiltinESMExports();`)
    const result=spawnSync(process.execPath,['--require',preload,entry,...(scenario==='unknown'?[]:[path.join(dir,'output.json')])],{encoding:'utf8',timeout:5000,maxBuffer:65536,env:{PATH:process.env.PATH,TMPDIR:dir,GITHUB_ACTIONS:'true',RUNNER_OS:'Windows',CASE:scenario}})
    assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,1)
    assert.match(result.stderr,new RegExp(`GALLERY70_FAILURE_STAGE=${stage}(?:\\r?\\n|$)`))
    assert.doesNotMatch(result.stderr+result.stdout,/SECRET_ERROR_URL_PATH_CERT|SECRET_INVALID_JSON_CERT|SECRET_SINK/)
    const observations=result.stderr.split(/\r?\n/).filter(line=>line.includes('GALLERY70_DOWNLOAD_OBSERVATION'))
    if(scenario==='download-sink') assert.equal(observations.length,0)
    else if(scenario.startsWith('download')) {
      assert.equal(observations.length,1)
      const expected={download:['REQUEST','REQUEST',['CLOSE_RETURNED','UNLINK_RETURNED']], 'download-close':['REQUEST','CLOSE',['CLOSE_THREW','FINALLY_CLOSE_RETURNED']], 'download-unlink':['REQUEST','UNLINK',['CLOSE_RETURNED','UNLINK_THREW']], 'download-outer':['REQUEST','REQUEST',['CLOSE_RETURNED','UNLINK_RETURNED']], 'download-finally':['NONE','FINALLY_CLOSE',['FINALLY_CLOSE_THREW']]}[scenario]
      assert.deepEqual(JSON.parse(observations[0]),{kind:'GALLERY70_DOWNLOAD_OBSERVATION',origin:expected[0],downloadThrown:expected[1],cleanup:expected[2]})
    } else assert.equal(observations.length,0)
  })
}
