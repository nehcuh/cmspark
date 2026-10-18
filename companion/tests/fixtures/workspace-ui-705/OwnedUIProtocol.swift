import Foundation
import Darwin
import CoreFoundation

enum OwnedUI705Error: Error { case refused }
enum OwnedUI705File: String {
 case input="input.json", startup="runner-start.json", ack="owner-ack.json", begin="ui-begin.json", returned="ui-quiescent.json", closed="runner-closed.json", cancel="cancel.json", first="picker-first.json", second="picker-second.json"
}
struct OwnedUI705Scene {
 static let runnerID="com.cmspark.tests.workspace-ui-705.xctrunner"
 let root:URL, nonce:String, dev:dev_t, ino:ino_t
 var runnerBundle:URL {root.appendingPathComponent("Products/Debug/OwnedPickerUITests-Runner.app")}
 var runnerExecutable:URL {runnerBundle.appendingPathComponent("Contents/MacOS/OwnedPickerUITests-Runner")}
 var appBundle:URL {root.appendingPathComponent("OwnedPicker705.app")}
 var selection:URL {root.deletingLastPathComponent().appendingPathComponent("selected")}
 init(_ path:String) throws {
  let u=URL(fileURLWithPath:path,isDirectory:true),name=u.lastPathComponent,prefix="cmspark-workspace-ui-705-"
  guard path.hasPrefix("/"),!path.contains("\0"),!path.contains("\n"),!path.contains("\r"),path.utf8.count<=4096,name.hasPrefix(prefix),try Self.canonicalPath(path)==path else{throw OwnedUI705Error.refused}
  let n=String(name.dropFirst(prefix.count));guard n.range(of:"^[0-9a-f]{64}$",options:.regularExpression) != nil else{throw OwnedUI705Error.refused}
  var s=stat();guard lstat(path,&s)==0,s.st_mode & mode_t(S_IFMT)==mode_t(S_IFDIR),s.st_mode & 0o777==0o700,s.st_uid==geteuid() else{throw OwnedUI705Error.refused}
  root=u;nonce=n;dev=s.st_dev;ino=s.st_ino
 }
 func check() throws {var s=stat();guard lstat(root.path,&s)==0,s.st_dev==dev,s.st_ino==ino,s.st_uid==geteuid(),s.st_mode & mode_t(S_IFMT)==mode_t(S_IFDIR),s.st_mode & 0o777==0o700,try Self.canonicalPath(root.path)==root.path else{throw OwnedUI705Error.refused}}
 // POSIX realpath preserves canonical /private spelling; Foundation may display the same object without /private.
 static func canonicalPath(_ path:String) throws ->String {guard !path.contains("\0"),let p=Darwin.realpath(path,nil) else{throw OwnedUI705Error.refused};defer{free(p)};return String(cString:p)}
 static func exactURL(_ actual:URL?,_ expected:URL) throws ->Bool {guard let actual=actual,actual.isFileURL else{return false};return try canonicalPath(expected.path)==expected.path && canonicalPath(actual.path)==expected.path}
 func requireActive() throws {if let value=try read(.cancel){try tuple(value,["schema","nonce"]);throw OwnedUI705Error.refused}}
 static func bytes(_ value:[String:Any]) throws ->Data {guard JSONSerialization.isValidJSONObject(value) else{throw OwnedUI705Error.refused};let d=try JSONSerialization.data(withJSONObject:value,options:[.sortedKeys,.withoutEscapingSlashes]);guard d.count<=4096 else{throw OwnedUI705Error.refused};return d}
 func read(_ name:OwnedUI705File) throws ->[String:Any]? {
  try check();let file=root.appendingPathComponent(name.rawValue).path,fd=open(file,O_RDONLY|O_NOFOLLOW|O_NONBLOCK)
  if fd<0 {if errno==ENOENT{return nil};throw OwnedUI705Error.refused};defer{close(fd)}
  var a=stat();guard fstat(fd,&a)==0 else{throw OwnedUI705Error.refused};if a.st_nlink==2,a.st_mode & mode_t(S_IFMT)==mode_t(S_IFREG),a.st_mode & 0o777==0o600,a.st_uid==geteuid(){var pending=stat();let temp=root.appendingPathComponent("."+name.rawValue+".pending").path;guard lstat(temp,&pending)==0,pending.st_dev==a.st_dev,pending.st_ino==a.st_ino,pending.st_nlink==2,pending.st_mode & mode_t(S_IFMT)==mode_t(S_IFREG) else{throw OwnedUI705Error.refused};return nil};guard a.st_mode & mode_t(S_IFMT)==mode_t(S_IFREG),a.st_mode & 0o777==0o600,a.st_uid==geteuid(),a.st_nlink==1,a.st_size>0,a.st_size<=4096 else{throw OwnedUI705Error.refused}
  var d=Data(count:Int(a.st_size)),offset=0
  try d.withUnsafeMutableBytes{buf in while offset<buf.count {let n=Darwin.read(fd,buf.baseAddress!.advanced(by:offset),buf.count-offset);if n<0&&errno==EINTR{continue};guard n>0 else{throw OwnedUI705Error.refused};offset+=n}}
  var b=stat(),c=stat();guard fstat(fd,&b)==0,lstat(file,&c)==0,a.st_dev==b.st_dev,a.st_ino==b.st_ino,a.st_size==b.st_size,a.st_dev==c.st_dev,a.st_ino==c.st_ino,c.st_nlink==1 else{throw OwnedUI705Error.refused};try check()
  guard let v=try JSONSerialization.jsonObject(with:d) as? [String:Any],try Self.bytes(v)==d else{throw OwnedUI705Error.refused};return v
 }
 func write(_ name:OwnedUI705File,_ value:[String:Any]) throws {
  try check();let d=try Self.bytes(value),file=root.appendingPathComponent(name.rawValue).path,temp=root.appendingPathComponent("."+name.rawValue+".pending").path,fd=open(temp,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0o600);guard fd>=0 else{throw OwnedUI705Error.refused}
  var owned=stat();guard fstat(fd,&owned)==0 else{close(fd);throw OwnedUI705Error.refused};var temporary=true
  defer{close(fd);if temporary{var current=stat();if lstat(temp,&current)==0,current.st_dev==owned.st_dev,current.st_ino==owned.st_ino{_ = unlink(temp)}}}
  try d.withUnsafeBytes{buf in var offset=0;while offset<buf.count{let n=Darwin.write(fd,buf.baseAddress!.advanced(by:offset),buf.count-offset);if n<0&&errno==EINTR{continue};guard n>0 else{throw OwnedUI705Error.refused};offset+=n}}
  guard fsync(fd)==0 else{throw OwnedUI705Error.refused};try check();guard link(temp,file)==0,unlink(temp)==0 else{throw OwnedUI705Error.refused};temporary=false;try check()
 }
 func tuple(_ value:[String:Any],_ fields:Set<String>) throws {guard Set(value.keys)==fields,try Self.number(value["schema"])==1,value["nonce"] as? String==nonce else{throw OwnedUI705Error.refused}}
 static func number(_ value:Any?) throws ->Double {guard let n=value as? NSNumber,CFGetTypeID(n) != CFBooleanGetTypeID(),n.doubleValue.isFinite else{throw OwnedUI705Error.refused};return n.doubleValue}
 static func boolean(_ value:Any?) throws ->Bool {guard let n=value as? NSNumber,CFGetTypeID(n)==CFBooleanGetTypeID() else{throw OwnedUI705Error.refused};return n.boolValue}
 static func pid(_ value:Any?) throws ->pid_t {guard let n=value as? NSNumber,CFGetTypeID(n) != CFBooleanGetTypeID(),n.doubleValue.isFinite,n.doubleValue.rounded(.down)==n.doubleValue,n.doubleValue>1,n.doubleValue<=Double(Int32.max) else{throw OwnedUI705Error.refused};return pid_t(n.int32Value)}
}
