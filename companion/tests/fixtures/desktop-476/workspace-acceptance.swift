private enum D476Acceptance {
 static var diagnosticMask=0;static var diagnosticSite=0;static var diagnosticSends=0;static var diagnosticLast="";static var diagnosticLocal=99;static var diagnosticOwned=99;static var diagnosticFlags=0;static var diagnosticKnown=0
 // #705: fixed observations, no transport error may retire the real host.
 static func note(_ h:NativeDesktop,_ bit:Int,_ site:Int=0,_ local:Int=99,_ owned:Int=99,_ flags:Int=0,_ known:Int=0){diagnosticMask |= bit;let first=diagnosticSite==0 && site != 0;if first{diagnosticSite=site};if local != 99{diagnosticLocal=min(2,local)};if owned != 99{diagnosticOwned=min(2,owned)};diagnosticFlags=(diagnosticFlags & ~known)|(flags & known);diagnosticKnown |= known;let a=diagnosticLocal==99 ? "X":String(diagnosticLocal),b=diagnosticOwned==99 ? "X":String(diagnosticOwned);let id="D476_WS_DIAG_M_\(diagnosticMask)_\(diagnosticSite)_\(a)_\(b)_\(diagnosticFlags & 15)_\(diagnosticKnown & 15)";guard id != diagnosticLast,diagnosticSends<16 || first else{return};diagnosticLast=id;diagnosticSends+=1;guard let task=h.socket,let data=try? JSONSerialization.data(withJSONObject:["type":"system.ping","id":id]),let text=String(data:data,encoding:.utf8) else{return};task.send(.string(text)){_ in}}
 static func fail(_ h:NativeDesktop,_ site:Int){note(h,0,site);emit(h,"D476_WS_FAIL")}
 static weak var owner:NativeDesktop?;static var documentGeneration:String?;static var selection:URL?;static var pickerTimer:Timer?;static var cancelPicker=false;static var directoryPrepared=false;static var panels=0;static var confirmations=0;static var receipts=0
 static func emit(_ h:NativeDesktop,_ id:String){if let task=h.socket{h.transmit(["type":"system.ping","id":id],to:task)}}
 static func document(_ h:NativeDesktop){guard owner == nil,let web=h.web,let generation=h.generation else{fail(h,1);return};owner=h;documentGeneration=generation;let code="const documentGeneration="+String(data:try! JSONSerialization.data(withJSONObject:generation,options:.fragmentsAllowed),encoding:.utf8)!+";"+D476_FORM_SOURCE;web.evaluateJavaScript(code){_,error in if error != nil{fail(h,2)}}}
 static func confirmation(_ h:NativeDesktop){confirmations+=1;DispatchQueue.main.async{guard owner === h,h.generation==documentGeneration,panels==1,confirmations==1,let p=h.confirmation,p.purpose=="workspace",p.alert.window.isVisible,p.alert.window.sheetParent === h.window,let raw=p.full.data(using:.utf8),let a=flatFrame(raw),a["path"] as? String==selection?.path else{fail(h,3);return};h.revealConfirmation(nil);guard p.details?.string==p.full else{fail(h,4);return};note(h,256);emit(h,"D476_WS_CONFIRMATION");p.alert.buttons[1].performClick(nil)}}
 static func picker(_ h:NativeDesktop,_ f:[String:Any])->Bool {
  guard f["type"] as? String=="D476.workspace.picker" else{return false}
  guard owner === h,h.generation==documentGeneration,let p=h.workspaceSelection,h.pickerCurrent(p),!p.settled,Set(f.keys)==["type","selection","pick_id","cancel"],f["pick_id"] as? String==p.nonce,let raw=f["selection"] as? String,(raw as NSString).isAbsolutePath,let cancel=f["cancel"] as? Bool,pickerTimer==nil,panels<2,cancel==(panels==1) else{fail(h,5);return true}
  selection=URL(fileURLWithPath:raw);cancelPicker=cancel;directoryPrepared=false;note(h,1)
  pickerTimer=Timer.scheduledTimer(withTimeInterval:0.016,repeats:true){[weak h] _ in guard let h=h else{return};panel(h)};note(h,2);return true
 }
 static func panel(_ h:NativeDesktop){
  let flags=(owner === h ? 1:0)|(h.generation==documentGeneration ? 2:0)|(h.requests["desktop.workspace.pick"] != nil ? 4:0)|(h.authenticated ? 8:0);note(h,0,0,99,99,flags,15)
  guard owner === h,h.generation==documentGeneration,let p=h.workspaceSelection,h.pickerCurrent(p),!p.settled else{pickerTimer?.invalidate();pickerTimer=nil;return}
  // AppKit may draw remotely. Observe only the actual retained NSOpenPanel object.
  let panel=p.panel;guard panel.isVisible else{return};note(h,4,0,1,1,flags,15)
  guard panel.sheetParent === h.window,let directory=selection else{pickerTimer?.invalidate();pickerTimer=nil;fail(h,6);return}
  // Selecting the directory may enable the real public OK control. Do it once before waiting.
  if !directoryPrepared {panel.directoryURL=directory;directoryPrepared=true;note(h,16,0,1,1,flags,15)}
  if !cancelPicker {guard let button=panel.defaultButtonCell,button.isEnabled else{return}}
  pickerTimer?.invalidate();pickerTimer=nil;note(h,8,0,1,1,flags,15);panels+=1
  emit(h,panels==1 ? "D476_WS_PICKER_SELECTED":"D476_WS_PICKER_CANCELLED")
  if cancelPicker {note(h,64,0,1,1,flags,15);panel.cancel(nil);note(h,128,0,1,1,flags,15)}
  else {guard let button=panel.defaultButtonCell,button.isEnabled else{fail(h,7);return};note(h,32,0,1,1,flags,15);note(h,64,0,1,1,flags,15);button.performClick(nil);note(h,128,0,1,1,flags,15)}
 }
 static func renderer(_ h:NativeDesktop,_ f:[String:Any]){guard owner === h,h.generation==documentGeneration,f["type"] as? String=="system.ping",let id=f["id"] as? String else{return};let names=["D476_WS_UNBOUND","D476_WS_COMMITTED","D476_WS_LISTED","D476_WS_READ","D476_WS_REOPENED","D476_WS_CANCELLED","D476_WS_DONE"];if let i=names.firstIndex(of:id){let bit=1<<i;if receipts&bit != 0{fail(h,8);return};receipts|=bit;emit(h,id);if i==6{if receipts != 127 || panels != 2 || confirmations != 1{fail(h,9)}};return};if id=="D476_WS_FAIL"{note(h,0,10);emit(h,id)}}
}
