'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
const file=path.resolve(__dirname,'../../src/ws/validate.ts'),sf=ts.createSourceFile(file,fs.readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true),found=[];
function visit(n){if(ts.isPropertyAssignment(n)&&ts.isStringLiteral(n.name)&&['modules.list','modules.set_profile'].includes(n.name.text))found.push(n);ts.forEachChild(n,visit)}visit(sf);assert.equal(found.length,2);
const source='globalThis.rules={'+found.map(n=>n.getText(sf)).join(',')+'};',context={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
const list=context.rules['modules.list'],write=context.rules['modules.set_profile'];
test('actual WS validators retain legacy input and accept explicit v1',()=>{assert.equal(list({}).valid,true);assert.equal(list({profile_receipt_protocol:1}).valid,true);assert.equal(write({profile:'community'}).valid,true);assert.equal(write({profile:'enterprise',profile_receipt_protocol:1,config_revision:'owned:1'}).valid,true)});
test('actual WS validators reject unsupported protocol variants',()=>{for(const value of [0,2,'1',null,true,{}]){assert.equal(list({profile_receipt_protocol:value}).valid,false);assert.equal(write({profile:'enterprise',profile_receipt_protocol:value}).valid,false)}});
test('actual WS write validator requires bounded observed revision only for v1',()=>{for(const value of [undefined,null,'',1,'x'.repeat(129)])assert.equal(write({profile:'enterprise',profile_receipt_protocol:1,config_revision:value}).valid,false);assert.equal(write({profile:'enterprise'}).valid,true)});
