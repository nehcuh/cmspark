import XCTest
import Foundation
import Darwin

final class WorkspacePicker705:XCTestCase {
 @MainActor func testOwnedPanel() throws {
  continueAfterFailure=false
  guard let path=ProcessInfo.processInfo.environment["CMSPARK_UI_SCENE"] else{throw OwnedUI705Error.refused}
  let scene=try OwnedUI705Scene(path)
  guard Bundle.main.bundleIdentifier==OwnedUI705Scene.runnerID,try OwnedUI705Scene.exactURL(Bundle.main.bundleURL,scene.runnerBundle),try OwnedUI705Scene.exactURL(Bundle.main.executableURL,scene.runnerExecutable),let input=try scene.read(.input) else{throw OwnedUI705Error.refused}
  try scene.tuple(input,["schema","nonce","deadline_ms"])
  let deadline=try OwnedUI705Scene.number(input["deadline_ms"]);guard deadline.rounded(.down)==deadline else{throw OwnedUI705Error.refused}
  func remaining() throws ->TimeInterval {try scene.requireActive();let r=(deadline-Date().timeIntervalSince1970*1000)/1000;guard r>0,r<=45 else{throw OwnedUI705Error.refused};return r}
  func waitFile(_ name:OwnedUI705File) throws ->[String:Any] {
   let fd=open(scene.root.path,O_EVTONLY|O_NOFOLLOW);guard fd>=0 else{throw OwnedUI705Error.refused}
   let e=expectation(description:"OWNED_UI_FIXED_RECEIPT"),source=DispatchSource.makeFileSystemObjectSource(fileDescriptor:fd,eventMask:[.write,.rename,.delete],queue:.main);var finished=false
   func check(){guard !finished else{return};do{try scene.requireActive();if try scene.read(name) != nil{finished=true;e.fulfill()}}catch{finished=true;e.fulfill()}}
   source.setCancelHandler{close(fd)};source.setEventHandler{check()};source.resume();defer{source.cancel()};check();wait(for:[e],timeout:try remaining())
   _ = try remaining();guard let value=try scene.read(name) else{throw OwnedUI705Error.refused};return value
  }
  let pid=getpid();try scene.write(.startup,["schema":1,"nonce":scene.nonce,"pid":pid,"bundle_url":scene.runnerBundle.absoluteString,"executable_url":scene.runnerExecutable.absoluteString,"bundle_id":OwnedUI705Scene.runnerID])
  let ack=try waitFile(.ack);try scene.tuple(ack,["schema","nonce","pid","identity_bound"]);guard try OwnedUI705Scene.pid(ack["pid"])==pid,try OwnedUI705Scene.boolean(ack["identity_bound"]) else{throw OwnedUI705Error.refused}
  _ = try remaining();try scene.write(.begin,["schema":1,"nonce":scene.nonce,"pid":pid,"phase":"UI_SEQUENCE_STARTED"])
  // No quiescent receipt if an Objective-C exception, timeout or termination interrupts a synchronous UI call.
  defer{do{try scene.write(.returned,["schema":1,"nonce":scene.nonce,"pid":pid,"phase":"UI_SEQUENCE_RETURNED"])}catch{XCTFail("OWNED_UI_QUIESCENCE_REFUSED")}}
  let app=XCUIApplication(url:scene.appBundle) // Proxy only. Never launch/activate/terminate another instance.
  let observedState=app.state
  guard observedState == .runningForeground || observedState == .runningBackground else{throw OwnedUI705Error.refused}
  func ready(_ file:OwnedUI705File,_ number:Int) throws {let f=try waitFile(file);try scene.tuple(f,["schema","nonce","number"]);guard try OwnedUI705Scene.number(f["number"])==Double(number) else{throw OwnedUI705Error.refused}}
  func sheet() throws ->XCUIElement {let windows=app.windows.matching(identifier:scene.nonce);guard windows.count==1 else{throw OwnedUI705Error.refused};let w=windows.element;guard w.sheets.element.waitForExistence(timeout:try remaining()),w.sheets.count==1 else{throw OwnedUI705Error.refused};return w.sheets.element}
  try ready(.first,1);let first=try sheet();_ = try remaining();first.typeKey("g",modifierFlags:[.command,.shift])
  let inputs=first.comboBoxes.count==1 ? first.comboBoxes:first.textFields
  guard inputs.count==1,inputs.element.isHittable else{throw OwnedUI705Error.refused}
  _ = try remaining();inputs.element.click();_ = try remaining();inputs.element.typeText(scene.selection.path);_ = try remaining();inputs.element.typeKey("\r",modifierFlags:[])
  let choose=first.buttons.matching(NSPredicate(format:"label IN %@",["Choose","Open"]))
  guard choose.count==1,choose.element.isHittable else{throw OwnedUI705Error.refused};_ = try remaining();choose.element.click()
  try ready(.second,2);let second=try sheet(),cancel=second.buttons.matching(identifier:"Cancel")
  guard cancel.count==1,cancel.element.isHittable else{throw OwnedUI705Error.refused};_ = try remaining();cancel.element.click()
 }
}
