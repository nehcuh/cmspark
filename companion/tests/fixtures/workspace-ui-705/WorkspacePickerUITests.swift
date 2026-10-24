import XCTest
import Foundation
import Darwin

final class WorkspacePicker705:XCTestCase {
 @MainActor func testOwnedPanel() throws {
  continueAfterFailure=false
  var preflightStage=0,writeStep=0,uiStage=0,uiDetail=0
  var writeErrno:Int32=0
  var uiScene:OwnedUI705Scene?
  do {
  preflightStage=1
  guard let path=ProcessInfo.processInfo.environment["CMSPARK_UI_SCENE"] else{throw OwnedUI705Error.refused}
  preflightStage=2
  let scene=try OwnedUI705Scene(path);uiScene=scene
  preflightStage=3
  guard Bundle.main.bundleIdentifier==OwnedUI705Scene.runnerID else{throw OwnedUI705Error.refused}
  preflightStage=4
  guard try OwnedUI705Scene.exactURL(Bundle.main.bundleURL,scene.runnerBundle) else{throw OwnedUI705Error.refused}
  preflightStage=5
  guard try OwnedUI705Scene.exactURL(Bundle.main.executableURL,scene.runnerExecutable) else{throw OwnedUI705Error.refused}
  preflightStage=6
  guard let input=try scene.read(.input) else{throw OwnedUI705Error.refused}
  preflightStage=7
  try scene.tuple(input,["schema","nonce","deadline_ms"])
  preflightStage=8
  let deadline=try OwnedUI705Scene.number(input["deadline_ms"])
  preflightStage=9
  guard deadline.rounded(.down)==deadline else{throw OwnedUI705Error.refused}
  func remaining() throws ->TimeInterval {try scene.requireActive();let r=(deadline-Date().timeIntervalSince1970*1000)/1000;guard r>0,r<=45 else{uiDetail=r<=0 ? 4:5;throw OwnedUI705Error.refused};return r}
  func waitFile(_ name:OwnedUI705File) throws ->[String:Any] {
   let fd=open(scene.root.path,O_EVTONLY|O_NOFOLLOW);guard fd>=0 else{throw OwnedUI705Error.refused}
   let e=expectation(description:"OWNED_UI_FIXED_RECEIPT"),source=DispatchSource.makeFileSystemObjectSource(fileDescriptor:fd,eventMask:[.write,.rename,.delete],queue:.main);var finished=false
   func check(){guard !finished else{return};do{try scene.requireActive();if try scene.read(name) != nil{finished=true;e.fulfill()}}catch{finished=true;e.fulfill()}}
   source.setCancelHandler{close(fd)};source.setEventHandler{check()};source.resume();defer{source.cancel()};check();wait(for:[e],timeout:try remaining())
   _ = try remaining();guard let value=try scene.read(name) else{throw OwnedUI705Error.refused};return value
  }
  preflightStage=10
  let pid=getpid();try scene.write(.startup,["schema":1,"nonce":scene.nonce,"pid":pid,"bundle_url":scene.runnerBundle.absoluteString,"executable_url":scene.runnerExecutable.absoluteString,"bundle_id":OwnedUI705Scene.runnerID]){step,code in writeStep=step.rawValue;writeErrno=code}
  preflightStage=0
  let ack=try waitFile(.ack);try scene.tuple(ack,["schema","nonce","pid","identity_bound"]);guard try OwnedUI705Scene.pid(ack["pid"])==pid,try OwnedUI705Scene.boolean(ack["identity_bound"]) else{throw OwnedUI705Error.refused}
  _ = try remaining();try scene.write(.begin,["schema":1,"nonce":scene.nonce,"pid":pid,"phase":"UI_SEQUENCE_STARTED"])
  // No quiescent receipt if an Objective-C exception, timeout or termination interrupts a synchronous UI call.
  defer{do{try scene.write(.returned,["schema":1,"nonce":scene.nonce,"pid":pid,"phase":"UI_SEQUENCE_RETURNED"])}catch{XCTFail("OWNED_UI_QUIESCENCE_REFUSED")}}
  uiStage=1;uiDetail=0
  let app=XCUIApplication(url:scene.appBundle) // Proxy only. Never launch/activate/terminate another instance.
  let observedState=app.state
  switch observedState {case .notRunning:uiDetail=1;case .runningForeground:uiDetail=2;case .runningBackground:uiDetail=3;default:uiDetail=4}
  guard observedState == .runningForeground || observedState == .runningBackground else{throw OwnedUI705Error.refused}
  func ready(_ file:OwnedUI705File,_ number:Int) throws {let f=try waitFile(file);try scene.tuple(f,["schema","nonce","number"]);guard try OwnedUI705Scene.number(f["number"])==Double(number) else{throw OwnedUI705Error.refused}}
  func sheet(_ stage:Int) throws ->XCUIElement {
   uiStage=stage;uiDetail=0;let windows=app.windows.matching(identifier:scene.nonce),count=windows.count;uiDetail=min(count,2)+1;guard count==1 else{throw OwnedUI705Error.refused};let w=windows.element
   uiStage=stage+1;uiDetail=0;let exists=w.sheets.element.waitForExistence(timeout:try remaining());uiDetail=exists ? 2:1;guard exists else{throw OwnedUI705Error.refused}
   uiStage=stage+2;uiDetail=0;let sheets=w.sheets.count;uiDetail=min(sheets,2)+1;guard sheets==1 else{throw OwnedUI705Error.refused};return w.sheets.element
  }
  uiStage=2;uiDetail=0;try ready(.first,1);let first=try sheet(3)
  uiStage=6;uiDetail=0;_ = try remaining();first.typeKey("g",modifierFlags:[.command,.shift])
  uiStage=7;uiDetail=0;let comboCount=first.comboBoxes.count;uiDetail=min(comboCount,2)+1;let inputs=comboCount==1 ? first.comboBoxes:first.textFields
  uiStage=8;uiDetail=0;let inputCount=inputs.count;uiDetail=min(inputCount,2)+1;guard inputCount==1 else{throw OwnedUI705Error.refused}
  uiStage=9;uiDetail=0;let inputHittable=inputs.element.isHittable;uiDetail=inputHittable ? 2:1;guard inputHittable else{throw OwnedUI705Error.refused}
  uiStage=10;uiDetail=0;_ = try remaining();inputs.element.click();_ = try remaining();inputs.element.typeText(scene.selection.path);_ = try remaining();inputs.element.typeKey("\r",modifierFlags:[])
  let choose=first.buttons.matching(NSPredicate(format:"label IN %@",["Choose","Open"]))
  uiStage=11;uiDetail=0;let chooseCount=choose.count;uiDetail=min(chooseCount,2)+1;guard chooseCount==1 else{throw OwnedUI705Error.refused}
  uiStage=12;uiDetail=0;let chooseHittable=choose.element.isHittable;uiDetail=chooseHittable ? 2:1;guard chooseHittable else{throw OwnedUI705Error.refused}
  uiStage=13;uiDetail=0;_ = try remaining();choose.element.click()
  uiStage=14;uiDetail=0;try ready(.second,2);let second=try sheet(15),cancel=second.buttons.matching(identifier:"Cancel")
  uiStage=18;uiDetail=0;let cancelCount=cancel.count;uiDetail=min(cancelCount,2)+1;guard cancelCount==1 else{throw OwnedUI705Error.refused}
  uiStage=19;uiDetail=0;let cancelHittable=cancel.element.isHittable;uiDetail=cancelHittable ? 2:1;guard cancelHittable else{throw OwnedUI705Error.refused}
  uiStage=20;uiDetail=0;_ = try remaining();cancel.element.click()
  } catch {
   // Failure-only closed integers; a logging refusal never replaces this error.
   if preflightStage==0 && (1...20).contains(uiStage),let scene=uiScene {try? scene.write(.uiRefusal,["schema":1,"nonce":scene.nonce,"stage":uiStage,"detail":uiDetail])}
   // Fixed test-only identity: never expose the scene path, environment or error body.
   if (1...10).contains(preflightStage) {
    let priorFailurePolicy=continueAfterFailure
    continueAfterFailure=true
    defer { continueAfterFailure=priorFailurePolicy }
    XCTFail("OWNED_UI705_PREFLIGHT_"+String(preflightStage))
    if preflightStage==10 && (1...10).contains(writeStep) {let code=(0...4095).contains(writeErrno) ? writeErrno:0;XCTFail("OWNED_UI705_WRITE_S"+String(writeStep)+"_E"+String(code))}
   }
   throw error
  }
 }
}
