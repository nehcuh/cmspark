'use strict'
// Remote-fixture only. Never inherit provider keys, proxy, HOME or Node hooks.
const path = require('node:path').win32
module.exports = function cockpitBridgeChildEnv(parent, { root, data, temp, compiled }) {
  const absolute = value => typeof value === 'string' && !value.includes('\0') && path.isAbsolute(value)
  const inside = value => {
    if (!absolute(value)) return false
    const relative = path.relative(root, value)
    return !!relative && relative !== '..' && !relative.startsWith('..\\') && !path.isAbsolute(relative)
  }
  if (parent.GITHUB_ACTIONS !== 'true' || parent.RUNNER_OS !== 'Windows' || !absolute(parent.SystemRoot) ||
      !absolute(root) || !inside(data) || !inside(temp) || !absolute(compiled)) throw Error('COCKPIT_BRIDGE_CHILD_ENV_REFUSED')
  const env = { SystemRoot: parent.SystemRoot, WINDIR: parent.SystemRoot,
    ComSpec: path.join(parent.SystemRoot, 'System32', 'cmd.exe'),
    PATH: path.join(parent.SystemRoot, 'System32'), TEMP: temp, TMP: temp,
    GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', CMSPARK_TEST_RUN_DIR: root,
    CMSPARK_DATA_DIR: data, CMSPARK_723_COMPILED_ROOT: compiled }
  // Existing job-owned orphan tracking only; never invent, print or hash it.
  if (typeof parent.RUNNER_TRACKING_ID === 'string' && parent.RUNNER_TRACKING_ID) env.RUNNER_TRACKING_ID = parent.RUNNER_TRACKING_ID
  return env
}
