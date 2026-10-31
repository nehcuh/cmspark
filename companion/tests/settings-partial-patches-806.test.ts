// Inert CPU regression: actual JSX onChange producer -> real config.set handler
// -> real saveConfig/deepMerge, with persistence and dependencies isolated.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const roots = [path.resolve(__dirname, '../..'), path.resolve(__dirname, '../../..')]
const requiredSources = [
 'chrome-extension/src/sidepanel/components/SettingsSlideout.tsx',
 'companion/src/message-router/handlers/config.ts',
 'companion/src/config.ts',
]
const matches = roots.filter(candidate => requiredSources.every(file => fs.existsSync(path.join(candidate, file))))
assert.equal(matches.length, 1, 'exactly one source root must contain every required producer and consumer')
const root = matches[0]
const parse = (p:string, kind=ts.ScriptKind.TS) => ts.createSourceFile(p, fs.readFileSync(path.join(root,p),'utf8'), ts.ScriptTarget.Latest, true, kind)
const ui = parse('chrome-extension/src/sidepanel/components/SettingsSlideout.tsx', ts.ScriptKind.TSX)
const router = parse('companion/src/message-router/handlers/config.ts')
const config = parse('companion/src/config.ts')
function fn(source:ts.SourceFile,name:string) {
 const matches=source.statements.filter((x):x is ts.FunctionDeclaration=>ts.isFunctionDeclaration(x)&&x.name?.text===name)
 assert.equal(matches.length,1,`unique actual function ${name}`)
 return matches[0].getText(source).replace(/^export\s+/, '')
}
function producer(field:string, input:unknown) {
 const found:ts.ArrowFunction[]=[]
 const walk=(n:ts.Node)=>{ if(ts.isJsxAttribute(n)&&n.name.getText(ui)==='onChange'&&n.initializer&&ts.isJsxExpression(n.initializer)&&n.initializer.expression&&ts.isArrowFunction(n.initializer.expression)) { const text=n.initializer.expression.getText(ui); if(new RegExp('\\b'+field+'\\s*:').test(text)&&text.includes('EDIT_SETTINGS_DRAFT'))found.push(n.initializer.expression) } ts.forEachChild(n,walk) }
 walk(ui); assert.equal(found.length,1,`unique JSX producer ${field}`)
 const code=ts.transpileModule(`globalThis.produce = (${found[0].getText(ui)})`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 let action:any; const ctx:any={dispatch:(a:any)=>{action=a}, parseInt}; vm.runInNewContext(code,ctx,{timeout:1000})
 ctx.produce({target:{value:input,checked:input}})
 assert.equal(action.type,'EDIT_SETTINGS_DRAFT'); assert.deepEqual(Object.keys(action.config),[field]); return action.config
}
function handler() {
 let current:any={llm:{base_url:'https://owned.invalid', model_name:'owned-model',api_key:'owned-llm',context_compaction_m2:true,native_vision:'auto'},vision:{enabled:true,base_url:'https://different.invalid',model_name:'vision',api_key:'owned-vision',timeout_ms:30000,fallback:'metadata'},security:{auto_approve_dangerous:false,allow_all_schemes:false,auto_approve_enterprise_tools:false},trusted_domains:['owned.invalid']}
 const source=[fn(router,'hasPrototypePollutionKey'),fn(router,'sanitizeConfig'),fn(router,'handleConfigFamily'),fn(config,'deepMerge'),fn(config,'saveConfig'),fn(config,'saveConfigWithReceipt'),fn(config,'saveConfigInternal')].join('\n')+'\nglobalThis.handle=handleConfigFamily'
 const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText
 const context:any={PROTOTYPE_POLLUTION_KEYS:new Set(['__proto__','constructor','prototype']),structuredClone, getConfig:()=>current,
  // Revision transport is outside this isolated producer test; the real
  // snapshot returns the current config and its process-scoped revision.
  getConfigSnapshot:()=>({config:current,revision:"owned-fixture:0"}),
  // Stubbed persistence cannot certify a real committed revision.
  getCommittedConfigRevision:()=>undefined,
  saveConfigSnapshot:(value:any)=>{current=value;return value},storedLlmKey:'owned-llm',storedVisionKey:'owned-vision',visionUsesLlm:false,
  stripCompanionUiProcessContinueDeny:(v:any)=>v, filterDomainPatterns:(v:any)=>v, isMaskedApiKey:(s:any)=>typeof s==='string'&&s.includes('***'),
  getEnvApiKey:()=>'',resolveInheritedVisionApiKey:()=>undefined,isPlaceholderVisionKey:()=>false,endpointsMatch:()=>false,
  redactConfigForWire:(v:any)=>v, console:{warn:()=>{}}, logger:{warn:()=>{}}, appendCapabilityAudit:()=>{},
  require:()=>{throw Error('UNEXPECTED_REQUIRE')},findArmingSecurityFlags:()=>{throw Error('UNEXPECTED_SECURITY')},findDisarmingSecurityFlags:()=>{throw Error('UNEXPECTED_SECURITY')},
 }
 vm.runInNewContext(code,context,{timeout:1000})
 return {handle:context.handle, snapshot:()=>structuredClone(current)}
}
for(const [field,input,section,key,expected] of [
 ['context_compaction_m2',false,'llm','context_compaction_m2',false],
 ['native_vision','on','llm','native_vision','on'],
 ['vision_timeout_ms','45000','vision','timeout_ms',45000],
 ['vision_fallback','error','vision','fallback','error'],
] as const) test(`actual ${field} JSX single-field patch reaches the saved snapshot without unrelated changes`,async()=>{
 const patch=producer(field,input),h=handler(),before=h.snapshot()
 const result=await h.handle('config.set',{config:patch})
 assert.equal(result.type,'config.updated')
 const after=h.snapshot(); assert.equal(after[section][key],expected,`${field} must reach the saved snapshot`)
 const expectedSnapshot=structuredClone(before);expectedSnapshot[section][key]=expected
 assert.deepEqual(after,expectedSnapshot)
})

// Manual adversarial payloads: these are not claimed to originate from JSX.
for (const [field, value] of [
 ['native_vision', 'invalid'],
 ['context_compaction_m2', 'not-a-boolean'],
 ['vision_timeout_ms', 'not-a-number'],
 ['vision_fallback', 'unknown'],
] as const) test(`manual invalid ${field} leaves the full saved snapshot unchanged`, async () => {
 const h=handler(), before=h.snapshot()
 await h.handle('config.set', {config: {[field]: value}})
 assert.deepEqual(h.snapshot(), before)
})

// Manual mixed payloads test each valid field independently of its invalid sibling.
for (const [patch, key, value] of [
 [{vision_fallback:'error', vision_timeout_ms:'not-a-number'}, 'fallback', 'error'],
 [{vision_timeout_ms:45000, vision_fallback:'unknown'}, 'timeout_ms', 45000],
] as const) test(`manual mixed vision patch changes only valid ${key}`, async () => {
 const h=handler(), expected=structuredClone(h.snapshot())
 expected.vision[key]=value
 await h.handle('config.set', {config: patch})
 assert.deepEqual(h.snapshot(), expected)
})

// Manual legacy flat payload exercises the pre-existing vision_enabled guard,
// separately from single-field producer tests; snapshot persistence is inert.
test('manual legacy flat vision payload retains prior multi-field behavior', async () => {
 const h=handler(), expected=structuredClone(h.snapshot())
 Object.assign(expected.vision, {enabled:false, base_url:'https://legacy.invalid', model_name:'legacy-model', timeout_ms:45000, fallback:'error'})
 const result=await h.handle('config.set', {config:{vision_enabled:false, vision_base_url:'https://legacy.invalid', vision_model_name:'legacy-model', vision_timeout_ms:45000, vision_fallback:'error'}})
 assert.equal(result.type, 'config.updated')
 assert.deepEqual(h.snapshot(), expected)
})
