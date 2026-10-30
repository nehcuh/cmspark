'use strict';
// Real owned configuration producer -> redacted reply -> extension reducer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const tsx = require(require.resolve('tsx/cjs/api', { paths: [path.join(root, 'companion')] }));
const unregister = tsx.register();

test('real save, stale writer and security gate preserve the right draft', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-config-draft-owned-')));
  const identity = fs.lstatSync(dir);
  const prior = process.env.CMSPARK_DATA_DIR;
  process.env.CMSPARK_DATA_DIR = dir;
  try {
    const config = require(path.join(root, 'companion/src/config.ts'));
    const { handleConfigFamily } = require(path.join(root, 'companion/src/message-router/handlers/config.ts'));
    const { agentReducer, initialState } = require(path.join(root, 'chrome-extension/src/sidepanel/store/agentStore.tsx'));
    const { normalizeConfig } = require(path.join(root, 'chrome-extension/src/sidepanel/utils/normalize-config.ts'));
    const { prepareSettingsSubmission } = require(path.join(root, 'chrome-extension/src/sidepanel/utils/settings-draft.ts'));
    config.clearConfigCache();
    config.saveConfig({ llm: { ...config.getConfig().llm, api_key: 'owned-synthetic-key', model_name: 'owned-initial' } }, { llmKey: true });
    const read = await handleConfigFamily('config.get', {});
    assert.equal(read.config.llm.api_key, '***');
    let state = agentReducer(initialState, { type: 'SET_CONNECTION', state: 'connected' });
    state = agentReducer(state, { type: 'SET_CONFIG_SNAPSHOT', config: normalizeConfig(read.config), revision: read.config_revision });
    state = agentReducer(state, { type: 'SET_CONFIG_HYDRATED', hydrated: true });
    state = agentReducer(state, { type: 'BEGIN_SETTINGS_DRAFT' });
    state = agentReducer(state, { type: 'EDIT_SETTINGS_DRAFT', config: { model_name: 'owned-draft' } });
    const sent = prepareSettingsSubmission(state.settingsDraft, 'settings-save:owned');
    state = agentReducer(state, { type: 'BEGIN_SETTINGS_SAVE', submission: sent });
    const remote = await handleConfigFamily('config.set', { config: { model_name: 'owned-remote' }, config_revision: sent.revision });
    const rejected = await handleConfigFamily('config.set', { config: sent.patch, config_revision: sent.revision });
    assert.equal(remote.type, 'config.updated');
    assert.equal(rejected.type, 'config.conflict');
    assert.equal(rejected.config.llm.api_key, '***');
    assert.equal(JSON.stringify(rejected).includes('owned-synthetic-key'), false);
    state = agentReducer(state, { type: 'SET_CONFIG_SNAPSHOT', config: normalizeConfig(rejected.config), revision: rejected.config_revision, id: sent.id, conflict: true });
    assert.equal(state.settingsSave.status, 'conflict');
    assert.equal(state.settingsDraft.value.model_name, 'owned-draft');
    assert.equal(state.settingsDraft.conflicts.model_name, true);
    assert.equal(config.getConfig().llm.model_name, 'owned-remote');
    const blocked = await handleConfigFamily('config.set', { config: { auto_approve_dangerous: true }, config_revision: rejected.config_revision });
    assert.equal(blocked.type, 'error');
    assert.notEqual(config.getConfig().security?.auto_approve_dangerous, true);
    state = agentReducer(state, { type: 'RESOLVE_SETTINGS_CONFLICT', key: 'model_name', choice: 'mine' });
    const retry = prepareSettingsSubmission(state.settingsDraft, 'settings-save:owned2');
    state = agentReducer(state, { type: 'BEGIN_SETTINGS_SAVE', submission: retry });
    const accepted = await handleConfigFamily('config.set', { config: retry.patch, config_revision: retry.revision });
    assert.equal(accepted.type, 'config.updated');
    state = agentReducer(state, { type: 'SET_CONFIG_SNAPSHOT', config: normalizeConfig(accepted.config), revision: accepted.config_revision, id: retry.id });
    assert.equal(state.settingsSave.status, 'saved');
    assert.equal(config.getConfig().llm.model_name, 'owned-draft');
    assert.equal(accepted.config.llm.api_key, '***');
  } finally {
    if (prior === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = prior;
    const now = fs.lstatSync(dir);
    assert.equal(now.isSymbolicLink(), false);
    assert.equal(now.dev, identity.dev);
    assert.equal(now.ino, identity.ino);
    fs.rmSync(dir, { recursive: true });
  }
});
test.after(() => unregister());
