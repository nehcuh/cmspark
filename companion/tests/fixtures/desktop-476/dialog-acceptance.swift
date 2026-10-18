private enum D476DialogAcceptance {
    static weak var owner:NativeDesktop?
    static var document:String?;static var keys=0;static var saves=0;static var stops=0;static var loss=false
    static func failure(_ h:NativeDesktop){D476Acceptance.emit(h,"D476_FAIL_DIALOG_PHASE")}
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
        if f["type"] as? String=="desktop.chat.send"{saves+=1;if saves>3{failure(h)};return}
        if f["type"] as? String=="desktop.chat.stop"{stops+=1;if saves != 2 || keys != 4 || stops != 1{failure(h)};return}
        guard f["type"] as? String=="system.ping",let id=f["id"] as? String else{return}
        if id=="D476_DIALOG_NEW_KEY"{guard keys==0,saves==0 else{failure(h);return};keys=1;key(h,36,"\r");return}
        if id=="D476_DIALOG_OTHER_KEY"{guard keys==4,stops==1 else{failure(h);return};keys=5;key(h,36,"\r");return}
        if id=="D476_DIALOG_REOPEN_KEY"{guard keys==5,stops==1 else{failure(h);return};keys=6;key(h,36,"\r");return}
        if id=="D476_DIALOG_SEND_KEY"{guard keys==1,saves==0 else{failure(h);return};keys=2;key(h,36,"\r");return}
        if id=="D476_DIALOG_FOLLOWUP_KEY"{guard keys==2,saves==1,stops==0 else{failure(h);return};keys=3;key(h,36,"\r");return}
        if id=="D476_DIALOG_LOST_ACK_KEY"{guard keys==6,saves==2,stops==1 else{failure(h);return};keys=7;key(h,36,"\r");return}
        if id=="D476_DIALOG_STOP_KEY"{guard keys==3,saves==2 else{failure(h);return};keys=4;key(h,36,"\r");return}
        if ["D476_DIALOG_CREATED","D476_DIALOG_USER","D476_DIALOG_STREAMED","D476_DIALOG_L2_DENIED","D476_DIALOG_STOPPED","D476_DIALOG_REOPEN","D476_FAIL_DIALOG_PHASE"].contains(id){D476Acceptance.emit(h,id)}
    }
    static func lost(_ h:NativeDesktop){loss=owner === h && h.authenticated && h.generation==document && keys==7 && saves==3 && stops==1}
    static func observe(_ h:NativeDesktop,_ message:WKScriptMessage)->Bool{
        guard owner === h,loss,!h.authenticated,h.socket==nil,h.generation==nil,let web=h.web,message.webView === web,
              message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.protocol=="cmspark-desktop",message.frameInfo.securityOrigin.host=="app",web.url?.absoluteString==origin,
              let f=message.body as? [String:Any],f["type"] as? String=="D476.dialog.offline" else{return false}
        guard keys==7,saves==3,stops==1,Set(f.keys)==["type","generation","result"],f["generation"] as? String==document,f["result"] as? String=="ok" else{exit(64)}
        loss=false;exit(76);return true // Distinct test-only terminal receipt; ordinary window close still exits 0.
    }
}
