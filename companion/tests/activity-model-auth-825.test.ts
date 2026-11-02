import './helpers/require-isolated-config-825'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { clearConfigCache, getConfig, getConfigDir, saveConfig, type LlmConfig, type VisionConfig } from '../src/config'
import { activityModelTarget, activityVisionConfig, hasActivityImageConsent } from '../src/activity/model-config'
import { resolveVisionLlmConfig } from '../src/llm/vision-pipeline'
import { DEFAULT_ACTIVITY_CONFIG, type ActivityConfig } from '../src/activity/types'

// All credentials and endpoints below are inert; no HTTP request is made.
const authFields = ['auth_style', 'client_header_profile', 'claude_code_compat_version', 'extra_headers', 'anthropic_version'] as const
type AuthField = typeof authFields[number]
const changed: Pick<LlmConfig, AuthField> = {
  auth_style: 'x-api-key', client_header_profile: 'claude_code_compat', claude_code_compat_version: '2.1.221', extra_headers: { 'x-owned-tenant': 'owned-main-b' }, anthropic_version: '2023-06-02',
}
function main(): LlmConfig {
  return { base_url: 'https://owned-gateway.invalid/v1', api_key: 'owned-main-key-825', model_name: 'owned-vision', protocol: 'anthropic', temperature: 0.3, context_window: 100000,
    auth_style: 'bearer', client_header_profile: 'none', claude_code_compat_version: '2.1.220', extra_headers: { 'x-owned-tenant': 'owned-main-a' }, anthropic_version: '2023-06-01' }
}
function vision(): VisionConfig {
  return { enabled: true, base_url: 'https://owned-gateway.invalid/v1', api_key: 'owned-vision-key-825', model_name: 'owned-vision', protocol: 'anthropic', timeout_ms: 15000, max_tokens: 1000, cache_ttl_seconds: 0, fallback: 'error', use_main_auth: false,
    auth_style: 'auto', client_header_profile: 'claude_code_compat', claude_code_compat_version: '2.1.111', extra_headers: { 'x-owned-tenant': 'owned-vision-a' }, anthropic_version: '2023-05-31' }
}
function reset(useMain = false): void {
  // Explicit undefined clears optional fields in the cached fake config; no old
  // header entry can leak between matrix rows through saveConfig's deep merge.
  saveConfig({ llm: { ...main(), extra_headers: undefined }, vision: { ...vision(), extra_headers: undefined } }, { llmKey: true, visionKey: true })
  saveConfig({ llm: main(), vision: { ...vision(), use_main_auth: useMain } }, { llmKey: true, visionKey: true })
}
async function isolated(action: () => void | Promise<void>): Promise<void> {
  const file = path.join(getConfigDir(), 'config.json'), before = fs.existsSync(file) ? fs.readFileSync(file) : null
  clearConfigCache()
  try { reset(); await action() }
  finally { if (before) fs.writeFileSync(file, before, { mode: 0o600 }); else fs.rmSync(file, { force: true }); clearConfigCache() }
}
const config = (): ActivityConfig => ({ ...DEFAULT_ACTIVITY_CONFIG, extraction_mode: 'vision' })
function consent(): ActivityConfig { const value = config(); return { ...value, image_ai_enabled: true, image_ai_consent: activityModelTarget(value).id } }
const resolved = (): LlmConfig => resolveVisionLlmConfig(activityVisionConfig(config()))
function setVision(value: Partial<VisionConfig>): void { saveConfig({ vision: { ...getConfig().vision!, ...value } }, { visionKey: true }) }
function setMain(value: Partial<LlmConfig>): void { saveConfig({ llm: { ...getConfig().llm, ...value } }, { llmKey: true }) }

test('825 standalone vision binds every effective auth field and invalidates image consent on each change', () => isolated(() => {
  for (const field of authFields) {
    reset(false)
    const accepted = consent(), before = activityModelTarget(accepted).id, current = resolved()[field]
    const replacement = field === 'client_header_profile' ? 'none' : changed[field]
    setVision({ [field]: replacement })
    assert.notDeepEqual(resolved()[field], current, `${field} must change the actual resolved request config`)
    assert.deepEqual(resolved()[field], replacement)
    assert.notEqual(activityModelTarget(accepted).id, before, `${field} must invalidate its prior consent`)
    assert.equal(hasActivityImageConsent(accepted), false)
  }
}))

test('825 matched inherited main auth changes effective resolver fields, target id, and prior consent', () => isolated(() => {
  for (const field of authFields) {
    reset(true)
    const accepted = consent(), before = activityModelTarget(accepted).id, current = resolved()[field]
    assert.deepEqual(current, getConfig().llm[field])
    setMain({ [field]: changed[field] })
    assert.deepEqual(resolved()[field], changed[field])
    assert.notDeepEqual(resolved()[field], current)
    assert.notEqual(activityModelTarget(accepted).id, before)
    assert.equal(hasActivityImageConsent(accepted), false)
  }
}))

test('825 inherited main fields override unused vision fields without spuriously expiring consent', () => isolated(() => {
  for (const field of authFields) {
    reset(true)
    const accepted = consent(), before = activityModelTarget(accepted).id, effective = resolved()[field]
    const replacement = field === 'auth_style' ? 'x-api-key' : field === 'client_header_profile' ? 'none' : field === 'extra_headers' ? { 'x-owned-tenant': 'owned-vision-unused' } : field === 'claude_code_compat_version' ? '2.1.999' : '2023-06-03'
    setVision({ [field]: replacement })
    assert.notDeepEqual(getConfig().vision![field], vision()[field], 'the covered configured field really changed')
    assert.deepEqual(resolved()[field], effective, 'actual resolver still uses main auth')
    assert.equal(activityModelTarget(accepted).id, before)
    assert.equal(hasActivityImageConsent(accepted), true)
  }
}))

test('825 nullish inherited fields fall back individually to configured vision auth', () => isolated(() => {
  for (const field of authFields) {
    reset(true)
    setMain({ [field]: undefined })
    assert.equal(getConfig().llm[field], undefined)
    assert.deepEqual(resolved()[field], getConfig().vision![field])
    const accepted = consent(), before = activityModelTarget(accepted).id
    const replacement = field === 'client_header_profile' ? 'none' : changed[field]
    setVision({ [field]: replacement })
    assert.deepEqual(resolved()[field], replacement)
    assert.notEqual(activityModelTarget(accepted).id, before)
    assert.equal(hasActivityImageConsent(accepted), false)
  }
}))

test('825 endpoint, model or protocol mismatch prevents unused main auth from affecting consent', () => isolated(() => {
  const mismatches: Partial<VisionConfig>[] = [
    { base_url: 'https://different-owned-gateway.invalid/v1' }, { model_name: 'different-owned-vision' }, { protocol: 'openai' },
  ]
  for (const mismatch of mismatches) for (const field of authFields) {
    reset(true); setVision(mismatch)
    const accepted = consent(), before = activityModelTarget(accepted).id, effective = resolved()[field]
    assert.deepEqual(effective, getConfig().vision![field])
    setMain({ [field]: changed[field] })
    assert.deepEqual(resolved()[field], effective)
    assert.equal(activityModelTarget(accepted).id, before)
    assert.equal(hasActivityImageConsent(accepted), true)
  }
}))

test('825 default OpenAI protocol and normalized matching endpoints follow the actual inheritance resolver', () => isolated(() => {
  reset(true)
  setMain({ base_url: 'https://owned-gateway.invalid/v1/', model_name: 'OWNED-VISION', protocol: 'openai' })
  setVision({ protocol: undefined })
  for (const field of authFields) assert.deepEqual(resolved()[field], getConfig().llm[field])
  const accepted = consent(), before = activityModelTarget(accepted).id
  setMain({ auth_style: 'x-api-key' })
  assert.equal(resolved().auth_style, 'x-api-key'); assert.notEqual(activityModelTarget(accepted).id, before); assert.equal(hasActivityImageConsent(accepted), false)
}))

test('825 default missing auth preserves the pre-change target hash and OCR stays the fixed local id', () => isolated(() => {
  reset(false)
  setVision({ ...Object.fromEntries(authFields.map(field => [field, undefined])), protocol: undefined, use_main_auth: undefined })
  const value = getConfig().vision!, expected = createHash('sha256').update(JSON.stringify(['vision', value.base_url, value.model_name, value.protocol, value.api_key, undefined, undefined, undefined, undefined, undefined])).digest('hex')
  for (const field of authFields) assert.equal(resolved()[field], undefined)
  assert.equal(activityModelTarget(config()).id, expected)
  assert.equal(activityModelTarget({ ...DEFAULT_ACTIVITY_CONFIG, extraction_mode: 'ocr' }).id, 'ocr')
  setMain(changed)
  assert.equal(activityModelTarget({ ...DEFAULT_ACTIVITY_CONFIG, extraction_mode: 'ocr' }).id, 'ocr')
}))

test('825 semantically identical effective headers keep consent across real object insertion order changes', () => isolated(() => {
  for (const inherited of [false, true]) {
    reset(inherited)
    const set = inherited ? setMain : setVision
    set({ extra_headers: undefined }); set({ extra_headers: { 'x-owned-a': 'owned-a', 'x-owned-z': 'owned-z' } })
    const accepted = consent(), before = activityModelTarget(accepted).id
    assert.deepEqual(Object.keys(resolved().extra_headers!), ['x-owned-a', 'x-owned-z'])
    set({ extra_headers: undefined }); set({ extra_headers: { 'x-owned-z': 'owned-z', 'x-owned-a': 'owned-a' } })
    assert.deepEqual(Object.keys(resolved().extra_headers!), ['x-owned-z', 'x-owned-a'], 'actual resolver receives a genuinely reordered object')
    assert.equal(activityModelTarget(accepted).id, before)
    assert.equal(hasActivityImageConsent(accepted), true)
    const target = activityModelTarget(accepted)
    assert.match(target.id, /^[a-f0-9]{64}$/)
    assert.equal(target.label.includes('owned-main-key-825'), false); assert.equal(target.label.includes('owned-vision-key-825'), false); assert.equal(target.label.includes('owned-a'), false)
  }
}))
