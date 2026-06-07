-- CMspark macOS Native Menu Bar (AppleScript + NSStatusBar)
-- ==========================================================
-- This script creates a true macOS NSStatusBar menu-bar icon.
-- It communicates with the Node.js menu-bar-agent via a status file.
--
-- Build: osacompile -o "CMspark Menu Bar.app" macos-menu-bar.applescript
--   Then set LSUIElement=true in Info.plist to hide from Dock.
--
-- Limitations:
--   - AppleScript ObjC bridge is limited; complex UI interactions may lag.
--   - Status updates require polling the JSON file.
--   - Not as responsive as a native Swift implementation.

use framework "Foundation"
use scripting additions

property statusItem : missing value
property statusTimer : missing value
property statusFile : ""

-- ---------------------------------------------------------------------------
-- Init
-- ---------------------------------------------------------------------------
on run
	set homePath to POSIX path of (path to home folder)
	set statusFile to homePath & ".cmspark-agent/.menu-bar-status.json"

	set statusBar to current application's NSStatusBar's systemStatusBar()
	set statusItem to statusBar's statusItemWithLength:(current application's NSVariableStatusItemLength)

	-- Initial icon
	updateStatus()

	-- Build menu
	set menu to current application's NSMenu's alloc()'s init()

	set startItem to current application's NSMenuItem's alloc()'s initWithTitle:("启动 Companion") action:("startCompanion:") keyEquivalent:("")
	startItem's setTarget:me
	menu's addItem:startItem

	set stopItem to current application's NSMenuItem's alloc()'s initWithTitle:("停止 Companion") action:("stopCompanion:") keyEquivalent:("")
	stopItem's setTarget:me
	menu's addItem:stopItem

	menu's addItem:(current application's NSMenuItem's separatorItem())

	set statusItem2 to current application's NSMenuItem's alloc()'s initWithTitle:("查看状态") action:("showStatus:") keyEquivalent:("")
	statusItem2's setTarget:me
	menu's addItem:statusItem2

	set logsItem to current application's NSMenuItem's alloc()'s initWithTitle:("打开日志目录") action:("openLogs:") keyEquivalent:("")
	logsItem's setTarget:me
	menu's addItem:logsItem

	menu's addItem:(current application's NSMenuItem's separatorItem())

	set quitItem to current application's NSMenuItem's alloc()'s initWithTitle:("退出") action:("quitApp:") keyEquivalent:("q")
	quitItem's setTarget:me
	menu's addItem:quitItem

	statusItem's setMenu:menu

	-- Start polling timer (every 3 seconds)
	set statusTimer to current application's NSTimer's scheduledTimerWithTimeInterval:3 target:me selector:("updateStatus") userInfo:(missing value) repeats:true

	-- Keep script running
	repeat while true
		delay 1
	end repeat
end run

-- ---------------------------------------------------------------------------
-- Status polling
-- ---------------------------------------------------------------------------
on updateStatus()
	try
		set statusJSON to do shell script "cat " & quoted form of statusFile & " 2>/dev/null || echo '{}'"
		if statusJSON contains "\"running\"" then
			statusItem's button's setTitle:"🟢"
		else
			statusItem's button's setTitle:"🔴"
		end if
	on error
		statusItem's button's setTitle:"🔴"
	end try
end updateStatus

-- ---------------------------------------------------------------------------
-- Menu actions
-- ---------------------------------------------------------------------------
on startCompanion:(_)
	try
		do shell script "cmspark-agent daemon start --daemonize >/dev/null 2>&1 &"
	end try
	updateStatus()
end startCompanion:

on stopCompanion:(_)
	try
		do shell script "cmspark-agent daemon stop >/dev/null 2>&1"
	end try
	updateStatus()
end stopCompanion:

on showStatus:(_)
	try
		set output to do shell script "cmspark-agent daemon status 2>&1"
		display dialog output buttons {"OK"} default button "OK"
	end try
end showStatus:

on openLogs:(_)
	try
		do shell script "open ~/.cmspark-agent/logs"
	end try
end openLogs:

on quitApp:(_)
	try
		if statusTimer is not missing value then
			statusTimer's invalidate()
		end if
	end try
	current application's NSApplication's sharedApplication()'s terminate:me
end quitApp:
