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
        const ext = file.name.split(".").pop(), video = ext === "mp4";
        const src = base + "&file=" + encodeURIComponent(file.name);
        const entry = document.createElement("details"), label = document.createElement("summary");
        label.textContent = (video ? "会议视频" : "会议录音") + " · " +
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
  function videoCommand(s, action) {
    return window.webkit.messageHandlers.meetingVideo.postMessage({action:action, meeting:s.owner, capture:s.sid});
  }
  async function acquireMeetingVideoAudio(s) {
    try {
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
    if (s && s.sid === id && !s.videoStop) {
      s.videoError = new Error(reason);
      s.capture?.stop("permission_revoked");
    }
  };
  function stopMeetingVideo(s) {
    if (s.mode !== "video") return Promise.resolve();
    if (!s.videoStop) {
      s.mic?.getTracks().forEach(t => t.stop());
      s.mix?.close().catch(() => {});
      s.videoStop = videoCommand(s, "stop").catch(error => { s.videoError = error });
    }
    return s.videoStop;
  }
`
