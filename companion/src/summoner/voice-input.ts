/** Browser-side dictation controller. Kept separate from meeting capture and navigation. */
export const SUMMONER_DICTATION_JS = String.raw`
function createSummonerDictation(o){
  var current=null,acks={},pendingEngine=null,serial=0;
  var status=document.createElement("div");
  status.id="voiceStatus";status.className="voice-status";status.hidden=true;
  status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  status.style.cssText="font-size:12px;line-height:1.5;padding:6px 12px;white-space:pre-wrap";
  o.mic.parentNode.parentNode.appendChild(status);
  function say(text){status.textContent=text||"";status.hidden=!text}
  function post(path,body,keepalive){return o.api(path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body),keepalive:keepalive===true})}
  function checked(d){
    if(!d||d.error||d.type==="error"||d.type==="voice.stt.error"){
      var e=new Error(d&&(d.message||d.error)||"听写服务未返回结果");e.code=d&&(d.code||d.error_code);throw e;
    }
    return d;
  }
  function live(s){return current===s && s.owner===o.threadId() && !s.cancelled}
  function mic(on){o.mic.setAttribute("aria-pressed",on?"true":"false");o.mic.title=on?"停止听写":"听写"}
  function cleanup(s,keepOwner){
    clearTimeout(s.timer);clearTimeout(s.startTimer);if(!keepOwner)clearInterval(s.ownerTimer);clearTimeout(s.partialTimer);
    if(s.proc){s.proc.onaudioprocess=null;try{s.proc.disconnect()}catch(e){}}
    [s.src,s.mute].forEach(function(n){try{if(n)n.disconnect()}catch(e){}});
    if(s.stream)s.stream.getTracks().forEach(function(t){t.stop()});
    if(s.ctx)Promise.resolve(s.ctx.close()).catch(function(){});
    s.stream=s.ctx=s.proc=null;mic(false);
  }
  function finish(s,text){
    if(!live(s)){cancel(s);return}
    var value=String(text||"").trim();
    if(value){var old=o.input.value;o.input.value=old&&old.trim()?old.replace(/\s*$/,"")+" "+value:value;o.input.dispatchEvent(new Event("input",{bubbles:true}))}
    cleanup(s);current=null;s.cancelled=true;say(value?"已填入草稿，请核对后发送":"没有识别到语音，请重试");
  }
  function copyError(e){
    var c=String(e&&e.code||e&&e.name||"");
    if(c==="NotAllowedError"||c==="not-allowed"||c==="service-not-allowed")return "麦克风未获授权，请在 Chrome 网站设置及系统隐私设置中允许麦克风";
    if(c==="model_missing"||c==="binary_missing")return "本机听写组件未就绪，请在 Chrome 侧栏的设置 → 输入与语音中下载组件和模型";
    if(c==="engine_not_local")return "听写引擎配置已变化，请重新开始听写";
    if(c==="network")return "浏览器语音服务连接失败，请检查网络或在 Chrome 侧栏设置 → 输入与语音中选择本机听写";
    if(c==="no-speech"||c==="empty_result")return "没有识别到语音，请重试";
    return e&&e.message||"听写失败，请重试";
  }
  function cancel(s){
    s=s||current;if(!s||s.cancelled)return;
    s.cancelled=true;cleanup(s);if(current===s)current=null;
    if(s.rec){try{s.rec.abort()}catch(e){}}
    // Queue abort after any start/chunk already in flight so delayed start cannot leak a session.
    s.queue.catch(function(){}).then(function(){if(s.started)return post("/api/stt/abort",{sessionId:s.sid},true)}).catch(function(){});
    say("已取消听写");
  }
  function fail(s,e){if(current!==s||s.cancelled)return;cancel(s);say(copyError(e))}
  function applyEvent(d){
    var s=current;if(!s||!d||d.sessionId!==s.sid)return false;
    if(!live(s)){cancel(s);return true}
    if(d.type==="voice.stt.error"){fail(s,{code:d.code||d.error_code,message:d.message||d.error});return true}
    // The final HTTP response is authoritative; an SSE duplicate cannot commit twice.
    if(d.type==="voice.stt.partial" && d.status==="hypothesis" && !s.stopping && d.text)say("正在听写… "+d.text);
    return true;
  }
  function startBrowser(s){
    var C=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!C){fail(s,new Error("此浏览器不支持浏览器听写，请在 Chrome 侧栏设置 → 输入与语音中选择本机听写"));return}
    var rec=new C();s.rec=rec;s.finals=[];rec.lang=s.settings.lang||"zh-CN";rec.continuous=true;rec.interimResults=true;rec.maxAlternatives=1;
    rec.onstart=function(){if(live(s)){clearTimeout(s.startTimer);say("正在听写… 再点麦克风结束");mic(true)}};
    rec.onresult=function(ev){
      if(!live(s))return;
      var interim="";
      for(var i=ev.resultIndex||0;i<ev.results.length;i++){
        var r=ev.results[i],text=r[0]&&r[0].transcript||"";
        if(r.isFinal)s.finals[i]=text;else interim+=text;
      }
      say("正在听写… "+s.finals.join("")+interim);
    };
    rec.onerror=function(e){if(e.error!=="aborted")fail(s,{code:e.error,message:"浏览器听写失败"})};
    rec.onend=function(){if(live(s))finish(s,s.finals.join(""))};
    try{rec.start();s.timer=setTimeout(function(){stop()},45000)}catch(e){fail(s,e)}
  }
  function queueChunk(s,bytes){
    var seq=s.seq++,binary="";for(var i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);
    var data=btoa(binary);
    s.queue=s.queue.then(function(){if(!live(s))return;return post("/api/stt/chunk",{sessionId:s.sid,seq:seq,data:data}).then(checked)});
    s.queue.catch(function(e){fail(s,e)});
  }
  function flush(s){if(!s.buf.length)return;var b=s.buf;s.buf=new Uint8Array(0);queueChunk(s,b)}
  function poll(s){
    if(!live(s)||s.stopping||s.settings.sttEngine!=="local"||s.settings.localModelId==="large-v3-turbo")return;
    s.partialTimer=setTimeout(function(){
      if(!live(s)||s.stopping)return;
      // A single outstanding partial; final end is independent and cancels it server-side.
      s.queue.then(function(){if(!live(s)||s.stopping)return;return post("/api/stt/partial",{sessionId:s.sid})}).then(function(d){if(d)applyEvent(d)}).catch(function(){}).finally(function(){poll(s)});
    },1400);
  }
  function startLocal(s){
    if(!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia){fail(s,new Error("此窗口无法访问麦克风"));return}
    navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}}).then(function(stream){
      if(!live(s)){stream.getTracks().forEach(function(t){t.stop()});return}
      s.stream=stream;var AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error("此窗口无法捕获麦克风音频");
      var ctx=new AC();s.ctx=ctx;
      return Promise.resolve(ctx.state==="suspended"?ctx.resume():undefined).then(function(){
        if(!live(s))return;
        s.queue=post("/api/stt/start",{sessionId:s.sid,modelId:s.settings.localModelId,engine:s.settings.sttEngine,privacy_ack_v2:true,lang:s.settings.lang||"zh-CN",maxMs:45000}).then(function(d){checked(d);s.started=true;return d});
        return s.queue.then(function(){
          if(!live(s))return;
          s.src=ctx.createMediaStreamSource(stream);s.proc=ctx.createScriptProcessor(4096,1,1);s.mute=ctx.createGain();s.mute.gain.value=0;
          s.proc.onaudioprocess=function(ev){
            if(!live(s)||s.stopping)return;
            var input=ev.inputBuffer.getChannelData(0),rate=ctx.sampleRate||48000;
            var n=Math.max(1,Math.round(input.length*16000/rate)),bytes=new Uint8Array(n*2),v=new DataView(bytes.buffer);
            for(var i=0;i<n;i++){var pos=i*rate/16000,a=Math.min(Math.floor(pos),input.length-1),b=Math.min(a+1,input.length-1),f=pos-a;var x=Math.max(-1,Math.min(1,input[a]*(1-f)+input[b]*f));v.setInt16(i*2,Math.round(x<0?x*32768:x*32767),true)}
            var buf=new Uint8Array(s.buf.length+bytes.length);buf.set(s.buf);buf.set(bytes,s.buf.length);s.buf=buf;if(s.buf.length>=32000)flush(s);
          };
          s.src.connect(s.proc);s.proc.connect(s.mute);s.mute.connect(ctx.destination);clearTimeout(s.startTimer);mic(true);say("正在听写… 再点麦克风结束");
          // Finish ahead of the daemon's 45 s recording lease so final upload can drain.
          s.timer=setTimeout(function(){stop()},44000);poll(s);
        });
      });
    }).catch(function(e){fail(s,e)});
  }
  function begin(settings){
    if(current||o.blocked())return;
    var s={sid:"dict-"+Date.now().toString(36)+"-"+(++serial),owner:o.threadId(),settings:settings,queue:Promise.resolve(),buf:new Uint8Array(0),seq:0};
    current=s;mic(true);say("正在请求麦克风…");
    s.ownerTimer=setInterval(function(){if(!live(s))cancel(s)},200);
    // Bound the permission/start phase; permission resolution after cancel is harmless.
    s.startTimer=setTimeout(function(){fail(s,new Error("麦克风启动超时，请检查浏览器权限后重试"))},15000);
    if(settings.sttEngine==="browser")startBrowser(s);else startLocal(s);
  }
  function stop(){
    var s=current;if(!s)return;
    if(s.stopping){cancel(s);return}
    if(s.rec){s.stopping=true;say("正在完成识别…");try{s.rec.stop()}catch(e){fail(s,e)};clearTimeout(s.timer);s.timer=setTimeout(function(){if(live(s))finish(s,s.finals.join(""))},5000);return}
    if(!s.started||!s.proc){cancel(s);return}
    s.stopping=true;flush(s);cleanup(s,true);say("正在识别… 再点麦克风取消");
    s.queue.then(function(){if(!live(s))return;return post("/api/stt/end",{sessionId:s.sid,totalSeq:s.seq})}).then(function(d){if(!live(s)||!d)return;checked(d);if(d.type!=="voice.stt.result")throw new Error("听写服务没有返回识别结果");finish(s,d.text)}).catch(function(e){fail(s,e)});
  }
  var requested=0;
  function toggle(){
    if(current){stop();return}
    if(o.blocked()){say("请先结束会议录音");return}
    var turn=++requested;say("正在准备听写…");
    o.api("/api/voice-settings").then(function(settings){
      if(turn!==requested||current)return;
      checked(settings);if(["browser","local","system"].indexOf(settings.sttEngine)<0)throw new Error("无法读取听写引擎，请重试");
      if(!acks[settings.sttEngine]){pendingEngine=settings;o.privacy(settings.sttEngine);say("");return}
      begin(settings);
    }).catch(function(e){say(copyError(e))});
  }
  return {toggle:toggle,cancel:function(){requested++;pendingEngine=null;cancel()},active:function(){return !!current},onEvent:applyEvent,ack:function(){if(!pendingEngine)return;var settings=pendingEngine;pendingEngine=null;acks[settings.sttEngine]=true;begin(settings)}};
}
`

/** Voice final decode can outlive ordinary metadata requests. */
export function summonerVoiceRequestTimeout(type: string): number | undefined {
  if (type === "voice.stt.end") return 305_000
  if (type === "voice.stt.partial_request") return 30_000
  return undefined
}
