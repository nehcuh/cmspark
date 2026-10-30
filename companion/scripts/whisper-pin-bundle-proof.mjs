// Bind a packaging-time binary digest to the compiled voice consumers and an
// exact replay of their bundle. This is not artifact provenance or a runtime test.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const modules = ['whisper-binary-pins', 'whisper-binary-download', 'whisper-prewarm', 'whisper-state', 'stt-session-service'];
// Pin extraction below relies on these two functions' exact semantics. A change
// to either requires reviewing and updating this contract alongside its tests.
const contracts = {
  expectedWhisperSha256: '3cc1c7442e9a43612d7761d79870446b3b601b463fc7dce7ab553435e95a9ef8',
  whisperPinResolveOpts: '3644f6a0ea17f34acac83e5c6f5f892e89835e199c4e470292a6bcd5ecff2607',
};
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = message => { throw new Error(`WHISPER_PIN_PROOF_${message}`); };

export function verifyWhisperPin({ typescript: ts, root, metafile, bundle, replay, arch }) {
  if (!['darwin-arm64', 'darwin-x64'].includes(arch)) fail('ARCH');
  if (!bundle.length || !Buffer.from(bundle).equals(Buffer.from(replay))) fail('BUNDLE_MISMATCH');
  const config = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) fail('TSCONFIG');
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length) fail('TSCONFIG');
  let pinSource;
  for (const name of modules) {
    const sourcePath = path.join(root, 'src', 'voice', name + '.ts');
    const compiledPath = path.join(root, 'dist', 'voice', name + '.js');
    const source = fs.readFileSync(sourcePath, 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: parsed.options, fileName: sourcePath, reportDiagnostics: true });
    if (output.diagnostics?.some(item => item.category === ts.DiagnosticCategory.Error)) fail('TRANSPILE');
    if (output.outputText !== fs.readFileSync(compiledPath, 'utf8')) fail('STALE');
    if (name === modules[0]) pinSource = source;
  }
  const pinInput = 'dist/voice/whisper-binary-pins.js';
  if (!metafile.inputs?.[pinInput]) fail('GRAPH');
  const outputs = Object.values(metafile.outputs || {});
  const relevant = [pinInput, ...modules.slice(1).map(name => `dist/voice/${name}.js`)];
  if (outputs.length !== 1 || outputs[0].entryPoint !== 'dist/index.js' || outputs[0].bytes !== replay.length
      || !relevant.every(name => outputs[0].inputs?.[name]?.bytesInOutput > 0)) fail('GRAPH');
  const edges = [];
  for (const [from, input] of Object.entries(metafile.inputs)) {
    for (const edge of input.imports || []) {
      if (edge.path !== pinInput) continue;
      if (edge.kind !== 'require-call') fail('GRAPH');
      edges.push(from);
    }
  }
  if (JSON.stringify(edges.sort()) !== JSON.stringify(relevant.slice(1).sort())) fail('GRAPH');
  const sf = ts.createSourceFile('whisper-binary-pins.ts', pinSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length) fail('SOURCE');
  let object;
  const found = new Set();
  for (const statement of sf.statements) {
    if (ts.isTypeAliasDeclaration(statement) && statement.name.text === 'WhisperPinnedArch') continue;
    if (ts.isFunctionDeclaration(statement) && contracts[statement.name?.text]) {
      const name = statement.name.text;
      if (found.has(name) || digest(statement.getText(sf)) !== contracts[name]) fail('FUNCTION_CONTRACT');
      found.add(name);
      continue;
    }
    if (ts.isVariableStatement(statement) && statement.modifiers?.some(item => item.kind === ts.SyntaxKind.ExportKeyword)
        && (statement.declarationList.flags & ts.NodeFlags.Const) !== 0 && statement.declarationList.declarations.length === 1) {
      const declaration = statement.declarationList.declarations[0];
      if (declaration.name.getText(sf) === 'WHISPER_BINARY_SHA256' && ts.isObjectLiteralExpression(declaration.initializer) && !object) {
        object = declaration.initializer;
        continue;
      }
    }
    fail('SOURCE');
  }
  if (!object || found.size !== 2) fail('SOURCE');
  const pins = Object.create(null);
  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name) || !ts.isStringLiteral(property.initializer)) fail('PINS');
    const key = property.name.text;
    const value = property.initializer.text;
    if (!['darwin-arm64', 'darwin-x64', 'win-x64', 'linux-x64'].includes(key)
        || Object.hasOwn(pins, key) || !/^[0-9a-f]{64}$/.test(value)) fail('PINS');
    pins[key] = value;
  }
  if (!pins[arch]) fail('MISSING');
  return pins[arch];
}
