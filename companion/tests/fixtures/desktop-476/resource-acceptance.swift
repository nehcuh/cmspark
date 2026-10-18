private enum D476Acceptance {
    static weak var owner:NativeDesktop?
    static var documentGeneration:String?;static var count=0;static var writes=0;static var receipts=0;static var keys=0;static var loss=false
    static func emit(_ h:NativeDesktop,_ id:String){if let task=h.socket{h.transmit(["type":"system.ping","id":id],to:task)}}
    static func document(_ h:NativeDesktop){
        guard owner == nil,let web=h.web,let generation=h.generation else{emit(h,"D476_RES_FAIL");return};owner=h;documentGeneration=generation
        let code="const documentGeneration="+String(data:try! JSONSerialization.data(withJSONObject:generation,options:.fragmentsAllowed),encoding:.utf8)!+";"+D476_FORM_SOURCE
        web.evaluateJavaScript(code){_,error in if error != nil{emit(h,"D476_RES_FAIL")}}
    }
    static func confirmation(_ h:NativeDesktop){
        count+=1;let number=count
        DispatchQueue.main.async{guard owner === h,!loss,let p=h.confirmation,p.purpose=="resource",p.alert.window.isVisible,p.alert.window.sheetParent === h.window,number<=6 else{emit(h,"D476_RES_FAIL");return}
            h.revealConfirmation(nil);guard p.details?.string==p.full else{emit(h,"D476_RES_FAIL");return};emit(h,"D476_RES_WINDOW_"+String(number));p.alert.buttons[number==4 ? 0:1].performClick(nil) // Real owned NSButton; synthetic, never human evidence.
        }
    }
    static func key(_ h:NativeDesktop){
        guard owner === h,!loss,h.authenticated,h.generation==documentGeneration,let window=h.window,let web=h.web,window.isVisible else{emit(h,"D476_RES_FAIL");return};window.makeKeyAndOrderFront(nil)
        guard window.isKeyWindow,let responder=window.firstResponder as? NSView,responder === web || responder.isDescendant(of:web),let down=NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:[],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:window.windowNumber,context:nil,characters:"\u{1b}",charactersIgnoringModifiers:"\u{1b}",isARepeat:false,keyCode:53),let up=NSEvent.keyEvent(with:.keyUp,location:.zero,modifierFlags:[],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:window.windowNumber,context:nil,characters:"\u{1b}",charactersIgnoringModifiers:"\u{1b}",isARepeat:false,keyCode:53) else{emit(h,"D476_RES_FAIL");return};NSApp.sendEvent(down);NSApp.sendEvent(up)
    }
    static func renderer(_ h:NativeDesktop,_ f:[String:Any]){
        guard owner === h,!loss,h.generation==documentGeneration else{return}
        if let type=f["type"] as? String,["desktop.resource.import","desktop.resource.update","desktop.resource.remove"].contains(type){writes+=1;if writes>6{emit(h,"D476_RES_FAIL")};return}
        guard f["type"] as? String=="system.ping",let id=f["id"] as? String else{return}
        if id=="D476_RES_ESCAPE_REQUEST"{guard keys==0,count==2,writes==2 else{emit(h,"D476_RES_FAIL");return};keys=1;key(h);return}
        let names=["D476_RES_SKILL_IMPORTED","D476_RES_KNOWLEDGE_IMPORTED","D476_RES_REOPENED","D476_RES_UPDATED","D476_RES_DENIED","D476_RES_REMOVED","D476_RES_BEFORE_LOST_ACK","D476_RES_ESCAPE_OK"]
        if let index=names.firstIndex(of:id){let bit=1<<index;if receipts&bit != 0{emit(h,"D476_RES_FAIL");return};receipts|=bit;emit(h,id);return};if id=="D476_RES_FAIL"{emit(h,id)}
    }
    static func lost(_ h:NativeDesktop){loss=owner === h && h.authenticated && h.generation==documentGeneration && count==6 && writes==6 && receipts==255 && keys==1}
    static func observe(_ h:NativeDesktop,_ message:WKScriptMessage)->Bool{
        guard owner === h,loss,!h.authenticated,h.socket==nil,h.generation==nil,let web=h.web,message.webView === web,message.frameInfo.isMainFrame,message.frameInfo.securityOrigin.protocol=="cmspark-desktop",message.frameInfo.securityOrigin.host=="app",web.url?.absoluteString==origin,let f=message.body as? [String:Any],f["type"] as? String=="D476.resource.offline" else{return false}
        guard Set(f.keys)==["type","generation","result"],f["generation"] as? String==documentGeneration,f["result"] as? String=="ok" else{exit(64)};loss=false;exit(76);return true
    }
}
