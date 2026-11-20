'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.resolve(__dirname,'../..'),ts=require(require.resolve('typescript',{paths:[path.join(root,'companion')]}));
const source=fs.readFileSync(path.join(root,'chrome-extension/src/background/index.ts'),'utf8');
const ast=ts.createSourceFile('background.ts',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const normSource=fs.readFileSync(path.join(root,'chrome-extension/src/sidepanel/utils/normalize-config.ts'),'utf8');
const normAst=ts.createSourceFile('normalize-config.ts',normSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
const budgetNormalizer=normAst.statements.filter(n=>
 (ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(normAst)==='CHAT_OUTPUT_LIMIT_MAX'))||
 (ts.isFunctionDeclaration(n)&&n.name?.text==='normalizeSavedChatOutputLimit')
);
assert.equal(budgetNormalizer.length,2);
const budgetSource=budgetNormalizer.map(n=>n.getText(normAst).replace(/^export /,'')).join('\n');
function only(predicate){const matches=[];function visit(n){if(predicate(n))matches.push(n);ts.forEachChild(n,visit)}visit(ast);assert.equal(matches.length,1);return matches[0]}
const save=only(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='saveExtensionConfig').getText(ast);
const send=only(n=>ts.isCaseClause(n)&&n.expression.getText(ast)==='"config.set"').statements.map(n=>n.getText(ast)).join('\n');
const hydrate=only(n=>ts.isIfStatement(n)&&n.expression.getText(ast)==='msg.type === "config.updated"'&&n.thenStatement.getText(ast).includes('saveExtensionConfig(')).getText(ast);
const wsSource=fs.readFileSync(path.join(root,'chrome-extension/src/background/ws-client.ts'),'utf8'),wsAst=ts.createSourceFile('ws-client.ts',wsSource,ts.ScriptTarget.Latest,true);
const wsClass=wsAst.statements.find(n=>ts.isClassDeclaration(n)&&n.name?.text==='WSClient');assert.ok(wsClass);
const wsMethods=wsClass.members.filter(n=>ts.isMethodDeclaration(n)&&['send','desktopBrowserConnectionCurrent'].includes(n.name.getText(wsAst)));assert.equal(wsMethods.length,2);
function fixture(mode){
 const text=`${budgetSource};class ActualWS {${wsMethods.map(n=>n.getText(wsAst)).join("\n")}};let extensionConfig={base_url:'https://original.invalid',model_name:'original',max_tokens:64000},reply;const writes=[],frames=[];const chrome={storage:{local:{set(value){writes.push(value)}}}},WebSocket={OPEN:1,CONNECTING:0};let wsClient=${mode==='missing'?'null':`new ActualWS()`};if(wsClient){wsClient.unpaired=false;wsClient.authenticated=${mode==='open'};wsClient.pending=[];wsClient.ws=${mode==='disconnected'?'null':`{readyState:1,send(value){frames.push(value)}}`}};${save};function send(message){reply=undefined;function sendResponse(value){reply=value}switch(message.type){case 'config.set':${send}}};function receive(msg){${hydrate}};globalThis.fixture={send,receive,writes,frames,wsClient,get:()=>extensionConfig,reply:()=>reply}`;
 const realm={};vm.runInNewContext(ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,realm);return realm.fixture;
}
for(const mode of ['missing','disconnected','handshake','open']) test(`actual ${mode} send preserves cache until authoritative update`,()=>{
 const f=fixture(mode);f.send({type:'config.set',config:{model_name:'uncommitted',api_key:'private-test-key'}});assert.equal(f.reply().ok,mode==='handshake'||mode==='open');if(mode==='handshake')assert.equal(f.wsClient.pending.length,1);if(mode==='open')assert.equal(f.frames.length,1);assert.equal(f.writes.length,0);assert.equal(f.get().model_name,'original');f.receive({type:'config.updated',config:{llm:{model_name:'committed',api_key:'***'}}});assert.equal(f.writes.length,1);assert.equal(f.get().model_name,'committed');assert.equal(JSON.stringify(f.writes).includes('private-test-key'),false)
});

test('only the authoritative update replaces the cached output budget',()=>{
 const f=fixture('open');
 f.send({type:'config.set',config:{max_tokens:32000}});
 assert.equal(JSON.parse(f.frames[0]).config.max_tokens,32000);
 assert.equal(f.get().max_tokens,64000);
 assert.equal(f.writes.length,0);
 for(const [input,expected] of [[500000,393216],[1000.5,1000],[0,0]]){
  f.receive({type:'config.updated',config:{llm:{max_tokens:input}}});
  assert.equal(f.get().max_tokens,expected);
  assert.equal(f.writes.at(-1).extensionConfig.max_tokens,expected);
 }
});

test('actual config forward preserves bounded request id and revision without treating send as persistence',()=>{
 const f=fixture('open');f.send({type:'config.set',id:'owned-request-1',config_revision:'owned-epoch:7',config:{model_name:'candidate'}});
 assert.equal(f.reply().ok,true);assert.equal(f.frames.length,1);
 const frame=JSON.parse(f.frames[0]);assert.equal(frame.id,'owned-request-1');assert.equal(frame.config_revision,'owned-epoch:7');
 assert.equal(f.writes.length,0);assert.equal(f.get().model_name,'original');
});

for(const fields of [{id:'invalid id'},{id:42},{config_revision:''},{config_revision:'x'.repeat(129)}]) test('actual config forward rejects malformed correlation metadata',()=>{
 const f=fixture('open');f.send({type:'config.set',config:{model_name:'candidate'},...fields});
 assert.equal(f.reply().ok,false);assert.equal(f.frames.length,0);assert.equal(f.writes.length,0);
});

test('correlated draft save is refused during authentication instead of queued',()=>{
 const f=fixture('handshake');f.send({type:'config.set',id:'owned-request-2',config_revision:'owned-epoch:7',config:{model_name:'candidate'}});
 assert.equal(f.reply().ok,false);assert.equal(f.reply().error,'CONFIG_CONNECTION_NOT_READY');assert.equal(f.wsClient.pending.length,0);assert.equal(f.frames.length,0);
});
