#!/usr/bin/env node
// Swift Tray Auto-Build Script
// =============================
// Automatically compiles the native Swift tray binary on macOS Apple Silicon
// during npm install. Silently skips on other platforms or if Swift is unavailable.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const scriptDir = __dirname;
const projectRoot = path.resolve(scriptDir, "..");
const buildScript = path.join(projectRoot, "companion", "src", "tray", "build-tray.sh");

function info(msg) {
  console.log(`[build-swift-tray] INFO:  ${msg}`);
}

function warn(msg) {
  console.warn(`[build-swift-tray] WARN:  ${msg}`);
}

function main() {
  // Only build on macOS
  if (process.platform !== "darwin") {
    info("Not macOS — skipping Swift tray build.");
    process.exit(0);
  }

  // Only build on ARM64 (Apple Silicon). x86_64 Macs can use systray2 via Rosetta.
  if (process.arch !== "arm64") {
    info(`Architecture is ${process.arch}, not arm64 — skipping Swift tray build.`);
    process.exit(0);
  }

  // Check if Swift compiler is available
  const swiftCheck = spawnSync("which", ["swiftc"], { encoding: "utf-8" });
  if (swiftCheck.status !== 0) {
    warn("swiftc not found. Install Xcode Command Line Tools:");
    warn("  xcode-select --install");
    warn("Swift tray will not be available. Falling back to systray2 (requires Rosetta) or readline CLI.");
    process.exit(0); // Don't fail npm install
  }

  // Check if build script exists
  if (!fs.existsSync(buildScript)) {
    warn(`Build script not found: ${buildScript}`);
    process.exit(0);
  }

  info("Detected macOS ARM64 with swiftc — building Swift tray...");

  const result = spawnSync("bash", [buildScript], {
    cwd: path.join(projectRoot, "companion"),
    stdio: "inherit",
    encoding: "utf-8",
  });

  if (result.status !== 0) {
    warn("Swift tray build failed. See output above for details.");
    warn("Menu bar will fall back to systray2 (requires Rosetta) or readline CLI.");
    process.exit(0); // Don't fail npm install
  }

  info("Swift tray build completed successfully.");
  process.exit(0);
}

main();
