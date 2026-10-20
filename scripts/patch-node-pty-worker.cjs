#!/usr/bin/env node
"use strict";
// #725: MIT-licensed @lydell/node-pty beta.15 compatibility correction, source-only.
// Provenance: exact npm lock integrity; both Windows architecture source texts verified.
// Natural exit retires the retained output Worker, never an exited numeric process ID.
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const CERT = {
  "version": "1.2.0-beta.15",
  "wrapper": {
    "resolved": "https://registry.npmjs.org/@lydell/node-pty/-/node-pty-1.2.0-beta.15.tgz",
    "integrity": "sha512-Br8wBxzbxFwdWgk9uQ+rdzE0xfoxOK4QuGH54swhRwc5IxP6H9Y1/bcyazRGvNUs6XkB5qNVkezuKSRxUwZe7A==",
    "packageSHA256": "c5bed9a4877885f271b49ca3b4ae014004e2d1aca3631a01da7a8bb2a6912acc"
  },
  "architectures": {
    "x64": {
      "resolved": "https://registry.npmjs.org/@lydell/node-pty-win32-x64/-/node-pty-win32-x64-1.2.0-beta.15.tgz",
      "integrity": "sha512-2f8twEmDVxZ7drchAXjtevpmSPhFok0avAnzXro4t5gmz0xsPNKkoZvymwtuIS3xo7PzQqZOPQ/YzwEMb7oIzQ==",
      "packageSHA256": "45d385c850259029c52ac5675b317e987f6556296f8e83758e89551935b27013",
      "beforeSHA256": "4f503c377b11cbd113e1f32b3932fdc35e8132b0e647f4c6b70dc84224127c53",
      "afterSHA256": "dc4c76d33bcb3e1b894594a672f34e04e08fdacabcf9df3bd980d22c56212df4"
    },
    "arm64": {
      "resolved": "https://registry.npmjs.org/@lydell/node-pty-win32-arm64/-/node-pty-win32-arm64-1.2.0-beta.15.tgz",
      "integrity": "sha512-pyAk91w7wnnKrD4mrHXtIXRfmzSWV5bEzvRhurXcMCtCc2TJ424ciUskIgWMhAPP6y3KyUnqElj+U6kY3iOt0A==",
      "packageSHA256": "e93d1d24224b183601a011512c6403d2be54ab818f3722e8ffacc95adb0f5bd5",
      "beforeSHA256": "4f503c377b11cbd113e1f32b3932fdc35e8132b0e647f4c6b70dc84224127c53",
      "afterSHA256": "dc4c76d33bcb3e1b894594a672f34e04e08fdacabcf9df3bd980d22c56212df4"
    }
  }
};
const ANCHOR = "        this._outSocket.destroy();\n    };\n    return WindowsPtyAgent;";
const REPLACEMENT = "        this._outSocket.destroy();\n        this._conoutSocketWorker.dispose();\n    };\n    return WindowsPtyAgent;";
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
function refuse(code) { throw new Error("PTY725_" + code); }
function transformWindowsPtyAgent(bytes, arch) {
  const expected = CERT.architectures[arch];
  if (!expected) refuse("ARCH");
  const hash = digest(bytes);
  if (hash === expected.afterSHA256) return bytes;
  if (hash !== expected.beforeSHA256) refuse("SOURCE");
  const text = bytes.toString("utf8");
  if (text.split(ANCHOR).length !== 2) refuse("ANCHOR");
  const out = Buffer.from(text.replace(ANCHOR, REPLACEMENT));
  if (digest(out) !== expected.afterSHA256) refuse("AFTER_SOURCE");
  return out;
}
function same(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.nlink === b.nlink &&
    a.uid === b.uid && a.gid === b.gid && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
/** Fixed package tree only. io is an inert owned-FS test seam, never a wire/tool input. */
function patchNodePtyWorker({ companionDir = path.resolve(__dirname, "../companion"), platform = process.platform, arch = process.arch, required = false, io = fs } = {}) {
  if (platform !== "win32") return { status: "not-windows", patched: 0 };
  if (!Object.hasOwn(CERT.architectures, arch)) { if (required) refuse("ARCH"); return { status: "not-supported", patched: 0 }; }
  const dirs = [];
  const directory = name => {
    const stat = io.lstatSync(name, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || io.realpathSync(name) !== path.resolve(name)) refuse("DIRECTORY");
    dirs.push({ name, stat }); return name;
  };
  const verifyDirs = () => {
    for (const { name, stat } of dirs) {
      const now = io.lstatSync(name, { bigint: true });
      if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== stat.dev || now.ino !== stat.ino || now.mode !== stat.mode || now.uid !== stat.uid || now.gid !== stat.gid || io.realpathSync(name) !== path.resolve(name)) refuse("DIRECTORY_CHANGED");
    }
  };
  const read = (name, maxBytes = 131072n) => {
    const named = io.lstatSync(name, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n || named.size > maxBytes) refuse("FILE");
    let fd;
    try {
      fd = io.openSync(name, io.constants.O_RDONLY | (io.constants.O_NOFOLLOW || 0));
      const held = io.fstatSync(fd, { bigint: true });
      if (!held.isFile() || !same(named, held)) refuse("FILE_CHANGED");
      const bytes = io.readFileSync(fd);
      if (BigInt(bytes.length) !== named.size || !same(held, io.fstatSync(fd, { bigint: true })) || !same(named, io.lstatSync(name, { bigint: true }))) refuse("FILE_CHANGED");
      return { bytes, stat: named, maxBytes };
    } finally {
      if (fd !== undefined) { const owned = fd; fd = undefined; io.closeSync(owned); }
    }
  };
  const root = directory(path.resolve(companionDir));
  const lockFile = path.join(root, "package-lock.json"), locked = read(lockFile, 262144n);
  const lock = JSON.parse(locked.bytes.toString("utf8")), anchors = [{ name: lockFile, ...locked }];
  const verifyAnchors = () => { for (const old of anchors) { const now = read(old.name, old.maxBytes); if (!same(now.stat, old.stat) || !now.bytes.equals(old.bytes)) refuse("PACKAGE_CHANGED"); } };
  const absent = () => { verifyDirs(); if (required) refuse("NOT_INSTALLED"); return { status: "not-installed", patched: 0 }; };
  const present = name => { try { io.lstatSync(name, { bigint: true }); return true; } catch (error) { if (error?.code === "ENOENT") return false; throw error; } };
  const nm = path.join(root, "node_modules"), scope = path.join(nm, "@lydell"), wrapper = path.join(scope, "node-pty");
  if (!present(nm)) return absent(); directory(nm);
  if (!present(scope)) return absent(); directory(scope);
  if (!present(wrapper)) {
    if (["x64", "arm64"].some(target => present(path.join(scope, "node-pty-win32-" + target)))) refuse("PACKAGE");
    return absent();
  }
  directory(wrapper);
  const metadata = (folder, name, expected) => {
    const nameFile = path.join(folder, "package.json"), captured = read(nameFile), raw = captured.bytes;
    anchors.push({ name: nameFile, ...captured });
    const pkg = JSON.parse(raw.toString("utf8")), row = lock.packages?.["node_modules/" + name];
    if (pkg.name !== name || pkg.version !== CERT.version || digest(raw) !== expected.packageSHA256 ||
      !row || row.version !== CERT.version || row.integrity !== expected.integrity || row.resolved !== expected.resolved) refuse("PACKAGE");
    return pkg;
  };
  const pkg = metadata(wrapper, "@lydell/node-pty", CERT.wrapper);
  const plans = [];
  for (const target of ["x64", "arm64"]) {
    const name = "node-pty-win32-" + target, folder = path.join(scope, name);
    let found;
    try { found = io.lstatSync(folder, { bigint: true }); } catch (error) { if (error?.code !== "ENOENT") throw error; continue; }
    if (!found.isDirectory() || found.isSymbolicLink()) refuse("DIRECTORY");
    directory(folder); metadata(folder, "@lydell/" + name, CERT.architectures[target]);
    if (pkg.optionalDependencies?.["@lydell/" + name] !== CERT.version) refuse("PACKAGE");
    directory(path.join(folder, "lib"));
    const file = path.join(folder, "lib/windowsPtyAgent.js"), original = read(file);
    plans.push({ target, file, original, after: transformWindowsPtyAgent(original.bytes, target) });
  }
  if (!plans.some(plan => plan.target === arch)) return absent();
  let patched = 0;
  for (const { file, original, after } of plans) {
    verifyDirs(); verifyAnchors();
    const current = read(file);
    if (!same(current.stat, original.stat) || !current.bytes.equals(original.bytes)) refuse("FILE_CHANGED");
    if (after.equals(original.bytes)) continue;
    const pending = path.join(path.dirname(file), ".cmspark-725-" + crypto.randomUUID() + ".pending");
    let fd, created;
    try {
      fd = io.openSync(pending, io.constants.O_WRONLY | io.constants.O_CREAT | io.constants.O_EXCL | (io.constants.O_NOFOLLOW || 0), Number(original.stat.mode & 0o777n));
      io.fchmodSync(fd, Number(original.stat.mode & 0o777n));
      created = io.fstatSync(fd, { bigint: true });
      if (!created.isFile() || created.nlink !== 1n) refuse("PENDING");
      if (io.writeSync(fd, after, 0, after.length) !== after.length) refuse("INCOMPLETE_WRITE");
      io.fsyncSync(fd);
      const owned = fd; fd = undefined; io.closeSync(owned);
      const ready = read(pending);
      if (ready.stat.dev !== created.dev || ready.stat.ino !== created.ino || !ready.bytes.equals(after) || ready.stat.mode !== original.stat.mode) refuse("PENDING_CHANGED");
      verifyDirs(); verifyAnchors(); const last = read(file);
      if (!same(last.stat, original.stat) || !last.bytes.equals(original.bytes)) refuse("FILE_CHANGED");
      io.renameSync(pending, file);
      const final = read(file);
      if (final.stat.dev !== created.dev || final.stat.ino !== created.ino || !final.bytes.equals(after) || final.stat.mode !== original.stat.mode) refuse("PUBLISHED_CHANGED");
      verifyDirs(); verifyAnchors(); patched++;
    } finally {
      if (fd !== undefined) { const owned = fd; fd = undefined; io.closeSync(owned); }
      if (created) {
        try {
          const left = io.lstatSync(pending, { bigint: true });
          if (left.isFile() && !left.isSymbolicLink() && left.dev === created.dev && left.ino === created.ino) io.unlinkSync(pending);
        } catch (error) { if (error?.code !== "ENOENT") throw error; }
      }
    }
  }
  return { status: patched ? "patched" : "already-patched", patched };
}
module.exports = { patchNodePtyWorker, transformWindowsPtyAgent, CERT };
if (require.main === module) {
  try {
    if (process.argv.slice(2).some(value => value !== "--windows-package")) refuse("ARGUMENT");
    if (process.argv.includes("--windows-package") && process.platform !== "win32") refuse("WINDOWS_PACKAGE_HOST");
    const result = patchNodePtyWorker({ required: process.argv.includes("--windows-package") });
    console.log("PTY725_" + result.status.toUpperCase().replaceAll("-", "_") + " " + result.patched);
  } catch { console.error("PTY725_PATCH_REFUSED"); process.exitCode = 1; }
}
