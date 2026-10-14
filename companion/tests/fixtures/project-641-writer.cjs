// Owned concurrent metadata writer only: no config/model/Agent/native host imports.
const { ProjectStore } = require(process.argv[2]);
const { randomUUID } = require('node:crypto');
process.once('message', () => {
  let receipt;
  try { receipt = { ok: true, result: new ProjectStore(process.argv[3]).mutate('project.create', {
    name: process.argv[4], operation_id: randomUUID(), expected_revision: 0, user_gesture: true,
  }, { thread: () => undefined, busy: () => 'unknown' }) }; }
  catch (error) { receipt = { ok: false, error_code: error.code }; }
  process.send(receipt, () => process.exit(0));
});
process.send({ ready: true });
