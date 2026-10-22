/** Controlled Windows image-lock model around the ACTUAL native C2 test callback. No native dlopen/executable. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import ts from "typescript"
import { ownedDirectoryIdentity, requireOwnedDirectory, requireInheritance } from "./fixtures/desktop-480/native-acceptance-controller"
const source=fs.readFileSync(path.resolve("tests/desktop-native-windows-480.test.ts"),"utf8")
const tree=ts.createSourceFile("desktop-native-windows-480.test.ts",source,ts.ScriptTarget.Latest,true)
const callbacks:ts.ArrowFunction[]=[]
function scan(n:ts.Node){if(ts.isCallExpression(n)&&n.expression.getText(tree)==="test"&&ts.isStringLiteral(n.arguments[0])&&n.arguments[0].text.startsWith("actual Windows inheritance: sentinel checker")){const callback=n.arguments[n.arguments.length-1];assert.ok(ts.isArrowFunction(callback));callbacks.push(callback)}ts.forEachChild(n,scan)}scan(tree);assert.equal(callbacks.length,1)
const body=ts.transpileModule(`return (${callbacks[0].getText(tree)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
// Derive receipt field names from the real N-API producer, not a parallel DTO.
const nativeSource=fs.readFileSync(path.resolve("tests/fixtures/desktop-480/windows-inheritance.c"),"utf8")
const inspectSource=nativeSource.slice(nativeSource.indexOf("static napi_value fixture_inspect("),nativeSource.indexOf("static void fixture_cleanup("))
const receiptFields=[...inspectSource.matchAll(/napi_(?:get_boolean|create_uint32)\(env,(\w+),&value\);napi_set_named_property\(env,object,"([a-z_]+)",value\);/g)].map(match=>({variable:match[1],field:match[2]}))
assert.equal(receiptFields.length,5);assert.equal(new Set(receiptFields.map(x=>x.field)).size,5)
function nativeReceipt(raw=4,objects=4,controlObjects=4,sidecar=true,control=4):Record<string,unknown>{
 const bindings:Record<string,unknown>={fixture_sidecar_ok:sidecar,fixture_control:control,fixture_sibling:raw,fixture_control_identity:controlObjects,fixture_sibling_identity:objects}
 return Object.fromEntries(receiptFields.map(({variable,field})=>{assert.ok(Object.hasOwn(bindings,variable));return[field,bindings[variable]]}))
}
const missingSiblingIdentity=nativeReceipt();delete missingSiblingIdentity.sibling_identity_mask
const missingControlIdentity=nativeReceipt();delete missingControlIdentity.control_identity_mask
for(const [name,observed,expectedFailure]of[
 ["valid exact identity4",nativeReceipt(),false],
 ["unrelated input slot raw5 identity4",nativeReceipt(5),false],
 ["unrelated parent slot raw6 identity4",nativeReceipt(6),false],
 ["unrelated both slots raw7 identity4",nativeReceipt(7),false],
 ["protected input leak",nativeReceipt(5,5),true],
 ["protected parent leak",nativeReceipt(6,6),true],
 ["protected both leak",nativeReceipt(7,7),true],
 ["missing sentinel identity",nativeReceipt(0,0),true],
 ["unknown sibling identity",nativeReceipt(4,256),true],
 ["not-run sibling identity",nativeReceipt(4,257),true],
 ["unknown control identity",nativeReceipt(4,4,256),true],
 ["missing sibling identity field",missingSiblingIdentity,true],
 ["missing control identity field",missingControlIdentity,true],
 ["checker refusal",nativeReceipt(243),true],
 ["checker incomplete",nativeReceipt(255),true],
 ["control missing sentinel",nativeReceipt(4,4,4,true,0),true],
 ["sidecar rejected",nativeReceipt(4,4,4,false),true],
]as const)test(`C2 cleanup model: ${name} preserves primary assertion and leaves loaded DLL outside disposable run`,async()=>{
 const root=fs.mkdtempSync(path.join(process.env.CMSPARK_DATA_DIR!,"c2-lock-model-")),input=path.join(root,"inheritance");fs.mkdirSync(input)
 for(const f of["desktop-inheritance.node","desktop-inheritance.exe"])fs.writeFileSync(path.join(input,f),"inert-not-executable",{flag:"wx"})
 let loaded="",run="",launched=0,inspected=0,terminated=0,cleanup=0;const copies:string[]=[],receipts:string[]=[]
 const api={...fs,mkdtempSync:(prefix:string)=>{run=fs.mkdtempSync(prefix);return run},copyFileSync:(from:string,to:string,flags:number)=>{copies.push(path.basename(to));return fs.copyFileSync(from,to,flags)},rmSync:(directory:string,options:fs.RmOptions)=>{cleanup++;if(loaded.startsWith(directory+path.sep)){const e:any=Error("OWNED_MODELED_WINDOWS_IMAGE_LOCK");e.code="EPERM";throw e}return fs.rmSync(directory,options)}}
 const pathAPI={...path,resolve:(...args:string[])=>args.length===1&&args[0]==="dist/desktop-native/acceptance/inheritance"?input:path.resolve(...args)}
 const addon={launch:(file:string,cap:string,key:string,url:string,finish:(code:number)=>void)=>{launched++;assert.equal(file,path.join(run,"desktop-inheritance.exe"));assert.equal(cap,"01".repeat(16));assert.equal(key,"02".repeat(32));assert.equal(url,"ws://127.0.0.1:1/desktop");fs.writeFileSync(file+".handles","inert-sidecar",{flag:"wx"});setImmediate(()=>finish(0));return{terminate:()=>{terminated++}}},inspectOwned:()=>{inspected++;return observed}}
 const execute=new Function("fs","path","require","assert","ownedDirectoryIdentity","requireOwnedDirectory","requireInheritance","console",body)(api,pathAPI,(file:string)=>{loaded=file;assert.equal(path.basename(file),"desktop-inheritance.node");return addon},assert,ownedDirectoryIdentity,requireOwnedDirectory,requireInheritance,{log:(value:string)=>receipts.push(value)})
 try{
  let failure:any;try{await execute({signal:new AbortController().signal})}catch(error){failure=error}
  if(expectedFailure){assert.ok(failure);assert.equal(failure.code,"ERR_ASSERTION","Cleanup must not replace strict native criterion failure");assert.deepEqual(receipts,[])}else{assert.equal(failure,undefined);assert.equal(receipts.length,1);assert.equal(JSON.parse(receipts[0].slice("DESKTOP_480_INHERITANCE ".length)).protectedSiblingAbsent,true)}
  assert.equal(launched,1);assert.equal(inspected,1);assert.equal(terminated,1);assert.equal(cleanup,1);assert.equal(fs.existsSync(run),false);assert.equal(loaded,path.join(input,"desktop-inheritance.node"));assert.deepEqual(copies,["desktop-inheritance.exe"])
  for(const f of["desktop-inheritance.node","desktop-inheritance.exe"])assert.equal(fs.readFileSync(path.join(input,f),"utf8"),"inert-not-executable")
 }finally{fs.rmSync(root,{recursive:true,force:true})}
})
