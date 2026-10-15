const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),net=require('node:net');
if(!process.env.CMSPARK_DATA_DIR||!process.env.CMSPARK_521_ROOT)throw Error('OWNED_NAMESPACE_REQUIRED');
const effects={process:0,network:0,issuer:0};for(const k of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[k]=()=>{effects.process++;throw Error('OWNED_HOST_PROCESS_FORBIDDEN')};net.Socket.prototype.connect=function(){effects.network++;throw Error('OWNED_OUTBOUND_NETWORK_FORBIDDEN')};
(async()=>{const dist=path.join(process.env.CMSPARK_521_ROOT,'companion/.test-dist/src'),cfg=require(dist+'/config');await cfg.initDataDir();const current=cfg.getConfig();cfg.saveConfig({port:Number(process.env.CMSPARK_521_PORT),llm:{...current.llm,api_key:'',base_url:'http://127.0.0.1:9'},vision:{...current.vision,enabled:false},voice:{...current.voice,enabled:false,modelRootDir:path.join(process.env.CMSPARK_DATA_DIR,'models')},mcp:{enabled:false,servers:{}},security:{...current.security,auto_approve_dangerous:false,auto_approve_enterprise_tools:false,allow_all_schemes:false}});
 const life=require(dist+'/ws/lifecycle');let captured;const bind=life.bindWsLifecycle;life.bindWsLifecycle=d=>{captured=d;bind(d)};const srv=require(dist+'/server');life.bindWsLifecycle=bind;if(!captured)throw Error('OWNED_BIND_REQUIRED');const tm=srv.seedThreadManagerForTests(),{SkillEngine}=require(dist+'/skills/skill-engine'),skills=new SkillEngine();
 bind({...captured,initServices:async()=>{},getThreadManager:()=>tm,getSkillEngine:()=>skills,getHistoryStore:()=>({close(){}}),probeChatModel:async()=>{}});
 const {SecurityPolicy}=require(dist+'/security-policy');for(const k of ['issueToken','issueTokenFor'])SecurityPolicy.prototype[k]=()=>{effects.issuer++;throw Error('OWNED_ISSUER_FORBIDDEN')};
 const a=tm.create('OWNED521_A'),b=tm.create('OWNED521_B'),{bindChatEvidenceScope}=require(dist+'/business-evidence/chat-scope'),{tryParseToolArgs}=require(dist+'/bridge/tool-schemas');await life.startServer();
 process.send?.({type:'ready',secret:require(dist+'/ws-auth').getOrCreateSharedSecret()});let peer,lastExecutor;const contexts=new Map();
 process.on('message',async m=>{try{
  const peers=[...life.getWsClients()].filter(w=>life.getWsAuthState(w)?.authenticated===true);const ext=peers.find(w=>/^chrome-extension:\/\//.test(life.getWsAuthState(w)?.origin||''));
  if(m.type==='stats'){process.send?.({id:m.id,authenticatedPeers:peers.length,extensionOriginOnly:peers.every(w=>/^chrome-extension:\/\//.test(life.getWsAuthState(w)?.origin||'')),pending:srv.pendingToolCalls.size,confirmations:srv.securityConfirmations.pendingCount(),effects});return}
  if(m.type!=='tool'||!ext)throw Error('OWNED_AUTHENTICATED_PEER_REQUIRED');
  if(peer!==ext){peer=ext;lastExecutor=srv.createToolExecutor(ext);contexts.clear();contexts.set('A',bindChatEvidenceScope(lastExecutor,a.id));contexts.set('B',bindChatEvidenceScope(lastExecutor,b.id));}
  const parsed=tryParseToolArgs(m.name,m.args);if(!parsed.ok){process.send?.({id:m.id,result:{success:false,error_code:'OWNED_SCHEMA_REFUSED'}});return}
  const run=m.owner==='none'?lastExecutor:contexts.get(m.owner||'A');if(!run)throw Error('OWNED_OWNER_REQUIRED');
  const args=m.spoof?{...parsed.args,__thread_id:a.id,locator_scope:{scope_id:'a'.repeat(64),thread_id:a.id}}:parsed.args;
  const result=await run('owned521-'+m.id,m.name,args);process.send?.({id:m.id,result});
 }catch{process.send?.({id:m.id,failed:'OWNED_SERVER_FIXTURE_FAILED'})}})
})().catch(()=>{process.send?.({type:'failed',fixed:'OWNED_SERVER_START_FAILED'});process.exitCode=1});
