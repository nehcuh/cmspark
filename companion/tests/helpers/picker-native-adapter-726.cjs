'use strict';
const cp = require('node:child_process');
// Internal test process pipe only. Never a product endpoint or diagnostic body.
exports.nativePickerAdapter726 = function ({ child, script, powershell, signal, registerChild }) {
  let controller, onChange, readyResolve, readyReject, sequence = 0, tail = '', stopped = false;
  const pending = new Map();
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject });
  ready.catch(() => {});
  let closeResolve; const closed = new Promise(resolve => { closeResolve = resolve });
  function fail() { readyReject(Error('PICKER726_CONTROLLER_UNKNOWN')); for (const row of pending.values()) row.reject(Error('PICKER726_CONTROLLER_UNKNOWN')); pending.clear() }
  function abort() { fail(); if (controller && controller.exitCode === null && controller.signalCode === null) controller.kill() }
  function request(op, data = {}) {
    if (stopped || signal.aborted || !controller || controller.exitCode !== null || controller.signalCode !== null) return Promise.reject(Error('PICKER726_CONTROLLER_CLOSED'));
    const id = ++sequence;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      controller.stdin.write(JSON.stringify({ id, op, ...data }) + '\n', error => { if (error) { pending.delete(id); reject(Error('PICKER726_CONTROLLER_WRITE')) } });
    });
  }
  return {
    async subscribe(owner, listener) {
      if (owner !== child || controller || signal.aborted || child.exitCode !== null || child.signalCode !== null) throw Error('PICKER726_OWNER_REFUSED');
      onChange = listener;
      controller = cp.spawn(powershell, ['-NoProfile', '-STA', '-File', script, '-OwnerPid', String(child.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
      registerChild(controller); // sync registration before the first await, including errors
      controller.once('error', fail);
      controller.once('close', () => { fail(); closeResolve() });
      controller.stdout.on('data', bytes => {
        tail += bytes.toString('utf8'); if (Buffer.byteLength(tail) > 8192) { abort(); return }
        for (;;) { const end = tail.indexOf('\n'); if (end < 0) break; const line = tail.slice(0, end); tail = tail.slice(end + 1);
          try { const row = JSON.parse(line);
            if (row.event === 'ready') readyResolve();
            else if (row.event === 'opened') onChange?.();
            else if (row.event === 'failed') fail();
            else { const p = pending.get(row.id); if (!p || !['WAIT', 'UNKNOWN_UIA', 'EXACT', 'INVOKED', 'REFUSED', 'STOPPED'].includes(row.result)) { fail(); continue } pending.delete(row.id); p.resolve(row.result) }
          } catch { fail() }
        }
      });
      signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort();
      await ready;
      return () => { onChange = undefined };
    },
    async snapshot() {
      const result = await request('snapshot');
      if (result === 'WAIT') return null;
      if (result !== 'EXACT') throw Error('PICKER726_NATIVE_UNKNOWN');
      return { owner: child, pid: child.pid, unique: true, visible: true, current: true };
    },
    async invoke(observed, mode) { if (observed.owner !== child) throw Error('PICKER726_OWNER_REFUSED'); return await request('invoke', { mode }) === 'INVOKED' ? observed : null },
    async stop() {
      if (stopped) return; stopped = true;
      if (controller && controller.exitCode === null && controller.signalCode === null) { // request while still open, then actual close
        stopped = false;
        try { if (!signal.aborted) await request('stop') } finally { stopped = true; if (controller.exitCode === null && controller.signalCode === null) controller.kill() }
      }
      if (controller) await closed;
      signal.removeEventListener('abort', abort);
    },
  };
};
