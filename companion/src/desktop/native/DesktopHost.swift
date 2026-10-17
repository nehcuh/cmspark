import AppKit
import WebKit
import CryptoKit
import Foundation
import CoreFoundation
import Darwin

// Auth/bootstrap/native request frames have primitive values only; reject duplicate decoded keys.
private func flatFrame(_ data:Data)->[String:Any]? {
    guard let object=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],object.values.allSatisfy({$0 is String || $0 is NSNumber || $0 is NSNull}) else{return nil}
    let bytes=Array(data);var i=0;var keys=Set<String>()
    func space(){while i<bytes.count && [UInt8(32),9,10,13].contains(bytes[i]){i+=1}}
    func string()->String?{guard i<bytes.count,bytes[i]==34 else{return nil};let start=i;i+=1;while i<bytes.count{if bytes[i]==92{i+=2;continue};if bytes[i]==34{i+=1;return (try? JSONSerialization.jsonObject(with:Data(bytes[start..<i]),options:.fragmentsAllowed)) as? String};i+=1};return nil}
    space();guard i<bytes.count,bytes[i]==123 else{return nil};i+=1;space()
    if i<bytes.count && bytes[i]==125{i+=1;space();return i==bytes.count ? object:nil}
    while i<bytes.count {
        space();guard let key=string(),!keys.contains(key) else{return nil};keys.insert(key);space();guard i<bytes.count,bytes[i]==58 else{return nil};i+=1;space()
        if i<bytes.count && bytes[i]==34{guard string() != nil else{return nil}}else{let start=i;while i<bytes.count && ![UInt8(44),125,32,9,10,13].contains(bytes[i]){i+=1};guard i>start else{return nil}}
        space();guard i<bytes.count else{return nil};if bytes[i]==125{i+=1;space();return i==bytes.count ? object:nil};guard bytes[i]==44 else{return nil};i+=1
    };return nil
}
private func exactOne(_ value:Any?)->Bool{guard let number=value as? NSNumber,CFGetTypeID(number) != CFBooleanGetTypeID() else{return false};return number.doubleValue==1}

private final class NativeConfirmation {
    let id:String;let digest:String;let thread:Any;let deadline:Double;let generation:String;let task:URLSessionWebSocketTask;let full:String
    let alert=NSAlert();var timer:Timer?;var details:NSTextView?
    init(id:String,digest:String,thread:Any,deadline:Double,generation:String,task:URLSessionWebSocketTask,full:String){self.id=id;self.digest=digest;self.thread=thread;self.deadline=deadline;self.generation=generation;self.task=task;self.full=full}
}
private let origin = "cmspark-desktop://app/"
private let methods = DesktopCapabilities.methods
private final class BundledScheme: NSObject, WKURLSchemeHandler {
    let root: URL
    init(root: URL) { self.root = root }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let allowed = [origin: ("index.html", "text/html"), origin + "app.css": ("app.css", "text/css"), origin + "app.js": ("app.js", "text/javascript")]
        guard let raw = task.request.url?.absoluteString, let resource = allowed[raw], let url = task.request.url,
              let data = try? Data(contentsOf: root.appendingPathComponent(resource.0)) else { task.didFailWithError(NSError(domain:"DesktopResourceDenied",code:1)); return }
        task.didReceive(URLResponse(url:url,mimeType:resource.1,expectedContentLength:data.count,textEncodingName:"utf-8"));task.didReceive(data);task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
private final class NativeDesktop: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let capability: String; let key: SymmetricKey; let endpoint: URL
    var socket: URLSessionWebSocketTask?; var session: URLSession?
    var phase = "initial"; var connection: String?; var authenticated = false
    var web: WKWebView?; var window: NSWindow?; var generation: String?
    var requests = [String: (nativeId: String, uiId: String?, generation: String, thread: String?)]()
    var confirmation:NativeConfirmation?
    var parentWatch: DispatchSourceProcess?; var view = "compact"
    var compactSize = NSSize(width:360,height:420); var workspaceSize = NSSize(width:1040,height:760)
    init(_ bootstrap: [String:Any], parent: pid_t) {
        self.capability = bootstrap["capability_id"] as! String
        self.key = SymmetricKey(data: Data(hex:bootstrap["secret"] as! String)!)
        self.endpoint = URL(string: bootstrap["url"] as! String)!
        super.init()
        parentWatch = DispatchSource.makeProcessSource(identifier:parent,eventMask:.exit,queue:.main)
        parentWatch?.setEventHandler { exit(1) }; parentWatch?.resume()
    }
    func applicationDidFinishLaunching(_ notification: Notification) { connect() }
    func connect() {
        guard getppid() > 1 else { exit(1) }
        authenticated=false;phase="initial";connection=nil
        let s=URLSession(configuration:.ephemeral);session=s
        var request=URLRequest(url:endpoint);request.setValue("cmspark-desktop-native://local",forHTTPHeaderField:"Origin")
        let task=s.webSocketTask(with:request);socket=task;task.resume();receive(task)
    }
    func transmit(_ value:[String:Any], to task: URLSessionWebSocketTask) {
        guard socket === task, let data=try? JSONSerialization.data(withJSONObject:value),let text=String(data:data,encoding:.utf8) else { return }
        task.send(.string(text)) { error in if error != nil { DispatchQueue.main.async { self.offline(task) } } }
    }
    func receive(_ task:URLSessionWebSocketTask) {
        task.receive { result in DispatchQueue.main.async {
            guard self.socket === task else { return }
            switch result {
            case .failure(let error): self.offline(task, code:(error as NSError).code)
            case .success(let message):
                let data:Data
                switch message {case .string(let s): data=Data(s.utf8);case .data(let d):data=d;@unknown default:self.offline(task);return}
                // Auth/control frames are flat; projected list replies legitimately contain arrays.
                guard let f=(self.phase == "ready" ? (try? JSONSerialization.jsonObject(with:data)) as? [String:Any] : flatFrame(data)) else { self.offline(task);return }
                if self.phase == "ready",let kind=f["type"] as? String,["desktop.window","desktop.close","desktop.confirmation.request","desktop.confirmation.resolved"].contains(kind),flatFrame(data)==nil { self.offline(task);return }
                self.accept(f,task);if self.socket === task { self.receive(task) }
            }
        } }
    }
    // Controller-only native UI. This private payload is never passed to deliver/WebView.
    func retireConfirmation(_ approved:Bool?,notify:Bool=true) {
        guard let p=confirmation else{return};confirmation=nil;p.timer?.invalidate()
        if let parent=p.alert.window.sheetParent{parent.endSheet(p.alert.window,returnCode:.abort)}
        if notify,let approved=approved,authenticated,socket === p.task,p.generation==generation,Date().timeIntervalSince1970*1000<p.deadline {
            transmit(["type":"desktop.confirmation.decision","confirmation_id":p.id,"action_digest":p.digest,"thread_id":p.thread,"approved":approved],to:p.task)
        }
    }
    @objc func revealConfirmation(_ sender:Any?) {guard let p=confirmation else{return};p.details?.string=p.full}
    func beginConfirmation(_ f:[String:Any],_ task:URLSessionWebSocketTask) {
        guard confirmation==nil,Set(f.keys)==["type","request_id","confirmation_id","thread_id","action_digest","action_json","deadline_ms","timeout_ms"],
              let request=requests["desktop.mcp.save"],request.nativeId==(f["request_id"] as? String),request.generation==generation,
              let id=f["confirmation_id"] as? String,!id.isEmpty,let digest=f["action_digest"] as? String,Self.hex(digest,64),
              let full=f["action_json"] as? String,SHA256.hash(data:Data(full.utf8)).map({String(format:"%02x",$0)}).joined()==digest,
              let raw=full.data(using:.utf8),let action=(try? JSONSerialization.jsonObject(with:raw)) as? [String:Any],let server=action["server"] as? [String:Any],
              let operation=action["action"] as? String,["add","update"].contains(operation),let name=action["name"] as? String,
              let deadline=f["deadline_ms"] as? NSNumber,CFGetTypeID(deadline) != CFBooleanGetTypeID(),let timeout=f["timeout_ms"] as? NSNumber,CFGetTypeID(timeout) != CFBooleanGetTypeID(),
              timeout.doubleValue>0,timeout.doubleValue<=45000,deadline.doubleValue>Date().timeIntervalSince1970*1000,deadline.doubleValue<=Date().timeIntervalSince1970*1000+timeout.doubleValue,
              let thread=f["thread_id"],(thread is NSNull && request.thread==nil)||(thread as? String != nil && (thread as? String)==request.thread),let generation=generation,let window=window else{return}
        let p=NativeConfirmation(id:id,digest:digest,thread:thread,deadline:deadline.doubleValue,generation:generation,task:task,full:full);confirmation=p
        p.alert.messageText="确认保存 MCP stdio 配置"
        p.alert.informativeText="此操作可能启动或重启本地进程。仅原生窗口可批准；凭据默认隐藏。"
        p.alert.addButton(withTitle:"取消");let approve=p.alert.addButton(withTitle:"确认并保存");approve.keyEquivalent=""
        let content=NSView(frame:NSRect(x:0,y:0,width:520,height:300)),scroll=NSScrollView(frame:NSRect(x:0,y:38,width:520,height:262))
        scroll.hasVerticalScroller=true;scroll.hasHorizontalScroller=true
        let text=NSTextView(frame:scroll.bounds);text.isEditable=false;text.isRichText=false;text.isSelectable=true
        let safe:[String:Any]=["action":operation,"name":name,"command":server["command"] ?? "","args":server["args"] ?? [],"cwd":server["cwd"] ?? "","enabled":server["enabled"] ?? false,"enable_global":action["enable_global"] ?? false,"env":"隐藏；完整操作可在本原生窗口查看"]
        if let data=try? JSONSerialization.data(withJSONObject:safe,options:[.prettyPrinted,.sortedKeys]),let value=String(data:data,encoding:.utf8){text.string=value}
        scroll.documentView=text;content.addSubview(scroll);p.details=text
        let reveal=NSButton(title:"查看完整操作（含私有配置）",target:self,action:#selector(revealConfirmation(_:)));reveal.frame=NSRect(x:0,y:0,width:320,height:30);content.addSubview(reveal);p.alert.accessoryView=content
        p.timer=Timer.scheduledTimer(withTimeInterval:max(0.001,(p.deadline-Date().timeIntervalSince1970*1000)/1000),repeats:false){[weak self,weak p] _ in guard let self=self,let p=p,self.confirmation === p else{return};self.retireConfirmation(nil)}
        p.alert.beginSheetModal(for:window){[weak self,weak p] response in guard let self=self,let p=p,self.confirmation === p else{return};self.retireConfirmation(response == .alertSecondButtonReturn)}
    }
    func accept(_ f:[String:Any],_ task:URLSessionWebSocketTask) {
        guard let type=f["type"] as? String else { offline(task);return }
        if phase=="initial" && type=="desktop.challenge.request" && Set(f.keys)==["type"] {
            phase="hello";transmit(["type":"desktop.hello","capability_id":capability,"protocol_version":1],to:task);return
        }
        if phase=="hello" && type=="desktop.challenge" {
            guard Set(f.keys)==["type","capability_id","connection_id","protocol_version","nonce"],f["capability_id"] as? String==capability,
                  exactOne(f["protocol_version"]),let cid=f["connection_id"] as? String,Self.hex(cid,32),let nonce=f["nonce"] as? String,Self.hex(nonce,64) else { offline(task);return }
            connection=cid;phase="proof"
            // IDs/domain are ASCII, fixed integer1; match daemon's exact compact JSON array.
            let input="[\"cmspark.desktop.auth.v1\",\"\(capability)\",\"\(cid)\",1,\"\(nonce)\"]"
            let proof=HMAC<SHA256>.authenticationCode(for:Data(input.utf8),using:key).map{String(format:"%02x",$0)}.joined()
            transmit(["type":"desktop.authenticate","capability_id":capability,"protocol_version":1,"proof":proof],to:task);return
        }
        if phase=="proof" && type=="desktop.ready" && Set(f.keys)==["type","protocol_version"] && exactOne(f["protocol_version"]) {
            phase="ready";authenticated=true;if window == nil { buildWindow() } else if web?.url?.absoluteString==origin { generation=UUID().uuidString;deliver(["type":"desktop.document","generation":generation!]) };return
        }
        guard authenticated,phase=="ready" else { offline(task);return }
        if type=="desktop.window",Set(f.keys)==["type","view"],let requested=f["view"] as? String,["compact","workspace"].contains(requested) { show(requested);return }
        if type=="desktop.close",Set(f.keys)==["type"] { NSApp.terminate(nil);return }
        if type=="desktop.confirmation.request" {beginConfirmation(f,task);return}
        if type=="desktop.confirmation.resolved" {if f["confirmation_id"] as? String==confirmation?.id{retireConfirmation(nil)};return}
        guard let id=f["id"] as? String,let pair=requests.first(where:{$0.value.nativeId==id}),pair.value.generation==generation else { return }
        requests.removeValue(forKey:pair.key)
        if pair.key=="thread.peek",f["type"] as? String=="thread.peek_result",f["thread_id"] as? String != pair.value.thread { return }
        if ["desktop.thread.metadata.edit","desktop.thread.metadata.save"].contains(pair.key),f["type"] as? String != pair.key+".result" || f["thread_id"] as? String != pair.value.thread { return }
        var reply=f;reply["id"]=pair.value.uiId;deliver(reply)
    }
    func offline(_ task:URLSessionWebSocketTask, code:Int = 0) {
        guard socket === task else { return };let wasAuthenticated=authenticated;retireConfirmation(nil);socket=nil;authenticated=false;generation=nil;requests.removeAll();task.cancel(with:.goingAway,reason:nil);session?.invalidateAndCancel();deliver(["type":"desktop.offline"])
        // Credential stays native; a fresh connection/nonce is required. Never tray fallback.
        if !wasAuthenticated { switch code { case -1022: exit(42);case -1011:exit(43);case -1004:exit(44);case 0:exit(45);default:exit(41) } }
        DispatchQueue.main.asyncAfter(deadline:.now()+5) { if self.socket == nil { self.connect() } }
    }
    func buildWindow() {
        let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent()
        let executable=URL(fileURLWithPath:CommandLine.arguments[0]).resolvingSymlinksInPath()
        config.setURLSchemeHandler(BundledScheme(root:executable.deletingLastPathComponent().appendingPathComponent("assets")),forURLScheme:"cmspark-desktop")
        config.userContentController.add(self,name:"desktop")
        let w=WKWebView(frame:.zero,configuration:config);w.navigationDelegate=self;w.uiDelegate=self
        if #available(macOS 13.3,*) { w.isInspectable=false }
        let win=NSWindow(contentRect:NSRect(origin:.zero,size:compactSize),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        win.title="CMspark 工作台";win.contentView=w;win.delegate=self;win.center();web=w;window=win
        w.load(URLRequest(url:URL(string:origin)!))
    }
    func show(_ next:String) {
        guard let win=window else { return }
        if view != next { if view=="compact" {compactSize=win.contentLayoutRect.size}else{workspaceSize=win.contentLayoutRect.size};view=next;win.setContentSize(next=="compact" ? compactSize:workspaceSize) }
        if let screen=win.screen ?? NSScreen.main { var frame=win.frame;frame.size.width=min(frame.width,screen.visibleFrame.width);frame.size.height=min(frame.height,screen.visibleFrame.height);frame.origin.x=max(screen.visibleFrame.minX,min(frame.origin.x,screen.visibleFrame.maxX-frame.width));frame.origin.y=max(screen.visibleFrame.minY,min(frame.origin.y,screen.visibleFrame.maxY-frame.height));win.setFrame(frame,display:true) }
        win.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
    }
    func windowWillClose(_ notification:Notification) { NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification:Notification) { retireConfirmation(false);socket?.cancel(with:.normalClosure,reason:nil);parentWatch?.cancel() }
    func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {
        var download=false
        if #available(macOS 11.3,*) { download=navigationAction.shouldPerformDownload }
        let allowed = !download && navigationAction.targetFrame?.isMainFrame==true && navigationAction.request.url?.absoluteString==origin
        if allowed { retireConfirmation(false);generation=nil;requests.removeAll() };decisionHandler(allowed ? .allow:.cancel)
    }
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) {
        guard authenticated,webView.url?.absoluteString==origin else{return};generation=UUID().uuidString;deliver(["type":"desktop.document","generation":generation!])
    }
    func webView(_ webView:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for navigationAction:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView? { nil }
    func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {
        guard authenticated,let web=web,message.webView === web,message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.protocol=="cmspark-desktop",message.frameInfo.securityOrigin.host=="app",web.url?.absoluteString==origin,
              let f=message.body as? [String:Any],let g=f["generation"] as? String,g==generation,let type=f["type"] as? String else{return}
        if type=="desktop.view",Set(f.keys)==["type","view","generation"],let view=f["view"] as? String,["compact","workspace"].contains(view){show(view);return}
        let allowed:Set<String>
        if type=="desktop.mcp.edit" {allowed=["type","id","name","thread_id","generation"]}
        else if type=="desktop.mcp.save" {allowed=["type","id","name","thread_id","action","payload_json","generation"]}
        else if type=="desktop.thread.metadata.edit" {allowed=["type","id","thread_id","generation"]}
        else if type=="desktop.thread.metadata.save" {allowed=["type","id","thread_id","payload_json","generation"]}
        else {allowed=type=="thread.peek" ? ["type","id","thread_id","generation"]:["type","id","generation"]}
        if type.hasPrefix("desktop.mcp.") {
            guard Set(f.keys)==allowed,f["name"] is String,f["thread_id"] is NSNull || f["thread_id"] is String,requests["desktop.mcp.save"]==nil else{return}
            if type=="desktop.mcp.save" {guard f["payload_json"] is String,let action=f["action"] as? String,["add","update"].contains(action) else{return}}
        }
        if ["desktop.thread.metadata.edit","desktop.thread.metadata.save"].contains(type) {guard Set(f.keys)==allowed,let id=f["id"] as? String,!id.isEmpty,id.utf16.count<=200,let target=f["thread_id"] as? String,!target.isEmpty else{return};if type=="desktop.thread.metadata.save" {guard let payload=f["payload_json"] as? String,!payload.isEmpty else{return}}}
        guard Set(f.keys).isSubset(of:allowed),methods.contains(type),f["id"]==nil || f["id"] is String,let socket=socket else{return}
        if type=="thread.peek" { guard let id=f["thread_id"] as? String,!id.isEmpty else{return} }
        let id=UUID().uuidString;requests[type]=(id,f["id"] as? String,g,f["thread_id"] as? String)
        var out=f;out.removeValue(forKey:"generation");out["id"]=id;transmit(out,to:socket)
    }
    func deliver(_ frame:[String:Any]) {
        guard let w=web,w.url?.absoluteString==origin else{return}
        // Fixed code and typed arguments; no content interpolation into JavaScript.
        if #available(macOS 11.0,*) { w.callAsyncJavaScript("window.cmsparkDesktopReceive(frame)",arguments:["frame":frame],in:nil,in:.page,completionHandler:nil) }
    }
    static func hex(_ s:String,_ n:Int)->Bool{s.utf8.count==n && s.utf8.allSatisfy{($0>=48 && $0<=57)||($0>=97 && $0<=102)}}
}
private extension Data { init?(hex:String){guard hex.count%2==0 else{return nil};var bytes=[UInt8]();var i=hex.startIndex;while i<hex.endIndex{let j=hex.index(i,offsetBy:2);guard let b=UInt8(hex[i..<j],radix:16)else{return nil};bytes.append(b);i=j};self.init(bytes)} }

// Observe actual parent identity before touching the inherited bootstrap descriptor.
let parent=getppid();guard parent>1,isatty(STDIN_FILENO)==0 else{exit(11)}
let bootstrapWatch=DispatchSource.makeProcessSource(identifier:parent,eventMask:.exit,queue:.global());bootstrapWatch.setEventHandler{exit(1)};bootstrapWatch.resume()
var data=Data()
while true { do { guard let part=try FileHandle.standardInput.read(upToCount:4097-data.count),!part.isEmpty else{break};data.append(part);if data.count>4096{exit(14)} } catch {exit(13)} }
try? FileHandle.standardInput.close()
guard getppid()==parent,let bootstrap=flatFrame(data),Set(bootstrap.keys)==["capability_id","secret","url","protocol_version","issued_method_set_version"],let cap=bootstrap["capability_id"] as? String,NativeDesktop.hex(cap,32),let secret=bootstrap["secret"] as? String,NativeDesktop.hex(secret,64),exactOne(bootstrap["protocol_version"]),(bootstrap["issued_method_set_version"] as? NSNumber)?.doubleValue==Double(DesktopCapabilities.version) && CFGetTypeID(bootstrap["issued_method_set_version"] as! NSNumber) != CFBooleanGetTypeID() && DesktopCapabilities.version==3,let endpoint=bootstrap["url"] as? String,let url=URL(string:endpoint),url.scheme=="ws",url.host=="127.0.0.1",url.path=="/desktop",url.user==nil,url.password==nil,url.query==nil,url.fragment==nil,url.port != nil else{exit(15)}
data.resetBytes(in:0..<data.count)
let app=NSApplication.shared;private let delegate=NativeDesktop(bootstrap,parent:parent);app.delegate=delegate;app.setActivationPolicy(.regular);bootstrapWatch.cancel();app.run()
