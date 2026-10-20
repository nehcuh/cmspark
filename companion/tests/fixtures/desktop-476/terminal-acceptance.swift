// Unshipped synthetic AppKit input. It is not physical human approval.
private enum D705TerminalAcceptance {
    static weak var owner:NativeDesktop?
    static weak var task:URLSessionWebSocketTask?
    static var document:String?;static var keyCount=0;static var confirmCount=0;static var receiptMask=0
    static var typed=false;static var resized=false;static var done=false;static var failed=false
    static func current(_ h:NativeDesktop)->Bool {owner === h && !failed && h.authenticated && h.socket === task && h.generation==document && h.window?.isVisible==true && h.web != nil}
    static func emit(_ h:NativeDesktop,_ id:String){if let socket=h.socket{h.transmit(["type":"system.ping","id":id],to:socket)}}
    static func failure(_ h:NativeDesktop){guard !failed else{return};failed=true;emit(h,"D476_TERMINAL_FAIL")}
    static func documentReady(_ h:NativeDesktop){
        guard owner==nil,h.authenticated,let web=h.web,let generation=h.generation,let socket=h.socket,
              let literal=try? JSONSerialization.data(withJSONObject:generation,options:.fragmentsAllowed),let encoded=String(data:literal,encoding:.utf8) else{failure(h);return}
        owner=h;task=socket;document=generation
        let code="const documentGeneration="+encoded+";"+D705_TERMINAL_FORM_SOURCE+";true"
        web.evaluateJavaScript(code){result,error in
            guard error == nil,current(h),let installed=result as? NSNumber,
                  CFGetTypeID(installed)==CFBooleanGetTypeID(),installed.boolValue else{failure(h);return}
        }
    }
    static func key(_ h:NativeDesktop,_ code:UInt16,_ characters:String)->Bool {
        guard current(h),let window=h.window,let web=h.web,window.isKeyWindow,
              let responder=window.firstResponder as? NSView,responder === web || responder.isDescendant(of:web),
              let down=NSEvent.keyEvent(with:.keyDown,location:.zero,modifierFlags:[],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:window.windowNumber,context:nil,characters:characters,charactersIgnoringModifiers:characters,isARepeat:false,keyCode:code),
              let up=NSEvent.keyEvent(with:.keyUp,location:.zero,modifierFlags:[],timestamp:ProcessInfo.processInfo.systemUptime,windowNumber:window.windowNumber,context:nil,characters:characters,charactersIgnoringModifiers:characters,isARepeat:false,keyCode:code) else{failure(h);return false}
        NSApp.sendEvent(down);NSApp.sendEvent(up);return current(h)
    }
    static func typeCommand(_ h:NativeDesktop){
        guard current(h),!typed,keyCount==6,confirmCount==3,receiptMask==3 else{failure(h);return};typed=true
        let command="printf '%016384dD476_'\"TERMINAL_\"'\\344\\270\\255\\n' 0; read -r owned #中"
        for character in command {if !key(h,0,String(character)){failure(h);return}}
        _=key(h,36,"\r")
    }
    static func resize(_ h:NativeDesktop){
        guard current(h),!resized,typed,keyCount==6,confirmCount==3,receiptMask==7,let window=h.window,window.isKeyWindow else{failure(h);return};resized=true
        let before=window.contentLayoutRect.size
        window.setContentSize(NSSize(width:before.width+120,height:before.height))
        guard window.contentLayoutRect.width==before.width+120 else{failure(h);return}
    }
    static func confirmation(_ h:NativeDesktop){
        guard current(h),confirmCount<4,let pending=h.confirmation else{failure(h);return}
        let number=confirmCount+1,expectedKey=number==1 ? 2:number==2 ? 4:number==3 ? 6:9
        // The sheet's visible presentation is observed in the next main turn,
        // without a timer, focus rescue or retry. Retain the exact pending object.
        DispatchQueue.main.async {
            guard current(h),h.confirmation === pending,confirmCount+1==number,keyCount==expectedKey,pending.purpose=="local-work",pending.generation==document,pending.task === task,pending.thread as? String=="native-terminal-A",
                  pending.alert.window.isVisible,pending.alert.window.sheetParent === h.window,pending.alert.window.isKeyWindow,
                  let raw=pending.full.data(using:.utf8),let action=(try? JSONSerialization.jsonObject(with:raw)) as? [String:Any],action["kind"] as? String==(number<4 ? "terminal-open":"terminal-return") else{failure(h);return}
            h.revealConfirmation(nil)
            guard current(h),h.confirmation === pending,pending.details?.string==pending.full,pending.alert.buttons.count==2 else{failure(h);return}
            confirmCount=number
            // Both negative requests use the existing native Cancel button; no unproven Escape/close contract.
            let button=pending.alert.buttons[number<=2 ? 0:1]
            guard button.isEnabled,button.window === pending.alert.window else{failure(h);return}
            button.performClick(nil)
        }
    }
    static func renderer(_ h:NativeDesktop,_ frame:[String:Any]){
        guard current(h),frame["type"] as? String=="system.ping" else{return}
        guard Set(frame.keys)==["type","id","generation"],frame["generation"] as? String==document,let id=frame["id"] as? String else{failure(h);return}
        let names=["ROW","OPEN_DENY","REFRESH_DENY","OPEN_CANCEL","REFRESH_CANCEL","OPEN_APPROVE","STOP","SELECT","RETURN","REOPEN"]
        for (index,name) in names.enumerated() {if id=="D476_TERMINAL_"+name+"_KEY" {
            let expectedConfirm=index<2 ? 0:index<4 ? 1:index<6 ? 2:index<9 ? 3:4
            let expectedReceipts=[0,0,1,1,3,3,15,31,31,63]
            guard keyCount==index,confirmCount==expectedConfirm,receiptMask==expectedReceipts[index],index<6 || (typed && resized) else{failure(h);return};keyCount=index+1;_=key(h,36,"\r");return
        }}
        if id=="D476_TERMINAL_TYPE"{typeCommand(h);return};if id=="D476_TERMINAL_RESIZE"{resize(h);return}
        let receipts=["DENIED","CANCELLED","OUTPUT","RESIZED","STOPPED","SAVED","REOPENED","DONE"]
        for(index,name)in receipts.enumerated(){if id=="D476_TERMINAL_"+name {
            guard receiptMask==((1<<index)-1) else{failure(h);return};receiptMask|=1<<index
            if index==7{guard keyCount==10,confirmCount==4,typed,resized else{failure(h);return};done=true};emit(h,id);return
        }}
        if id=="D476_TERMINAL_FAIL"{failure(h)}
    }
    static func complete(_ h:NativeDesktop,_ frame:[String:Any])->Bool {
        guard frame["type"] as? String=="D476.terminal.complete" else{return false}
        guard current(h),done,keyCount==10,confirmCount==4,receiptMask==255,typed,resized,Set(frame.keys)==["type","result"],frame["result"] as? String=="COMPLETE" else{exit(64)}
        done=false;exit(77)
    }
}
