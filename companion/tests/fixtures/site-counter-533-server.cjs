// Owned protocol integration child. Real lifecycle/auth/router/executor; keyless
// isolated config/data. No native tools or model/SSO/business requests.
const path=require('node:path');
const dist=process.env.CMSPARK_533_COMPILED_ROOT;
let busy;
(async()=>{
 const config=require(path.join(dist,'config.js'));await config.initDataDir();const c=config.getConfig();
 config.saveConfig({port:Number(process.env.CMSPARK_533_PORT),llm:{...c.llm,api_key:'',base_url:'http://127.0.0.1:9'},vision:{...c.vision,enabled:false},voice:{...c.voice,enabled:false},mcp:{enabled:false,servers:[]},acp:{...c.acp,enabled:false}});
 const server=require(path.join(dist,'server.js')),life=require(path.join(dist,'ws/lifecycle.js'));
 const memory=require(path.join(dist,'tool/site-op-memory.js')),router=require(path.join(dist,'message-router.js'));
 const tm=server.seedThreadManagerForTests(),skills=new(require(path.join(dist,'skills/skill-engine.js')).SkillEngine)();
 const thread=tm.create('Owned runtime counter','counter533-owned'),other=tm.create('Other runtime counter','counter533-other');
 for(let i=0;i<4;i++)memory.recordSiteOpFailure(thread.id,'click',{tabId:7,selector:'#real-missing'},undefined,'https://scope533.test:8443');
 memory.recordSiteOpFailure(other.id,'click',{tabId:7,selector:'#other'},undefined,'https://scope533.test:8443');
 life.bindWsLifecycle({createToolExecutor:server.createToolExecutor,handleSecurityConfirmationResponse:server.handleSecurityConfirmationResponse,
 initServices:async()=>{},getThreadManager:()=>tm,getSkillEngine:()=>skills,getHistoryStore:()=>({close(){}}),securityConfirmations:server.securityConfirmations,
 handleComputerTaskAbort:()=>{throw Error('OWNED_EFFECT_FORBIDDEN')},flipAllComputerTaskAborts:()=>0,probeChatModel:async()=>{},getMcpSessionId:server.getSessionIdForTests,
 clearMcpSession:()=>{},getActiveMcpSessions:()=>new Set(),activeTrayConfirmsByWs:new WeakMap()});
 await life.startServer();process.send?.({type:'ready',thread_id:thread.id,other_thread_id:other.id});
 process.on('message',msg=>{
  if(msg.type==='stats')process.send?.({type:'stats',id:msg.id,count:memory.getOriginFailCount(thread.id,'https://scope533.test:8443'),other_count:memory.getOriginFailCount(other.id,'https://scope533.test:8443'),authenticated:[...life.getWsClients()].filter(ws=>life.getWsAuthState(ws)?.authenticated===true).length});
  if(msg.type==='busy'){if(msg.active)busy=router.installKickAbortController(thread.id);else{router.releaseKickAbortController(thread.id,busy);busy=undefined}process.send?.({type:'busy',id:msg.id,active:!!busy})}
 });
})().catch(()=>{process.send?.({type:'failed',code:'OWNED_SERVER_FAILED'});process.exitCode=1});
