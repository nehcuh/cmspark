'use strict';
// Test-only lifecycle coordinator. Native adapter alone obtains HWND/UIA facts;
// injected CPU adapters are explicitly not Windows evidence.
exports.controlPicker726 = function controlPicker726({ child, native, mode, signal }) {
  if (!child || !Number.isInteger(child.pid) || child.pid <= 0 || !['ok', 'cancel'].includes(mode)) throw Error('PICKER726_OWNER_REFUSED');
  let closed = false, disposed = false, unsubscribe, active = true, busy = false, queued = false;
  let settled = false, invoking = false, resolve, reject;
  const done = new Promise((yes, no) => { resolve = yes; reject = no });
  // Observe before any async registration. terminate dispatch is never close.
  child.once('close', onClose);
  signal.addEventListener('abort', onAbort, { once: true });
  function fail(code) { if (!settled) { settled = true; reject(Error(code)) } }
  function onClose() { closed = true; active = false; if (!settled && !invoking) fail('PICKER726_CHILD_EARLY_CLOSE') }
  function onAbort() { active = false; fail('PICKER726_ABORTED') }
  function current() { return active && !signal.aborted && !closed && child.exitCode === null && child.signalCode === null }
  async function check() {
    if (!current()) { onAbort(); return }
    if (busy) { queued = true; return }
    busy = true;
    try {
      const observed = await native.snapshot();
      if (!current()) { onAbort(); return }
      if (observed === null) return; // no owned modal yet; only a new real event can reobserve
      if (!observed || observed.owner !== child || observed.pid !== child.pid ||
          observed.unique !== true || observed.visible !== true || observed.current !== true) throw Error('PICKER726_NATIVE_UNKNOWN');
      // Native adapter revalidates its captured exact HWND, owner at
      // action time. No model/caller ready bit can authorize an action.
      invoking = true;
      const receipt = await native.invoke(observed, mode);
      // The exact native receipt may race the picker exit/stdio-close delivery.
      // Ownership was rechecked by invoke; cleanup still waits actual close.
      if (signal.aborted || disposed) { onAbort(); return }
      if (receipt !== observed) throw Error('PICKER726_ACTION_REFUSED');
      active = false; settled = true; resolve({ ownedModalAction: true, action: mode });
    } catch { active = false; fail('PICKER726_NATIVE_UNKNOWN') }
    finally { busy = false; if (queued && active) { queued = false; queueMicrotask(check) } }
  }
  const ready = (async () => {
    if (!current()) { onAbort(); return }
    unsubscribe = await native.subscribe(child, check);
    if (!current()) { onAbort(); return }
    // Subscribe first, then one exact-owner snapshot closes opened-before-subscribe.
    await check();
  })().catch(() => { active = false; fail('PICKER726_REGISTER_REFUSED') });
  return { done, ready,
    async dispose() {
      if (disposed) return;
      disposed = true; active = false;
      await ready;
      await native.stop(); // must stop any in-flight snapshot/invoke before returning
      if (typeof unsubscribe === 'function') unsubscribe();
      signal.removeEventListener('abort', onAbort);
      if (!closed) throw Error('PICKER726_CHILD_CLOSE_UNKNOWN');
      child.removeListener('close', onClose);
    },
  };
};
