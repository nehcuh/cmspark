// Bounded localhost test host; requires companion test compilation first.
const fs=require('fs'),path=require('path'),http=require('http');
const [fixture,dataDir,output]=process.argv.slice(2);
if(!fixture||!dataDir||!output)throw new Error('fixture, isolated data directory and evidence path required');
process.env.CMSPARK_DATA_DIR=dataDir;
const repo=path.resolve(__dirname,'../..');
const {handleMeetingMessage}=require(path.join(repo,'companion/.test-dist/src/meeting/meeting-handlers.js'));
const {generateMeetingMinutes}=require(path.join(repo,'companion/.test-dist/src/meeting/meeting-minutes.js'));
const {validateWsMessage}=require(path.join(repo,'companion/.test-dist/src/ws/validate.js'));
const traces=[];
const server=http.createServer(async(req,res)=>{
  if(req.method==='POST'&&req.url==='/rpc'){
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>15*1024*1024)throw new Error('fixture payload too large')}
      const {message,failWrite,failLlm}=JSON.parse(body);
      let response;
      const shape=validateWsMessage(message);
      if(!shape.valid)response={type:'error',error:shape.error};
      else if(failWrite&&['meeting.set_transcript','meeting.append_transcript','meeting.set_reference'].includes(message.type))response={type:'meeting.error',code:'fixture_write_denied',message:'合成保存失败'};
      else response=await handleMeetingMessage(message,{origin:'chrome-extension://abcdefghijklmnopqrstuvwxyz'},{
        getLlmConfig:()=>failLlm?null:{base_url:'https://unused.invalid',api_key:'synthetic-unused',model_name:'synthetic'},
        generate:params=>generateMeetingMinutes({...params,extract:async options=>{
          traces.push({llmBoundary:{systemPrompt:options.systemPrompt,userContent:options.userContent}});
          if(params.referenceNotes?.trim())return JSON.stringify({minutes_md:'### TL;DR\n讨论 Python 发布。\n### 决议\n未明确。\n### 待办\n- [ ] 待确认负责人。\n### 风险 / 开放问题\n笔记与录音须核对。',corrections:[{original:'配森',replacement:'Python',reference_excerpt:'Python',reason:'参考笔记中的项目术语'}],conflicts:[],reference_supplements:[]});
          return '### TL;DR\n合成测试会议。\n### 决议\n未明确。\n### 待办\n- [ ] 待确认。\n### 风险 / 开放问题\n无明确负责人。';
        }})
      });
      const frame={...response,id:message.id};traces.push({request:message,response:frame});fs.writeFileSync(output,JSON.stringify(traces,null,2));
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(frame));
    }catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}))}return;
  }
  const file=req.url==='/app.js'?'app.js':req.url==='/'?'index.html':null;
  if(!file){res.writeHead(404);res.end();return}
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});res.end(fs.readFileSync(path.join(fixture,file)));
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
