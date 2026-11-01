'use strict';
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript'),test=require('node:test'),assert=require('node:assert/strict');
const base=path.resolve(__dirname,'../../src')+path.sep;
require.extensions['.ts']=(mod,file)=>mod._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,file);
const snapshots=require(base+'capability/module-snapshot.ts');
function input(modules,capability_profile='enterprise'){return {config:{modules,capability_profile},revision:'owned:1'}}
function validModules(){return {netsec:{available:true,enabled:false,target_allowlist:['owned.example']},shell:{available:true,enabled:false,allowlist_commands:['owned --safe']}}}

test('module snapshot preserves existing legal ranges and normal array consumers',()=>{
 const target_allowlist=Array.from({length:64},()=> 'x'.repeat(253));
 const allowlist_commands=Array.from({length:512},()=> 'c'.repeat(4096));
 const source={netsec:{available:true,enabled:false,target_allowlist},shell:{available:true,enabled:false,allowlist_commands}};
 const result=snapshots.copyModulesConfigSnapshot(input(source));
 assert.equal(result.revision,'owned:1');assert.equal(result.capability_profile,'enterprise');
 assert.notEqual(result.modules,source);assert.notEqual(result.modules.netsec,source.netsec);assert.notEqual(result.modules.netsec.target_allowlist,target_allowlist);
 assert.equal(result.modules.netsec.target_allowlist.length,64);assert.equal(result.modules.shell.allowlist_commands.length,512);
 assert.equal(result.modules.netsec.target_allowlist.join(','),target_allowlist.join(','));
 assert.equal(result.modules.shell.allowlist_commands.join(','),allowlist_commands.join(','));
 result.modules.netsec.target_allowlist.push('other.example');assert.equal(target_allowlist.length,64);
});

test('snapshot objects and arrays mask inherited toJSON without losing Array.prototype or join',()=>{
 const result=snapshots.copyModulesConfigSnapshot(input(validModules())).modules;
 const rows=[result,result.netsec,result.shell,result.netsec.target_allowlist,result.shell.allowlist_commands];
 for(const row of rows){
  const array=Array.isArray(row);assert.equal(Object.getPrototypeOf(row),array?Array.prototype:Object.prototype);
  const descriptor=Object.getOwnPropertyDescriptor(row,'toJSON');assert.ok(descriptor);assert.equal(descriptor.value,undefined);assert.equal(descriptor.enumerable,false);assert.equal(descriptor.writable,false);assert.equal(descriptor.configurable,false);
  assert.throws(()=>{row.toJSON=()=>({})});assert.throws(()=>Object.defineProperty(row,'toJSON',{value:()=>({})}));
 }
 const objectDescriptor=Object.getOwnPropertyDescriptor(Object.prototype,'toJSON'),arrayDescriptor=Object.getOwnPropertyDescriptor(Array.prototype,'toJSON');let touched=0;
 Object.defineProperty(Object.prototype,'toJSON',{configurable:true,get(){touched++;throw Error('PRIVATE_OBJECT_SERIALIZER')}});
 Object.defineProperty(Array.prototype,'toJSON',{configurable:true,get(){touched++;throw Error('PRIVATE_ARRAY_SERIALIZER')}});
 try{assert.equal(JSON.parse(JSON.stringify(result)).netsec.target_allowlist[0],'owned.example');assert.equal(touched,0)}
 finally{
  if(objectDescriptor)Object.defineProperty(Object.prototype,'toJSON',objectDescriptor);else delete Object.prototype.toJSON;
  if(arrayDescriptor)Object.defineProperty(Array.prototype,'toJSON',arrayDescriptor);else delete Array.prototype.toJSON;
 }
 assert.equal(result.netsec.target_allowlist.join('、'),'owned.example');
});

for(const [name,make] of [
 ['accessor',()=>{const value=validModules();Object.defineProperty(value.netsec,'enabled',{enumerable:true,get(){throw Error('PRIVATE_GETTER')}});return value}],
 ['proxy',()=>{const value=validModules();value.netsec=new Proxy(value.netsec,{ownKeys(){throw Error('PRIVATE_PROXY')}});return value}],
 ['custom prototype',()=>{const value=validModules();Object.setPrototypeOf(value.netsec,{toJSON(){throw Error('PRIVATE_INHERITED_SERIALIZER')}});return value}],
 ['null prototype',()=>{const value=validModules();Object.setPrototypeOf(value.netsec,null);return value}],
 ['cycle',()=>{const value=validModules();value.netsec.self=value.netsec;return value}],
 ['sparse array',()=>{const value=validModules();value.netsec.target_allowlist=[];value.netsec.target_allowlist[1]='owned.example';return value}],
 ['non-enumerable property',()=>{const value=validModules();Object.defineProperty(value.netsec,'hidden',{value:'PRIVATE_HIDDEN'});return value}],
 ['symbol property',()=>{const value=validModules();value.netsec[Symbol('PRIVATE_SYMBOL')]=true;return value}],
 ['own toJSON field',()=>{const value=validModules();value.netsec.toJSON='PRIVATE_SERIALIZER';return value}],
])test(`module snapshot rejects ${name} without evaluating its input`,()=>{
 let touched=0;const value=make();const original=value.netsec;
 if(name==='accessor')Object.defineProperty(value.netsec,'enabled',{enumerable:true,get(){touched++;throw Error('PRIVATE_GETTER')}});
 if(name==='proxy')value.netsec=new Proxy(original,{ownKeys(){touched++;throw Error('PRIVATE_PROXY')}});
 assert.throws(()=>snapshots.copyModulesConfigSnapshot(input(value)),{message:'MODULE_SNAPSHOT_INVALID'});assert.equal(touched,0);
});


test('snapshot rejects inputs beyond the depth and array limits',()=>{
 const deep={};let current=deep;for(let i=0;i<66;i++){current.next={};current=current.next}
 assert.throws(()=>snapshots.copyModulesConfigSnapshot(input(deep)),{message:'MODULE_SNAPSHOT_INVALID'});
 assert.throws(()=>snapshots.copyModulesConfigSnapshot(input({items:new Array(1000001)})),{message:'MODULE_SNAPSHOT_INVALID'});
});
