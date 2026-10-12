// Each invocation has a cold module cache and isolated data. Only the owner
// query boundary is delayed; native mode still runs PowerShell and the Job.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const { EventEmitter } = require('node:events'), { PassThrough, Writable } = require('node:stream');
const assert = require('node:assert/strict');
const [base, mode, root] = process.argv.slice(2);
const native = process.platform === 'win32';
process.env.CMSPARK_DATA_DIR = path.join(root, 'data');
process.env.HOME = process.env.USERPROFILE = root;
process.env.CMSPARK_SKIP_LOGIN_ENV = '1';
process.env.DEEPSEEK_API_KEY = process.env.OPENAI_API_KEY = '';
const realExec = cp.execFile, realSync = cp.execFileSync, realSpawn = cp.spawn;
let queries = 0, targets = 0, firstQuery = 0, heartbeat = 0, stopped;
const queryChildren = [];
const interval = setInterval(() => { if (firstQuery && !heartbeat) heartbeat = performance.now() - firstQuery }, 10);
const slow = !['native-positive', 'native-mismatch', 'owner-failure'].includes(mode);
function queryStarted() {
  queries++;
  if (!firstQuery) {
    firstQuery = performance.now();
    if (stopped) setTimeout(stopped, 30);
  }
}
function proxyQuery(file, args, options, callback) {
  queryStarted();
  let command = args.at(-1);
  if (slow) command = '[Threading.Thread]::Sleep(450); ' + command;
  if (mode === 'owner-failure') command = "throw 'owned query failure'";
  const query = native
    ? realExec(file, [...args.slice(0, -1), command], options, finish)
    : realExec(process.execPath, ['-e', mode === 'owner-failure' ? 'process.exit(2)' : `setTimeout(()=>console.log('134046125350000001'),${slow ? 450 : 0})`], options, finish);
  const entry = { pid: query.pid, closed: false }; queryChildren.push(entry);
  query.once('close', () => { entry.closed = true });
  function finish(error, stdout, stderr) {
    if (!error && mode === 'native-mismatch') stdout = String(BigInt(stdout.trim()) + 1n) + '\n';
    callback(error, stdout, stderr);
  }
  return query;
}
cp.execFile = proxyQuery;
// Baseline replay: intercept the old sync query with the same native delay.
cp.execFileSync = (file, args, options) => {
  if (!args.includes('-Command')) return realSync(file, args, options);
  queryStarted();
  return native ? realSync(file, [...args.slice(0, -1), '[Threading.Thread]::Sleep(450); ' + args.at(-1)], options)
    : realSync(process.execPath, ['-e', "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,450);console.log('134046125350000001')"], options);
};
cp.spawn = (file, args, options) => {
  if (!args.includes('-EncodedCommand')) return realSpawn(file, args, options);
  targets++;
  if (native && mode.startsWith('native-')) return realSpawn(file, args, options);
  const child = new EventEmitter();
  Object.assign(child, { pid: 98765, exitCode: null, signalCode: null, stdout: new PassThrough(), stderr: new PassThrough(), unref() {} });
  child.kill = () => { if (child.exitCode !== null) return true; child.exitCode = 1; queueMicrotask(() => { child.emit('exit', 1); child.emit('close', 1) }); return true };
  let input = '';
  child.stdin = new Writable({ write(chunk, _encoding, done) {
    input += chunk;
    for (let split; (split = input.indexOf('\n')) >= 0;) {
      const m = JSON.parse(input.slice(0, split)); input = input.slice(split + 1);
      if (m.id === undefined) continue;
      const result = m.method === 'initialize' ? { protocolVersion: m.params.protocolVersion, capabilities: {}, serverInfo: { name: 'owned', version: '1' } } : {};
      queueMicrotask(() => child.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result }) + '\n'));
    }
    done();
  } });
  queueMicrotask(() => child.emit('spawn'));
  return child;
};
// POSIX hosts replay the Windows branching without claiming a native Job.
if (!native) {
  Object.defineProperty(process, 'platform', { value: 'win32' });
  // This seam isolates the ownership/deadline contract from POSIX executables
  // failing Windows PATHEXT resolution; native tests retain the real parser.
  require('cross-spawn')._parse = (command, args, options) => ({ command, args, options, file: command });
}
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  let extra = {};
  const command = process.execPath;
  const config = { transport: 'stdio', command, args: [], enabled: true, trust_level: 'manual', startup_timeout_ms: 80 };
  if (mode === 'mcp-timeout') {
    const { McpClient } = require(path.join(base, 'mcp/client.js'));
    const client = new McpClient('owned', config), before = performance.now();
    try { await assert.rejects(client.connect(), /startup > 80ms/); }
    finally { await client.close(); }
    extra.elapsed = performance.now() - before;
    assert.equal(targets, 0); assert.ok(heartbeat < 200, String(heartbeat));
    assert.ok(extra.elapsed < 400, String(extra.elapsed));
  } else if (mode === 'mcp-close') {
    const { OwnedStdioTransport } = require(path.join(base, 'mcp/stdio-transport.js'));
    const transport = new OwnedStdioTransport({ command, args: [] });
    let closing; stopped = () => { closing = transport.close() };
    await assert.rejects(transport.start(), /cancelled|closed/); await closing;
    assert.equal(targets, 0);
  } else if (mode === 'mcp-config-disable') {
    const { McpManager } = require(path.join(base, 'mcp/manager.js'));
    const manager = new McpManager(); let changed;
    stopped = () => { changed = manager.applyConfig({ enabled: true, servers: { owned: { ...config, enabled: false } } }) };
    try { await manager.start({ enabled: true, servers: { owned: { ...config, startup_timeout_ms: 2000 } } }); await changed; assert.equal(targets, 0); }
    finally { await manager.shutdown(); }
  } else if (mode.startsWith('acp-') || mode === 'owner-failure') {
    const cfg = require(path.join(base, 'config.js')); await cfg.initDataDir();
    cfg.saveConfig({ acp: { enabled: true, policy: { require_workspace: true, default_profile: 'review_readonly' }, servers: { owned: { display_name: 'Owned', transport: 'stdio', enabled: true, command, args: [], protocol: 'auto', policy: { profile: 'review_readonly', session_timeout_ms: mode === 'acp-timeout' ? 80 : 2000 } } } }, coding_handoff: { open_local_terminal: false } });
    const { AcpManager } = require(path.join(base, 'acp/manager.js'));
    const manager = new AcpManager(); let closing;
    const offered = manager.propose({ threadId: 'owner', agentId: 'owned', goal: 'owned query fixture', workspaceRoot: root }); assert.ok(offered.ok);
    if (mode === 'acp-cancel') stopped = () => manager.cancel(offered.session.session_id);
    if (mode === 'acp-shutdown') stopped = () => { closing = manager.shutdown() };
    const result = await manager.start(offered.session.session_id);
    if (closing) await closing;
    assert.equal(result.ok, false); assert.equal(targets, 0); assert.equal(queries, 1);
    if (mode === 'acp-cancel' || mode === 'acp-shutdown') assert.equal(offered.session.terminal_kind, 'cancelled');
    const next = manager.propose({ threadId: 'replacement', agentId: 'owned', goal: 'after cleanup', workspaceRoot: root });
    if (mode !== 'acp-shutdown' && mode !== 'owner-failure') assert.ok(next.ok);
    await manager.shutdown();
  } else if (mode.startsWith('native-')) {
    const { prepareWindowsJob, spawnWindowsJob } = require(path.join(base, 'process/windows-job.js'));
    const before = performance.now(); await prepareWindowsJob(); extra.ownerMs = performance.now() - before;
    const marker = path.join(root, 'target');
    const child = spawnWindowsJob(command, ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'owned');process.stdout.write('NATIVE_OK')`], { stdio: 'pipe' });
    let output = '', error = ''; child.stdout.on('data', b => { output += b }); child.stderr.on('data', b => { error += b });
    const code = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject) });
    if (mode === 'native-positive') { assert.equal(code, 0, error); assert.equal(output, 'NATIVE_OK'); assert.ok(fs.existsSync(marker)); }
    else { assert.equal(code, 1); assert.match(error, /owner has exited or changed/); assert.equal(fs.existsSync(marker), false); }
  } else { throw Error('unknown mode'); }
  await pause(500);
  assert.ok(queryChildren.every(q => q.closed), JSON.stringify(queryChildren));
  clearInterval(interval);
  console.log('OWNER_PROBE=' + JSON.stringify({ mode, native, queries, targets, heartbeat, queryChildren, ...extra }));
})().catch(e => { clearInterval(interval); console.error(e); process.exitCode = 1 });
