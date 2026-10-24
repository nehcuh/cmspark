/** Real locked bundle and emitted factory expressions; no browser/native runtime. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {createHash} from 'node:crypto'
import ts from 'typescript'
const {transformXtermStyleNonce,XTERM_VERSION,XTERM_BYTES,XTERM_SHA256}=require('../../scripts/desktop-xterm-style-nonce.cjs')
const original=fs.readFileSync(require.resolve('@xterm/xterm'))
const transformed:Buffer=transformXtermStyleNonce(original,XTERM_VERSION)
const source=transformed.toString('utf8'),ast=ts.createSourceFile('terminal-core.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
const factories:string[]=[]
function walk(n:ts.Node){
 if(ts.isCallExpression(n)&&ts.isParenthesizedExpression(n.expression)&&ts.isArrowFunction(n.expression.expression)){
  const arrow=n.expression.expression
  if(arrow.parameters.length===1&&arrow.parameters[0].name.getText(ast)==='d'&&arrow.body.getText(ast).startsWith('{const e=d.createElement("style"),m=d.querySelectorAll('))factories.push(n.getText(ast))
 }
 ts.forEachChild(n,walk)
}walk(ast)
const expressions=['s.mainDocument.createElement("style")','this._document.createElement("style")','document.createElement("style")']
function fixture(expression:string,values:unknown[]){
 const created:any[]=[],counts={receiver:0,create:0,meta:0}
 const doc={createElement(this:unknown,name:string){assert.equal(this,doc);assert.equal(name,'style');counts.create++;const element={nonce:''};created.push(element);return element},querySelectorAll(this:unknown,query:string){assert.equal(this,doc);assert.equal(query,'meta[name="cmspark-style-nonce"]');counts.meta++;return values.map(content=>({content}))}}
 const s={get mainDocument(){counts.receiver++;return doc}},self={get _document(){counts.receiver++;return doc}},scope={s,document:doc,Error}
 const result=()=>vm.runInNewContext('(function(){return '+expression+'}).call(thisValue)',{...scope,thisValue:self})
 return{result,created,counts,doc}
}
test('locked actual vendor has exactly four intended style factory sites and outside bytes invert exactly',()=>{
 assert.equal(original.length,XTERM_BYTES);assert.equal(createHash('sha256').update(original).digest('hex'),XTERM_SHA256);assert.equal(factories.length,4)
 let inverse=source
 for(const f of factories){const call=ts.createSourceFile('factory.js',f,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS).statements[0]as ts.ExpressionStatement;const expr=call.expression as ts.CallExpression;const receiver=expr.arguments[0].getText();assert.ok(['s.mainDocument','this._document','document'].includes(receiver));inverse=inverse.replace(f,receiver+'.createElement("style")').replace('/*CMSPARK_STYLE_NONCE_476*/','')}
 assert.equal(inverse,original.toString('utf8'))
 assert.equal(source.includes('unsafe-inline'),original.toString('utf8').includes('unsafe-inline'))
})
for(const [i,f]of factories.entries())test('actual emitted style factory preserves receiver and element '+i,()=>{
 const run=fixture(f,['a'.repeat(64)]),element=run.result();assert.equal(element,run.created[0]);assert.equal(element.nonce,'a'.repeat(64));assert.equal(run.counts.create,1);assert.equal(run.counts.meta,1);assert.equal(run.counts.receiver,f.endsWith('(document)')?0:1)
})
for(const [i,f]of factories.entries())for(const values of [[],['a'.repeat(64),'b'.repeat(64)],[''],['A'.repeat(64)],['a'.repeat(63)],['a'.repeat(65)],['OWNED_NONCE_SENTINEL'],[null],[3],[{}]])test('actual emitted factory refuses unavailable meta without reflection '+i+'/'+JSON.stringify(values),()=>{
 const run=fixture(f,values);assert.throws(run.result,e=>e instanceof Error&&e.message==='XTERM_STYLE_NONCE_UNAVAILABLE');assert.equal(run.counts.create,1);assert.equal(run.created[0].nonce,'');assert.equal(run.counts.meta,1)
})
test('distinct documents receive their own nonce without globals or cross-document caching',()=>{
 for(const f of factories){const a=fixture(f,['1'.repeat(64)]),b=fixture(f,['2'.repeat(64)]);assert.equal(a.result().nonce,'1'.repeat(64));assert.equal(b.result().nonce,'2'.repeat(64));assert.equal(a.doc.createElement.toString(),b.doc.createElement.toString())}
})
test('unsupported vendor version/length/same-size drift and second transformation refuse before output',()=>{
 const changed=Buffer.from(original);changed[changed.length-2]^=1
 for(const [body,version]of [[original,'5.5.0'],[original,'6.0.1'],[original.toString(),'6.0.0'],[original.subarray(1),'6.0.0'],[changed,'6.0.0'],[transformed,'6.0.0']])assert.throws(()=>transformXtermStyleNonce(body,version),/^Error: XTERM_STYLE_VENDOR_MISMATCH$/)
})
test('actual original viewport/global style sites bypass a Document override',()=>{
 const override={createElement:()=>({nonce:'OVERRIDE'})},bare=fixture('document.createElement("style")',[]);assert.equal(bare.result().nonce,'')
 const originalAst=ts.createSourceFile('original.js',original.toString(),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);let precedence:ts.Node|undefined
 function find(n:ts.Node){if(ts.isConditionalExpression(n)&&n.condition.getText(originalAst).includes('this._document??')&&n.whenTrue.getText(originalAst)==='window.document')precedence=n;ts.forEachChild(n,find)}find(originalAst);assert.ok(precedence)
 const actual=vm.runInNewContext('(function(){return '+precedence!.getText(originalAst)+'}).call(owned)',{owned:{_document:override},window:{document:bare.doc}});assert.equal(actual,bare.doc)
 assert.equal(expressions.length,3)
})
