// Unshipped #571 target. Only an actual external AX press can call the state producer.
import AppKit
import WebKit
import Foundation
import Darwin

func ax571Readiness(_ active: Bool, _ key: Bool, _ targetBound: Bool, _ siblingBound: Bool) -> Bool { return active && key && targetBound && siblingBound }

// Test-only LaunchServices owner. No PID lookup, app enumeration or foreign kill.
private struct AX571OwnedPaths {
    let framework: String
    let ready: URL
    let marker: URL
    let sibling: URL
    let directory: URL
    let device: UInt64
    let inode: UInt64
    init?(_ arguments: [String]) {
        guard arguments.count == 4, ["APPKIT", "WKWEBVIEW"].contains(arguments[0]), arguments.dropFirst().allSatisfy({ $0.hasPrefix("/") && !$0.contains("\0") }) else { return nil }
        let urls = arguments.dropFirst().map { URL(fileURLWithPath: $0).standardizedFileURL }
        let parent = urls[0].deletingLastPathComponent()
        guard parent.lastPathComponent.hasPrefix("ax-native571-"), parent.resolvingSymlinksInPath() == parent,
              urls.map({ $0.lastPathComponent }) == ["ready.json", "target.json", "sibling.json"],
              urls.allSatisfy({ $0.deletingLastPathComponent() == parent }),
              let attributes = try? FileManager.default.attributesOfItem(atPath: parent.path),
              attributes[.type] as? FileAttributeType == .typeDirectory,
              (attributes[.ownerAccountID] as? NSNumber)?.uint32Value == getuid(),
              let permissions = (attributes[.posixPermissions] as? NSNumber)?.intValue, permissions & 0o077 == 0,
              let dev = (attributes[.systemNumber] as? NSNumber)?.uint64Value,
              let ino = (attributes[.systemFileNumber] as? NSNumber)?.uint64Value, ino > 0 else { return nil }
        framework = arguments[0]; ready = urls[0]; marker = urls[1]; sibling = urls[2]; directory = parent; device = dev; inode = ino
    }
    func current() -> Bool {
        guard directory.resolvingSymlinksInPath() == directory,
              let a = try? FileManager.default.attributesOfItem(atPath: directory.path) else { return false }
        return a[.type] as? FileAttributeType == .typeDirectory && (a[.systemNumber] as? NSNumber)?.uint64Value == device && (a[.systemFileNumber] as? NSNumber)?.uint64Value == inode && (a[.ownerAccountID] as? NSNumber)?.uint32Value == getuid()
    }
}
private final class AX571OwnedLauncher {
    let paths: AX571OwnedPaths
    let bundle: URL
    let executable: URL
    let budget: Int
    var application: NSRunningApplication?
    var applicationPID: pid_t = 0
    var terminationObservation: NSKeyValueObservation?
    var signalSources: [DispatchSourceSignal] = []
    var stopping = false
    var terminationRequested = false
    var completed = false
    init?(_ arguments: [String]) {
        guard arguments.count == 5, let paths = AX571OwnedPaths(Array(arguments.prefix(4))),
              let ms = Int(arguments[4]), String(ms) == arguments[4], ms > 0, ms <= 20_000,
              let binary = Bundle.main.executableURL?.resolvingSymlinksInPath(),
              binary == URL(fileURLWithPath: CommandLine.arguments[0]).resolvingSymlinksInPath(),
              Bundle.main.bundleIdentifier == "com.cmspark.ax571.owned-target",
              Bundle.main.object(forInfoDictionaryKey: "CFBundlePackageType") as? String == "APPL" else { return nil }
        let app = Bundle.main.bundleURL.resolvingSymlinksInPath()
        guard app.lastPathComponent == "OwnedAX571.app", binary == app.appendingPathComponent("Contents/MacOS/owned-target"),
              [paths.ready, paths.marker, paths.sibling, paths.ready.appendingPathExtension("owner-started"), paths.ready.appendingPathExtension("owner-closed")].allSatisfy({ !FileManager.default.fileExists(atPath: $0.path) }) else { return nil }
        self.paths = paths; bundle = app; executable = binary; budget = ms
    }
    func receipt(_ terminated: Bool) -> Bool {
        guard paths.current(), applicationPID > 0 else { return false }
        let value: [String: Any] = ["schema":1,"framework":paths.framework,"pid":Int(applicationPID),"urlBound":true,"terminated":terminated]
        guard let data = try? JSONSerialization.data(withJSONObject:value) else { return false }
        let url = paths.ready.appendingPathExtension(terminated ? "owner-closed" : "owner-started")
        do { try data.write(to:url,options:.withoutOverwriting); try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path); return true } catch { return false }
    }
    func observedTermination(_ owned: NSRunningApplication) {
        guard application === owned, owned.isTerminated, !completed else { return }
        completed = true
        guard receipt(true) else { exit(65) }
        terminationObservation?.invalidate(); terminationObservation = nil
        for source in signalSources { source.cancel() }; signalSources.removeAll()
        exit(stopping ? 177 : 0)
    }
    func retire() {
        stopping = true
        guard let owned = application else { return } // late completion must still bind/reap its returned owner
        if owned.isTerminated { observedTermination(owned); return }
        guard !terminationRequested else { return }; terminationRequested = true
        _ = owned.forceTerminate() // this exact returned instance only; the Bool is not a close receipt
    }
    func start() {
        for number in [SIGTERM, SIGINT] {
            _ = Darwin.signal(number, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal:number,queue:.main)
            source.setEventHandler { [weak self] in self?.retire() }; signalSources.append(source); source.resume()
        }
        // One original remaining lifetime, never a new per-phase budget or retry.
        DispatchQueue.main.asyncAfter(deadline:.now() + .milliseconds(budget)) { [weak self] in self?.retire() }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.createsNewApplicationInstance = true
        configuration.allowsRunningApplicationSubstitution = false
        configuration.addsToRecentItems = false
        configuration.hides = false; configuration.hidesOthers = false; configuration.promptsUserIfNeeded = false
        configuration.arguments = [paths.framework, paths.ready.path, paths.marker.path, paths.sibling.path]
        configuration.environment = ["PATH":"/usr/bin:/bin","TMPDIR":paths.directory.path]
        NSWorkspace.shared.openApplication(at:bundle,configuration:configuration) { [self] returned, error in
            DispatchQueue.main.async { [self] in
                guard error == nil, let returned = returned, paths.current(),
                      returned.processIdentifier > 0, returned.processIdentifier != getpid(), !returned.isTerminated,
                      returned.bundleIdentifier == "com.cmspark.ax571.owned-target",
                      returned.bundleURL?.resolvingSymlinksInPath() == bundle,
                      returned.executableURL?.resolvingSymlinksInPath() == executable else { exit(65) }
                application = returned; applicationPID = returned.processIdentifier
                terminationObservation = returned.observe(\.isTerminated,options:[.initial,.new]) { [weak self] owned, _ in
                    DispatchQueue.main.async { self?.observedTermination(owned) }
                }
                guard receipt(false) else { retire(); return }
                if stopping { retire() }
            }
        }
    }
}

final class AX571Target: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    let framework: String
    let ready: URL
    let marker: URL
    let siblingMarker: URL
    var target: NSWindow!
    var sibling: NSWindow!
    var web: WKWebView?
    var published = false
    var setupStarted = false
    var readinessQueued = false
    var readinessObservers: [NSObjectProtocol] = []
    init(_ arguments: [String]) {
        guard let paths = AX571OwnedPaths(arguments) else { exit(64) }
        framework = paths.framework; ready = paths.ready; marker = paths.marker; siblingMarker = paths.sibling
        super.init()
    }
    func window(_ title: String) -> NSWindow {
        let value = NSWindow(contentRect: NSRect(x: 180, y: 180, width: 600, height: 400), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        value.title = title; value.delegate = self; value.isReleasedWhenClosed = false
        return value
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        target = window("Owned AX571 target")
        sibling = window("Owned AX571 foreground sibling")
        let siblingButton = NSButton(title: "OwnedAX571Sibling", target: self, action: #selector(siblingPressed(_:)))
        siblingButton.frame = NSRect(x: 40, y: 80, width: 280, height: 60); sibling.contentView?.addSubview(siblingButton)
        if framework == "APPKIT" {
            let button = NSButton(title: "OwnedAX571Press", target: self, action: #selector(targetPressed(_:)))
            button.frame = NSRect(x: 40, y: 80, width: 280, height: 60); target.contentView?.addSubview(button)
            target.makeKeyAndOrderFront(nil); publishReady()
        } else {
            let config = WKWebViewConfiguration(); config.userContentController.add(self, name: "ownedAX571")
            let view = WKWebView(frame: target.contentView!.bounds, configuration: config); view.autoresizingMask = [.width, .height]; view.navigationDelegate = self
            target.contentView = view; web = view
            view.loadHTMLString("<!doctype html><meta charset=utf-8><button aria-label='OwnedAX571Press' style='margin:50px;width:280px;height:60px' onclick=\"if(event.isTrusted)window.webkit.messageHandlers.ownedAX571.postMessage('AX571_TRUSTED_PRESS')\">OwnedAX571Press</button>", baseURL: nil)
            target.makeKeyAndOrderFront(nil)
        }
        // Safety termination only; it can never produce a PASS marker.
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { exit(177) }
    }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { publishReady() }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { exit(64) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { exit(64) }
    func publishReady() {
        guard !setupStarted else { return }; setupStarted = true
        // LaunchServices made the sole initial activation request; readiness observes its receipt.
        for (name, object) in [(NSApplication.didBecomeActiveNotification, NSApp as AnyObject), (NSWindow.didBecomeKeyNotification, sibling as AnyObject)] {
            readinessObservers.append(NotificationCenter.default.addObserver(forName: name, object: object, queue: .main) { [weak self] _ in self?.queueReadiness() })
        }
        sibling.makeKeyAndOrderFront(nil)
        queueReadiness()
    }
    func queueReadiness() {
        guard setupStarted, !published, !readinessQueued else { return }; readinessQueued = true
        DispatchQueue.main.async { [weak self] in
            guard let self=self else { return }; self.readinessQueued = false
            guard !self.published else { return }
            let pid=ProcessInfo.processInfo.processIdentifier, targetNumber=self.target.windowNumber, siblingNumber=self.sibling.windowNumber
            let rows=CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]
            let own = rows?.filter { ($0[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == pid } ?? []
            let number: ([String: Any]) -> Int? = { ($0[kCGWindowNumber as String] as? NSNumber)?.intValue }
            // Observe correspondence; never assume that a positive AppKit number is a CG ID.
            let targetBound=targetNumber>0 && own.filter { number($0)==targetNumber }.count==1
            let siblingBound=siblingNumber>0 && siblingNumber != targetNumber && own.filter { number($0)==siblingNumber }.count==1
            let firstRow=rows?.first(where: { (($0[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0)<=1000 })
            let first=firstRow.flatMap { number($0) }
            let role=rows == nil ? "UNKNOWN" : first == nil ? "NONE" : first == targetNumber ? "TARGET" : first == siblingNumber ? "SIBLING" : "OTHER"
            let active=NSApp.isActive, key=self.sibling.isKeyWindow
            let observation: [String: Any] = ["schema":1,"appActive":active,"siblingKey":key,"targetBound":targetBound,"siblingBound":siblingBound,"firstRole":role]
            self.write(observation, to:self.ready.appendingPathExtension("setup"))
            guard ax571Readiness(active,key,targetBound,siblingBound) else { return }
            self.published = true
            for observer in self.readinessObservers { NotificationCenter.default.removeObserver(observer) }; self.readinessObservers.removeAll()
            self.write(["schema":1,"framework":self.framework,"appPID":Int(getpid()),"target":targetNumber,"sibling":siblingNumber,"setup":observation], to:self.ready)
        }
    }
    func write(_ value: [String: Any], to url: URL) {
        do { let data = try JSONSerialization.data(withJSONObject: value); try data.write(to: url, options: .atomic) }
        catch { exit(64) }
    }
    @objc func targetPressed(_ sender: Any?) { changed() }
    @objc func siblingPressed(_ sender: Any?) { write(["schema": 1, "changed": true], to: siblingMarker) }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard framework == "WKWEBVIEW", message.webView === web, message.frameInfo.isMainFrame, message.body as? String == "AX571_TRUSTED_PRESS" else { return }
        changed()
    }
    func changed() {
        guard published, !FileManager.default.fileExists(atPath: marker.path) else { return }
        write(["schema": 1, "framework": framework, "changed": true], to: marker)
    }
    func windowWillClose(_ notification: Notification) { NSApp.terminate(nil) }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
let arguments = Array(CommandLine.arguments.dropFirst())
let app = NSApplication.shared
if arguments.first == "--launch-owned" {
    guard let launcher = AX571OwnedLauncher(Array(arguments.dropFirst())), app.setActivationPolicy(.prohibited) else { exit(64) }
    launcher.start(); withExtendedLifetime(launcher) { app.run() }
} else {
    let delegate = AX571Target(arguments)
    guard app.setActivationPolicy(.regular) else { exit(64) }
    app.delegate = delegate; withExtendedLifetime(delegate) { app.run() }
}
