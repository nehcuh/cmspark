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

test('real config handler round-trips independent editable fields without overwriting a secret', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-config-fields-owned-')));
  const identity = fs.lstatSync(dir), prior = process.env.CMSPARK_DATA_DIR;
  process.env.CMSPARK_DATA_DIR = dir;
  try {
    const config = require(path.join(root, 'companion/src/config.ts'));
    const { handleConfigFamily } = require(path.join(root, 'companion/src/message-router/handlers/config.ts'));
    const { normalizeConfig } = require(path.join(root, 'chrome-extension/src/sidepanel/utils/normalize-config.ts'));
    config.clearConfigCache();
    config.saveConfig({ llm: { ...config.getConfig().llm, api_key: 'owned-synthetic-key' } }, { llmKey: true });
    const fields = [
      ['base_url', 'https://owned.example/v1'], ['model_name', 'owned-model'],
      ['reasoning_effort', 'high'], ['temperature', 0.4], ['context_window', 131072],
      ['context_compaction', 'prompt'], ['native_vision', 'off'],
      ['vision_enabled', true], ['vision_base_url', 'https://vision.example/v1'],
      ['vision_model_name', 'owned-vision'], ['base_url', ''], ['vision_base_url', ''],
      ['vision_model_name', ''], ['vision_timeout_ms', 12345], ['vision_fallback', 'error'],
      ['file_upload_max_size', 2097152], ['file_upload_max_tokens', 12000], ['file_upload_vision', false],
      ['thread_digest_enabled', true], ['thread_digest_on_idle_hours', 12], ['thread_digest_max_per_day', 8],
      ['trusted_domains', ['owned.example']], ['auto_approved_domains', ['owned.example']],
      ['obsidian_vault_path', '/owned/synthetic/vault'], ['obsidian_vault_path', ''],
    ];
    for (const [key, value] of fields) {
      const before = await handleConfigFamily('config.get', {});
      const reply = await handleConfigFamily('config.set', { config: { [key]: value }, config_revision: before.config_revision });
      assert.equal(reply.type, 'config.updated', key);
      assert.deepEqual(normalizeConfig(reply.config)[key], value, key);
      assert.equal(reply.config.llm.api_key, '***', key);
    }
    assert.equal(config.getConfig().obsidian.vault_path, null);
    assert.equal(config.getConfig().obsidian.name_template, '{{date}} {{first_user_line}}');
    const beforeInvalid = await handleConfigFamily('config.get', {});
    const invalid = await handleConfigFamily('config.set', { config: { obsidian_vault_path: 'owned\0invalid' }, config_revision: beforeInvalid.config_revision });
    assert.equal(invalid.type, 'error');
    assert.equal(invalid.error, 'INVALID_OBSIDIAN_VAULT_PATH');
    assert.equal(config.getConfigRevision(), beforeInvalid.config_revision);
    assert.equal(config.getConfig().obsidian.vault_path, null);
  } finally {
    if (prior === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = prior;
    const now = fs.lstatSync(dir);
    assert.equal(now.isSymbolicLink(), false); assert.equal(now.dev, identity.dev); assert.equal(now.ino, identity.ino);
    fs.rmSync(dir, { recursive: true });
  }
});

test('real secret receipt confirms only an explicit write that remains current', async () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-config-secret-owned-')));
  const identity = fs.lstatSync(dir), prior = process.env.CMSPARK_DATA_DIR;
  process.env.CMSPARK_DATA_DIR = dir;
  try {
    const config = require(path.join(root, 'companion/src/config.ts'));
    const { handleConfigFamily } = require(path.join(root, 'companion/src/message-router/handlers/config.ts'));
    const { agentReducer, initialState } = require(path.join(root, 'chrome-extension/src/sidepanel/store/agentStore.tsx'));
    const { normalizeConfig } = require(path.join(root, 'chrome-extension/src/sidepanel/utils/normalize-config.ts'));
    const { prepareSettingsSubmission } = require(path.join(root, 'chrome-extension/src/sidepanel/utils/settings-draft.ts'));
    config.clearConfigCache();
    const before = await handleConfigFamily('config.get', {});
    let state = agentReducer(initialState, { type: 'SET_CONNECTION', state: 'connected' });
    state = agentReducer(state, { type: 'SET_CONFIG_SNAPSHOT', config: normalizeConfig(before.config), revision: before.config_revision });
    state = agentReducer(state, { type: 'SET_CONFIG_HYDRATED', hydrated: true });
    state = agentReducer(state, { type: 'EDIT_SETTINGS_DRAFT', config: { api_key: 'owned-synthetic-new' } });
    const sent = prepareSettingsSubmission(state.settingsDraft, 'settings-save:owned-secret');
    state = agentReducer(state, { type: 'BEGIN_SETTINGS_SAVE', submission: sent });
    const reply = await handleConfigFamily('config.set', { config: sent.patch, config_revision: sent.revision });
    assert.deepEqual(reply.config_applied_secret_fields, ['api_key']);
    assert.equal(JSON.stringify(reply).includes('owned-synthetic-new'), false);
    state = agentReducer(state, { type: 'SET_CONFIG_SNAPSHOT', config: normalizeConfig(reply.config), revision: reply.config_revision, id: sent.id, confirmedSecrets: reply.config_applied_secret_fields });
    assert.equal(state.settingsSave.status, 'saved');
    assert.equal(state.settingsDraft.value.api_key, '');
    const vision = await handleConfigFamily('config.set', { config: { vision_api_key: 'owned-vision-secret' }, config_revision: reply.config_revision });
    assert.deepEqual(vision.config_applied_secret_fields, ['vision_api_key']);
    assert.equal(JSON.stringify(vision).includes('owned-vision-secret'), false);
    const listener = () => {
      config.configEvents.off(config.CONFIG_CHANGE_EVENT, listener);
      config.saveConfig({ llm: { ...config.getConfig().llm, model_name: 'owned-reentrant' } });
    };
    config.configEvents.on(config.CONFIG_CHANGE_EVENT, listener);
    try {
      const raced = await handleConfigFamily('config.set', { config: { api_key: 'owned-raced-key' }, config_revision: vision.config_revision });
      assert.equal(raced.type, 'config.updated');
      assert.equal(raced.config_applied_secret_fields, undefined);
      assert.equal(JSON.stringify(raced).includes('owned-raced-key'), false);
    } finally { config.configEvents.off(config.CONFIG_CHANGE_EVENT, listener); }
  } finally {
    if (prior === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = prior;
    const now = fs.lstatSync(dir);
    assert.equal(now.isSymbolicLink(), false); assert.equal(now.dev, identity.dev); assert.equal(now.ino, identity.ino);
    fs.rmSync(dir, { recursive: true });
  }
});
