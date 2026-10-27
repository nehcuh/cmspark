// Inert, owned-filesystem execution of the actual collector CLI. No network or native child.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '../..')
for (const [scenario, stage] of [['download','DOWNLOAD'], ['runps','RUN_PS'], ['parse','PARSE'], ['cleanup','CLEANUP'], ['run-cleanup','CLEANUP'], ['close','CLEANUP'], ['rmdir','CLEANUP'], ['unknown','UNKNOWN']]) {
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
global.fetch=async()=>{if(process.env.CASE==='download')throw Error('SECRET_ERROR_URL_PATH_CERT');return new Response('inert')};
crypto.createHash=()=>({update(){return this},digest(){return catalog[current++].reference.packageSHA256}});
const unlink=fs.unlinkSync;fs.unlinkSync=(p)=>{const r=unlink(p);if((process.env.CASE==='cleanup'||process.env.CASE==='run-cleanup')&&String(p).endsWith('.zip'))throw Error('SECRET_ERROR_URL_PATH_CERT');return r};
const open=fs.openSync;let evidenceFd;fs.openSync=(p,...a)=>{const fd=open(p,...a);if(String(p).endsWith('output.json'))evidenceFd=fd;return fd};
const close=fs.closeSync;fs.closeSync=(fd)=>{const r=close(fd);if(process.env.CASE==='close'&&fd===evidenceFd)throw Error('SECRET_ERROR_URL_PATH_CERT');return r};
const rmdir=fs.rmdirSync;fs.rmdirSync=(p)=>{const r=rmdir(p);if(process.env.CASE==='rmdir')throw Error('SECRET_ERROR_URL_PATH_CERT');return r};
require('node:module').syncBuiltinESMExports();`)
    const result=spawnSync(process.execPath,['--require',preload,entry,...(scenario==='unknown'?[]:[path.join(dir,'output.json')])],{encoding:'utf8',timeout:5000,maxBuffer:65536,env:{PATH:process.env.PATH,TMPDIR:dir,GITHUB_ACTIONS:'true',RUNNER_OS:'Windows',CASE:scenario}})
    assert.equal(result.error,undefined);assert.equal(result.signal,null);assert.equal(result.status,1)
    assert.match(result.stderr,new RegExp(`GALLERY70_FAILURE_STAGE=${stage}(?:\\r?\\n|$)`))
    assert.doesNotMatch(result.stderr+result.stdout,/SECRET_ERROR_URL_PATH_CERT|SECRET_INVALID_JSON_CERT/)
  })
}
