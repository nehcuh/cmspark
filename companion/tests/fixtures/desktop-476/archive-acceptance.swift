private enum D476ArchiveAcceptance {
    static weak var owner:NativeDesktop?
    static var document:String?;static var keys=0;static var saves=0;static var loss=false
    static func failure(_ h:NativeDesktop){D476Acceptance.emit(h,"D476_FAIL_ARCHIVE_PHASE")}
    static func arm(_ h:NativeDesktop){guard owner == nil else{failure(h);return};owner=h;document=h.generation}
    static func key(_ h:NativeDesktop,_ code:UInt16,_ characters:String){
        guard owner === h,!loss,h.authenticated,h.generation==document,let window=h.window,let web=h.web,window.isVisible else{failure(h);return}
        window.makeKeyAndOrderFront(nil)
        guard window.isKeyWindow,let responder=window.firstResponder as? NSView,responder === web || responder.isDescendant(of:web),
              let down=NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:[],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:window.windowNumber,context:nil,characters:characters,charactersIgnoringModifiers:characters,isARepeat:false,keyCode:code),
              let up=NSEvent.keyEvent(with:.keyUp,location:.zero,modifierFlags:[],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:window.windowNumber,context:nil,characters:characters,charactersIgnoringModifiers:characters,isARepeat:false,keyCode:code) else{failure(h);return}
        NSApp.sendEvent(down);NSApp.sendEvent(up) // Actual owned-window AppKit path; not DOM dispatch or physical human.
    }
    static func renderer(_ h:NativeDesktop,_ f:[String:Any]){
        guard owner === h,!loss,h.generation==document else{return}
        if f["type"] as? String=="desktop.archive.set" {saves+=1;if f["thread_id"] as? String != "native-archive-A" || saves>3 || ![2,6,10].contains(keys){failure(h)};return}
        guard f["type"] as? String=="system.ping",let id=f["id"] as? String else{return}
        let names=["ROW","SAVE","VIEW","HISTORY","RESTORE_ROW","RESTORE_SAVE","NORMAL","BUSY_ROW","RETRY_ROW","LOST_SAVE"]
        for (index,name) in names.enumerated() {if id=="D476_ARCHIVE_"+name+"_KEY" {guard keys==index,saves==(index<2 ? 0:index<6 ? 1:2) else{failure(h);return};keys=index+1;key(h,36,"\r");return}}
        if ["D476_ARCHIVE_ARCHIVED","D476_ARCHIVE_VIEW","D476_ARCHIVE_HISTORY","D476_ARCHIVE_RESTORED","D476_ARCHIVE_BUSY","D476_ARCHIVE_BEFORE_LOST_ACK","D476_ARCHIVE_BLOCK","D476_ARCHIVE_UNBLOCK","D476_FAIL_ARCHIVE_PHASE"].contains(id){D476Acceptance.emit(h,id)}
    }
    static func lost(_ h:NativeDesktop){loss=owner === h && h.authenticated && h.generation==document && keys==10 && saves==3}
    static func observe(_ h:NativeDesktop,_ message:WKScriptMessage)->Bool{
        guard owner === h,loss,!h.authenticated,h.socket==nil,h.generation==nil,let web=h.web,message.webView === web,
              message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.protocol=="cmspark-desktop",message.frameInfo.securityOrigin.host=="app",web.url?.absoluteString==origin,
              let f=message.body as? [String:Any],f["type"] as? String=="D476.archive.offline" else{return false}
        guard keys==10,saves==3,Set(f.keys)==["type","generation","result"],f["generation"] as? String==document,f["result"] as? String=="ok" else{exit(64)}
        loss=false;exit(76);return true
    }
}
