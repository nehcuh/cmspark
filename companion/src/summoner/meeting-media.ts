/** Local recording controls shared by the Mini page and the loopback meeting view. */
export const SUMMONER_MEETING_MEDIA_JS = String.raw`
  async function loadRecordingFiles(meeting) {
    const box = $("meetingRecordings");
    box.replaceChildren(); box.hidden = true;
    if (!meeting) return;
    const base = "/api/meeting/recordings?meeting=" + encodeURIComponent(meeting);
    try {
      const result = await meetingRequest(base);
      if (lastMeetingId !== meeting || !result.recordings.length) return;
      const heading = document.createElement("h3");
      heading.textContent = "录制文件"; box.appendChild(heading);
      for (const file of result.recordings) {
        const ext = file.name.split(".").pop(), video = ext !== "wav";
        const src = base + "&file=" + encodeURIComponent(file.name);
        const entry = document.createElement("details"), label = document.createElement("summary");
        label.textContent = (file.name.endsWith(".partial.webm") ? "会议视频（部分）" : video ? "会议视频" : "会议录音") + " · " +
          new Date(file.started).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) + " · " +
          (file.bytes / 1048576).toFixed(1) + " MB";
        entry.appendChild(label);
        const player = document.createElement(video ? "video" : "audio");
        player.controls = true; player.preload = "none"; player.src = src;
        player.setAttribute("aria-label", video ? "播放会议视频" : "播放会议录音");
        entry.appendChild(player);
        const bridge = window.webkit?.messageHandlers?.meetingFiles;
        if (bridge) {
          const reveal = document.createElement("button");
          reveal.textContent = "在访达中显示";
          reveal.onclick = () => bridge.postMessage({action:"reveal", meeting:meeting, capture:file.name.split(".")[0], ext:ext}).catch(meetingProblem);
          entry.appendChild(reveal);
        } else {
          const link = document.createElement("a");
          link.href = src + "&download=1"; link.download = file.name; link.textContent = "下载文件";
          entry.appendChild(link);
        }
        box.appendChild(entry);
      }
      box.hidden = false;
    } catch (error) {
      if (lastMeetingId === meeting) meetingProblem(error);
    }
  }
  function chooseMeetingSource(s, label, activate) {
    const button = $("meetingChooseSource"), signal = s.desktopOwner.signal;
    return new Promise((resolve,reject) => {
      function clear() { button.hidden = true; button.onclick = null; signal.removeEventListener("abort", cancel) }
      function cancel() { clear(); reject(new Error("已取消选择会议来源")) }
      if (signal.aborted) { cancel(); return }
      signal.addEventListener("abort",cancel,{once:true});
      button.textContent = label; button.hidden = false; button.focus();
      button.onclick = () => { clear(); try { resolve(activate()) } catch (e) { reject(e) } };
    });
  }
  function miniVideoUrl(s, action) {
    return "/api/meeting/video?meeting="+encodeURIComponent(s.owner)+"&capture="+encodeURIComponent(s.sid)+"&action="+action;
  }
  function browserRecordingStore(s) {
    async function send(action, offset, body) {
      const response = await fetch(miniVideoUrl(s,action)+(offset == null ? "" : "&offset="+offset),
        {method:"POST",credentials:"same-origin",body:body});
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "视频写入失败");
    }
    return {
      save: row => send(row.state === "open" ? "open" : row.state === "complete" ? "finish" : "partial",row.bytes),
      remove: () => send("discard"),
      async append(row, blob, elapsedMs) {
        const block = 1024*1024;
        for(let pos=0;pos<blob.size;pos+=block) await send("append",row.bytes+pos,blob.slice(pos,pos+block));
        return {...row,bytes:row.bytes+blob.size,chunks:row.chunks+1,elapsedMs:elapsedMs};
      }
    };
  }
  async function prepareComputerSound(s) {
    return chooseMeetingSource(s,"录制电脑播放的全部声音（含其他应用）",async () => {
      const ctx = new AudioContext(), dest = ctx.createMediaStreamDestination();
      const abort = new AbortController();
      s.stopMonitor = () => { abort.abort(); ctx.close().catch(() => {}) };
      await ctx.resume();
      s.startMonitor = async () => {
        const timer=setTimeout(()=>abort.abort(),8000);
        let response;
        try { response=await fetch(miniVideoUrl(s,"monitor"),{method:"POST", credentials:"same-origin",signal:abort.signal}) }
        finally { clearTimeout(timer) }
        if(!response.ok) throw new Error((await response.json()).error);
        const reader=response.body.getReader();
        (async () => {
          let next=0, carry;
          while(true){
            const {value,done}=await reader.read();
            if(done)break;
            let bytes=value;
            if(carry!==undefined){bytes=new Uint8Array(value.length+1);bytes[0]=carry;bytes.set(value,1)}
            const size=bytes.length-bytes.length%2;
            carry=size===bytes.length?undefined:bytes[size];
            if(!size)continue;
            const view=new DataView(bytes.buffer,bytes.byteOffset,size), buf=ctx.createBuffer(1,size/2,16000);
            const pcm=buf.getChannelData(0);
            for(let i=0;i<pcm.length;i++)pcm[i]=view.getInt16(i*2,true)/32768;
            const src=ctx.createBufferSource();src.buffer=buf;src.connect(dest);
            next=Math.max(next,ctx.currentTime);src.start(next);next+=buf.duration;
          }
          if(!abort.signal.aborted)throw new Error("电脑声音已断开");
        })().catch(e=>{if(!abort.signal.aborted)window.miniMeetingVideoEnded(s.sid,e.message)});
      };
      return dest.stream;
    });
  }
  async function browserVideoCommand(s, action) {
    if(action==="choose"){
      s.desktopOwner=new AbortController();
      const media=await chooseMeetingSource(s,"选择会议窗口、标签页或屏幕",()=>
        CMsparkMeetingPcm.openDesktopMeetingMedia(s.desktopOwner.signal,true,{
          allowTab:true,store:browserRecordingStore(s),
          missingSharedAudio: miniPlatform==="linux" ? ()=>prepareComputerSound(s) : undefined
        }));
      s.desktop=media;
      media.signal.addEventListener("abort",()=>{
        if(!s.stoppingVideo)window.miniMeetingVideoEnded(s.sid,String(media.signal.reason));
      },{once:true});
      return;
    }
    s.desktop?.close("stop");s.desktopOwner?.abort("stop");s.stopMonitor?.();
    await s.videoFile;
  }
  function videoCommand(s, action) {
    if(!window.webkit?.messageHandlers?.meetingVideo)return browserVideoCommand(s,action);
    return window.webkit.messageHandlers.meetingVideo.postMessage({action:action, meeting:s.owner, capture:s.sid});
  }
  async function acquireMeetingVideoAudio(s) {
    try {
      if(s.desktop){
        if(s.startMonitor)await s.startMonitor();
        await new Promise((resolve,reject)=>{
          s.videoFile=s.desktop.startRecording(s.owner,resolve,undefined,s.sid).then(row=>{
            if(row.state!=="complete" || !row.bytes)throw new Error(row.detail||"视频未完整保存");
          }).catch(e=>{
            s.videoError=e;reject(e);
            if(s.active && !s.stoppingVideo)s.capture.stop("input_gap");
          });
        });
        return s.desktop.audio;
      }
      const mic = await navigator.mediaDevices.getUserMedia({audio:{channelCount:1, echoCancellation:true}});
      if (s.lost || s.videoStop) { mic.getTracks().forEach(t => t.stop()); throw new Error("视频录制已取消") }
      s.mic = mic;
      const ctx = s.mix = new AudioContext(), dest = s.destination = ctx.createMediaStreamDestination();
      ctx.createMediaStreamSource(mic).connect(dest);
      for (const t of mic.getAudioTracks()) t.onended = () => s.capture.stop("permission_revoked");
      await ctx.resume();
      if (s.lost || s.videoStop) throw new Error("视频录制已取消");
      await videoCommand(s, "start");
      return dest.stream;
    } catch (e) {
      s.videoError = e;
      throw e;
    }
  }
  window.miniMeetingSystemAudio = function(id, data, rate) {
    const s = meetingContinuous;
    if (!s || s.sid !== id || !s.mix || s.videoStop) return;
    const bytes = Uint8Array.from(atob(data), c => c.charCodeAt(0));
    const samples = new Float32Array(bytes.buffer);
    const buffer = s.mix.createBuffer(1, samples.length, rate);
    buffer.copyToChannel(samples, 0);
    const source = s.mix.createBufferSource(); source.buffer = buffer; source.connect(s.destination);
    const when = Math.max(s.mix.currentTime, s.nextSystemSample || 0);
    source.start(when); s.nextSystemSample = when + buffer.duration;
  };
  window.miniMeetingVideoEnded = function(id, reason) {
    const s = meetingContinuous;
    if (s && s.sid === id && !s.stoppingVideo && !s.lost) {
      s.videoError = new Error(reason);
      if(s.capture)s.capture.stop("permission_revoked");else continuousMeetingLost(s,s.videoError);
    }
  };
  function stopMeetingVideo(s) {
    if (s.mode !== "video") return Promise.resolve();
    if (!s.videoStop) {
      s.stoppingVideo=true;
      s.mic?.getTracks().forEach(t => t.stop());
      s.mix?.close().catch(() => {});
      s.videoStop = videoCommand(s, "stop").catch(error => { s.videoError = error });
    }
    return s.videoStop;
  }
`
