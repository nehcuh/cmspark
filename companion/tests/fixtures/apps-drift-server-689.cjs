// Actual loopback lifecycle/HMAC/router, synthetic inert measurement/Hello only.
const path=require('node:path'),assert=require('node:assert/strict');
const dist=process.env.CMSPARK_689_COMPILED_ROOT;
(async()=>{
 const config=require(path.join(dist,'config.js'));await config.initDataDir();const c=config.getConfig();
 const token='win.app.drift689',pin='a'.repeat(64);
 config.saveConfig({port:Number(process.env.CMSPARK_689_PORT),llm:{...c.llm,api_key:'',base_url:'http://127.0.0.1:9'},vision:{...c.vision,enabled:false},voice:{...c.voice,enabled:false},mcp:{enabled:false,servers:[]},acp:{...c.acp,enabled:false},apps:{enabled:true,entries:{[token]:{token,kind:'gui',source:'user',display_name:'Owned inert 689',policy:'auto',enabled:true,added_at:'2026-10-17',exe:{path:'C:\\Owned\\inert.exe',sha256:pin,signer:'CN=Owned inert',user_writable_dir:false}}}}});
 const server=require(path.join(dist,'server.js')),life=require(path.join(dist,'ws/lifecycle.js'));
 const tm=server.seedThreadManagerForTests(),skills=new(require(path.join(dist,'skills/skill-engine.js')).SkillEngine)();
 life.bindWsLifecycle({createToolExecutor:server.createToolExecutor,handleSecurityConfirmationResponse:server.handleSecurityConfirmationResponse,
 initServices:async()=>{},getThreadManager:()=>tm,getSkillEngine:()=>skills,getHistoryStore:()=>({close(){}}),securityConfirmations:server.securityConfirmations,
 handleComputerTaskAbort:()=>{throw Error('NO_EFFECT')},flipAllComputerTaskAborts:()=>0,probeChatModel:async()=>{},getMcpSessionId:server.getSessionIdForTests,
 clearMcpSession:()=>{},getActiveMcpSessions:()=>new Set(),activeTrayConfirmsByWs:new WeakMap()});
 const http=require('node:http'),create=http.createServer;let owned,listen,reject;
 const ready=new Promise((r,j)=>{listen=r;reject=j});
 http.createServer=function(...args){assert.equal(owned,undefined);owned=create.apply(this,args);owned.once('listening',listen);owned.once('error',reject);return owned};
 try{await life.startServer();await ready}finally{http.createServer=create}
 let measures=0,gates=0,effects=0,held=false,release;
 const cp=require('node:child_process');for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=()=>{effects++;throw Error('NO_NATIVE_EFFECT')};
 require('node:os').platform=()=> 'win32';
 require(path.join(dist,'apps/binary-drift-files.js')).measureAppBinary=async(_entry,check)=>{measures++;check();return{sha256:'b'.repeat(64),signer:'CN=Owned inert',userWritable:false,recheck:check}};
 require(path.join(dist,'apps/biometric-gate.js')).requireAppsBiometric=async()=>{gates++;if(held){process.send?.({type:'gate-entered'});await new Promise(r=>release=r)}return{approved:true,method:'windows-hello',nonce:'INERT_SOFTWARE_ONLY'}};
 process.on('message',m=>{if(m.type==='hold'){held=m.active;process.send?.({type:'hold',id:m.id})}if(m.type==='release'){held=false;release?.();process.send?.({type:'release',id:m.id})}if(m.type==='stats'){const e=config.getConfig().apps.entries[token];process.send?.({type:'stats',id:m.id,policy:e.policy,pin:e.exe.sha256,record:!!e.binary_drift,measures,gates,effects})}});
 process.send?.({type:'ready'});
})().catch(()=>{process.send?.({type:'failed',code:'OWNED_SERVER_FAILED'});process.exitCode=1});
