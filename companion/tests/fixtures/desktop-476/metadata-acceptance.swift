private enum D476MetadataAcceptance {
    static weak var owner:NativeDesktop?
    static var document:String?;static var keys=0;static var saves=0;static var loss=false
    static func failure(_ h:NativeDesktop){D476Acceptance.emit(h,"D476_FAIL_METADATA_PHASE")}
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
        if f["type"] as? String=="desktop.thread.metadata.save"{saves+=1;if f["thread_id"] as? String != "native-metadata-A" || saves>2{failure(h)};return}
        guard f["type"] as? String=="system.ping",let id=f["id"] as? String else{return}
        if id=="D476_META_ESCAPE_REQUEST"{guard keys==0,saves==1 else{failure(h);return};keys=1;key(h,53,"\u{1b}");return}
        if id=="D476_META_ENTER_REQUEST"{guard keys==1,saves==1 else{failure(h);return};keys=2;key(h,36,"\r");return}
        if ["D476_META_FIRST_SAVED","D476_META_REOPEN_OK","D476_META_ESCAPE_OK","D476_META_ENTER_OK","D476_META_BEFORE_LOST_ACK","D476_FAIL_METADATA_PHASE"].contains(id){D476Acceptance.emit(h,id)}
    }
    static func lost(_ h:NativeDesktop){loss=owner === h && h.authenticated && h.generation==document && keys==2 && saves==2}
    static func observe(_ h:NativeDesktop,_ message:WKScriptMessage)->Bool{
        guard owner === h,loss,!h.authenticated,h.socket==nil,h.generation==nil,let web=h.web,message.webView === web,
              message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.protocol=="cmspark-desktop",message.frameInfo.securityOrigin.host=="app",web.url?.absoluteString==origin,
              let f=message.body as? [String:Any],f["type"] as? String=="D476.metadata.offline" else{return false}
        guard keys==2,saves==2,Set(f.keys)==["type","generation","result"],f["generation"] as? String==document,f["result"] as? String=="ok" else{exit(64)}
        loss=false;exit(76);return true // Distinct test-only terminal receipt; ordinary window close still exits 0.
    }
}
