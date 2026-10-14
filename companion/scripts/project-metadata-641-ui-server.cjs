// Actual router, canonical disk store and actual authenticated summoner HTML. Owned fixture only.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),net=require('node:net');
const out=process.argv[2],data=path.join(out,'data');fs.mkdirSync(data,{recursive:true,mode:0o700});
process.env.CMSPARK_DATA_DIR=data;process.env.CMSPARK_SKIP_LOGIN_ENV='1';process.env.HOME=out;
let stopped=false,server,summoner;const receipts=[];let held=[],hold=false;
async function free(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p}
(async()=>{
 const config=require('../.test-dist/src/config.js');await config.initDataDir();
 const {ThreadManager}=require('../.test-dist/src/threads/thread-manager.js');let tm=new ThreadManager();
 const router=require('../.test-dist/src/message-router.js');require('../.test-dist/src/threads/project-activity.js').bindProjectConfirmationProbe(()=>0);
 const owner=tm.create('OWNED_THREAD_A','owned641A'),other=tm.create('OWNED_THREAD_B','owned641B');tm.update(owner.id,{user_tags:['original'],topic_folder:'manual'});
 const call=async(msg,surface='panel')=>{const response=await router.handleMessage(msg,{threadManager:tm},{surface,sendToExtension(){},executeTool:async()=>({success:false})});receipts.push({surface,request:msg,response});return response};
 summoner=require('../.test-dist/src/summoner-web.js');const web=await summoner.startSummonerWebServer({preferredPort:await free(),dispatch:msg=>call(msg,'summoner'),attachChrome:()=> 'OWNED_NOT_STARTED',hasExtensionPeer:()=>false});
 const reply=(res,value)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value))};
 server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname==='/fixture/threads'){reply(res,await call({type:'thread.list'}));return}
   let body='';for await(const chunk of req){body+=chunk;if(body.length>65536)throw Error('BODY_LIMIT')}
   if(url.pathname==='/fixture/control'){
    const control=JSON.parse(body||'{}');if(control.hold!==undefined)hold=control.hold===true;
    if(control.release){const pending=held;held=[];pending.forEach(fn=>fn())}
    if(control.busy!==undefined)router.__testSetLlmActiveForTests(owner.id,control.busy===true);
    if(control.confirmationCount!==undefined)require('../.test-dist/src/threads/project-activity.js').bindProjectConfirmationProbe(()=>control.confirmationCount);
    if(control.conflict){await call({type:'project.create',name:'OWNED_CONCURRENT',user_gesture:true,operation_id:require('node:crypto').randomUUID(),expected_revision:tm.projects.list().revision})}
    if(control.restart)tm=new ThreadManager();
    reply(res,{ok:true});return;
   }
   if(url.pathname==='/fixture/rpc'){
    const message=JSON.parse(body);if(!['project.list','project.create','project.rename','project.archive','project.restore','thread.project.set','thread.create','thread.select'].includes(message.type))throw Error('METHOD');
    const response=await call(message);const frame={...response,id:message.id};
    if(hold&&message.type==='thread.project.set')held.push(()=>reply(res,frame));else reply(res,frame);return;
   }
   const file=url.pathname==='/'?'index.html':url.pathname==='/app.js'?'app.js':null;
   if(!file){res.statusCode=404;res.end();return}res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':'text/html');res.end(fs.readFileSync(path.join(out,file)));
  }catch{res.statusCode=400;reply(res,{type:'project.error',error:'OWNED_FIXTURE_REQUEST_FAILED'})}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 // Auth material is in this restricted ephemeral file only, never stdout/screenshots/review receipts.
 fs.writeFileSync(path.join(out,'private-ui-endpoints.json'),JSON.stringify({react:'http://127.0.0.1:'+server.address().port+'/',summoner:'http://127.0.0.1:'+web.port+'/',owned_cookie:web.token}),{mode:0o600});
 fs.writeFileSync(path.join(out,'ready'),'ready');
})().catch(()=>{console.error('OWNED_UI_SETUP_FAILED');process.exitCode=1;shutdown()});
function shutdown(){if(stopped)return;stopped=true;fs.writeFileSync(path.join(out,'actual-router-receipts.json'),JSON.stringify(receipts,null,2));summoner?.stopSummonerWebServer();server?.close();setTimeout(()=>process.exit(process.exitCode||0),50).unref()}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
