import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const lineage = require(path.resolve('scripts/tests/workspace-query-101-inverse.cjs'));

const ui = fs.readFileSync(path.resolve('tests/fixtures/workspace-ui-705/WorkspacePickerUITests.swift'), 'utf8');
const helper = fs.readFileSync(path.resolve('tests/helpers/workspace-xctest-owned-705.ts'), 'utf8');
// Project the actual Swift query statements. This controls query semantics; it
// does not execute XCTest or claim a native performance measurement.
function sheetQuery({windows = 1, sheets = 1, exists = true} = {}) {
  const start = ui.indexOf('func sheet(_ stage:Int) throws ->XCUIElement {');
  const end = ui.indexOf('\n  }\n  uiStage=2;', start);
  assert(start >= 0 && end > start);
  let body = ui.slice(ui.indexOf('{', start) + 1, end);
  for (const [before, after] of [
    ['matching(identifier:scene.nonce)', 'matching({identifier:scene.nonce})'],
    ['waitForExistence(timeout:try remaining())', 'waitForExistence({timeout:remaining()})'],
    ['guard count==1 else{throw OwnedUI705Error.refused}', "if(count!==1){throw Error('REFUSED')}"],
    ['guard exists else{throw OwnedUI705Error.refused}', "if(!exists){throw Error('REFUSED')}"],
    ['guard sheets==1 else{throw OwnedUI705Error.refused}', "if(sheets!==1){throw Error('REFUSED')}"],
  ]) { assert.equal(body.split(before).length, 2); body = body.replace(before, after); }
  body = body.replaceAll('let ', 'const ').replaceAll('min(', 'Math.min(');
  assert.doesNotMatch(body, /\bguard\b|\btry\b|OwnedUI705Error/);
  const calls: string[] = [], sheet = {waitForExistence({timeout}: {timeout: number}) { calls.push('wait'); assert.equal(timeout, 2); return exists; }};
  const window = {sheets: {get firstMatch() { calls.push('sheet-first'); return sheet; }, get count() { calls.push('sheet-count'); return sheets; }}};
  const query = {get count() { calls.push('window-count'); return windows; }, get firstMatch() { calls.push('window-first'); return window; }, get element() { throw Error('REDUNDANT_FULL_QUERY'); }};
  const scope = {Math, stage: 3, scene: {nonce: 'INERT'}, app: {windows: {matching({identifier}: {identifier: string}) { assert.equal(identifier, 'INERT'); return query; }}}, remaining() { calls.push('remaining'); return 2; }, observeUIStage() {}};
  return {calls, sheet, run: () => vm.runInNewContext('(function(){let uiStage=0,uiDetail=0;' + body + '})()', scope)};
}
test('actual owner query keeps uniqueness and existence guards before returning a sheet', () => {
  const current = sheetQuery();
  assert.equal(current.run(), current.sheet);
  assert.deepEqual(current.calls, ['window-count', 'window-first', 'sheet-first', 'remaining', 'wait', 'sheet-count', 'sheet-first']);
  for (const windows of [0, 2]) { const f = sheetQuery({windows}); assert.throws(f.run, /REFUSED/); assert.deepEqual(f.calls, ['window-count']); }
  const absent = sheetQuery({exists: false}); assert.throws(absent.run, /REFUSED/); assert(!absent.calls.includes('sheet-count'));
  for (const sheets of [0, 2]) { const f = sheetQuery({sheets}); assert.throws(f.run, /REFUSED/); assert.equal(f.calls.filter(c => c === 'sheet-first').length, 1); }
});
test('whole-source lineage preserves all preceding deadline, identity and real action assertions', () => {
  for (const eol of ['\n', '\r\n']) {
    for (const [kind, raw] of [['ui', ui], ['helper', helper]]) {
      const source = raw.replace(/\r?\n/g, eol);
      assert.notEqual(lineage.restoreWorkspaceQuery101(kind, source), source);
      assert.throws(() => lineage.restoreWorkspaceQuery101(kind, source + eol));
    }
    for (const [before, after] of [['guard count==1 else', 'guard count>=1 else'], ['guard sheets==1 else', 'guard sheets>=1 else'], ['guard inputHittable else', 'guard true else'], ['guard r>0,r<=45 else', 'guard r>0,r<=46 else'], ['cancel.element.click()', 'cancel.element.doubleClick()']]) {
      assert.equal(ui.split(before).length, 2);
      assert.throws(() => lineage.restoreWorkspaceQuery101('ui', ui.replace(before, after).replace(/\r?\n/g, eol)));
    }
  }
});
