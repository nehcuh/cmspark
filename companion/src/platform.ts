// Platform abstraction layer for CMspark Companion
// Provides cross-platform APIs for lock files, service management, Chrome opening, etc.

import * as os from "os"
import * as path from "path"
import { getConfigDir } from "./config"

export type PlatformName = "darwin" | "win32" | "linux" | "unknown"

export function getPlatform(): PlatformName {
  const p = os.platform()
  if (p === "darwin") return "darwin"
  if (p === "win32") return "win32"
  if (p === "linux") return "linux"
  return "unknown"
}

export function isWindows(): boolean {
  return getPlatform() === "win32"
}

export function isMacOS(): boolean {
  return getPlatform() === "darwin"
}

export function isLinux(): boolean {
  return getPlatform() === "linux"
}

// ---------------------------------------------------------------------------
// Lock path
// ---------------------------------------------------------------------------

/**
 * Return the platform-appropriate lock path.
 * - macOS/Linux: Unix Domain Socket file under ~/.cmspark-agent/
 * - Windows: Named pipe path (\\?\pipe\...)
 */
export function getLockPath(): string {
  if (isWindows()) {
    // Windows named pipe.  Must NOT be a filesystem path.
    return "\\\\?\\pipe\\cmspark-agent-lock"
  }
  return path.join(getConfigDir(), "daemon.sock")
}

/**
 * Return the PID file path (common across platforms).
 */
export function getPidPath(): string {
  return path.join(getConfigDir(), "daemon.pid")
}

// ---------------------------------------------------------------------------
// Service manager commands
// ---------------------------------------------------------------------------

export interface ServiceCommands {
  /** Install and register the background service */
  install: string[]
  /** Uninstall / deregister */
  uninstall: string[]
  /** Query service status */
  status: string[]
  /** Start the service now */
  start: string[]
  /** Stop the service now */
  stop: string[]
}

export function getServiceCommands(): ServiceCommands {
  const platform = getPlatform()
  switch (platform) {
    case "darwin":
      return {
        install: ["sh", "-c", "cd $(dirname $0)/../.. && ./scripts/install-daemon.sh"],
        uninstall: ["sh", "-c", "cd $(dirname $0)/../.. && ./scripts/uninstall-daemon.sh"],
        status: ["launchctl", "list"],
        start: ["launchctl", "start", "com.cmspark.companion"],
        stop: ["launchctl", "stop", "com.cmspark.companion"],
      }
    case "win32":
      return {
        install: ["powershell", "-ExecutionPolicy", "Bypass", "-File", "scripts/install-daemon.ps1"],
        uninstall: ["powershell", "-ExecutionPolicy", "Bypass", "-File", "scripts/uninstall-daemon.ps1"],
        status: ["schtasks", "/query", "/tn", "cmspark-companion"],
        start: ["schtasks", "/run", "/tn", "cmspark-companion"],
        stop: ["schtasks", "/end", "/tn", "cmspark-companion"],
      }
    case "linux":
      return {
        install: ["sh", "-c", "cd $(dirname $0)/../.. && ./scripts/install-daemon.sh"],
        uninstall: ["sh", "-c", "cd $(dirname $0)/../.. && ./scripts/uninstall-daemon.sh"],
        status: ["systemctl", "--user", "status", "cmspark-companion"],
        start: ["systemctl", "--user", "start", "cmspark-companion"],
        stop: ["systemctl", "--user", "stop", "cmspark-companion"],
      }
    default:
      throw new Error(`Unsupported platform: ${platform}`)
  }
}

// ---------------------------------------------------------------------------
// Chrome / Browser opening
// ---------------------------------------------------------------------------

export interface ChromeOpener {
  /** Open Chrome and focus it (best effort) */
  openChrome(): void
  /** Open Chrome extension management page */
  openExtensions(): void
  /** Open Chrome side panel for CMspark (best effort) */
  openSidePanel(): void
}

function runSilent(cmd: string, args: string[]): void {
  const { spawn } = require("child_process")
  const child = spawn(cmd, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  })
  child.unref()
}

class MacOSChromeOpener implements ChromeOpener {
  openChrome(): void {
    runSilent("osascript", [
      "-e",
      'tell application "Google Chrome" to activate',
    ])
  }

  openExtensions(): void {
    runSilent("osascript", [
      "-e",
      'tell application "Google Chrome" to open location "chrome://extensions/"',
    ])
  }

  openSidePanel(): void {
    // Best effort: activate Chrome and tell user to click the icon
    runSilent("osascript", [
      "-e",
      'tell application "Google Chrome" to activate',
    ])
  }
}

class WindowsChromeOpener implements ChromeOpener {
  openChrome(): void {
    runSilent("cmd", ["/c", "start", "chrome"])
  }

  openExtensions(): void {
    runSilent("cmd", ["/c", "start", "chrome", "chrome://extensions/"])
  }

  openSidePanel(): void {
    runSilent("cmd", ["/c", "start", "chrome"])
  }
}

class LinuxChromeOpener implements ChromeOpener {
  openChrome(): void {
    runSilent("xdg-open", ["chrome://newtab/"])
  }

  openExtensions(): void {
    runSilent("xdg-open", ["chrome://extensions/"])
  }

  openSidePanel(): void {
    runSilent("xdg-open", ["chrome://newtab/"])
  }
}

export function getChromeOpener(): ChromeOpener {
  const platform = getPlatform()
  switch (platform) {
    case "darwin":
      return new MacOSChromeOpener()
    case "win32":
      return new WindowsChromeOpener()
    case "linux":
      return new LinuxChromeOpener()
    default:
      return new LinuxChromeOpener()
  }
}

// ---------------------------------------------------------------------------
// Log directory opening
// ---------------------------------------------------------------------------

/**
 * Open the log directory in the platform file manager.
 */
export function openLogDirectory(logDir: string): void {
  const platform = getPlatform()
  switch (platform) {
    case "darwin":
      runSilent("open", [logDir])
      break
    case "win32":
      runSilent("explorer", [logDir])
      break
    case "linux":
      runSilent("xdg-open", [logDir])
      break
    default:
      console.log(`Log directory: ${logDir}`)
  }
}

// ---------------------------------------------------------------------------
// Tray / Menu-bar support level
// ---------------------------------------------------------------------------

export type TrayLevel = "native" | "notification-only" | "none"

export function getTrayLevel(): TrayLevel {
  const platform = getPlatform()
  switch (platform) {
    case "darwin":
      // node-notifier notifications + readline menu (not true NSStatusBar)
      return "notification-only"
    case "win32":
      // Can use native system tray via systray npm package
      return "native"
    case "linux":
      // node-notifier with libnotify backend
      return "notification-only"
    default:
      return "none"
  }
}

// ---------------------------------------------------------------------------
// Service install script path
// ---------------------------------------------------------------------------

export function getInstallScriptPath(): string {
  const platform = getPlatform()
  if (platform === "win32") {
    return "scripts/install-daemon.ps1"
  }
  return "scripts/install-daemon.sh"
}

// ---------------------------------------------------------------------------
// Service config path
// ---------------------------------------------------------------------------

export function getServiceConfigPath(): string {
  const platform = getPlatform()
  switch (platform) {
    case "darwin":
      return path.join(os.homedir(), "Library/LaunchAgents/com.cmspark.companion.plist")
    case "win32":
      return "scripts/windows-service.xml"
    case "linux":
      return path.join(os.homedir(), ".config/systemd/user/cmspark-companion.service")
    default:
      return ""
  }
}
