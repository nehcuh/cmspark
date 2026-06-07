#!/usr/bin/env node
// systray2 Binary Integrity Verifier
// ====================================
// Validates precompiled Go binaries shipped with systray2 npm package
// against known-good SHA256 hashes.
//
// Usage:
//   node scripts/verify-systray2.js [--strict]
//     --strict   Exit with code 1 on any mismatch (default: warn only)
//
// Exit codes:
//   0  All present binaries match expected hashes
//   1  One or more binaries mismatch (or missing expected files)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const EXIT_OK = 0;
const EXIT_MISMATCH = 1;
const EXIT_CONFIG_ERROR = 2;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function error(msg) {
  console.error(`[verify-systray2] ERROR: ${msg}`);
}

function warn(msg) {
  console.warn(`[verify-systray2] WARN:  ${msg}`);
}

function info(msg) {
  console.log(`[verify-systray2] INFO:  ${msg}`);
}

function ok(msg) {
  console.log(`[verify-systray2] OK:    ${msg}`);
}

/**
 * Compute SHA256 of a file using streams (constant memory).
 */
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const strict = process.argv.includes("--strict");

  // Resolve paths relative to project root (where this script lives in scripts/)
  const scriptDir = __dirname;
  const projectRoot = path.resolve(scriptDir, "..");
  const hashFilePath = path.join(scriptDir, "systray2-sha256.json");
  const systrayBinDir = path.join(
    projectRoot,
    "companion",
    "node_modules",
    "systray2",
    "traybin"
  );

  // Load expected hashes
  if (!fs.existsSync(hashFilePath)) {
    error(`Hash manifest not found: ${hashFilePath}`);
    process.exit(EXIT_CONFIG_ERROR);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(hashFilePath, "utf-8"));
  } catch (e) {
    error(`Failed to parse hash manifest: ${e.message}`);
    process.exit(EXIT_CONFIG_ERROR);
  }

  if (!manifest.binaries || typeof manifest.binaries !== "object") {
    error("Hash manifest missing 'binaries' field");
    process.exit(EXIT_CONFIG_ERROR);
  }

  info(`Verifying systray2 binaries (package=${manifest.package}, version=${manifest.version})`);

  let mismatchCount = 0;
  let checkedCount = 0;

  for (const [binaryName, meta] of Object.entries(manifest.binaries)) {
    const expectedHash = meta.sha256;
    if (!expectedHash) {
      warn(`No expected hash for ${binaryName}; skipping`);
      continue;
    }

    const binaryPath = path.join(systrayBinDir, binaryName);

    if (!fs.existsSync(binaryPath)) {
      // Binary not present on this platform — that's okay (e.g. Windows binary on macOS)
      info(`Binary not present on this platform: ${binaryName}`);
      continue;
    }

    checkedCount++;
    const actualHash = await sha256File(binaryPath);

    if (actualHash !== expectedHash) {
      mismatchCount++;
      error(`HASH MISMATCH: ${binaryName}`);
      error(`  Expected: ${expectedHash}`);
      error(`  Actual:   ${actualHash}`);
      error(`  Path:     ${binaryPath}`);
      if (meta.note) {
        error(`  Note:     ${meta.note}`);
      }
    } else {
      ok(`${binaryName} → ${actualHash}`);
    }
  }

  // Summary
  console.log("");
  if (mismatchCount > 0) {
    error(`Verification FAILED: ${mismatchCount} binary(s) mismatched out of ${checkedCount} checked.`);
    error("Possible causes:");
    error("  1. npm registry compromise or MITM attack");
    error("  2. systray2 was upgraded without updating systray2-sha256.json");
    error("  3. Binary was corrupted during download");
    error("");
    error("DO NOT USE THIS BUILD IN PRODUCTION.");
    error("If you intentionally upgraded systray2, see CONTRIBUTING.md for hash update procedure.");
    process.exit(strict ? EXIT_MISMATCH : EXIT_OK);
  }

  if (checkedCount === 0) {
    warn("No binaries were checked. Is systray2 installed?");
    process.exit(strict ? EXIT_MISMATCH : EXIT_OK);
  }

  ok(`All ${checkedCount} binary(s) verified successfully.`);
  process.exit(EXIT_OK);
}

main().catch((e) => {
  error(`Unexpected error: ${e.message}`);
  process.exit(EXIT_CONFIG_ERROR);
});
