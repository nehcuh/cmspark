// Unshipped #571 target. Only an actual external AX press can call the state producer.
import AppKit
import WebKit
import Foundation
import Darwin

func ax571Readiness(_ active: Bool, _ key: Bool, _ targetBound: Bool, _ siblingBound: Bool) -> Bool { return active && key && targetBound && siblingBound }

// NSWindow.windowNumber is an application device number, not a CGWindowID.
// Cocoa screen origin is the primary/menu-bar screen's lower left; CG bounds use
// its upper left. Use the current screens[0] full frame, never NSScreen.main,
// visibleFrame, a guessed display size, or a backing-pixel scale.
private func ax571FiniteFrame(_ frame: CGRect) -> Bool {
    return frame.origin.x.isFinite && frame.origin.y.isFinite && frame.width.isFinite && frame.height.isFinite && frame.width > 0 && frame.height > 0 && frame.maxX.isFinite && frame.maxY.isFinite
}
private func ax571CGFrame(_ frame: CGRect, _ primary: CGRect) -> CGRect? {
    guard ax571FiniteFrame(frame), ax571FiniteFrame(primary), primary.origin.x == 0, primary.origin.y == 0 else { return nil }
    let converted = CGRect(x: frame.origin.x, y: primary.maxY - frame.maxY, width: frame.width, height: frame.height)
    guard ax571FiniteFrame(converted) else { return nil }
    return converted
}
private func ax571CGInteger(_ raw: Any?) -> Int? {
    guard let raw = raw as? NSNumber, CFGetTypeID(raw) != CFBooleanGetTypeID() else { return nil }
    let value = raw.doubleValue
    guard value.isFinite, value.rounded(.towardZero) == value, value >= 0, value <= Double(UInt32.max) else { return nil }
    return Int(value)
}
private enum AX571BindingReason: String {
    case invalidInput = "INVALID_INPUT"
    case rowOwnerInvalid = "ROW_OWNER_INVALID"
    case titleUnavailable = "TITLE_UNAVAILABLE"
    case geometryOrIDInvalid = "GEOMETRY_OR_ID_INVALID"
    case noTitleMatch = "NO_TITLE_MATCH"
    case geometryMismatch = "GEOMETRY_MISMATCH"
    case ambiguous = "AMBIGUOUS"
    case matched = "MATCHED"
}
private func ax571UniqueWindow(_ rows: [[String: Any]], _ pid: pid_t, _ title: String, _ frame: CGRect, _ reason: inout AX571BindingReason) -> Int? {
    reason = .invalidInput
    guard pid > 0, !title.isEmpty, ax571FiniteFrame(frame) else { return nil }
    var found: Int?
    var titleMatched = false
    for row in rows {
        guard let owner = ax571CGInteger(row[kCGWindowOwnerPID as String]) else { reason = .rowOwnerInvalid; return nil }
        if owner != Int(pid) { continue }
        guard let name = row[kCGWindowName as String] as? String else { reason = .titleUnavailable; return nil }
        if !name.utf8.elementsEqual(title.utf8) { continue }
        titleMatched = true
        guard let rawBounds = row[kCGWindowBounds as String] as? [String: Any],
              let bounds = CGRect(dictionaryRepresentation: rawBounds as CFDictionary), ax571FiniteFrame(bounds),
              let number = ax571CGInteger(row[kCGWindowNumber as String]), number > 0 else { reason = .geometryOrIDInvalid; return nil }
        if bounds != frame { continue }
        guard found == nil else { reason = .ambiguous; return nil }
        found = number
    }
    reason = found != nil ? .matched : (titleMatched ? .geometryMismatch : .noTitleMatch)
    return found
}

// Test-only LaunchServices owner. No PID lookup, app enumeration or foreign kill.
// Compare POSIX canonical bytes with Node realpath, not Foundation's display alias.
private func ax571CanonicalDirectory(_ directory: URL) -> Bool {
    guard directory.isFileURL, directory.path.hasPrefix("/"), !directory.path.contains("\0"),
          let resolved = Darwin.realpath(directory.path, nil) else { return false }
    defer { free(resolved) }
    return String(cString: resolved) == directory.path
}
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
        guard parent.lastPathComponent.hasPrefix("ax-native571-"), ax571CanonicalDirectory(parent),
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
        guard ax571CanonicalDirectory(directory),
              let a = try? FileManager.default.attributesOfItem(atPath: directory.path) else { return false }
        return a[.type] as? FileAttributeType == .typeDirectory && (a[.systemNumber] as? NSNumber)?.uint64Value == device && (a[.systemFileNumber] as? NSNumber)?.uint64Value == inode && (a[.ownerAccountID] as? NSNumber)?.uint32Value == getuid()
    }
}
// Passive startup journal: fixed tokens on one exclusively created, retained descriptor.
private enum AX571StartupPoint: String {
    case targetEntry = "TARGET_ENTRY", pathsAdmitted = "PATHS_ADMITTED", regularPolicyAdmitted = "REGULAR_POLICY_ADMITTED"
    case didFinishEntered = "DID_FINISH_ENTERED", readinessQueued = "READINESS_QUEUED"
    case targetPathsRefused = "TARGET_PATHS_REFUSED", regularPolicyRefused = "REGULAR_POLICY_REFUSED"
    case wkNavigationRefused = "WK_NAVIGATION_REFUSED", receiptWriteRefused = "RECEIPT_WRITE_REFUSED"
}
private final class AX571StartupJournal {
    let directory: String
    let directoryFD: Int32
    let fileFD: Int32
    let directoryIdentity: stat
    let fileIdentity: stat
    var records = 0
    var bytes = 0
    var last: AX571StartupPoint?
    var stopped = false
    static func same(_ value: stat, _ original: stat, _ kind: mode_t, _ permissions: mode_t) -> Bool {
        return value.st_dev == original.st_dev && value.st_ino == original.st_ino && value.st_uid == getuid() && value.st_mode & S_IFMT == kind && value.st_mode & 0o7777 == permissions && value.st_nlink == 1
    }
    // Directories need not have nlink1; file identities always do.
    static func sameDirectory(_ value: stat, _ original: stat) -> Bool {
        return value.st_dev == original.st_dev && value.st_ino == original.st_ino && value.st_uid == getuid() && value.st_mode & S_IFMT == S_IFDIR && value.st_mode & 0o7777 == 0o700
    }
    static func closeOwned(_ fd: Int32, _ original: stat, _ directory: Bool) {
        var current = stat()
        guard Darwin.fstat(fd, &current) == 0 else { return }
        if directory ? sameDirectory(current, original) : same(current, original, mode_t(S_IFREG), mode_t(0o600)) { _ = Darwin.close(fd) }
    }
    init?() {
        guard let raw = ProcessInfo.processInfo.environment["TMPDIR"], raw.hasPrefix("/"), !raw.contains("\0") else { return nil }
        let url = URL(fileURLWithPath: raw)
        guard url.path == raw, url.lastPathComponent.hasPrefix("ax-native571-"), ax571CanonicalDirectory(url) else { return nil }
        var original = stat()
        guard Darwin.lstat(raw, &original) == 0, Self.sameDirectory(original, original) else { return nil }
        let d = Darwin.open(raw, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC)
        guard d >= 0 else { return nil }
        var held = stat()
        guard Darwin.fstat(d, &held) == 0, Self.sameDirectory(held, original) else { Self.closeOwned(d, original, true); return nil }
        let f = Darwin.openat(d, "target-startup.log", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, mode_t(0o600))
        guard f >= 0 else { Self.closeOwned(d, original, true); return nil }
        var file = stat(), current = stat()
        // No reopen/unlink even if admission or observation fails.
        guard Darwin.fstat(f, &file) == 0 else { Self.closeOwned(d, original, true); return nil }
        guard Self.same(file, file, mode_t(S_IFREG), mode_t(0o600)), file.st_size == 0,
              Darwin.lstat(raw, &current) == 0, Self.sameDirectory(current, original) else { Self.closeOwned(f, file, false); Self.closeOwned(d, original, true); return nil }
        directory = raw; directoryFD = d; fileFD = f; directoryIdentity = original; fileIdentity = file
    }
    func note(_ point: AX571StartupPoint) {
        guard !stopped else { return }
        // Repeated readiness notifications are an existing callback, not a new stage.
        if last == point { return }
        let stages: [AX571StartupPoint] = [.targetEntry, .pathsAdmitted, .regularPolicyAdmitted, .didFinishEntered, .readinessQueued]
        let refusals: [AX571StartupPoint] = [.targetPathsRefused, .regularPolicyRefused, .wkNavigationRefused, .receiptWriteRefused]
        let refusal = refusals.contains(point)
        let next = stages.firstIndex(of: point)
        let previous = last.flatMap { stages.firstIndex(of: $0) }
        let allowedRefusal = (point == .targetPathsRefused && last == .targetEntry) || (point == .regularPolicyRefused && last == .pathsAdmitted) || ((point == .wkNavigationRefused || point == .receiptWriteRefused) && (previous ?? -1) >= 2)
        guard refusal ? allowedRefusal : next == (previous.map { $0 + 1 } ?? 0) else { stopped = true; return }
        var parent = stat(), heldParent = stat(), file = stat()
        guard Darwin.lstat(directory, &parent) == 0, Self.sameDirectory(parent, directoryIdentity),
              Darwin.fstat(directoryFD, &heldParent) == 0, Self.sameDirectory(heldParent, directoryIdentity),
              Darwin.fstat(fileFD, &file) == 0, Self.same(file, fileIdentity, mode_t(S_IFREG), mode_t(0o600)), file.st_size == off_t(bytes) else { stopped = true; return }
        let data = Array((point.rawValue + "\n").utf8)
        guard records < 12, bytes + data.count <= 512 else { stopped = true; return }
        let written = data.withUnsafeBytes { Darwin.write(fileFD, $0.baseAddress, data.count) }
        guard written == data.count else { stopped = true; return }
        bytes += data.count; records += 1; last = point
        if refusal { stopped = true }
    }
    deinit {
        // Descriptor numbers alone confer no ownership after replacement.
        var file = stat(), parent = stat()
        if Darwin.fstat(fileFD, &file) == 0 && Self.same(file, fileIdentity, mode_t(S_IFREG), mode_t(0o600)) { _ = Darwin.close(fileFD) }
        if Darwin.fstat(directoryFD, &parent) == 0 && Self.sameDirectory(parent, directoryIdentity) { _ = Darwin.close(directoryFD) }
    }
}
private var ax571StartupJournal: AX571StartupJournal?

// Test-only lifecycle observations, never application ownership or cleanup authority.
private enum AX571LaunchLifecyclePoint { case entry, refused }
private func ax571LaunchLifecycle(_ point: AX571LaunchLifecyclePoint, _ application: NSRunningApplication) {
    let pidAvailable = application.processIdentifier > 0
    let terminated = application.isTerminated
    let finishedLaunching = application.isFinishedLaunching
    let bits = (pidAvailable ? 1 : 0) | (terminated ? 2 : 0) | (finishedLaunching ? 4 : 0)
    let marker = point == .entry ? "AX571_LIFECYCLE_ENTRY_" : "AX571_LIFECYCLE_REFUSED_"
    do { try FileHandle.standardError.write(contentsOf: Data((marker + String(bits) + "\n").utf8)) } catch {}
}
// Fixed diagnostic categories only. A failed completion still refuses with exit65.
private enum AX571LaunchGuardFailure {
    case openError, noReturnedApp, parentChanged, returnedPIDNonpositive, returnedPIDSelf, returnedTerminated, bundleID, bundleURL, executableURL
}
private func ax571LaunchGuardRefused(_ failure: AX571LaunchGuardFailure) -> Never {
    let marker: String
    switch failure {
    case .openError: marker = "AX571_LAUNCH_OPEN_ERROR\n"
    case .noReturnedApp: marker = "AX571_LAUNCH_NO_RETURNED_APP\n"
    case .parentChanged: marker = "AX571_LAUNCH_PARENT_CHANGED\n"
    case .returnedPIDNonpositive: marker = "AX571_LAUNCH_RETURNED_PID_NONPOSITIVE\n"
    case .returnedPIDSelf: marker = "AX571_LAUNCH_RETURNED_PID_SELF\n"
    case .returnedTerminated: marker = "AX571_LAUNCH_RETURNED_TERMINATED\n"
    case .bundleID: marker = "AX571_LAUNCH_BUNDLE_ID\n"
    case .bundleURL: marker = "AX571_LAUNCH_BUNDLE_URL\n"
    case .executableURL: marker = "AX571_LAUNCH_EXECUTABLE_URL\n"
    }
    try? FileHandle.standardError.write(contentsOf: Data(marker.utf8))
    exit(65)
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
            if error == nil, let observed = returned { ax571LaunchLifecycle(.entry, observed) }
            DispatchQueue.main.async { [self] in
                guard error == nil else { ax571LaunchGuardRefused(.openError) }
                guard let returned = returned else { ax571LaunchGuardRefused(.noReturnedApp) }
                guard paths.current() else { ax571LaunchGuardRefused(.parentChanged) }
                guard returned.processIdentifier > 0 else { ax571LaunchLifecycle(.refused, returned); ax571LaunchGuardRefused(.returnedPIDNonpositive) }
                guard returned.processIdentifier != getpid() else { ax571LaunchGuardRefused(.returnedPIDSelf) }
                guard !returned.isTerminated else { ax571LaunchGuardRefused(.returnedTerminated) }
                guard returned.bundleIdentifier == "com.cmspark.ax571.owned-target" else { ax571LaunchGuardRefused(.bundleID) }
                guard returned.bundleURL?.resolvingSymlinksInPath() == bundle else { ax571LaunchGuardRefused(.bundleURL) }
                guard returned.executableURL?.resolvingSymlinksInPath() == executable else { ax571LaunchGuardRefused(.executableURL) }
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
        guard let paths = AX571OwnedPaths(arguments) else { ax571StartupJournal?.note(.targetPathsRefused); exit(64) }
        ax571StartupJournal?.note(.pathsAdmitted)
        framework = paths.framework; ready = paths.ready; marker = paths.marker; siblingMarker = paths.sibling
        super.init()
    }
    func window(_ title: String) -> NSWindow {
        let value = NSWindow(contentRect: NSRect(x: 180, y: 180, width: 600, height: 400), styleMask: [.titled, .closable], backing: .buffered, defer: false)
        value.title = title; value.delegate = self; value.isReleasedWhenClosed = false
        return value
    }
    func applicationDidFinishLaunching(_ notification: Notification) {
        ax571StartupJournal?.note(.didFinishEntered)
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
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { ax571StartupJournal?.note(.wkNavigationRefused); exit(64) }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { ax571StartupJournal?.note(.wkNavigationRefused); exit(64) }
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
        ax571StartupJournal?.note(.readinessQueued)
        DispatchQueue.main.async { [weak self] in
            guard let self=self else { return }; self.readinessQueued = false
            guard !self.published else { return }
            let pid=ProcessInfo.processInfo.processIdentifier
            let primary=NSScreen.screens.first, primaryFrame=primary?.frame
            let targetTitle=self.target.title, siblingTitle=self.sibling.title
            let targetFrame=self.target.frame, siblingFrame=self.sibling.frame
            let rows=CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]
            let own=rows?.filter { ax571CGInteger($0[kCGWindowOwnerPID as String]) == Int(pid) }
            let targetCG=primaryFrame.flatMap { ax571CGFrame(targetFrame,$0) }, siblingCG=primaryFrame.flatMap { ax571CGFrame(siblingFrame,$0) }
            var firstTargetReason=AX571BindingReason.invalidInput, firstSiblingReason=AX571BindingReason.invalidInput
            let targetNumber=own.flatMap { list in targetCG.flatMap { ax571UniqueWindow(list,pid,targetTitle,$0,&firstTargetReason) } }
            let siblingNumber=own.flatMap { list in siblingCG.flatMap { ax571UniqueWindow(list,pid,siblingTitle,$0,&firstSiblingReason) } }
            // Re-observe the exact two objects, screen and CG identities; no retry or fallback.
            let currentRows=CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]]
            let currentOwn=currentRows?.filter { ax571CGInteger($0[kCGWindowOwnerPID as String]) == Int(pid) }
            var secondTargetReason=AX571BindingReason.invalidInput, secondSiblingReason=AX571BindingReason.invalidInput
            let currentTarget=currentOwn.flatMap { list in targetCG.flatMap { ax571UniqueWindow(list,pid,targetTitle,$0,&secondTargetReason) } }
            let currentSibling=currentOwn.flatMap { list in siblingCG.flatMap { ax571UniqueWindow(list,pid,siblingTitle,$0,&secondSiblingReason) } }
            let stable=primary != nil && NSScreen.screens.first === primary && primary?.frame == primaryFrame && targetTitle.utf8.elementsEqual("Owned AX571 target".utf8) && siblingTitle.utf8.elementsEqual("Owned AX571 foreground sibling".utf8) && self.target.title.utf8.elementsEqual(targetTitle.utf8) && self.sibling.title.utf8.elementsEqual(siblingTitle.utf8) && self.target.frame == targetFrame && self.sibling.frame == siblingFrame && currentTarget == targetNumber && currentSibling == siblingNumber
            let targetBound=stable && targetNumber != nil
            let siblingBound=stable && siblingNumber != nil && siblingNumber != targetNumber
            let number: ([String: Any]) -> Int? = { ax571CGInteger($0[kCGWindowNumber as String]) }
            let firstRow=rows?.first(where: { (($0[kCGWindowLayer as String] as? NSNumber)?.intValue ?? 0)<=1000 })
            let first=firstRow.flatMap { number($0) }
            let role=rows == nil ? "UNKNOWN" : first == nil ? "NONE" : first == targetNumber ? "TARGET" : first == siblingNumber ? "SIBLING" : "OTHER"
            let active=NSApp.isActive, key=self.sibling.isKeyWindow
            let observation: [String: Any] = ["schema":1,"appActive":active,"siblingKey":key,"targetBound":targetBound,"siblingBound":siblingBound,"firstRole":role]
            self.writeBinding(firstTargetReason,firstSiblingReason,secondTargetReason,secondSiblingReason,stable)
            self.write(observation, to:self.ready.appendingPathExtension("setup"))
            guard ax571Readiness(active,key,targetBound,siblingBound) else { return }
            guard let targetNumber=targetNumber, let siblingNumber=siblingNumber else { return }
            self.published = true
            for observer in self.readinessObservers { NotificationCenter.default.removeObserver(observer) }; self.readinessObservers.removeAll()
            self.write(["schema":1,"framework":self.framework,"appPID":Int(getpid()),"target":targetNumber,"sibling":siblingNumber,"setup":observation], to:self.ready)
        }
    }
    // Passive private test observation only. Failure must never replace setup/ready or exit.
    private func writeBinding(_ firstTarget: AX571BindingReason, _ firstSibling: AX571BindingReason, _ secondTarget: AX571BindingReason, _ secondSibling: AX571BindingReason, _ stable: Bool) {
        do {
            let value: [String: Any] = ["schema":1,"firstTarget":firstTarget.rawValue,"firstSibling":firstSibling.rawValue,"secondTarget":secondTarget.rawValue,"secondSibling":secondSibling.rawValue,"stable":stable]
            let data = try JSONSerialization.data(withJSONObject:value)
            guard data.count <= 512 else { return }
            let file = ready.appendingPathExtension("binding")
            try data.write(to:file,options:.atomic)
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
        } catch {}
    }
    func write(_ value: [String: Any], to url: URL) {
        do { let data = try JSONSerialization.data(withJSONObject: value); try data.write(to: url, options: .atomic) }
        catch { ax571StartupJournal?.note(.receiptWriteRefused); exit(64) }
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
if arguments.first != "--launch-owned" { ax571StartupJournal = AX571StartupJournal(); ax571StartupJournal?.note(.targetEntry) }
let app = NSApplication.shared
if arguments.first == "--launch-owned" {
    // Dedicated categories are reachable only before any owned-app launch request.
    guard let launcher = AX571OwnedLauncher(Array(arguments.dropFirst())) else { exit(78) }
    guard app.setActivationPolicy(.prohibited) else { exit(79) }
    launcher.start(); withExtendedLifetime(launcher) { app.run() }
} else {
    let delegate = AX571Target(arguments)
    let initialPolicy = app.activationPolicy()
    guard initialPolicy == .regular || (app.setActivationPolicy(.regular) && app.activationPolicy() == .regular) else { ax571StartupJournal?.note(.regularPolicyRefused); exit(64) }
    ax571StartupJournal?.note(.regularPolicyAdmitted)
    app.delegate = delegate; withExtendedLifetime(delegate) { app.run() }
}
