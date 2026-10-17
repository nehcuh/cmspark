private enum D476Acceptance {
    static var count=0
    static func emit(_ h:NativeDesktop,_ id:String){if let task=h.socket{h.transmit(["type":"system.ping","id":id],to:task)}}
    static func document(_ h:NativeDesktop){
        guard let w=h.web,let g=h.generation else{return}
        let code="const documentGeneration="+String(data:try! JSONSerialization.data(withJSONObject:g,options:.fragmentsAllowed),encoding:.utf8)!+";"+D476_FORM_SOURCE
        w.evaluateJavaScript(code){_,error in if error != nil{emit(h,"D476_FAIL_SCRIPT")}}
    }
    static func confirmation(_ h:NativeDesktop){
        count+=1;let number=count
        DispatchQueue.main.async{guard let p=h.confirmation,p.alert.window.isVisible,p.alert.window.sheetParent === h.window,number<=3 else{emit(h,"D476_FAIL_NATIVE_WINDOW");return}
            if p.details?.string.contains("OWNED_PRIVATE_476")==true{emit(h,"D476_FAIL_DEFAULT_SECRET");return}
            h.revealConfirmation(nil)
            guard p.details?.string==p.full,number>=3||p.full.contains("OWNED_PRIVATE_476") else{emit(h,"D476_FAIL_FULL_VIEW");return}
            emit(h,"D476_NATIVE_WINDOW_"+String(number));p.alert.buttons[number==2 ? 0:1].performClick(nil) // Actual NSButton synthetic activation; not human evidence.
        }
    }
    // Observe only fixed test receipts after the real renderer admission guards.
    // The normal production request still gets its native UUID and is sent.
    static func renderer(_ h:NativeDesktop,_ f:[String:Any]){
        let names:Set<String>=["D476_SAVE_APPROVED","D476_SAVE_DENIED","D476_NATIVE_DONE","D476_FAIL_ROW","D476_FAIL_APPROVE","D476_FAIL_DENY","D476_FAIL_ADD","D476_FAIL_RENDERER_SECRET"]
        guard f["type"] as? String=="system.ping",let id=f["id"] as? String,names.contains(id) else{return}
        emit(h,id)
    }
}
