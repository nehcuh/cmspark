// Bounded localhost test host; requires companion test compilation first.
const fs=require('fs'),path=require('path'),http=require('http');
const [fixture,dataDir,output]=process.argv.slice(2);
if(!fixture||!dataDir||!output)throw new Error('fixture, isolated data directory and evidence path required');
process.env.CMSPARK_DATA_DIR=dataDir;
fs.mkdirSync(dataDir,{recursive:true});
const repo=path.resolve(__dirname,'../..');
const {handleMeetingMessage}=require(path.join(repo,'companion/.test-dist/src/meeting/meeting-handlers.js'));
const {generateMeetingMinutes}=require(path.join(repo,'companion/.test-dist/src/meeting/meeting-minutes.js'));
const {validateWsMessage}=require(path.join(repo,'companion/.test-dist/src/ws/validate.js'));
const {setVoiceFields}=require(path.join(repo,'companion/.test-dist/src/config.js'));
const {SttSessionService}=require(path.join(repo,'companion/.test-dist/src/voice/stt-session-service.js'));
const {handleVoiceSttMessage}=require(path.join(repo,'companion/.test-dist/src/voice/stt-handlers.js'));
const {meetingPcmPong}=require(path.join(repo,'companion/.test-dist/src/voice/meeting-pcm-contract.js'));
setVoiceFields({sttEngine:'local',localModelId:'medium'});
let recognitions=[];
const modelRoot=path.join(dataDir,'fixture-model');
const service=new SttSessionService({dataDir,whisperRoot:modelRoot,
  probeModel:()=>({status:'ready'}),resolveModelPath:()=>path.join(modelRoot,'synthetic.bin'),
  resolveBinary:()=>({ok:true,path:'fixture-only',arch:'win32-x64',pinned:true,sha256:'synthetic'}),
  runWhisper:async()=>({text:recognitions.shift()||'',ms:1}),
});
const events=new Set();
const ctx={origin:'chrome-extension://abcdefghijklmnopqrstuvwxyz',peerId:'meeting-ui-fixture',surface:'panel',
  send:frame=>{for(const stream of events)stream.write(`data: ${JSON.stringify(frame)}\n\n`)}};
const traces=[];
let asrPosts=0;
const server=http.createServer(async(req,res)=>{
  if(req.url==='/events'&&req.method==='GET'){
    res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache'});
    res.write(': ready\n\n');events.add(res);res.on('close',()=>events.delete(res));return;
  }
  if(req.url==='/recognizer'&&req.method==='POST'){
    let body='';for await(const chunk of req)body+=chunk;
    recognitions=JSON.parse(body);res.writeHead(204);res.end();return;
  }
  if(req.method==='POST'&&req.url==='/v1/audio/transcriptions'){
    try{
      const chunks=[];let total=0;
      for await(const chunk of req){
        total+=chunk.length;
        if(total>2*1024*1024)throw new Error('fixture audio frame too large');
        chunks.push(chunk);
      }
      const request=new Request('http://127.0.0.1/v1/audio/transcriptions',{
        method:'POST',headers:{'Content-Type':req.headers['content-type']},body:Buffer.concat(chunks),
      });
      const form=await request.formData(),wav=form.get('file'),model=form.get('model');
      if(!(wav instanceof Blob)||model!=='fixture-whisper'||req.headers.authorization!=='Bearer synthetic-asr')throw new Error('unexpected fixture audio request');
      const data=Buffer.from(await wav.arrayBuffer());
      if(data.toString('ascii',0,4)!=='RIFF'||data.readUInt32LE(24)!==16000)throw new Error('expected canonical meeting WAV');
      const status=++asrPosts===1?200:429;
      traces.push({asrBoundary:{status,wavBytes:data.length,model}});
      fs.writeFileSync(output,JSON.stringify(traces,null,2));
      res.writeHead(status,{'Content-Type':'application/json'});
      res.end(JSON.stringify(status===200?{text:'第一段外部转写'}:{}));
    }catch(error){res.writeHead(400);res.end(JSON.stringify({error:error.message}))}
    return;
  }
  if(req.method==='POST'&&req.url==='/rpc'){
    try{
      let body='';for await(const chunk of req){body+=chunk;if(body.length>15*1024*1024)throw new Error('fixture payload too large')}
      const {message,failWrite,failLlm}=JSON.parse(body);
      let response;
      const shape=validateWsMessage(message);
      if(!shape.valid)response={type:'error',error:shape.error};
      else if(failWrite&&['meeting.set_transcript','meeting.append_transcript','meeting.set_reference'].includes(message.type))response={type:'meeting.error',code:'fixture_write_denied',message:'合成保存失败'};
      else if(message.type==='system.ping')response=meetingPcmPong();
      else if(message.queue_contract===1&&message.type.startsWith('voice.stt.'))response=await handleVoiceSttMessage(message,ctx,{service});
      else response=await handleMeetingMessage(message,ctx,{
        sttService:service,
        getLlmConfig:()=>failLlm?null:{base_url:'https://unused.invalid',api_key:'synthetic-unused',model_name:'synthetic'},
        generate:params=>generateMeetingMinutes({...params,extract:async options=>{
          traces.push({llmBoundary:{systemPrompt:options.systemPrompt,userContent:options.userContent}});
          if(params.referenceNotes?.trim())return JSON.stringify({minutes_md:'### TL;DR\n讨论 Python 发布。\n### 决议\n未明确。\n### 待办\n- [ ] 待确认负责人。\n### 风险 / 开放问题\n笔记与录音须核对。',corrections:[{original:'配森',replacement:'Python',reference_excerpt:'Python',reason:'参考笔记中的项目术语'}],conflicts:[],reference_supplements:[]});
          const excerpt=params.transcriptText.match(/^[^。\n]+。?/u)?.[0]?.trim();
          if(!excerpt)throw new Error('fixture expected a transcript sentence');
          return `### TL;DR\n- ${excerpt}\n### 决议\n无明确记录。\n### 待办\n无明确记录。\n### 风险 / 开放问题\n无明确记录。`;
        }})
      });
      const frame={...response,id:message.id};
      const recorded=message.type==='meeting.asr.segment'||message.type==='voice.stt.chunk'
        ? {...message,data:undefined}
        : message.type==='meeting.asr.set'&&message.external
          ? {...message,external:{...message.external,apiKey:undefined}}
          : message;
      traces.push({request:recorded,response:frame});
      // Preserve every PCM receipt in evidence without keeping the audio clock
      // waiting for a full trace-file rewrite on every 40 ms block.
      if(message.type!=='voice.stt.chunk')fs.writeFileSync(output,JSON.stringify(traces,null,2));
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(frame));
    }catch(error){res.writeHead(500);res.end(JSON.stringify({error:error.message}))}return;
  }
  const file=req.url==='/app.js'?'app.js':req.url==='/'?'index.html':null;
  if(!file){res.writeHead(404);res.end();return}
  res.writeHead(200,{'Content-Type':file.endsWith('.js')?'text/javascript':'text/html; charset=utf-8'});res.end(fs.readFileSync(path.join(fixture,file)));
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:server.address().port})));
