// Read-only audit probes for #445. Uses compiled companion modules and the actual
// browser scriptingExecute method, transpiled in memory. No Chrome or LLM calls.
// Run after companion test compilation with Node 22; pass repo root optionally.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const repo = process.argv[2] || path.resolve(__dirname, '../../..');
const isolatedData = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-070-probe-'));
process.env.CMSPARK_DATA_DIR = isolatedData;
const compiled = path.join(repo, 'companion/.test-dist/src');

async function main() {
  const { applyToolResult, mapProposeItems } = require(path.join(compiled, 'threads/run-progress.js'));
  const { evaluateCompletion } = require(path.join(compiled, 'loop/completion-predicate.js'));
  const { resolveToolCallFromThreadMessages, canComplete } = require(path.join(compiled, 'board/service.js'));
  const { createEmptyMissionBoard, FactSchema, IntentSchema } = require(path.join(compiled, 'board/schema.js'));
  // Intentionally adversarial inputs, not claimed to be recorded production fixtures.
  const progress = { items: mapProposeItems([{ text: '提交表单且后台生成记录', tool: 'click' }]) };
  const afterClick = applyToolResult(progress, { tool: 'click', success: true });
  const failedResult = {
    role: 'tool', content: JSON.stringify({ success: false, error: 'timeout' }),
    tool_calls: [{ id: 'failed-read', name: 'get_page_text', result: { success: false, error: 'timeout' } }],
  };
  const resolver = resolveToolCallFromThreadMessages({ getMessages: () => [failedResult] }, 'probe-thread');
  const board = createEmptyMissionBoard({ goal: '收齐变更材料' });
  const provenance = { actor_type: 'system', thread_id: 'probe-thread', worker_id: null,
    orchestrator_run_id: null, message_id: null, tool_name: null, at: board.updated_at };
  board.facts.push(FactSchema.parse({ id: 'f1', claim: '版本匹配', trust: 'tool_verified',
    evidence: [{ kind: 'tool_result', value: 'unverified claim', tool_call_id: 'failed-read' }],
    provenance, created_at: board.updated_at }));
  board.intents.push(IntentSchema.parse({ id: 'i1', description: 'CMDB 尚未读取', status: 'open',
    provenance, created_at: board.updated_at, updated_at: board.updated_at }));

  const ts = require(path.join(repo, 'companion/node_modules/typescript'));
  const srcPath = path.join(repo, 'chrome-extension/src/background/browser-bridge.ts');
  const src = fs.readFileSync(srcPath, 'utf8');
  const ast = ts.createSourceFile(srcPath, src, ts.ScriptTarget.Latest, true);
  let method;
  function visit(n) {
    if (ts.isMethodDeclaration(n) && n.name.getText(ast) === 'scriptingExecute') method = n;
    ts.forEachChild(n, visit);
  }
  visit(ast);
  if (!method) throw new Error('scriptingExecute method not found');
  const code = ts.transpileModule(`class Probe { ${method.getText(ast)} } module.exports = Probe;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const fullHtml = '<html><section id="wanted">release-A</section><aside>unrelated-content</aside></html>';
  const wantedHtml = '<section id="wanted">release-A</section>';
  async function browserProbe(forceMain) {
    let invocations = 0;
    const sandbox = {
      module: { exports: {} },
      document: { querySelector: (s) => s === 'html' ? { outerHTML: fullHtml,
        querySelector: (nested) => nested === '#wanted' ? { outerHTML: wantedHtml } : null } : null },
      chrome: { scripting: { executeScript: async (args) => {
        invocations++;
        if (forceMain && invocations === 1) return [{ error: 'mock ISOLATED unavailable' }];
        return [{ result: args.func(...(args.args || [])) }];
      } } },
    };
    vm.runInNewContext(code, sandbox);
    return new sandbox.module.exports().scriptingExecute(1,
      `document.querySelector('html').querySelector("#wanted")?.outerHTML?.substring(0, 500000) || ''`);
  }
  return {
    basis: 'HEAD 63b449d9; actual production functions, adversarial synthetic input; no live browser',
    runProgress: { afterClick, completion: evaluateCompletion({ runProgress: afterClick,
      closingTurnToolCalls: 0, pendingConfirms: 0, claim: { itemIds: afterClick.items.map(x => x.id) } }) },
    board: { failedToolIdResolves: resolver('failed-read'),
      openIntentStatus: board.intents[0].status,
      completion: canComplete(board, { supporting_fact_ids: ['f1'] }) },
    htmlFallback: { requested: wantedHtml, isolated: await browserProbe(false), main: await browserProbe(true) },
    siteExperienceNameCollision: ['a.b-c', 'a-b.c'].map(host => ({ host,
      name: host.replace(/^www\./, '').replace(/\./g, '-') })),
  };
}
main().then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => fs.rmSync(isolatedData, { recursive: true, force: true }));
