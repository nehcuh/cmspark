// Unshipped #571 target. Only an actual external AX press can call the state producer.
import AppKit
import WebKit
import Foundation

func ax571Readiness(_ active: Bool, _ key: Bool, _ targetBound: Bool, _ siblingBound: Bool) -> Bool { return active && key && targetBound && siblingBound }

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
        guard arguments.count == 4, ["APPKIT", "WKWEBVIEW"].contains(arguments[0]), arguments.dropFirst().allSatisfy({ $0.hasPrefix("/") && !$0.contains("\0") }) else { exit(64) }
        framework = arguments[0]; ready = URL(fileURLWithPath: arguments[1]); marker = URL(fileURLWithPath: arguments[2]); siblingMarker = URL(fileURLWithPath: arguments[3])
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
        // Only initial owned setup may request activation. A request is not its receipt.
        for (name, object) in [(NSApplication.didBecomeActiveNotification, NSApp as AnyObject), (NSWindow.didBecomeKeyNotification, sibling as AnyObject)] {
            readinessObservers.append(NotificationCenter.default.addObserver(forName: name, object: object, queue: .main) { [weak self] _ in self?.queueReadiness() })
        }
        if #available(macOS 14.0, *) { NSApp.activate() } else { NSApp.activate(ignoringOtherApps: true) }
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
            self.write(["schema":1,"framework":self.framework,"target":targetNumber,"sibling":siblingNumber,"setup":observation], to:self.ready)
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
let app = NSApplication.shared
let delegate = AX571Target(Array(CommandLine.arguments.dropFirst()))
app.setActivationPolicy(.regular); app.delegate = delegate; app.run()
