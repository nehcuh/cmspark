import AppKit
import Foundation
import Darwin

final class OwnedRunner705Observer {
 let scene:OwnedUI705Scene
 var captured:NSRunningApplication?,observation:NSKeyValueObservation?,watch:DispatchSourceFileSystemObject?,parentWatch:DispatchSourceProcess?
 var lookedUp=false,cancelled=false,closed=false
 init(_ scene:OwnedUI705Scene){self.scene=scene}
 func start() throws {
  let fd=open(scene.root.path,O_EVTONLY|O_NOFOLLOW);guard fd>=0 else{throw OwnedUI705Error.refused}
  let source=DispatchSource.makeFileSystemObjectSource(fileDescriptor:fd,eventMask:[.write,.rename,.delete],queue:.main);watch=source
  source.setCancelHandler{close(fd)};source.setEventHandler{[weak self] in self?.inspect()};source.resume()
  let parent=getppid();guard parent>1 else{throw OwnedUI705Error.refused}
  let life=DispatchSource.makeProcessSource(identifier:parent,eventMask:.exit,queue:.main);parentWatch=life
  life.setEventHandler{[weak self] in self?.cancelled=true;self?.requestStop()};life.resume();inspect()
 }
 func refuse()->Never {if let app=captured,!app.isTerminated{_ = app.forceTerminate()};FileHandle.standardError.write(Data("OWNED_UI_OBSERVER_REFUSED\n".utf8));exit(41)}
 func inspect(){do{
  try scene.check()
  if let cancel=try scene.read(.cancel){try scene.tuple(cancel,["schema","nonce"]);cancelled=true}
  if captured==nil,!lookedUp,let tuple=try scene.read(.startup){
   try scene.tuple(tuple,["schema","nonce","pid","bundle_url","executable_url","bundle_id"])
   let pid=try OwnedUI705Scene.pid(tuple["pid"])
   guard pid != getpid(),tuple["bundle_id"] as? String==OwnedUI705Scene.runnerID,tuple["bundle_url"] as? String==scene.runnerBundle.absoluteString,tuple["executable_url"] as? String==scene.runnerExecutable.absoluteString,try OwnedUI705Scene.canonicalPath(scene.runnerBundle.path)==scene.runnerBundle.path,try OwnedUI705Scene.canonicalPath(scene.runnerExecutable.path)==scene.runnerExecutable.path,let bundle=Bundle(url:scene.runnerBundle),bundle.bundleIdentifier==OwnedUI705Scene.runnerID,try OwnedUI705Scene.exactURL(bundle.executableURL,scene.runnerExecutable) else{throw OwnedUI705Error.refused}
   lookedUp=true
   guard let app=NSRunningApplication(processIdentifier:pid),!app.isTerminated,app.processIdentifier==pid,app.bundleIdentifier==OwnedUI705Scene.runnerID,try OwnedUI705Scene.exactURL(app.bundleURL,scene.runnerBundle),try OwnedUI705Scene.exactURL(app.executableURL,scene.runnerExecutable) else{throw OwnedUI705Error.refused}
   captured=app
   observation=app.observe(\.isTerminated,options:[.initial,.new]){[weak self] app,_ in DispatchQueue.main.async{self?.terminated(app)}}
   if let cancel=try scene.read(.cancel){try scene.tuple(cancel,["schema","nonce"]);cancelled=true}
   if !cancelled {
   try scene.write(.ack,["schema":1,"nonce":scene.nonce,"pid":pid,"identity_bound":true])
   }
  }
  requestStop()
 }catch{refuse()}}
 func requestStop(){if cancelled,let app=captured,!app.isTerminated{_ = app.forceTerminate()}} // Request only; Bool is never a closure receipt.
 func terminated(_ app:NSRunningApplication){guard !closed,app === captured,app.isTerminated else{return};closed=true;do{try scene.write(.closed,["schema":1,"nonce":scene.nonce,"pid":app.processIdentifier,"terminated":true])}catch{refuse()};watch?.cancel();parentWatch?.cancel();exit(0)}
}
