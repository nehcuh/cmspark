// Controlled PowerShell boundary -> real enumerate/parser/handler -> serialized response.
// Synthetic metadata only; not a Registry inventory or native Windows receipt.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cmspark-apps-record-644-'));
process.env.CMSPARK_DATA_DIR=directory;
const root=path.resolve(__dirname,'../..');
const {enumerateAppsDetailed}=require(path.join(root,'.test-dist/src/apps/enumerate.js'));
const {handleAppsMessage}=require(path.join(root,'.test-dist/src/apps/handlers.js'));
const {initDataDir,getConfig}=require(path.join(root,'.test-dist/src/config.js'));
(async()=>{
 await initDataDir();const before=JSON.stringify(getConfig().apps),rows=[
  {name:'Owned Normal',source:'registry',path:'C:\\Owned644\\Normal.exe'},
  {name:'Owned CMD',source:'registry',path:'C:\\Owned644\\cmd.exe'}];
 const shapes={complete:{apps:rows,registry_summary:{status:'complete',reasons:[]}},
  partial:{apps:rows,registry_summary:{status:'partial',reasons:['VALUE_LIMIT']}},
  zero:{apps:[],registry_summary:{status:'partial',reasons:['OUTPUT_LIMIT']}},
  unavailable:{apps:[],registry_summary:{status:'unavailable',reasons:['ACCESS_DENIED']}},
  legacy:{apps:[{name:'Owned Start',source:'startapps',aumid:'Owned644!Start'}]},
  malformed:{apps:[],registry_summary:{status:'partial',reasons:['RAW_UNTRUSTED_REASON']}}};
 const payloads={};for(const [key,shape] of Object.entries(shapes)){
  payloads[key]=JSON.parse(JSON.stringify(await handleAppsMessage({type:'apps.enumerate'},{},{platform:'win32',enumerateDetailed:()=>enumerateAppsDetailed(async()=>JSON.stringify(shape))})));
 }
 if(JSON.stringify(getConfig().apps)!==before)throw new Error('OWNED_ENUMERATION_MUTATED_CONFIG');
 process.stdout.write(JSON.stringify({boundary:'controlled-PsRunner;real-parser-handler-JSON',payloads}));
})().catch(()=>{process.stderr.write('OWNED_RECORDING_FAILED\n');process.exitCode=1}).finally(()=>fs.rmSync(directory,{recursive:true,force:true}));
