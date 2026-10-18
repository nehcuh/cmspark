// Unshipped #571 target. Only an actual external AX press can call the state producer.
import AppKit
import WebKit
import Foundation

final class AX571Target: NSObject, NSApplicationDelegate, NSWindowDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    let framework: String
    let ready: URL
    let marker: URL
    let siblingMarker: URL
    var target: NSWindow!
    var sibling: NSWindow!
    var web: WKWebView?
    var published = false
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
        guard !published else { return }; published = true
        // Initial owned setup only. No activation/restoration is done after readiness.
        sibling.makeKeyAndOrderFront(nil)
        DispatchQueue.main.async { [self] in
            guard target.windowNumber > 0, sibling.windowNumber > 0, target.windowNumber != sibling.windowNumber else { exit(64) }
            write(["schema": 1, "framework": framework, "target": target.windowNumber, "sibling": sibling.windowNumber], to: ready)
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
