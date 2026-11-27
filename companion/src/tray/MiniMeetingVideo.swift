import AppKit
import AVFoundation
import ScreenCaptureKit
import WebKit

// The page supplies meeting and capture identifiers. All file locations are derived here.
final class MiniMeetingFiles: NSObject, WKScriptMessageHandlerWithReply {
  weak var page: WKWebView?
  var port: Int?
  var video: AnyObject?

  func install(on config: WKWebViewConfiguration) {
    let controller = config.userContentController
    controller.addScriptMessageHandler(self, contentWorld: .page, name: "meetingFiles")
    if #available(macOS 15, *) {
      video = MiniMeetingVideo()
      controller.addScriptMessageHandler(self, contentWorld: .page, name: "meetingVideo")
    }
  }

  func close() {
    if #available(macOS 15, *) { (video as? MiniMeetingVideo)?.stop(nil) }
  }

  func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage,
                             replyHandler: @escaping (Any?, String?) -> Void) {
    let origin = message.frameInfo.securityOrigin
    guard let page, message.webView === page, message.frameInfo.isMainFrame,
          origin.protocol == "http", origin.host == "127.0.0.1", origin.port == port, page.url?.path == "/",
          let body = message.body as? [String: String], let action = body["action"],
          let id = body["meeting"], id.range(of: #"^[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$"#, options: .regularExpression) != nil,
          let capture = body["capture"], UUID(uuidString: capture) != nil else {
      replyHandler(nil, "无效的会议请求"); return
    }
    let home = FileManager.default.homeDirectoryForCurrentUser
    let root = ProcessInfo.processInfo.environment["CMSPARK_DATA_DIR"].map { URL(fileURLWithPath: $0) }
      ?? home.appendingPathComponent(".cmspark-agent")
    let meeting = root.appendingPathComponent("meetings").appendingPathComponent(id)
    let directory = meeting.appendingPathComponent("recordings")
    if message.name == "meetingFiles", action == "reveal", let ext = body["ext"], ["wav", "mp4"].contains(ext) {
      let file = directory.appendingPathComponent(capture + "." + ext)
      guard FileManager.default.fileExists(atPath: file.path) else { replyHandler(nil, "录制文件不存在"); return }
      NSWorkspace.shared.activateFileViewerSelecting([file]); replyHandler(true, nil); return
    }
    if #available(macOS 15, *), message.name == "meetingVideo", let recorder = video as? MiniMeetingVideo {
      switch action {
      case "choose": recorder.choose(capture, page: page, reply: replyHandler); return
      case "stop":
        guard recorder.capture == capture else { replyHandler(true, nil); return }
        recorder.stop(replyHandler); return
      case "start":
        let meta = try? Data(contentsOf: meeting.appendingPathComponent("meta.json"))
        let json = meta.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        guard json?["status"] as? String == "recording",
              (json?["capture_summary"] as? [String: Any])?["last_capture_id"] as? String == capture else {
          replyHandler(nil, "当前会议录制已变更"); return
        }
        recorder.start(capture, directory: directory, reply: replyHandler); return
      default: break
      }
    }
    replyHandler(nil, "不支持此录制操作")
  }
}

@available(macOS 15, *)
final class MiniMeetingVideo: NSObject, SCContentSharingPickerObserver, SCRecordingOutputDelegate, SCStreamDelegate, SCStreamOutput {
  typealias Reply = (Any?, String?) -> Void
  private(set) var capture: String?
  private weak var page: WKWebView?
  private var selection: SCContentFilter?
  private var pickerReply: Reply?
  private var startReply: Reply?
  private var stopReplies = [Reply]()
  private var stream: SCStream?
  private var output: SCRecordingOutput?
  private var file: URL?
  private var temporary: URL?
  private var stopping = false
  private var samples = Data()
  private let picker = SCContentSharingPicker.shared

  func choose(_ id: String, page: WKWebView, reply: @escaping Reply) {
    guard capture == nil else { reply(nil, "另一场视频正在录制或保存"); return }
    capture = id; self.page = page; pickerReply = reply
    var config = SCContentSharingPickerConfiguration()
    config.allowedPickerModes = [.singleWindow, .singleDisplay]
    config.allowsChangingSelectedContent = false
    picker.defaultConfiguration = config
    picker.add(self); picker.isActive = true; picker.present(using: .window)
  }

  private func endPicker(_ filter: SCContentFilter?, _ error: String?) {
    guard let reply = pickerReply else { return }
    picker.remove(self); pickerReply = nil; selection = filter
    if filter == nil { capture = nil; picker.isActive = false }
    reply(filter == nil ? nil : true, error)
  }

  func contentSharingPicker(_ picker: SCContentSharingPicker, didCancelFor stream: SCStream?) {
    DispatchQueue.main.async { self.endPicker(nil, "已取消选择会议画面") }
  }
  func contentSharingPickerStartDidFailWithError(_ error: Error) {
    DispatchQueue.main.async { self.endPicker(nil, "无法打开系统录屏选择器：" + error.localizedDescription) }
  }
  func contentSharingPicker(_ picker: SCContentSharingPicker, didUpdateWith filter: SCContentFilter, for stream: SCStream?) {
    DispatchQueue.main.async { self.endPicker(filter, nil) }
  }

  func start(_ id: String, directory: URL, reply: @escaping Reply) {
    guard capture == id, let filter = selection, stream == nil else { reply(nil, "请重新选择会议画面"); return }
    selection = nil; startReply = reply
    do {
      let fm = FileManager.default
      try fm.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
      let dest = directory.appendingPathComponent(id + ".mp4")
      let temp = directory.appendingPathComponent("." + id + ".mp4")
      guard !fm.fileExists(atPath: dest.path), !fm.fileExists(atPath: temp.path) else {
        throw CocoaError(.fileWriteFileExists)
      }
      file = dest; temporary = temp
      let config = SCStreamConfiguration()
      let rect = filter.contentRect
      let scale = min(CGFloat(filter.pointPixelScale), 1920 / max(1, rect.width, rect.height))
      config.width = max(2, Int(rect.width * scale) / 2 * 2)
      config.height = max(2, Int(rect.height * scale) / 2 * 2)
      config.minimumFrameInterval = CMTime(value: 1, timescale: 30)
      config.capturesAudio = true; config.captureMicrophone = true; config.excludesCurrentProcessAudio = true
      config.sampleRate = 48000; config.channelCount = 1
      let movie = SCRecordingOutputConfiguration()
      movie.outputURL = temp; movie.outputFileType = .mp4; movie.videoCodecType = .h264
      let recorder = SCRecordingOutput(configuration: movie, delegate: self)
      let source = SCStream(filter: filter, configuration: config, delegate: self)
      stream = source; output = recorder
      try source.addRecordingOutput(recorder)
      try source.addStreamOutput(self, type: .audio, sampleHandlerQueue: .main)
      source.startCapture { error in
        if let error { DispatchQueue.main.async { if self.stream === source { self.finish(error.localizedDescription) } } }
      }
    } catch { finish(error.localizedDescription) }
  }

  // ScreenCaptureKit provides mono float PCM at the configured rate. Deliver it to the
  // transcription mix in small batches. The MP4 receives sound directly from SCStream.
  func stream(_ stream: SCStream, didOutputSampleBuffer sample: CMSampleBuffer, of type: SCStreamOutputType) {
    guard stream === self.stream, type == .audio, !stopping, let id = capture,
          let desc = sample.formatDescription?.audioStreamBasicDescription,
          desc.mChannelsPerFrame == 1, desc.mBitsPerChannel == 32, desc.mFormatFlags & kAudioFormatFlagIsFloat != 0,
          let block = sample.dataBuffer else { return }
    let size = CMBlockBufferGetDataLength(block)
    guard size > 0 else { return }
    var data = Data(count: size)
    let rc = data.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: size, destination: $0.baseAddress!) }
    guard rc == noErr else { return }
    samples.append(data)
    guard samples.count >= Int(desc.mSampleRate * 0.08) * 4 else { return }
    page?.callAsyncJavaScript("window.miniMeetingSystemAudio?.(id, data, rate)", arguments:
      ["id": id, "data": samples.base64EncodedString(), "rate": desc.mSampleRate], in: nil, in: .page, completionHandler: nil)
    samples.removeAll(keepingCapacity: true)
  }

  func stop(_ reply: Reply?) {
    if let reply { stopReplies.append(reply) }
    if stopping { return }
    stopping = true
    guard let source = stream else { finish(nil); return }
    source.stopCapture { error in
      if let error { DispatchQueue.main.async { if self.stream === source { self.finish(error.localizedDescription) } } }
    }
  }

  func recordingOutputDidStartRecording(_ recordingOutput: SCRecordingOutput) {
    DispatchQueue.main.async {
      guard self.output === recordingOutput else { return }
      self.startReply?(true, nil); self.startReply = nil
    }
  }
  func recordingOutputDidFinishRecording(_ recordingOutput: SCRecordingOutput) {
    DispatchQueue.main.async {
      guard self.output === recordingOutput else { return }
      self.finish(nil)
    }
  }
  func recordingOutput(_ recordingOutput: SCRecordingOutput, didFailWithError error: Error) {
    DispatchQueue.main.async {
      guard self.output === recordingOutput else { return }
      self.stream?.stopCapture(completionHandler: { _ in }); self.finish(error.localizedDescription)
    }
  }
  func stream(_ stream: SCStream, didStopWithError error: Error) {
    DispatchQueue.main.async {
      guard self.stream === stream, !self.stopping, let id = self.capture else { return }
      self.page?.callAsyncJavaScript("window.miniMeetingVideoEnded?.(id, reason)", arguments:
        ["id": id, "reason": error.localizedDescription], in: nil, in: .page, completionHandler: nil)
    }
  }

  private func finish(_ failure: String?) {
    var error = failure
    if error == nil, let temporary, let file {
      do { try FileManager.default.moveItem(at: temporary, to: file) }
      catch let cause { error = cause.localizedDescription }
    }
    if error != nil, let temporary { try? FileManager.default.removeItem(at: temporary) }
    let reason = error.map { "视频保存失败：" + $0 }
    if let id = capture, stream != nil, !stopping {
      page?.callAsyncJavaScript("window.miniMeetingVideoEnded?.(id, reason)", arguments:
        ["id": id, "reason": reason ?? "所选会议画面已停止共享"], in: nil, in: .page, completionHandler: nil)
    }
    endPicker(nil, "已取消选择会议画面")
    startReply?(nil, reason ?? "视频录制已停止"); startReply = nil
    for reply in stopReplies { reply(reason == nil ? true : nil, reason) }
    stopReplies.removeAll(); picker.isActive = false
    capture = nil; selection = nil; output = nil; stream = nil; temporary = nil; file = nil
    samples.removeAll(); stopping = false
  }
}
