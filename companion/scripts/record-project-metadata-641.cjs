// Capture actual router outputs under owned synthetic data; never reads personal config.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cmspark-project-641-record-'));
process.env.CMSPARK_DATA_DIR=root;process.env.CMSPARK_SKIP_LOGIN_ENV='1';process.env.HOME=root;
(async()=>{
 try {
  const config=require('../.test-dist/src/config.js');await config.initDataDir();
  const {ThreadManager}=require('../.test-dist/src/threads/thread-manager.js');const tm=new ThreadManager();
  require('../.test-dist/src/threads/project-activity.js').bindProjectConfirmationProbe(()=>0);
  const {handleMessage}=require('../.test-dist/src/message-router.js');
  const session={surface:'panel',sendToExtension(){},executeTool:async()=>({success:false})};
  const call=(type,fields={})=>handleMessage({type,...fields},{threadManager:tm},session);
  const operation=(revision,fields)=>({operation_id:crypto.randomUUID(),expected_revision:revision,user_gesture:true,...fields});
  const createRequest=operation(0,{name:'OWNED_RECORDED_PROJECT'}),created=await call('project.create',createRequest);
  const thread=tm.create('OWNED_RECORDED_THREAD'),bindRequest=operation(created.revision,{thread_id:thread.id,project_id:created.project.id});
  const bound=await call('thread.project.set',bindRequest),state=await call('project.list');
  const refused=await call('project.rename',operation(0,{project_id:created.project.id,name:'STALE'}));
  const receipt={source:'actual handleMessage JSON roundtrip; isolated synthetic names, no guessed payload keys',createRequest,bindRequest,created,bound,state,refused};
  fs.writeFileSync(process.argv[2],JSON.stringify(receipt,null,2)+'\n');
 } finally {fs.rmSync(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e.code||'OWNED_CAPTURE_FAILED');process.exitCode=1});
