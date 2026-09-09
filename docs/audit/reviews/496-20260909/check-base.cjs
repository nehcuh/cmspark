const fs=require('fs'),path=require('path'),cp=require('child_process');
const ts=require(path.resolve('companion/node_modules/typescript'));
const compiled='companion/.test-dist/src/server.js',saved=fs.readFileSync(compiled);
const base=cp.execFileSync('git',['show','719890f4f160aef9b62b83d7eafa72e5a7b5dae8:companion/src/server.ts'],{encoding:'utf8'});
try{
 fs.writeFileSync(compiled,ts.transpileModule(base,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText);
 const result=cp.spawnSync('uv',['run','--no-project','--with','playwright','python','chrome-extension/scripts/test-chat-run-ui.py'],{encoding:'utf8'});
 fs.writeFileSync('.omx/artifacts/chat-run-496/browser-red.log',result.stdout+result.stderr);
 if(result.status!==1 || !result.stderr.includes('completed attachment run must be idle')) throw new Error('Base did not fail at the expected regression assertion');
 console.log('Confirmed base UI reproduction fails: completed attachment run remains busy.');
}finally{fs.writeFileSync(compiled,saved)}
