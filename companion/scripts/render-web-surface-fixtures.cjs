// Real HTML templates in an isolated data directory. No server is started.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });
const isolated = fs.mkdtempSync(path.join(os.tmpdir(), 'cmspark-surface-data-'));
process.env.CMSPARK_DATA_DIR = isolated;
try {
  for (const [file, symbol, name] of [['summoner-web.ts', 'SUMMONER_HTML', 'capture'], ['settings-web.ts', 'SETTINGS_HTML', 'settings']]) {
    const filename = path.join(root, 'src', file);
    const contents = fs.readFileSync(filename, 'utf8') + `\nexport { ${symbol} as fixtureHtml };`;
    const result = require('esbuild').buildSync({ stdin: { contents, resolveDir: path.dirname(filename), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', write: false });
    const mod = new Module(filename, module);
    mod.filename = filename; mod.paths = Module._nodeModulePaths(path.dirname(filename));
    mod._compile(result.outputFiles[0].text, filename);
    fs.writeFileSync(path.join(out, name + '.html'), mod.exports.fixtureHtml);
  }
} finally { fs.rmSync(isolated, { recursive: true, force: true }); }
console.log(out);
