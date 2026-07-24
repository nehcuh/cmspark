#!/usr/bin/env node
// TinyClick vendored Florence-2 files integrity verifier (WP5 I1 WI-1.4)
// ======================================================================
// Validates the three vendored trust_remote_code files
// (scripts/spike/s1-tinyclick-onnx/vendor/*.py) against the SINGLE hash
// registry: companion/models.manifest.json → models.tinyclick.provenance
// .exportVendor (B6: no parallel sha256.json — one registry, no drift).
//
// Why pinned: upstream auto_map resolves microsoft/Florence-2-base HEAD at
// runtime; a silent upstream push would make the same export recipe produce
// different ONNX bytes under an unchanged hash-registry narrative (W3 §6).
// The vendored bytes were statically reviewed (no network callback / file
// write / dynamic exec) and re-export regression matched the fp32 graph
// hashes byte-for-byte.
//
// CRLF discipline: vendor/.gitattributes pins `*.py text eol=lf`, but a
// working copy checked out BEFORE that attribute existed (or touched by an
// editor) may still hold CRLF bytes. A hash mismatch caused ONLY by line
// endings gets a targeted, actionable error (not a generic mismatch).
//
// Usage:
//   node scripts/verify-tinyclick-vendor.js [--strict]
//     --strict   Exit 1 on any mismatch/missing (default: warn only)
//
// Exit codes:
//   0  All files match expected hashes
//   1  Mismatch / missing (strict mode)
//   2  Config error (manifest unreadable / registry fields absent)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const EXIT_OK = 0;
const EXIT_MISMATCH = 1;
const EXIT_CONFIG_ERROR = 2;

// vendor/LICENSE is the microsoft/Florence-2-base MIT text @5ca5edf5 (same
// vendored snapshot). Not part of exportVendor in models.manifest.json
// (schema covers the three code files); pinned here as a constant.
const LICENSE_SHA256 = "9906940f61b1f0b533fa7d99baf55178b2808fbe113ea51dfbfad8572ccd5f2b";

const VENDOR_FILES = [
  ["configuration", "configuration_florence2.py"],
  ["modeling", "modeling_florence2.py"],
  ["processing", "processing_florence2.py"],
];

function error(msg) {
  console.error(`[verify-tinyclick-vendor] ERROR: ${msg}`);
}
function warn(msg) {
  console.warn(`[verify-tinyclick-vendor] WARN:  ${msg}`);
}
function info(msg) {
  console.log(`[verify-tinyclick-vendor] INFO:  ${msg}`);
}
function ok(msg) {
  console.log(`[verify-tinyclick-vendor] OK:    ${msg}`);
}

function sha256buf(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function main() {
  const strict = process.argv.includes("--strict");
  const scriptDir = __dirname;
  const projectRoot = path.resolve(scriptDir, "..");
  const manifestPath = path.join(projectRoot, "companion", "models.manifest.json");
  const vendorDir = path.join(projectRoot, "scripts", "spike", "s1-tinyclick-onnx", "vendor");

  // Single registry: companion/models.manifest.json
  if (!fs.existsSync(manifestPath)) {
    error(`models.manifest.json not found: ${manifestPath}`);
    process.exit(EXIT_CONFIG_ERROR);
  }
  let registry;
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    registry = manifest.models.tinyclick.provenance.exportVendor;
    for (const [key] of VENDOR_FILES) {
      if (typeof registry[key] !== "string" || !/^[0-9a-f]{64}$/.test(registry[key])) {
        throw new Error(`exportVendor.${key} missing or not 64-hex`);
      }
    }
  } catch (e) {
    error(`Failed to read exportVendor registry from models.manifest.json: ${e.message}`);
    process.exit(EXIT_CONFIG_ERROR);
  }

  const rev = JSON.parse(fs.readFileSync(manifestPath, "utf-8")).models.tinyclick.revision;
  info(`Verifying vendored Florence-2 files (upstream microsoft/Florence-2-base@5ca5edf5; TinyClick rev ${rev})`);

  let failCount = 0;
  const checks = [
    ...VENDOR_FILES.map(([key, name]) => ({ name, expected: registry[key] })),
    { name: "LICENSE", expected: LICENSE_SHA256 },
  ];

  for (const { name, expected } of checks) {
    const filePath = path.join(vendorDir, name);
    if (!fs.existsSync(filePath)) {
      failCount++;
      error(`MISSING: ${name} — vendored files live in the repo and must exist (${filePath})`);
      continue;
    }
    const buf = fs.readFileSync(filePath);
    const actual = sha256buf(buf);
    if (actual === expected) {
      ok(`${name} → ${actual}`);
      continue;
    }
    // Targeted CRLF diagnosis: line-ending-only drift is an autocrlf working-copy
    // artifact, not a content attack — say so explicitly with the fix.
    const lfHash = sha256buf(Buffer.from(buf.toString("utf-8").replace(/\r\n/g, "\n"), "utf-8"));
    if (lfHash === expected) {
      failCount++;
      error(`LINE-ENDING DRIFT: ${name} — content matches only after CRLF→LF normalization.`);
      error("  The working copy was checked out with core.autocrlf=true before vendor/.gitattributes");
      error("  pinned eol=lf (or an editor rewrote endings). Fix with:");
      error(`    rm "scripts/spike/s1-tinyclick-onnx/vendor/${name}" && git checkout -- "scripts/spike/s1-tinyclick-onnx/vendor/${name}"`);
      error("  (no git — e.g. zip distribution? re-download the repo zip: eol=lf is applied");
      error("   at archive time, so the zip already contains LF bytes.)");
    } else {
      failCount++;
      error(`HASH MISMATCH: ${name}`);
      error(`  Expected: ${expected}`);
      error(`  Actual:   ${actual}`);
      error("  Content drifted from the reviewed bytes — possible upstream re-vendor without");
      error("  registry update, or tampering. Re-review the file, then update exportVendor in");
      error("  companion/models.manifest.json via PR (hash re-registration must go through review).");
    }
  }

  console.log("");
  if (failCount > 0) {
    error(`Verification FAILED: ${failCount} of ${checks.length} file(s) mismatched/missing.`);
    process.exit(strict ? EXIT_MISMATCH : EXIT_OK);
  }
  ok(`All ${checks.length} vendored file(s) verified successfully.`);
  process.exit(EXIT_OK);
}

main().catch((e) => {
  error(`Unexpected error: ${e.message}`);
  process.exit(EXIT_CONFIG_ERROR);
});
