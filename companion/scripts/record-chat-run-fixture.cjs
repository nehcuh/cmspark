// Capture production executor, chat adapter and thread.select frames with isolated data.
const fs=require('fs'),path=require('path'),os=require('os');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'cmspark-496-capture-'));
process.env.CMSPARK_DATA_DIR=root;
const base=path.resolve(__dirname,'../.test-dist/src');
const {createToolExecutor,handleToolResult,seedExtensionWsAuthForTests}=require(base+'/server.js');
const {resolveBrowserSiteTarget}=require(base+'/site-context/browser-resolver.js');
const {siteTargetFromBrowser}=require(base+'/site-context/target.js');
const {chatCreate}=require(base+'/llm/adapter.js');
const {handleMessage}=require(base+'/message-router.js');
const {ThreadManager}=require(base+'/threads/thread-manager.js');
const {SkillEngine}=require(base+'/skills/skill-engine.js');
const OpenAI=require('openai').default;
(async()=>{
 await require(base+'/config.js').initDataDir();
 const manager=new ThreadManager(),engine=new SkillEngine();engine.bindThreadManager(manager);
 const a=manager.create('附件对话','thread-496-a'),b=manager.create('新对话','thread-496-b');
 const frames=[];const ws={readyState:1,send(raw){const frame=JSON.parse(raw);frames.push(frame);if(frame.type==='tool.execute')queueMicrotask(()=>handleToolResult({tool_call_id:frame.tool_call_id,result:{success:true,data:{site_target:siteTargetFromBrowser(17,'https://example.com/change',Date.now())}}},ws))}};
 seedExtensionWsAuthForTests(ws);const execute=createToolExecutor(ws);
 const proto=Object.getPrototypeOf(new OpenAI({apiKey:'synthetic'}).chat.completions),original=proto.create;
 proto.create=async()=> (async function*(){yield{choices:[{delta:{content:'附件已读取，测试完成。'}}]};yield{choices:[{delta:{},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}})();
 try{
 await chatCreate({threadId:a.id,message:'读取测试附件',fileContents:[{filename:'synthetic.txt',content:'Synthetic attachment for regression testing.'}],skillIds:[],knowledgeIds:[],siteContextTabId:17,contextSelection:{kind:'thread',skillMode:'auto',knowledgeMode:'auto'},resolveSiteTarget:(id,signal)=>resolveBrowserSiteTarget(execute,a.id,id,signal),config:{base_url:'http://localhost:9999',api_key:'synthetic',model_name:'synthetic',temperature:0,context_window:128000},threadManager:manager,skillEngine:engine,historyStore:{record:()=>0},sendToExtension:frame=>frames.push(frame),executeTool:execute});
 const select=await handleMessage({type:'thread.select',thread_id:a.id},{threadManager:manager,skillEngine:engine,historyStore:{record:()=>0}});
 fs.writeFileSync(process.argv[2],JSON.stringify({threads:[a,b],frames,select},null,2));
 }finally{proto.create=original}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>fs.rmSync(root,{recursive:true,force:true}));
