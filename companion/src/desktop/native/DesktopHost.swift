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
    var purpose:String?
    let alert=NSAlert();var timer:Timer?;var details:NSTextView?
    init(id:String,digest:String,thread:Any,deadline:Double,generation:String,task:URLSessionWebSocketTask,full:String){self.id=id;self.digest=digest;self.thread=thread;self.deadline=deadline;self.generation=generation;self.task=task;self.full=full}
}
private let origin = "cmspark-desktop://app/"
private let methods = DesktopCapabilities.methods
private final class BundledScheme: NSObject, WKURLSchemeHandler {
    let root: URL
    var styleNonce=""
    func newDocument(){styleNonce=(UUID().uuidString+UUID().uuidString).replacingOccurrences(of:"-",with:"").lowercased()}
    static func styledHTML(_ raw:Data,_ nonce:String)->Data? {
        guard nonce.utf8.count==64,nonce.utf8.allSatisfy({(48...57).contains($0)||(97...102).contains($0)}),let text=String(data:raw,encoding:.utf8) else{return nil}
        let marker="__CM_STYLE_NONCE__",contexts=["'nonce-__CM_STYLE_NONCE__'","name=\"cmspark-style-nonce\" content=\"__CM_STYLE_NONCE__\""]
        guard text.components(separatedBy:marker).count==3,contexts.allSatisfy({text.components(separatedBy:$0).count==2}) else{return nil}
        let prepared=text.replacingOccurrences(of:marker,with:nonce)
        guard !prepared.contains(marker) else{return nil};return prepared.data(using:.utf8)
    }
    init(root: URL) { self.root = root }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let allowed = [origin: ("index.html", "text/html"), origin + "app.css": ("app.css", "text/css"), origin + "app.js": ("app.js", "text/javascript"), origin + "terminal.css": ("terminal.css", "text/css"), origin + "terminal-fit.js": ("terminal-fit.js", "text/javascript"), origin + "terminal-core.js": ("terminal-core.js", "text/javascript"), origin + "local-work.js": ("local-work.js", "text/javascript")]
        guard let raw = task.request.url?.absoluteString, let resource = allowed[raw], let url = task.request.url,
              var data = try? Data(contentsOf: root.appendingPathComponent(resource.0)) else { task.didFailWithError(NSError(domain:"DesktopResourceDenied",code:1)); return }
        if resource.0=="index.html" {guard let prepared=Self.styledHTML(data,styleNonce) else{task.didFailWithError(NSError(domain:"DesktopResourceDenied",code:1));return};data=prepared}
        task.didReceive(URLResponse(url:url,mimeType:resource.1,expectedContentLength:data.count,textEncodingName:"utf-8"));task.didReceive(data);task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}
private final class NativeDesktop: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
    let capability: String; let key: SymmetricKey; let endpoint: URL
    var socket: URLSessionWebSocketTask?; var session: URLSession?
    var phase = "initial"; var connection: String?; var authenticated = false
    var bundledScheme:BundledScheme?
    var web: WKWebView?; var window: NSWindow?; var generation: String?
    var requests = [String: (nativeId: String, uiId: String?, generation: String, thread: String?, kind: String?, target: String?, revision: String?)]()
    typealias LocalPending=(nativeId:String,uiId:String?,generation:String,thread:String?,kind:String?,target:String?,revision:String?)
    var localOperations=[String:LocalPending]();var localRequests=[String:(pending:LocalPending,method:String,operation:String?)]();var localClosed=Set<String>();var localThread:String?
    var archiveTarget:String?
    var browserRequest:String?;var browserThread:String?
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
            var result:[String:Any] = ["type":"desktop.confirmation.decision","confirmation_id":p.id,"action_digest":p.digest,"thread_id":p.thread,"approved":approved]
            if p.purpose=="resource" {result["purpose"]="resource"}else if p.purpose=="local-work" {result["purpose"]="local-work"};transmit(result,to:p.task)
        }
    }
    @objc func revealConfirmation(_ sender:Any?) {guard let p=confirmation else{return};p.details?.string=p.full}
    func beginConfirmation(_ f:[String:Any],_ task:URLSessionWebSocketTask) {
        let resource=f["purpose"] as? String=="resource",local=f["purpose"] as? String=="local-work"
        let method=(resource || local) ? f["request_method"] as? String:"desktop.mcp.save"
        let expected:Set<String> = (resource || local) ? ["type","purpose","request_method","request_id","confirmation_id","thread_id","action_digest","action_json","deadline_ms","timeout_ms"]:["type","request_id","confirmation_id","thread_id","action_digest","action_json","deadline_ms","timeout_ms"]
        let binding=local ? localOperations[f["request_id"] as? String ?? ""]:requests[method ?? ""]
        guard confirmation==nil,Set(f.keys)==expected,let method=method,(!local || ["desktop.terminal.open","desktop.terminal.return"].contains(method)),(!resource || ["desktop.resource.import","desktop.resource.update","desktop.resource.remove"].contains(method)),
              let request=binding,(!local || request.thread==localThread),request.nativeId==(f["request_id"] as? String),request.generation==generation,
              let id=f["confirmation_id"] as? String,!id.isEmpty,let digest=f["action_digest"] as? String,Self.hex(digest,64),
              let full=f["action_json"] as? String,SHA256.hash(data:Data(full.utf8)).map({String(format:"%02x",$0)}).joined()==digest,
              let raw=full.data(using:.utf8),let action=(try? JSONSerialization.jsonObject(with:raw)) as? [String:Any],
              let deadline=f["deadline_ms"] as? NSNumber,CFGetTypeID(deadline) != CFBooleanGetTypeID(),let timeout=f["timeout_ms"] as? NSNumber,CFGetTypeID(timeout) != CFBooleanGetTypeID(),
              timeout.doubleValue>0,timeout.doubleValue<=45000,deadline.doubleValue>Date().timeIntervalSince1970*1000,deadline.doubleValue<=Date().timeIntervalSince1970*1000+timeout.doubleValue,
              let thread=f["thread_id"],(thread is NSNull && request.thread==nil)||(thread as? String != nil && (thread as? String)==request.thread),let generation=generation,let window=window else{return}
        let safe:[String:Any]
        if local {
            guard Set(action.keys)==["purpose","kind","thread_id","operation_id","payload"],action["purpose"] as? String=="local-work",action["thread_id"] as? String==request.thread,action["operation_id"] as? String==request.nativeId,let payload=action["payload"] as? [String:Any],let kind=action["kind"] as? String,["terminal-open":"desktop.terminal.open","terminal-return":"desktop.terminal.return"][kind]==method else{return}
            guard localRequests.values.contains(where:{$0.method==method && $0.pending.generation==generation && $0.pending.thread==request.thread && ($0.operation ?? $0.pending.nativeId)==request.nativeId}) else{return}
            if kind=="terminal-open"{guard payload["revision"] as? String==request.revision else{return}}
            safe=action
        } else if resource {
            guard Set(action.keys)==["purpose","op","kind","resource_id","revision","payload","thread_id"],action["purpose"] as? String=="resource",action["op"] as? String==String(method.dropFirst(17)),action["kind"] as? String==request.kind,let target=action["resource_id"] as? String,!target.isEmpty,thread is NSNull,action["thread_id"] is NSNull,action["payload"] is [String:Any] else{return}
            if method=="desktop.resource.import" {guard action["revision"] is NSNull else{return}}
            else {guard target==request.target,action["revision"] as? String==request.revision else{return}}
            safe=action
        } else {
            guard let server=action["server"] as? [String:Any],let operation=action["action"] as? String,["add","update"].contains(operation),let name=action["name"] as? String else{return}
            safe=["action":operation,"name":name,"command":server["command"] ?? "","args":server["args"] ?? [],"cwd":server["cwd"] ?? "","enabled":server["enabled"] ?? false,"enable_global":action["enable_global"] ?? false,"env":"隐藏；完整操作可在本原生窗口查看"]
        }
        let p=NativeConfirmation(id:id,digest:digest,thread:thread,deadline:deadline.doubleValue,generation:generation,task:task,full:full);p.purpose=local ? "local-work":resource ? "resource":nil;confirmation=p
        p.alert.messageText=local ? "确认本地终端操作":resource ? "确认全局技能／知识变更":"确认保存 MCP stdio 配置"
        p.alert.informativeText=local ? "用户终端可执行命令并离开起始目录；不是 OS 沙箱；本次许可不授权模型读取终端屏显。启动／保存所选摘录的完整操作如下。":resource ? "全局资源变更可能影响后续对话读取；管理许可不授权执行内容。完整操作如下。":"此操作可能启动或重启本地进程。仅原生窗口可批准；凭据默认隐藏。"
        p.alert.addButton(withTitle:"取消");let approve=p.alert.addButton(withTitle:"确认并保存");approve.keyEquivalent=""
        let content=NSView(frame:NSRect(x:0,y:0,width:520,height:300)),scroll=NSScrollView(frame:NSRect(x:0,y:38,width:520,height:262))
        scroll.hasVerticalScroller=true;scroll.hasHorizontalScroller=true
        let text=NSTextView(frame:scroll.bounds);text.isEditable=false;text.isRichText=false;text.isSelectable=true
        if let data=try? JSONSerialization.data(withJSONObject:safe,options:[.prettyPrinted,.sortedKeys]),let value=String(data:data,encoding:.utf8){text.string=value}
        scroll.documentView=text;content.addSubview(scroll);p.details=text
        let reveal=NSButton(title:"查看完整操作（含私有配置）",target:self,action:#selector(revealConfirmation(_:)));reveal.frame=NSRect(x:0,y:0,width:320,height:30);content.addSubview(reveal);p.alert.accessoryView=content
        p.timer=Timer.scheduledTimer(withTimeInterval:max(0.001,(p.deadline-Date().timeIntervalSince1970*1000)/1000),repeats:false){[weak self,weak p] _ in guard let self=self,let p=p,self.confirmation === p else{return};self.retireConfirmation(nil)}
        p.alert.beginSheetModal(for:window){[weak self,weak p] response in guard let self=self,let p=p,self.confirmation === p else{return};self.retireConfirmation(response == .alertSecondButtonReturn)}
    }
    // Retire the server snapshot without tracking/delivering a new document reply.
    func retireBrowser(_ all:Bool) {
        let parent=browserRequest
        requests.removeValue(forKey:"desktop.browser.tasks");requests.removeValue(forKey:"desktop.browser.visibility")
        if all {browserRequest=nil;browserThread=nil}
        if authenticated,let parent=parent,let socket=socket {transmit(["type":"desktop.browser.retire","context_request_id":parent,"scope":all ? "all":"view"],to:socket)}
    }
    static let localMethods:Set<String>=["desktop.local.state","desktop.terminal.open","desktop.terminal.input","desktop.terminal.resize","desktop.terminal.ack","desktop.terminal.ping","desktop.terminal.close","desktop.terminal.return"]
    static func localInteger(_ value:Any?,_ maximum:Double)->Bool {guard let n=value as? NSNumber,CFGetTypeID(n) != CFBooleanGetTypeID() else{return false};return n.doubleValue.isFinite && n.doubleValue>=1 && n.doubleValue<=maximum && n.doubleValue.rounded(.towardZero)==n.doubleValue}
    static func localBase64(_ value:String)->Bool {guard !value.isEmpty,value.utf8.count<=21848,let data=Data(base64Encoded:value),!data.isEmpty,data.count<=16384 else{return false};return data.base64EncodedString()==value}
    func retireLocal() {
        if confirmation?.purpose=="local-work" {retireConfirmation(false)}
        if authenticated,let socket=socket {for(id,op)in localOperations where op.generation==generation {transmit(["type":"desktop.terminal.close","id":UUID().uuidString,"thread_id":op.thread ?? "","operation_id":id],to:socket)}}
        localOperations.removeAll();localRequests.removeAll();localClosed.removeAll();localThread=nil
    }
    func renderLocal(_ f:[String:Any]) {
        guard let type=f["type"] as? String,Self.localMethods.contains(type),methods.contains(type),let id=f["id"] as? String,!id.isEmpty,id.utf8.count<=200,let thread=f["thread_id"] as? String,!thread.isEmpty,let generation=generation,let socket=socket else{return}
        let start=["desktop.terminal.open"].contains(type)
        var expected:Set<String>=["type","id","thread_id","generation"]
        if start {expected.insert("revision")}
        if ["desktop.terminal.open","desktop.terminal.resize"].contains(type){expected.formUnion(["cols","rows"]);guard Self.localInteger(f["cols"],500),Self.localInteger(f["rows"],200) else{return}}
        if type != "desktop.local.state" && !start {expected.insert("operation_id")}
        if ["desktop.terminal.input","desktop.terminal.ack"].contains(type){expected.insert("seq");guard Self.localInteger(f["seq"],9007199254740991) else{return}}
        if type=="desktop.terminal.input" {expected.insert("b64");guard let text=f["b64"] as? String,Self.localBase64(text) else{return}}
        if ["desktop.terminal.return"].contains(type){expected.insert("text");guard let text=f["text"] as? String,!text.isEmpty,text.utf16.count<=48000 else{return}}
        guard Set(f.keys)==expected else{return}
        if start {guard let revision=f["revision"] as? String,Self.hex(revision,64) else{return}}
        var frame=f,operation:String?
        if let original=f["operation_id"] {guard let original=original as? String,let found=localOperations.first(where:{$0.value.uiId==original && $0.value.thread==thread && $0.value.generation==generation}),(type.hasPrefix("desktop.terminal."))==(found.value.kind=="terminal") else{return};operation=found.key;frame["operation_id"]=found.key}
        if type=="desktop.local.state" {if confirmation?.purpose=="local-work" {retireConfirmation(false)};localThread=thread}
        if ["desktop.terminal.open","desktop.terminal.input","desktop.terminal.resize","desktop.terminal.return"].contains(type),localThread != thread{return}
        let native=UUID().uuidString,pending:LocalPending=(native,id,generation,thread,"terminal",nil,f["revision"] as? String)
        if start {guard !localOperations.contains(where:{$0.value.generation==generation && (!localClosed.contains($0.key) || $0.value.uiId==id)}) else{return};if confirmation?.purpose=="local-work" {retireConfirmation(false)};localOperations[native]=pending}
        localRequests[native]=(pending,type,operation);frame.removeValue(forKey:"generation");frame["id"]=native;transmit(frame,to:socket)
    }
    func acceptLocal(_ f:[String:Any])->Bool {
        guard let type=f["type"] as? String else{return false}
        if ["desktop.terminal.data","desktop.terminal.closed","desktop.terminal.heartbeat"].contains(type){guard let operation=f["operation_id"] as? String,let op=localOperations[operation],op.generation==generation,f["thread_id"] as? String==op.thread,(type.hasPrefix("desktop.terminal."))==(op.kind=="terminal") else{return true};if type=="desktop.terminal.heartbeat"{if let socket=socket{transmit(["type":"desktop.terminal.ping","id":UUID().uuidString,"thread_id":op.thread ?? "","operation_id":operation],to:socket)};return true};if type=="desktop.terminal.closed"{localClosed.insert(operation)};var reply=f;reply["operation_id"]=op.uiId;deliver(reply);return true}
        guard let id=f["id"] as? String,let request=localRequests[id] else{return false}
        guard request.pending.generation==generation,type==request.method+".result",f["thread_id"] as? String==request.pending.thread else{return true}
        var reply=f
        if f["operation_id"] != nil {let expected=request.operation ?? request.pending.nativeId;guard f["operation_id"] as? String==expected,let op=localOperations[expected] else{return true};reply["operation_id"]=op.uiId}
        if request.method=="desktop.local.state",var state=f["state"] as? [String:Any],let rows=state["operations"] as? [[String:Any]] {state["operations"]=rows.compactMap { row -> [String:Any]? in guard let operation=row["operation_id"] as? String,let op=localOperations[operation],op.generation==generation,op.thread==request.pending.thread else{return nil};var mapped=row;mapped["operation_id"]=op.uiId;return mapped};reply["state"]=state}
        if request.method=="desktop.terminal.open" {guard let ok=f["ok"] as? Bool else{return true};if !ok{localOperations.removeValue(forKey:request.pending.nativeId)}else{guard reply["operation_id"] as? String==request.pending.uiId else{return true};for old in Array(localOperations.keys) where old != request.pending.nativeId && localClosed.contains(old){localClosed.remove(old);localOperations.removeValue(forKey:old)}}}
        if request.method=="desktop.terminal.close",f["status"] as? String=="closed",let operation=request.operation{localClosed.insert(operation)}
        localRequests.removeValue(forKey:id);reply["id"]=request.pending.uiId;deliver(reply);return true
    }
    func retireArchive() {
        let target=archiveTarget;archiveTarget=nil
        requests.removeValue(forKey:"desktop.archive.state");requests.removeValue(forKey:"desktop.archive.set")
        if authenticated,let target=target,let socket=socket {transmit(["type":"desktop.archive.state","id":UUID().uuidString,"thread_id":target],to:socket)}
    }
    func retireDialog() {
        retireLocal()
        guard let run=requests["desktop.chat.send"] else{return};requests.removeValue(forKey:"desktop.chat.send")
        if authenticated,let socket=socket {transmit(["type":"desktop.chat.stop","id":UUID().uuidString,"thread_id":run.thread ?? "","run_id":run.nativeId],to:socket)}
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
        if acceptLocal(f){return}
        guard let id=f["id"] as? String,let pair=requests.first(where:{$0.value.nativeId==id}),pair.value.generation==generation else { return }
        if pair.key=="desktop.chat.send" {
            guard f["thread_id"] as? String==pair.value.thread,["desktop.chat.send.result","desktop.chat.event"].contains(type) else{return}
            if f["run_id"] != nil && f["run_id"] as? String != pair.value.nativeId{return}
            if type=="desktop.chat.event" {guard f["run_id"] as? String==pair.value.nativeId,let kind=f["kind"] as? String,["user","snapshot","assistant","done","aborted","error","confirmation_unavailable","terminal"].contains(kind) else{return};if kind=="terminal"{requests.removeValue(forKey:pair.key)}}
            else {guard let ok=f["ok"] as? Bool else{return};if !ok{requests.removeValue(forKey:pair.key)}}
            var reply=f;reply["id"]=pair.value.uiId;if f["run_id"] != nil {reply["run_id"]=pair.value.uiId};deliver(reply);return
        }
        var mapped=f
        if ["desktop.thread.create","desktop.thread.open","desktop.chat.stop"].contains(pair.key) {
            guard type==pair.key+".result",pair.key=="desktop.thread.create" || f["thread_id"] as? String==pair.value.thread else{return}
            let active=requests["desktop.chat.send"]
            if pair.key=="desktop.thread.open",f["owned_run_id"] != nil {if let active=active,active.generation==generation,active.thread==pair.value.thread,f["owned_run_id"] as? String==active.nativeId{mapped["owned_run_id"]=active.uiId}else{mapped["owned_run_id"]=NSNull()}}
            if pair.key=="desktop.chat.stop",f["run_id"] != nil {guard let active=active,f["run_id"] as? String==active.nativeId else{return};mapped["run_id"]=active.uiId}
        }
        if ["desktop.archive.list","desktop.archive.state","desktop.archive.set"].contains(pair.key) {
            guard type==pair.key+".result",pair.key=="desktop.archive.list" || f["thread_id"] as? String==pair.value.thread else{return}
        }
        if pair.key.hasPrefix("desktop.browser.") {guard type==pair.key+".result",pair.key=="desktop.browser.status" || f["thread_id"] as? String==pair.value.thread else{return}}
        if pair.key.hasPrefix("desktop.resource.") && type != pair.key+".result" {return}
        requests.removeValue(forKey:pair.key)
        if pair.key=="thread.peek",f["type"] as? String=="thread.peek_result",f["thread_id"] as? String != pair.value.thread { return }
        if ["desktop.thread.metadata.edit","desktop.thread.metadata.save"].contains(pair.key),f["type"] as? String != pair.key+".result" || f["thread_id"] as? String != pair.value.thread { return }
        var reply=mapped;reply["id"]=pair.value.uiId;deliver(reply)
    }
    func offline(_ task:URLSessionWebSocketTask, code:Int = 0) {
        if socket === task {retireLocal()}
        guard socket === task else { return };let wasAuthenticated=authenticated;browserRequest=nil;browserThread=nil;archiveTarget=nil;retireConfirmation(nil);socket=nil;authenticated=false;generation=nil;requests.removeAll();task.cancel(with:.goingAway,reason:nil);session?.invalidateAndCancel();deliver(["type":"desktop.offline"])
        // Credential stays native; a fresh connection/nonce is required. Never tray fallback.
        if !wasAuthenticated { switch code { case -1022: exit(42);case -1011:exit(43);case -1004:exit(44);case 0:exit(45);default:exit(41) } }
        DispatchQueue.main.asyncAfter(deadline:.now()+5) { if self.socket == nil { self.connect() } }
    }
    func buildWindow() {
        let config=WKWebViewConfiguration();config.websiteDataStore = .nonPersistent()
        let executable=URL(fileURLWithPath:CommandLine.arguments[0]).resolvingSymlinksInPath()
        let scheme=BundledScheme(root:executable.deletingLastPathComponent().appendingPathComponent("assets"));bundledScheme=scheme;config.setURLSchemeHandler(scheme,forURLScheme:"cmspark-desktop")
        config.userContentController.add(self,name:"desktop")
        let w=WKWebView(frame:.zero,configuration:config);w.navigationDelegate=self;w.uiDelegate=self
        if #available(macOS 13.3,*) { w.isInspectable=false }
        let win=NSWindow(contentRect:NSRect(origin:.zero,size:compactSize),styleMask:[.titled,.closable,.miniaturizable,.resizable],backing:.buffered,defer:false)
        win.title="CMspark 工作台";win.contentView=w;win.delegate=self;win.center();web=w;window=win
        w.load(URLRequest(url:URL(string:origin)!))
    }
    func show(_ next:String) {
        guard let win=window else { return }
        if view != next { if confirmation?.purpose=="local-work" {retireConfirmation(false)};localThread=nil;retireArchive();if view=="compact" {compactSize=win.contentLayoutRect.size}else{workspaceSize=win.contentLayoutRect.size};view=next;win.setContentSize(next=="compact" ? compactSize:workspaceSize) }
        if let screen=win.screen ?? NSScreen.main { var frame=win.frame;frame.size.width=min(frame.width,screen.visibleFrame.width);frame.size.height=min(frame.height,screen.visibleFrame.height);frame.origin.x=max(screen.visibleFrame.minX,min(frame.origin.x,screen.visibleFrame.maxX-frame.width));frame.origin.y=max(screen.visibleFrame.minY,min(frame.origin.y,screen.visibleFrame.maxY-frame.height));win.setFrame(frame,display:true) }
        win.makeKeyAndOrderFront(nil);NSApp.activate(ignoringOtherApps:true)
    }
    func windowWillClose(_ notification:Notification) { NSApp.terminate(nil) }
    func applicationWillTerminate(_ notification:Notification) { retireBrowser(true);retireArchive();retireDialog();retireConfirmation(false);socket?.cancel(with:.normalClosure,reason:nil);parentWatch?.cancel() }
    func webView(_ webView:WKWebView,decidePolicyFor navigationAction:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void) {
        var download=false
        if #available(macOS 11.3,*) { download=navigationAction.shouldPerformDownload }
        let allowed = !download && navigationAction.targetFrame?.isMainFrame==true && navigationAction.request.url?.absoluteString==origin
        if allowed {retireLocal();bundledScheme?.newDocument()}
        if allowed { retireBrowser(true);retireArchive();retireDialog();retireConfirmation(false);generation=nil;requests.removeAll() };decisionHandler(allowed ? .allow:.cancel)
    }
    func webView(_ webView:WKWebView,didFinish navigation:WKNavigation!) {
        if authenticated,webView.url?.absoluteString==origin {retireLocal()}
        guard authenticated,webView.url?.absoluteString==origin else{return};retireArchive();generation=UUID().uuidString;deliver(["type":"desktop.document","generation":generation!])
    }
    func webView(_ webView:WKWebView,createWebViewWith configuration:WKWebViewConfiguration,for navigationAction:WKNavigationAction,windowFeatures:WKWindowFeatures)->WKWebView? { nil }
    func userContentController(_ userContentController:WKUserContentController,didReceive message:WKScriptMessage) {
        guard authenticated,let web=web,message.webView === web,message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.protocol=="cmspark-desktop",message.frameInfo.securityOrigin.host=="app",web.url?.absoluteString==origin,
              let f=message.body as? [String:Any],let g=f["generation"] as? String,g==generation,let type=f["type"] as? String else{return}
        if type=="desktop.view",Set(f.keys)==["type","view","generation"],let view=f["view"] as? String,["compact","workspace"].contains(view){show(view);return}
        if Self.localMethods.contains(type){renderLocal(f);return}
        let allowed:Set<String>
        if type=="thread.search" {allowed=f["limit"] == nil ? ["type","id","query","generation"]:["type","id","query","limit","generation"]}
        else if type=="desktop.archive.list" {allowed=f["query"] == nil ? ["type","id","generation"]:["type","id","query","generation"]}
        else if type=="desktop.browser.tasks" {allowed=["type","id","thread_id","generation"]}
        else if type=="desktop.browser.visibility" {allowed=["type","id","thread_id","context_id","selection_id","visibility","generation"]}
        else if type=="desktop.archive.state" {allowed=["type","id","thread_id","generation"]}
        else if type=="desktop.archive.set" {allowed=["type","id","thread_id","revision","archived","generation"]}
        else if type=="desktop.mcp.edit" {allowed=["type","id","name","thread_id","generation"]}
        else if type=="desktop.mcp.save" {allowed=["type","id","name","thread_id","action","payload_json","generation"]}
        else if type=="desktop.resource.read" {allowed=["type","id","kind","resource_id","generation"]}
        else if type=="desktop.resource.import" {allowed=["type","id","kind","payload_json","generation"]}
        else if type=="desktop.resource.update" {allowed=["type","id","kind","resource_id","revision","payload_json","generation"]}
        else if type=="desktop.resource.remove" {allowed=["type","id","kind","resource_id","revision","generation"]}
        else if type=="desktop.thread.metadata.edit" {allowed=["type","id","thread_id","generation"]}
        else if type=="desktop.thread.metadata.save" {allowed=["type","id","thread_id","payload_json","generation"]}
        else if type=="desktop.thread.create" {allowed=["type","id","generation"]}
        else if type=="desktop.thread.open" {allowed=["type","id","thread_id","generation"]}
        else if type=="desktop.chat.send" {allowed=["type","id","thread_id","message","generation"]}
        else if type=="desktop.chat.stop" {allowed=["type","id","thread_id","run_id","generation"]}
        else {allowed=type=="thread.peek" ? ["type","id","thread_id","generation"]:["type","id","generation"]}
        if type=="thread.search" {
            guard Set(f.keys)==allowed,let id=f["id"] as? String,id.utf16.count<=200,let query=f["query"] as? String,query.utf16.count<=120 else{return}
            if let value=f["limit"] {guard let limit=value as? NSNumber,CFGetTypeID(limit) != CFBooleanGetTypeID(),limit.doubleValue.isFinite,limit.doubleValue.rounded(.towardZero)==limit.doubleValue,limit.doubleValue>=1,limit.doubleValue<=20 else{return}}
        }
        if ["desktop.archive.list","desktop.archive.state","desktop.archive.set"].contains(type) {
            guard Set(f.keys)==allowed,let id=f["id"] as? String,!id.isEmpty,id.utf16.count<=200 else{return}
            if type=="desktop.archive.list" {if let query=f["query"] {guard let text=query as? String,text.utf16.count<=120 else{return}}}
            else {
                guard let target=f["thread_id"] as? String,!target.isEmpty,target.utf8.count<=64,target.utf8.allSatisfy({($0>=65 && $0<=90)||($0>=97 && $0<=122)||($0>=48 && $0<=57)||$0==95||$0==45}) else{return}
                if type=="desktop.archive.set" {guard let revision=f["revision"] as? String,Self.hex(revision,64),let value=f["archived"] as? NSNumber,CFGetTypeID(value)==CFBooleanGetTypeID() else{return}}
            }
        }
        if type=="desktop.browser.tasks" || type=="desktop.browser.visibility" {
            guard Set(f.keys)==allowed,let target=f["thread_id"] as? String,!target.isEmpty,target.utf8.count<=64,target.utf8.allSatisfy({($0>=65 && $0<=90)||($0>=97 && $0<=122)||($0>=48 && $0<=57)||$0==95||$0==45}) else{return}
            if type=="desktop.browser.visibility" {guard browserRequest != nil,browserThread==target,let context=f["context_id"] as? String,Self.hex(context,32),let selection=f["selection_id"] as? String,Self.hex(selection,32),let mode=f["visibility"] as? String,["background","foreground"].contains(mode) else{return}}
        }
        if type.hasPrefix("desktop.mcp.") {
            guard Set(f.keys)==allowed,f["name"] is String,f["thread_id"] is NSNull || f["thread_id"] is String,requests["desktop.mcp.save"]==nil else{return}
            if type=="desktop.mcp.save" {guard f["payload_json"] is String,let action=f["action"] as? String,["add","update"].contains(action) else{return}}
        }
        if type.hasPrefix("desktop.resource.") {
            guard ["desktop.resource.read","desktop.resource.import","desktop.resource.update","desktop.resource.remove"].contains(type),Set(f.keys)==allowed,let id=f["id"] as? String,id.range(of:"^[a-zA-Z0-9_-]{1,128}$",options:.regularExpression) != nil,let kind=f["kind"] as? String,["skill","knowledge"].contains(kind) else{return}
            if type != "desktop.resource.import" {guard let target=f["resource_id"] as? String,!target.isEmpty else{return}}
            if ["desktop.resource.update","desktop.resource.remove"].contains(type) {guard let revision=f["revision"] as? String,Self.hex(revision,64) else{return}}
            if type=="desktop.resource.update" && kind != "knowledge" {return}
            if ["desktop.resource.import","desktop.resource.update"].contains(type) {guard let payload=f["payload_json"] as? String,!payload.isEmpty else{return}}
            if type != "desktop.resource.read" && ["desktop.resource.import","desktop.resource.update","desktop.resource.remove"].contains(where:{requests[$0] != nil}) {return}
        }
        if ["desktop.thread.metadata.edit","desktop.thread.metadata.save"].contains(type) {guard Set(f.keys)==allowed,let id=f["id"] as? String,!id.isEmpty,id.utf16.count<=200,let target=f["thread_id"] as? String,!target.isEmpty else{return};if type=="desktop.thread.metadata.save" {guard let payload=f["payload_json"] as? String,!payload.isEmpty else{return}}}
        if ["desktop.thread.create","desktop.thread.open","desktop.chat.send","desktop.chat.stop"].contains(type) {
            guard Set(f.keys)==allowed,let id=f["id"] as? String,!id.isEmpty,id.utf16.count<=200 else{return}
            if type != "desktop.thread.create" {guard let target=f["thread_id"] as? String,!target.isEmpty else{return}}
            if type=="desktop.chat.send" {guard let text=f["message"] as? String,!text.isEmpty,requests[type]==nil else{return}}
            if type=="desktop.thread.create",requests[type] != nil{return}
            if type=="desktop.chat.stop" {guard let active=requests["desktop.chat.send"],active.generation==generation,active.thread==f["thread_id"] as? String,active.uiId==f["run_id"] as? String else{return}}
        }
        guard Set(f.keys).isSubset(of:allowed),methods.contains(type),f["id"]==nil || f["id"] is String,let socket=socket else{return}
        if type=="thread.peek" { guard let id=f["thread_id"] as? String,!id.isEmpty else{return} }
        let oldBrowser=browserRequest
        let changesThread=["thread.peek","desktop.thread.open","desktop.chat.send"].contains(type)
        if type=="desktop.thread.create" || (changesThread && localThread != (f["thread_id"] as? String)){if confirmation?.purpose=="local-work" {retireConfirmation(false)};localThread=nil}
        let viewFence=["thread.list","mcp.list","skill.list","knowledge.list","desktop.browser.status","desktop.browser.tasks"].contains(type) || changesThread
        let allFence=type=="desktop.thread.create" || (changesThread && browserThread != nil && browserThread != (f["thread_id"] as? String))
        if viewFence || allFence {requests.removeValue(forKey:"desktop.browser.tasks");requests.removeValue(forKey:"desktop.browser.visibility");if allFence {browserRequest=nil;browserThread=nil}}
        if type=="desktop.archive.state" || type=="desktop.archive.set" {archiveTarget=f["thread_id"] as? String}
        let id=UUID().uuidString;requests[type]=(id,f["id"] as? String,g,f["thread_id"] as? String,f["kind"] as? String,f["resource_id"] as? String,f["revision"] as? String)
        var out=f;if type=="desktop.chat.stop"{out["run_id"]=requests["desktop.chat.send"]?.nativeId};out.removeValue(forKey:"generation");out["id"]=id
        let outgoing=out
        if let parent=oldBrowser,viewFence || allFence {
            let revoke:[String:Any]=["type":"desktop.browser.retire","context_request_id":parent,"scope":allFence ? "all":"view"]
            guard let data=try? JSONSerialization.data(withJSONObject:revoke),let text=String(data:data,encoding:.utf8) else {offline(socket);return}
            socket.send(.string(text)){ error in DispatchQueue.main.async {
                guard self.socket === socket,self.generation==g,self.requests[type]?.nativeId==id else{return}
                if error != nil {self.offline(socket);return}
                if type=="desktop.browser.tasks" {self.browserRequest=id;self.browserThread=f["thread_id"] as? String}
                self.transmit(outgoing,to:socket)
            }}
        } else {if type=="desktop.browser.tasks" {self.browserRequest=id;self.browserThread=f["thread_id"] as? String};transmit(out,to:socket)}
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
guard getppid()==parent,let bootstrap=flatFrame(data),Set(bootstrap.keys)==["capability_id","secret","url","protocol_version","issued_method_set_version"],let cap=bootstrap["capability_id"] as? String,NativeDesktop.hex(cap,32),let secret=bootstrap["secret"] as? String,NativeDesktop.hex(secret,64),exactOne(bootstrap["protocol_version"]),(bootstrap["issued_method_set_version"] as? NSNumber)?.doubleValue==Double(DesktopCapabilities.version) && CFGetTypeID(bootstrap["issued_method_set_version"] as! NSNumber) != CFBooleanGetTypeID() && DesktopCapabilities.version==9,let endpoint=bootstrap["url"] as? String,let url=URL(string:endpoint),url.scheme=="ws",url.host=="127.0.0.1",url.path=="/desktop",url.user==nil,url.password==nil,url.query==nil,url.fragment==nil,url.port != nil else{exit(15)}
data.resetBytes(in:0..<data.count)
let app=NSApplication.shared;private let delegate=NativeDesktop(bootstrap,parent:parent);app.delegate=delegate;app.setActivationPolicy(.regular);bootstrapWatch.cancel();app.run()
