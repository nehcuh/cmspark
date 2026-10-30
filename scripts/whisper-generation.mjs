// Verify one locally built generation and stage its bytes. This checks
// consistency, not provenance, runtime attestation, or crash durability.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inside = (parent, child) => child.startsWith(parent + path.sep);
const fail = message => { throw new Error(`WHISPER_GENERATION_${message}`); };
const allowed = name => /^lib(?:whisper|ggml)[^/]*\.dylib$/.test(name)
  || /^libomp(?:\.[0-9]+(?:\.[0-9]+)*)?\.dylib$/.test(name);

function storePath(store) {
  const entry = fs.lstatSync(store);
  if (entry.isSymbolicLink() || !entry.isDirectory()) fail('STORE');
  return fs.realpathSync(store);
}

function binaryName(arch) {
  if (!['darwin-arm64', 'darwin-x64'].includes(arch)) fail('ARCH');
  return `cmspark-whisper-${arch}`;
}

function snapshot(root, arch) {
  const base = fs.realpathSync(root);
  const bin = fs.realpathSync(path.join(base, 'bin'));
  const lib = fs.realpathSync(path.join(base, 'lib'));
  if (!inside(base, bin) || !inside(base, lib)) fail('DIRECTORY_ESCAPE');
  const binary = path.join(bin, binaryName(arch));
  if (fs.lstatSync(binary).isSymbolicLink() || !fs.statSync(binary).isFile()) fail('BINARY');
  const names = fs.readdirSync(lib).sort();
  if (!names.length || names.length > 256 || names.some(name => !allowed(name))) fail('LIBRARY_NAMES');
  if (!names.some(name => name.startsWith('libwhisper')) || !names.some(name => name.startsWith('libggml'))) fail('INCOMPLETE');
  const data = new Map();
  let total = 0;
  const read = (name, file) => {
    const st = fs.statSync(file);
    total += st.size;
    if (!st.isFile() || st.size > 256 * 1024 * 1024 || total > 512 * 1024 * 1024) fail('FILE');
    const bytes = fs.readFileSync(file);
    if (bytes.length !== st.size) fail('FILE_CHANGED');
    data.set(name, bytes);
    return digest(bytes);
  };
  const primary = read(`bin/${binaryName(arch)}`, binary);
  const files = {};
  for (const name of names) {
    const real = fs.realpathSync(path.join(lib, name));
    if (!inside(lib, real)) fail('LIBRARY_ESCAPE');
    files[name] = read(`lib/${name}`, real);
  }
  return { manifest: { v: 1, arch, primary, files }, data };
}

export function seal(root, arch) {
  const { manifest } = snapshot(root, arch);
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest) + '\n', { flag: 'wx', mode: 0o600 });
}

function readSealed(generation, arch) {
  const manifestPath = path.join(generation, 'manifest.json');
  const entry = fs.lstatSync(manifestPath);
  if (entry.isSymbolicLink()) fail('MANIFEST_LINK');
  if (!entry.isFile() || entry.size > 65536) fail('MANIFEST_SIZE');
  const text = fs.readFileSync(manifestPath, 'utf8');
  if (Buffer.byteLength(text) > 65536) fail('MANIFEST_SIZE');
  const manifest = JSON.parse(text);
  const result = snapshot(generation, arch);
  if (JSON.stringify(manifest) !== JSON.stringify(result.manifest)) fail('MANIFEST_MISMATCH');
  return result;
}

export function publish(root, store, current, arch) {
  const parent = storePath(store);
  const generation = fs.realpathSync(root);
  if (path.dirname(generation) !== parent) fail('GENERATION_ESCAPE');
  readSealed(generation, arch);
  let previous;
  try { previous = fs.lstatSync(current); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous) {
    if (!previous.isSymbolicLink()) fail('CURRENT_NOT_LINK');
    let prior;
    try { prior = fs.realpathSync(current); } catch (error) {
      if (error.code === 'ENOENT') fail('CURRENT_DANGLING');
      throw error;
    }
    if (path.dirname(prior) !== parent) fail('CURRENT_ESCAPE');
    readSealed(prior, arch);
  }
  const currentDir = fs.realpathSync(path.dirname(current));
  const pending = current + '.' + crypto.randomBytes(16).toString('hex');
  try {
    fs.symlinkSync(path.relative(currentDir, generation), pending);
    fs.renameSync(pending, current);
  } catch (error) {
    try { fs.unlinkSync(pending); } catch { /* It may not exist. */ }
    throw error;
  }
}

export function stage(store, current, arch, stageRoot, expected) {
  if (!/^[0-9a-f]{64}$/.test(expected)) fail('PIN');
  const parent = storePath(store);
  if (!fs.lstatSync(current).isSymbolicLink()) fail('CURRENT_NOT_LINK');
  const generation = fs.realpathSync(current);
  if (path.dirname(generation) !== parent) fail('GENERATION_ESCAPE');
  const result = readSealed(generation, arch);
  if (result.manifest.primary !== expected) fail('PIN_MISMATCH');
  const dest = fs.realpathSync(stageRoot);
  const bin = fs.realpathSync(path.join(dest, 'bin'));
  const lib = fs.realpathSync(path.join(dest, 'lib'));
  if (!inside(dest, bin) || !inside(dest, lib)) fail('STAGE_ESCAPE');
  // The staging directory belongs to the caller; do not overwrite its files.
  for (const [name, bytes] of result.data) {
    fs.writeFileSync(path.join(dest, name), bytes, { flag: 'wx', mode: name.startsWith('bin/') ? 0o755 : 0o644 });
  }
  if (JSON.stringify(snapshot(dest, arch).manifest) !== JSON.stringify(result.manifest)) fail('STAGED_MISMATCH');
  return result.manifest;
}

export function verifyStaged(store, current, arch, stageRoot, expected) {
  if (!/^[0-9a-f]{64}$/.test(expected)) fail('PIN');
  const parent = storePath(store);
  if (!fs.lstatSync(current).isSymbolicLink()) fail('CURRENT_NOT_LINK');
  const generation = fs.realpathSync(current);
  if (path.dirname(generation) !== parent) fail('GENERATION_ESCAPE');
  const result = readSealed(generation, arch);
  if (result.manifest.primary !== expected) fail('PIN_MISMATCH');
  if (JSON.stringify(snapshot(stageRoot, arch).manifest) !== JSON.stringify(result.manifest)) fail('STAGED_MISMATCH');
}

let isMain = false;
try { isMain = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url)); } catch { /* Imported from stdin or an unavailable path. */ }
if (isMain) {
  const [mode, ...args] = process.argv.slice(2);
  try {
    if (mode === 'seal' && args.length === 2) seal(...args);
    else if (mode === 'publish' && args.length === 4) publish(...args);
    else if (mode === 'stage' && args.length === 5) stage(...args);
    else if (mode === 'verify' && args.length === 5) verifyStaged(...args);
    else fail('ARGUMENTS');
  } catch (error) {
    console.error(error instanceof Error && /^WHISPER_GENERATION_[A-Z_]+$/.test(error.message) ? error.message : 'WHISPER_GENERATION_FAILED');
    process.exitCode = 1;
  }
}
