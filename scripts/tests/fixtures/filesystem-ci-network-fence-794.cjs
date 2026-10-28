// CPU stdio acceptance only. This closes the known Node network API surface;
// it is not described as an OS network namespace or a hostile-code sandbox.
const denied = () => {
  const error = new Error('STAGED_FILESYSTEM_NETWORK_DENIED')
  error.code = 'STAGED_FILESYSTEM_NETWORK_DENIED'
  throw error
}
const net = require('node:net')
net.connect = net.createConnection = denied
net.Socket.prototype.connect = denied
net.Server.prototype.listen = denied
require('node:tls').connect = denied
require('node:dgram').createSocket = denied
for (const name of ['node:http', 'node:https']) {
  const module = require(name)
  module.request = module.get = denied
}
const dns = require('node:dns')
for (const key of Object.keys(dns)) if (typeof dns[key] === 'function') dns[key] = denied
for (const key of Object.keys(dns.promises)) if (typeof dns.promises[key] === 'function') dns.promises[key] = denied
globalThis.fetch = denied
require('node:module').syncBuiltinESMExports()
