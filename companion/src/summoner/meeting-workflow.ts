/** Native meeting page workflow. Uses the shell's authenticated HTTP API only. */
export const SUMMONER_MEETING_WORKFLOW_JS = String.raw`
  var meetingEnding=null,meetingWorkBusy=false,meetingFailure=null,meetingContinuous=null;
  var meetingReferenceName="",meetingCapture=null,meetingConsentResume=null,pendingMeetingSegment=null,meetingViewRev=0;
  function continuousMeetingRequest(message){
    var route={"voice.stt.start":"/api/stt/start","voice.stt.chunk":"/api/stt/chunk","voice.stt.end":"/api/stt/end","voice.stt.abort":"/api/stt/abort"}[message.type];
    if(!route)return Promise.reject(new Error("连续录制消息无效"));
    var body=Object.assign({},message);delete body.type;
    return meetingPost(route,body);
  }
  function continuousMeetingLost(s,e){
    if(meetingContinuous!==s || s.lost)return;
    s.lost=true;meetingFailure=e;stopRecClock();s.capture&&s.capture.destroy();
    s.reject(e);meetingContinuous=null;meetingId="";setRecordingUi(false);meetingControls(meetingWorkBusy);
    $("meetingCancel").hidden=true;$("meetingHint").textContent="采集已停止；服务端未确认范围不属于完整转写";meetingProblem(e);
  }
  function syncContinuousMeeting(s){
    if(s.syncing)return s.syncing;
    s.syncing=Promise.resolve().then(async function(){
      do{
        var target=s.wanted,d=await meetingRequest("/api/meeting?id="+encodeURIComponent(s.owner)),m=d.meeting;
        if(meetingContinuous!==s || s.lost || meetingId!==s.owner)return;
        if(!m || m.id!==s.owner || m.capture_epoch!==s.epoch)throw new Error("原稿读取回执不匹配");
        (m.original_transcript||[]).forEach(function(line){if(line.segment_id && !s.seen.has(line.segment_id)){s.seen.add(line.segment_id);appendMeetingLive(line.text,line.speaker||"")}});
        applyMeetingMaterials(m);s.synced=target;
      }while(meetingContinuous===s && !s.lost && s.synced<s.wanted);
    }).finally(function(){s.syncing=null});return s.syncing;
  }
  function continuousMeetingStatus(s,status){
    if(meetingContinuous!==s || s.lost)return;
    s.wanted=Math.max(s.wanted,status.committed_end||0);
    var backlog=Math.max(0,(status.server_received_end-status.committed_end)/16000);
    $("meetingQueue").textContent=(s.active?"采集中":"已停采，正在排空")+(status.inflight_segment!==null?" · 识别第"+(status.inflight_segment+1)+"段":"")+" · 积压 "+backlog.toFixed(1)+" 秒 · 已处理到 "+(status.processed_end/16000).toFixed(1)+" 秒 · 原稿 "+status.saved_text_segments+" 段已保存"+(status.eta_seconds===null?" · 预计延迟未知":" · 若现在停止，预计约 "+Math.ceil(status.eta_seconds)+" 秒排空")+(status.high_water?" · 接近积压上限":"")+(status.stop_reason && status.stop_reason!=="user_stop"?" · 提前停采："+CMsparkMeetingPcm.meetingCaptureStopLabel(status.stop_reason):"");
    if(s.synced<s.wanted)syncContinuousMeeting(s).catch(function(e){if(meetingContinuous===s)meetingProblem(e)});
  }
  async function beginContinuousMeeting(){
    if(meetingId || meetingContinuous || meetingWorkBusy || meetingEnding)return;
    if(!meetingAck || !voiceAck){requestMeetingConsent(beginContinuousMeeting);return}
    if(!lastMeetingId){showMeetingDesk(true);meetingSay("请先点击新会议或选择历史会议，再开始连续录制");return}
    var s={owner:lastMeetingId,sid:crypto.randomUUID(),epoch:null,active:false,lost:false,capture:null,wanted:0,synced:-1,syncing:null,seen:new Set(),resolve:null,reject:null};
    s.done=new Promise(function(resolve,reject){s.resolve=resolve;s.reject=reject});s.done.catch(function(){});
    meetingContinuous=s;meetingFailure=null;meetingViewRev++;showMeetingDesk(true);meetingControls(true);$("meetingCancel").hidden=false;$("meetingHint").textContent="正在准备连续录制…";
    try{
      if(summonerVoice)summonerVoice.cancel();
      await loadVoiceSettings(s.sid);
      if(meetingContinuous!==s || s.lost)return;
      if(voiceSettings.meeting_pcm_contract!==1)throw new Error("当前连接不支持连续会议；请更新后重新显式开始");
      if(voiceSettings.sttEngine!=="local")throw new Error(STT_NEED_MODEL);
      var loaded=await meetingRequest("/api/meeting?id="+encodeURIComponent(s.owner));
      if(meetingContinuous!==s || s.lost)return;
      if(loaded.meeting&&loaded.meeting.privacy&&loaded.meeting.privacy.audio_retained)throw new Error("连续录制暂不支持保留原始音频；现有选择未改变");
      var started=await meetingPost("/api/meeting/start",{v:1,id:s.owner,queue_contract:1,capture_id:s.sid,expected_capture_epoch:loaded.meeting&&loaded.meeting.capture_epoch||0,privacy_ack_v1:true,privacy_ack_v2:true,audio_retained:false});
      var status=started.continuous_capture;
      if(meetingContinuous!==s || s.lost)return;
      if(started.type!=="meeting.started" || !started.meeting || started.meeting.id!==s.owner || !status || status.capture_id!==s.sid || status.meeting_id!==s.owner || status.queue_contract!==1)throw new Error("连续开始回执不匹配");
      s.epoch=status.capture_epoch;meetingId=s.owner;lastMeetingId=s.owner;
      (started.meeting.original_transcript||[]).forEach(function(line){if(line.segment_id)s.seen.add(line.segment_id)});
      s.capture=CMsparkMeetingPcm.createMeetingContinuousCapture({meetingId:s.owner,captureId:s.sid,epoch:s.epoch,modelId:voiceSettings.localModelId||"medium",lang:voiceSettings.lang||"zh",request:continuousMeetingRequest,
        onStart:function(){if(meetingContinuous!==s)return;s.active=true;setRecordingUi(true);$("meetingRec").disabled=false;startRecClock();$("meetingHint").textContent="持续采集中"},
        onStopped:function(){if(meetingContinuous!==s)return;s.active=false;stopRecClock();$("meetingRec").disabled=true;$("meetingHint").textContent="已停止采集，正在排空此前音频"},
        onStatus:function(value){continuousMeetingStatus(s,value)},
        onError:function(code){continuousMeetingLost(s,new Error(CMsparkMeetingPcm.meetingCaptureErrorMessage(code)))},
        onEnd:function(value){
          if(meetingContinuous!==s)return;s.active=false;stopRecClock();s.wanted=Math.max(s.wanted,value.committed_end||0);
          syncContinuousMeeting(s).then(function(){
            if(meetingContinuous!==s)return;
            $("meetingCancel").hidden=true;$("meetingQueue").textContent=value.completion&&value.completion.outcome==="complete"?"已保存全部采集前缀":"已保存部分前缀；未处理范围已取消或录制提前停止";
            if(!value.completion || value.completion.outcome!=="complete")meetingFailure=new Error("录制提前停止或取消；未处理范围不属于完整转写");
            s.resolve(value);
            if(!meetingEnding){meetingContinuous=null;meetingId="";setRecordingUi(false);meetingControls(meetingWorkBusy);meetingSay(meetingFailure?meetingFailure.message:"录制已结束，转写已保存");loadMeetingHistory()}
          }).catch(function(e){continuousMeetingLost(s,e)});
        }});
      await s.capture.start();
    }catch(e){continuousMeetingLost(s,e)}
  }
  function requestMeetingConsent(resume){
    meetingConsentResume=resume;$("meetingVoiceSection").hidden=voiceAck;$("meetingPrivacy").hidden=false;
  }
  $("meetingOpen").onclick=function(){showMeetingDesk(true)};
  async function createNewMeeting(){
    if(meetingWorkBusy || meetingContinuous)return;
    var viewRev=++meetingViewRev;
    meetingWorkBusy=true;meetingControls(true);
    try{
      await prepareMeetingSwitch();
      if(viewRev!==meetingViewRev || meetingContinuous)return;
      var created=await meetingPost("/api/meeting/create",{title:"新会议"});
      if(viewRev!==meetingViewRev || meetingContinuous || meetingId)return;
      if(!created.meeting || typeof created.meeting.id!=="string" || created.meeting.id.indexOf("mtg_")!==0)throw new Error("新会议创建回执不匹配");
      lastMeetingId=created.meeting.id;meetingReferenceName="";meetingFailure=null;pendingMeetingSegment=null;
      $("meetingReferenceName").textContent="";$("meetingReferenceNotes").value="";paintTranscript([]);
      $("meetingMinutes").hidden=true;$("meetingEvidence").hidden=true;$("meetingOriginal").hidden=true;$("meetingRetry").hidden=true;
      setRecordingUi(false);meetingSay("新会议已创建：可开始录制或导入材料");loadMeetingHistory();
    }catch(e){meetingProblem(e)}finally{meetingWorkBusy=false;meetingControls(false)}
  }
  $("meetingNew").onclick=createNewMeeting;
  async function prepareMeetingSwitch(){
    await endMeetingCapture();
    if(lastMeetingId || $("meetingReferenceNotes").value){await saveMeetingReference(await ensureMeeting())}
  }
  function meetingSay(text){$("meetingWorkflowStatus").textContent=text||"";setStatus(text)}
  function meetingProblem(e){meetingSay(e&&e.message||String(e)||"会议操作失败")}
  function meetingChecked(d){
    if(!d || d.error || d.type==="error" || d.type==="meeting.error" || d.type==="voice.stt.error"){
      var e=new Error(d&&(d.message||d.error)||"会议服务未返回结果");e.code=d&&(d.code||d.error_code);throw e;
    }
    return d;
  }
  function meetingRequest(path,body){
    var controller=new AbortController(),ms=path==="/api/stt/end"&&!(body&&body.queue_contract===1)?305000:path==="/api/meeting/minutes"?100000:15000;
    var timer=setTimeout(function(){controller.abort()},ms);
    var opts={signal:controller.signal};
    if(body!==undefined){opts.method="POST";opts.headers={"Content-Type":"application/json"};opts.body=JSON.stringify(body)}
    return api(path,opts).then(meetingChecked).catch(function(e){if(e.name==="AbortError")throw new Error("请求超时，请保留当前稿并重试");throw e}).finally(function(){clearTimeout(timer)});
  }
  function meetingPost(path,body){return meetingRequest(path,body)}
  function meetingControls(disabled){
    ["meetingRec","meetingMinutesBtn","meetingAudioImport","meetingReferenceImport","meetingReferenceSave","meetingHistToggle","meetingNew"].forEach(function(id){$(id).disabled=disabled});
    $("meetingReferenceNotes").disabled=disabled;
  }
  function applyMeetingMaterials(m){
    meetingReferenceName=m.reference_name||"";
    $("meetingReferenceName").textContent=meetingReferenceName;
    $("meetingReferenceNotes").value=m.reference_notes||"";
    var original=(m.original_transcript||[]).map(function(l){return l.text||""}).join("\n");
    $("meetingOriginal").hidden=!original;$("meetingOriginalText").textContent=original;
    $("meetingSourceRange").textContent=CMsparkMeetingPcm.meetingSourceRangeLabel(m.capture_summary);
    renderMeetingEvidence(m.minutes);
  }
  function renderMeetingEvidence(minutes){
    var box=$("meetingEvidence");box.innerHTML="";box.hidden=!minutes;
    if(!minutes)return;
    if(minutes.stale){var stale=document.createElement("p");stale.textContent="材料已修改，当前纪要待重新生成。";box.appendChild(stale)}
    function detail(title,text){if(!text)return;var d=document.createElement("details"),s=document.createElement("summary"),p=document.createElement("pre");s.textContent=title;p.textContent=text;d.appendChild(s);d.appendChild(p);box.appendChild(d)}
    detail("独立校正稿",minutes.corrected_transcript);
    detail("本次生成使用的转写",minutes.source_transcript);
    detail("修改依据",(minutes.corrections||[]).map(function(c){return c.original+" → "+c.replacement+"\n参考原句："+c.reference_excerpt+"\n依据："+c.reason}).join("\n\n"));
    detail("参考补充（不代表会议决定）",(minutes.reference_supplements||[]).map(function(c){return c.reference_excerpt+"\n"+c.reason}).join("\n\n"));
    detail("待确认冲突",(minutes.conflicts||[]).map(function(c){return "转写："+c.transcript_excerpt+"\n参考："+c.reference_excerpt+"\n"+c.reason}).join("\n\n"));
  }
  function captureFailure(s,e){
    if(s.failed)return;
    s.failed=e;meetingFailure=e;$("meetingRetry").hidden=false;meetingProblem(new Error(sttUserCopy(e.code,e.message)));
    if(meetingCapture===s){teardownStt();sttSid="";stopRecClock();$("meetingHint").textContent="转写失败，请保留当前稿并重试"}
  }
  function commitMeetingSegment(s,d){
    if(s.committed)return s.committed;
    meetingChecked(d);
    if(d.type!=="voice.stt.result" || d.sessionId!==s.sid)throw new Error("语音识别未返回匹配的最终结果");
    var text=typeof d.text==="string"?d.text.trim():"";
    if(!text){s.committed=Promise.resolve();return s.committed}
    // Paint first, persist second. Failed saves keep the visible text for recovery.
    appendMeetingLive(text,"");$("meetingPartial").textContent="";
    s.text=text;pendingMeetingSegment=s;
    s.committed=saveMeetingSegment(s);
    s.committed.catch(function(e){captureFailure(s,e)});
    return s.committed;
  }
  async function saveMeetingSegment(s){
    var reply=await meetingPost("/api/meeting/append",{id:s.owner,text:s.text,segment_id:s.sid});
    var m=reply.meeting;
    if(!m || m.id!==s.owner || !(m.original_transcript||[]).some(function(line){return line.segment_id===s.sid && line.text===s.text && line.source==="stt"}))throw new Error("原始转写保存回执不匹配，请重试保存");
    var raw=(m.original_transcript||[]).map(function(l){return l.text||""}).join("\n");
    $("meetingOriginal").hidden=!raw;$("meetingOriginalText").textContent=raw;renderMeetingEvidence(m.minutes);
    if(pendingMeetingSegment===s)pendingMeetingSegment=null;
  }
  $("meetingRetry").onclick=async function(){
    if(meetingWorkBusy || meetingEnding)return;meetingWorkBusy=true;meetingControls(true);
    try{
      var s=pendingMeetingSegment;
      if(s){await saveMeetingSegment(s);s.failed=null;s.committed=Promise.resolve()}
      if(meetingCapture){await meetingCapture.queue.catch(function(){});await meetingPost("/api/stt/abort",{sessionId:meetingCapture.sid}).catch(function(){});meetingCapture=null}
      meetingFailure=null;$("meetingRetry").hidden=true;
      if(s){await endMeetingCapture();$("meetingHint").textContent="末段转写已恢复";meetingSay("末段转写已核对保存，可重新生成纪要")}
      else if(meetingId){startStt();startRecClock();meetingSay("正在重试录制；已保存转写保留")}
    }catch(e){meetingProblem(e)}finally{meetingWorkBusy=false;meetingControls(false)}
  };
  function meetingSttEvent(d){
    if(meetingContinuous && d.queue_contract===1){meetingContinuous.capture&&meetingContinuous.capture.handleStatus(d);return}
    var s=meetingCapture;if(!s || d.sessionId!==s.sid)return;
    if(d.type==="voice.stt.partial"){$("meetingPartial").textContent=d.text||"";return}
    if(d.type==="voice.stt.error"){captureFailure(s,{code:d.code,message:d.message||d.error});return}
    if(d.type==="voice.stt.result"){
      try{commitMeetingSegment(s,d).catch(function(){})}catch(e){captureFailure(s,e)}
    }
  }
  function queueMeetingPcm(s,bytes){
    var seq=s.seq++,data=uint8ToB64(bytes);
    s.queue=s.queue.then(function(){if(s.failed)throw s.failed;return meetingPost("/api/stt/chunk",{sessionId:s.sid,seq:seq,data:data})});
    s.queue.catch(function(e){captureFailure(s,e)});
  }
  function flushStt(force){
    var s=meetingCapture;if(!s || !sttSid)return;
    var min=force?1:STT_FLUSH;
    while(sttBuf.length>=min){
      var n=Math.min(STT_CHUNK,sttBuf.length);
      queueMeetingPcm(s,new Uint8Array(sttBuf.subarray(0,n)));
      sttSeq=s.seq;sttBuf=new Uint8Array(sttBuf.subarray(n));
    }
  }
  function stopStt(abort){
    var continuous=meetingContinuous;
    if(continuous){if(!continuous.capture){continuousMeetingLost(continuous,new Error("开始已取消"));return Promise.resolve()}return Promise.resolve(abort?continuous.capture.abort():continuous.capture.stop()).then(function(){return continuous.done})}
    var s=meetingCapture;if(!s)return Promise.resolve();
    if(s.finishing)return s.finishing;
    if(!abort)flushStt(true);
    teardownStt();sttSid="";
    if(!abort && !meetingEnding)$("meetingHint").textContent="分段识别中，麦克风暂时暂停";
    s.finishing=s.queue.then(function(){
      if(abort || s.failed)return meetingPost("/api/stt/abort",{sessionId:s.sid}).then(function(){throw s.failed||new Error("已取消转写")});
      return meetingPost("/api/stt/end",{sessionId:s.sid,totalSeq:s.seq}).then(function(d){return commitMeetingSegment(s,d)});
    }).then(function(){if(s.failed)throw s.failed}).catch(function(e){captureFailure(s,e);return meetingPost("/api/stt/abort",{sessionId:s.sid}).catch(function(){}).then(function(){throw e})}).finally(function(){
      if(meetingCapture===s)meetingCapture=null;
      // Legacy import never starts a live recording automatically.
    });
    s.finishing.catch(function(){});
    return s.finishing;
  }
  function startStt(){return beginContinuousMeeting()}
  function endMeetingCapture(){
    if(meetingEnding)return meetingEnding;
    if(!meetingId)return Promise.resolve();
    var id=meetingId;stopRecClock();meetingControls(true);
    $("meetingHint").textContent="正在保存最后一段…";
    // Assign before stopping: final callbacks must not start another capture window.
    meetingEnding=Promise.resolve().then(function(){return stopStt(false)}).then(function(){
      if(meetingFailure)throw meetingFailure;
      return meetingPost("/api/meeting/end",{id:id});
    }).then(function(d){
      if(!d.meeting || d.meeting.id!==id)throw new Error("结束会议回执不匹配");
      lastMeetingId=id;meetingId="";setRecordingUi(false);
      $("meetingHint").textContent="已结束 · 可生成纪要";meetingSay("录制已结束，转写已保存");loadMeetingHistory();
    }).catch(function(e){meetingProblem(e);throw e}).finally(function(){meetingContinuous=null;$("meetingCancel").hidden=true;meetingEnding=null;meetingControls(meetingWorkBusy)});
    meetingEnding.catch(function(){});return meetingEnding;
  }
  async function ensureMeeting(){
    var id=meetingId||lastMeetingId;if(id)return id;
    var d=await meetingPost("/api/meeting/create",{title:"导入会议"});
    if(!d.meeting || !d.meeting.id)throw new Error("创建会议失败");
    lastMeetingId=d.meeting.id;setRecordingUi(false);return lastMeetingId;
  }
  async function saveMeetingReference(id){
    var notes=$("meetingReferenceNotes").value,name=meetingReferenceName;
    if(notes.length>100000)throw new Error("参考笔记不能超过 100000 字符");
    var d=await meetingPost("/api/meeting/reference",{id:id,reference_notes:notes,reference_name:name});
    if(!d.meeting || d.meeting.id!==id || d.meeting.reference_notes!==notes || d.meeting.reference_name!==name)throw new Error("参考笔记保存回执不匹配");
    renderMeetingEvidence(d.meeting.minutes);return d.meeting;
  }
  async function requestMeetingMinutes(){
    if(meetingWorkBusy)return;
    if(!meetingAck || !voiceAck){requestMeetingConsent(requestMeetingMinutes);return}
    meetingWorkBusy=true;meetingControls(true);
    try{
      await endMeetingCapture();
      var id=lastMeetingId;if(!id)throw new Error("请先录制或导入录音");
      await saveMeetingReference(id);
      meetingSay("正在生成纪要…");$("meetingHint").textContent="正在生成纪要…";
      var d=await meetingPost("/api/meeting/minutes",{id:id,privacy_ack_v1:true});
      var md=d.minutes&&(d.minutes.raw_md||d.minutes.md);
      if(!md)throw new Error("纪要生成失败：未返回正文");
      $("meetingMinutes").hidden=false;$("meetingMinutes").innerHTML="<p>会议纪要 · AI 草稿，请核对</p>"+renderMd(md);renderMeetingEvidence(d.minutes);
      meetingSay(d.minutes.stale?"材料已变化，请重新生成纪要":"AI 纪要草稿已生成，请核对");$("meetingHint").textContent="AI 纪要草稿";
    }catch(e){meetingProblem(e);$("meetingHint").textContent="纪要生成失败"}
    finally{meetingWorkBusy=false;meetingControls(false)}
  }
  $("meetingCancel").onclick=function(){var s=meetingContinuous;if(!s)return;if(!s.capture){continuousMeetingLost(s,new Error("开始已取消"));return}s.active=false;stopRecClock();s.capture.abort()};
  $("meetingReferenceImport").onclick=function(){if(!meetingWorkBusy)$("meetingReferenceFile").click()};
  $("meetingReferenceFile").onchange=async function(){
    var file=this.files&&this.files[0];this.value="";if(!file || meetingWorkBusy)return;
    meetingWorkBusy=true;meetingControls(true);
    try{
      if(!/\.(docx|md|txt)$/i.test(file.name))throw new Error("请选择 Word（DOCX）、MD 或 TXT 文件");
      if(file.size>7*1024*1024)throw new Error("参考文件不能超过 7 MiB");
      var d=await meetingPost("/api/meeting/reference/import",{file:{name:file.name,type:file.type,content:uint8ToB64(new Uint8Array(await file.arrayBuffer()))}});
      if(!d.reference || typeof d.reference.text!=="string")throw new Error("参考文件解析失败");
      meetingReferenceName=d.reference.name;$("meetingReferenceName").textContent=meetingReferenceName;$("meetingReferenceNotes").value=d.reference.text;$("meetingReferenceSection").open=true;
      await saveMeetingReference(await ensureMeeting());meetingSay("参考笔记已保存；生成时会保留原始转写并列出校正依据");
    }catch(e){meetingProblem(e)}finally{meetingWorkBusy=false;meetingControls(false)}
  };
  $("meetingReferenceSave").onclick=async function(){
    if(meetingWorkBusy)return;meetingWorkBusy=true;meetingControls(true);
    try{await saveMeetingReference(await ensureMeeting());meetingSay("参考笔记已保存")}catch(e){meetingProblem(e)}finally{meetingWorkBusy=false;meetingControls(false)}
  };
  $("meetingReferenceNotes").oninput=function(){meetingSay("参考笔记有未保存修改；生成纪要前会先保存")};
  $("meetingAudioImport").onclick=function(){if(meetingWorkBusy)return;if(!meetingAck || !voiceAck){requestMeetingConsent(function(){$("meetingAudioFile").click()});return}$("meetingAudioFile").click()};
  $("meetingAudioFile").onchange=async function(){
    var file=this.files&&this.files[0];this.value="";if(!file || meetingWorkBusy)return;
    if(!meetingAck || !voiceAck){meetingSay("请先阅读并确认会议及语音说明，再导入录音");return}
    meetingWorkBusy=true;meetingControls(true);var ctx=null,s=null;
    try{
      await endMeetingCapture();await loadVoiceSettings();
      if(voiceSettings.sttEngine!=="local")throw new Error("请在侧栏设置 → 输入与语音中启用本机转写并下载组件和模型");
      if(file.size>100*1024*1024)throw new Error("录音文件不能超过 100 MiB，请分段导入");
      var AC=window.AudioContext||window.webkitAudioContext;if(!AC)throw new Error("当前浏览器无法解码录音");
      ctx=new AC();meetingSay("正在解码录音…");
      var audio=await ctx.decodeAudioData(await file.arrayBuffer());
      if(!audio.length || audio.duration>4*60*60)throw new Error("录音为空或超过 4 小时，请分段导入");
      var id=await ensureMeeting(),chunkFrames=Math.floor(audio.sampleRate*45),chunks=Math.ceil(audio.length/chunkFrames);
      meetingFailure=null;
      for(var offset=0,index=0;offset<audio.length;offset+=chunkFrames,index++){
        meetingSay("正在识别录音 "+(index+1)+" / "+chunks);
        var n=Math.min(chunkFrames,audio.length-offset),mono=new Float32Array(n);
        for(var ch=0;ch<audio.numberOfChannels;ch++){var samples=audio.getChannelData(ch);for(var j=0;j<n;j++)mono[j]+=samples[offset+j]/audio.numberOfChannels}
        var pcm=floatToS16(resampleMono(mono,audio.sampleRate,STT_RATE));
        s={owner:id,sid:"ov-import-"+Date.now().toString(36)+"-"+index,seq:0,failed:null,committed:null};meetingCapture=s;
        s.queue=meetingPost("/api/stt/start",{sessionId:s.sid,modelId:voiceSettings.localModelId,privacy_ack_v2:true,lang:voiceSettings.lang||"zh",maxMs:45000});
        for(var at=0;at<pcm.length;at+=STT_CHUNK)queueMeetingPcm(s,pcm.subarray(at,Math.min(pcm.length,at+STT_CHUNK)));
        await s.queue;
        var result=await meetingPost("/api/stt/end",{sessionId:s.sid,totalSeq:s.seq});await commitMeetingSegment(s,result);
        if(s.failed)throw s.failed;meetingCapture=null;s=null;
      }
      await saveMeetingReference(id);meetingSay("录音转写已保存，可生成会议纪要");$("meetingHint").textContent="录音已导入";loadMeetingHistory();
    }catch(e){
      meetingProblem(e);
      if(s){await s.queue.catch(function(){});await meetingPost("/api/stt/abort",{sessionId:s.sid}).catch(function(){})}
    }finally{meetingCapture=null;if(ctx)await ctx.close().catch(function(){});meetingWorkBusy=false;meetingControls(false);setRecordingUi(false)}
  };
`
