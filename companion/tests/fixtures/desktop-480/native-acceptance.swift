// Test binary only, appended to the exact production source. No runtime input selects script.
private final class D480Acceptance {
    static let shared=D480Acceptance()
    var firstWindow:Int?;var auths=0;var phase="initial";var admitted=0;var oldGeneration:String?
    var windowObservers=[NSObjectProtocol]();var windowObservation:(()->Void)?
    func stopWindow() {
        windowObservation=nil
        for observer in windowObservers { NotificationCenter.default.removeObserver(observer) }
        windowObservers.removeAll()
    }
    func windowCurrent(_ host:NativeDesktop,_ win:NSWindow,_ socket:URLSessionWebSocketTask,_ view:String)->Bool {
        return host.window === win && host.socket === socket && host.view==view && host.authenticated && host.phase=="ready"
    }
    func emit(_ host:NativeDesktop,_ value:String) { if let socket=host.socket { host.transmit(["type":"system.ping","id":"D480A_"+value],to:socket) } }
    func script(_ host:NativeDesktop,_ literal:String,_ generation:String?=nil) {
        guard let web=host.web,let g=generation ?? host.generation else { emit(host,"FAIL_NO_DOCUMENT");return }
        if #available(macOS 11.0,*) { web.callAsyncJavaScript(literal,arguments:["g":g],in:nil,in:.page) { result in
            if case .failure = result { DispatchQueue.main.async { self.emit(host,"FAIL_SCRIPT") } }
        } } else { emit(host,"FAIL_ENGINE_API") }
    }
    func window(_ host:NativeDesktop) {
        stopWindow()
        guard let win=host.window,let socket=host.socket else { emit(host,"FAIL_WINDOW");return }
        let view=host.view
        if firstWindow==nil { firstWindow=win.windowNumber }
        windowObservation={ [weak self,weak host,weak win,weak socket] in
            guard let self=self else{return}
            guard let host=host,let win=win,let socket=socket else{self.stopWindow();return}
            guard self.windowCurrent(host,win,socket,view) else {self.stopWindow();return}
            // Activation is a request. Observe actual native transitions rather
            // than treating one queued CPU block as AppKit completion.
            guard win.isKeyWindow && NSApp.isActive else{return}
            guard let screen=win.screen else {self.stopWindow();self.emit(host,"FAIL_WINDOW");return}
            let client=win.contentLayoutRect, frame=win.frame,work=screen.visibleFrame
            let desired=host.view=="compact" ? NSSize(width:360,height:420):NSSize(width:1040,height:760)
            let chrome=NSSize(width:frame.width-client.width,height:frame.height-client.height)
            let expected=NSSize(width:min(desired.width,work.width-chrome.width),height:min(desired.height,work.height-chrome.height))
            let ownCount=NSApp.windows.filter{($0.delegate as AnyObject?) === host}.count
            let bits=[win.isVisible,win.isKeyWindow,NSApp.isActive,self.firstWindow==win.windowNumber,ownCount==1,client.width==expected.width&&client.height==expected.height,work.contains(frame)].map{$0 ? "1":"0"}.joined()
            self.stopWindow()
            self.emit(host,"WINDOW_"+(view=="compact" ? "C":"W")+"_\(Int(client.width))_\(Int(client.height))_\(Int(expected.width))_\(Int(expected.height))_"+bits)
        }
        for (name,object) in [(NSApplication.didBecomeActiveNotification,NSApplication.shared as AnyObject),(NSWindow.didBecomeKeyNotification,win as AnyObject)] {
            windowObservers.append(NotificationCenter.default.addObserver(forName:name,object:object,queue:.main){ [weak self] _ in self?.windowObservation?() })
        }
        // Covers transitions already completed before these observers were armed.
        DispatchQueue.main.async { [weak self] in self?.windowObservation?() }
    }
    func document(_ host:NativeDesktop) {
#if D480_HOSTILE
        if phase=="initial" {
            oldGeneration=host.generation;phase="frame"
            if #available(macOS 13.3,*) { emit(host,host.web?.isInspectable==false ? "DEVTOOLS_DENIED":"FAIL_DEVTOOLS") } else {emit(host,"FAIL_ENGINE_API")}
            script(host,"const f=document.createElement('iframe');document.body.appendChild(f);f.contentWindow.webkit.messageHandlers.desktop.postMessage({type:'mcp.list',id:'D480A_HIT_FRAME',generation:g});")
        } else if phase=="reload" {
            guard oldGeneration != host.generation else{emit(host,"FAIL_GENERATION");return};emit(host,"DOCUMENT_FRESH");phase="stale"
            script(host,"window.webkit.messageHandlers.desktop.postMessage({type:'mcp.list',id:'D480A_HIT_STALE',generation:g});",oldGeneration)
        }
#endif
    }
    func message(_ host:NativeDesktop,_ message:WKScriptMessage) {
#if D480_HOSTILE
        guard let f=message.body as? [String:Any],let id=f["id"] as? String else{return}
        if phase=="frame",id=="D480A_HIT_FRAME",!message.frameInfo.isMainFrame {
            DispatchQueue.main.async {
                guard self.admitted==0 else{self.emit(host,"FAIL_FRAME_FORWARDED");return};self.emit(host,"FRAME_DENIED");self.phase="remote"
                self.script(host,"location.href='https://cmspark-480-blocked.invalid/';")
            }
        } else if phase=="stale",id=="D480A_HIT_STALE",message.frameInfo.isMainFrame {
            DispatchQueue.main.async {self.emit(host,self.admitted==0 ? "STALE_DENIED":"FAIL_STALE_FORWARDED");self.phase="done"}
        }
#endif
    }
    func forwarded(_ frame:[String:Any]) {if let id=frame["id"] as? String,id.hasPrefix("D480A_HIT_"){admitted+=1}}
    func navigation(_ host:NativeDesktop,_ action:WKNavigationAction,_ allowed:Bool) {
#if D480_HOSTILE
        if phase=="remote",action.request.url?.absoluteString=="https://cmspark-480-blocked.invalid/" {
            emit(host,allowed ? "FAIL_REMOTE":"REMOTE_DENIED");if !allowed {phase="new";DispatchQueue.main.async{self.script(host,"window.open('https://cmspark-480-blocked.invalid/','_blank');")}}
        } else if phase=="download" {
            if #available(macOS 11.3,*),action.shouldPerformDownload {
                emit(host,allowed ? "FAIL_DOWNLOAD":"DOWNLOAD_DENIED");if !allowed{phase="reload";DispatchQueue.main.async{host.web?.reload()}}
            }
        }
#endif
    }
    func newWindow(_ host:NativeDesktop) {
#if D480_HOSTILE
        guard phase=="new" else{return};emit(host,"NEW_WINDOW_DENIED");phase="download"
        DispatchQueue.main.async {self.script(host,"const a=document.createElement('a');a.href='cmspark-desktop://app/';a.download='owned-inert.txt';document.body.appendChild(a);a.click();")}
#endif
    }
}
private func d480AcceptanceAuth(_ host:NativeDesktop){let s=D480Acceptance.shared;s.auths+=1;s.emit(host,"AUTH_\(s.auths)");
#if D480_PARENT
 s.emit(host,d480ParentFD>=0 ? "PARENT_LOCK_ARMED":"FAIL_PARENT_LOCK")
#endif
}
private func d480AcceptanceWindow(_ host:NativeDesktop){D480Acceptance.shared.window(host)}
private func d480AcceptanceWindowStop(_ host:NativeDesktop){D480Acceptance.shared.stopWindow()}
private func d480AcceptanceDocument(_ host:NativeDesktop){D480Acceptance.shared.document(host)}
private func d480AcceptanceMessage(_ host:NativeDesktop,_ message:WKScriptMessage){D480Acceptance.shared.message(host,message)}
private func d480AcceptanceForward(_ host:NativeDesktop,_ f:[String:Any]){D480Acceptance.shared.forwarded(f)}
private func d480AcceptanceNavigation(_ host:NativeDesktop,_ action:WKNavigationAction,_ allowed:Bool){D480Acceptance.shared.navigation(host,action,allowed)}
private func d480AcceptanceNewWindow(_ host:NativeDesktop){D480Acceptance.shared.newWindow(host)}

// Root-approved test IPC amendment: the lock is deliberately held until original process exit.
private var d480ParentFD:Int32 = -1
private var d480ParentStat=stat()
private func d480AcceptanceParentArm()->Bool {
#if D480_PARENT
 let file=URL(fileURLWithPath:CommandLine.arguments[0]).resolvingSymlinksInPath().deletingLastPathComponent().appendingPathComponent("parent-exit.receipt").path
 let fd=open(file,O_RDWR|O_NOFOLLOW);guard fd>=0 else{return false}
 var value=stat();guard fstat(fd,&value)==0,(value.st_mode&S_IFMT)==S_IFREG,value.st_nlink==1,value.st_size==0,flock(fd,LOCK_EX|LOCK_NB)==0 else{close(fd);return false}
 d480ParentFD=fd;d480ParentStat=value
#endif
 return true
}
private func d480AcceptanceParentObserved(){
#if D480_PARENT
 guard d480ParentFD>=0 else{return};var before=stat()
 guard fstat(d480ParentFD,&before)==0,before.st_dev==d480ParentStat.st_dev,before.st_ino==d480ParentStat.st_ino,before.st_nlink==1,before.st_size==0,lseek(d480ParentFD,0,SEEK_SET)==0 else{return}
 var byte:UInt8=49;guard write(d480ParentFD,&byte,1)==1 else{return};_ = fsync(d480ParentFD)
 // Never close/unlock here. Original actual parent event's exit(1) owns OS release.
#endif
}

private func d480AcceptanceSafetyWatchdog(){
#if D480_PARENT
 // Owned test binary cleanup only: fixed monotonic original20s, no marker write or renewal.
 DispatchQueue.global().asyncAfter(deadline:.now()+20){Darwin._exit(177)}
#endif
}
