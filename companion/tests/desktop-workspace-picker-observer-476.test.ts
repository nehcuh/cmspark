/** Node core execFile/promisify through a cached production picker; no child can spawn. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
// Import/cache before the test-only observer is installed, exactly as canonical imports can.
import { pickFolderNative, WORKSPACE_FOLDER_PROMPT } from '../src/obsidian/folder-picker'
import { observeWorkspacePicker476 } from './helpers/desktop-workspace-picker-476'

for(const platform of ['darwin','win32'] as const)test(`cached real picker promisify is observed through exact ${platform} spawn, original output/argv unchanged`,async t=>{
 const descriptor=Object.getOwnPropertyDescriptor(process,'platform')!;Object.defineProperty(process,'platform',{value:platform});t.after(()=>Object.defineProperty(process,'platform',descriptor));t.mock.method(os,'platform',()=>platform)
 const selected=fs.mkdtempSync(path.join(os.tmpdir(),'owned-picker-observer-'));t.after(()=>fs.rmSync(selected,{recursive:true,force:true}))
 let calls=0,envReads=0,pid=0,invalid=0;const observations:number[]=[],optionRefs:any[]=[]
 const inert=function(this:any,options:any){calls++;optionRefs.push(options);Object.defineProperty(options,'envPairs',{get(){envReads++;throw Error('ENV_MUST_NOT_BE_INSPECTED')}});this.pid=4000+calls;this.stdin=new PassThrough();this.stdout=new PassThrough();this.stderr=new PassThrough();this.stdio=[this.stdin,this.stdout,this.stderr];process.nextTick(()=>{this.stdout.end(selected+(platform==='darwin'?'/':''));this.stderr.end();this.emit('close',0,null)});return this}
 const installed=t.mock.method(ChildProcess.prototype as any,'spawn',inert as any)
 const cached=await pickFolderNative(WORKSPACE_FOLDER_PROMPT);assert.equal(cached.path,selected);assert.equal(calls,1)
 const actual=await observeWorkspacePicker476(value=>{pid=value;observations.push(value)},()=>invalid++)
 assert.equal(actual.result.path,selected);assert.equal(actual.observed,1);assert.equal(calls,2);assert.deepEqual(observations,[4002]);assert.equal(pid,4002);assert.equal(invalid,0);assert.equal(envReads,0);assert.equal((ChildProcess.prototype as any).spawn,installed)
 const args=optionRefs.map(o=>o.args);assert.equal(args[0][0],args[1][0]);if(platform==='darwin')assert.deepEqual(args[0],args[1]);else{assert.deepEqual(args[0].slice(0,-1),args[1].slice(0,-1));assert.equal(optionRefs.every(o=>o.windowsHide===false),true)}
})
test('observer callback faults cannot replace cached original picker return and scoped spawn is restored',async t=>{
 const descriptor=Object.getOwnPropertyDescriptor(process,'platform')!;Object.defineProperty(process,'platform',{value:'darwin'});t.after(()=>Object.defineProperty(process,'platform',descriptor));t.mock.method(os,'platform',()=> 'darwin')
 const inert=function(this:any){this.pid=4900;this.stdin=new PassThrough();this.stdout=new PassThrough();this.stderr=new PassThrough();this.stdio=[this.stdin,this.stdout,this.stderr];process.nextTick(()=>{this.stdout.end('/owned-inert-selected/');this.stderr.end();this.emit('close',0,null)});return this};const installed=t.mock.method(ChildProcess.prototype as any,'spawn',inert as any)
 const r=await observeWorkspacePicker476(()=>{throw Error('OWNED_CALLBACK_FAULT')},()=>{throw Error('OWNED_LOGGER_FAULT')});assert.equal(r.result.path,'/owned-inert-selected');assert.equal(r.observed,1);assert.equal((ChildProcess.prototype as any).spawn,installed)
})
