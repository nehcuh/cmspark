// Actual BrowserBridge bundled from source. Chrome read API is explicitly
// controlled; effect APIs trap. This is not native Chrome/context ownership proof.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
exports.loadOwnedCounterBridge=repo=>{
 const owned=fs.mkdtempSync(path.join(os.tmpdir(),'cmspark-533-bridge-'));const output=path.join(owned,'bridge.cjs');
 fs.symlinkSync(path.join(repo,'companion/node_modules'),path.join(owned,'node_modules'),'dir');
 require(path.join(repo,'companion/node_modules/esbuild')).buildSync({entryPoints:[path.join(repo,'chrome-extension/src/background/browser-bridge.ts')],bundle:true,platform:'node',format:'cjs',packages:'external',outfile:output,logLevel:'silent'});
 const ts=require(path.join(repo,'companion/node_modules/typescript'));
 const file=path.join(repo,'chrome-extension/src/background/index.ts'),source=fs.readFileSync(file,'utf8'),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 let exact;
 const walk=node=>{if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.name.text==='send'){
  const obj=node.arguments[0];if(obj&&ts.isObjectLiteralExpression(obj)&&obj.properties.some(p=>p.name?.getText(ast)==='type'&&p.initializer?.text==='tool.result')&&obj.properties.some(p=>p.name?.getText(ast)==='result'))exact=node.getText(ast);
 }ts.forEachChild(node,walk)};walk(ast);if(!exact)throw Error('ACTUAL_TOOL_RESULT_PRODUCER_MISSING');
 const forwardResult=new Function('msg','result','wsClient',exact);
 const previous=global.chrome,state={active:7,url:'https://scope533.test:8443/path?private=synthetic#route',queries:0,gets:0,effects:0,mutateAfterQuery:undefined};
 const effect=()=>{state.effects++;throw Error('OWNED_EFFECT_FORBIDDEN')};
 const event={addListener(){},removeListener(){}};
 global.chrome={runtime:{id:'owned533'},storage:{local:{get:async()=>({enterprise_profile_id:'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa'}),set:async()=>{}}},debugger:{onDetach:event,attach:effect,detach:effect,sendCommand:effect},scripting:{executeScript:effect},tabs:{get:async id=>{state.gets++;return {id,url:state.url}},query:async()=>{state.queries++;state.mutateAfterQuery?.(state.queries);return [{id:state.active,url:state.url,active:true}]}}};
 const bridge=new(require(output).BrowserBridge)();
 return {bridge,state,forwardResult,close(){global.chrome=previous;fs.rmSync(owned,{recursive:true,force:true})}};
};
