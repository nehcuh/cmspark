import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const lineage = require(path.resolve('scripts/tests/workspace-query-101-inverse.cjs'));
const pickerWait = require(path.resolve('scripts/tests/picker-wait-inverse.cjs'));

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
    ['element(boundBy:0)', 'element({boundBy:0})'],
    ['element(boundBy:1)', 'element({boundBy:1})'],
    ['waitForExistence(timeout:try remaining())', 'waitForExistence({timeout:remaining()})'],
    ['waitForExistence(timeout:1)', 'waitForExistence({timeout:1})'],
    ['guard windowOne else{throw OwnedUI705Error.refused}', "if(!windowOne){throw Error('REFUSED')}"],
    ['guard !windowExtra else{throw OwnedUI705Error.refused}', "if(windowExtra){throw Error('REFUSED')}"],
    ['guard exists else{throw OwnedUI705Error.refused}', "if(!exists){throw Error('REFUSED')}"],
    ['guard !sheetExtra else{throw OwnedUI705Error.refused}', "if(sheetExtra){throw Error('REFUSED')}"],
  ]) { const times = before.startsWith('element(boundBy:1)') || before.startsWith('waitForExistence') ? 3 : 2; assert.equal(body.split(before).length, times, before); body = body.replaceAll(before, after); }
  body = body.replaceAll('let ', 'const ');
  assert.doesNotMatch(body, /\bguard\b|\btry\b|OwnedUI705Error/);
  assert.equal(ui.split('let w=windows.firstMatch').length, 2);
  assert.equal(ui.split('w.sheets.firstMatch.waitForExistence').length, 2);
  assert.equal(ui.split('return w.sheets.firstMatch').length, 2);
  const calls: string[] = [];
  const returned = {id: 'sheet'};
  const sheet = {
    element({boundBy}: {boundBy: number}) {
      assert.equal(boundBy, 1); calls.push('sheet-extra');
      return {waitForExistence({timeout}: {timeout: number}) { calls.push('sheet-extra-wait'); assert.equal(timeout, 1); return sheets !== 1; }};
    },
    get firstMatch() { calls.push('sheet-first'); return {waitForExistence({timeout}: {timeout: number}) { calls.push('wait'); assert.equal(timeout, 2); return exists; }, id: 'exists'}; },
  };
  const window = {sheets: sheet};
  const query = {
    element({boundBy}: {boundBy: number}) {
      calls.push(boundBy === 0 ? 'window-one' : 'window-extra');
      return {waitForExistence({timeout}: {timeout: number}) {
        calls.push(boundBy === 0 ? 'window-one-wait' : 'window-extra-wait');
        if (boundBy === 0) { assert.equal(timeout, 2); return windows !== 0; }
        assert.equal(timeout, 1); return windows > 1;
      }};
    },
    get firstMatch() { calls.push('window-first'); return window; },
  };
  const scope = {stage: 3, scene: {nonce: 'INERT'}, app: {windows: {matching({identifier}: {identifier: string}) { assert.equal(identifier, 'INERT'); return query; }}}, remaining() { calls.push('remaining'); return 2; }, observeUIStage() {}};
  return {calls, returned, run: () => vm.runInNewContext('(function(){let uiStage=0,uiDetail=0;' + body + ';return w.sheets.firstMatch;})()', scope)};
}
test('actual owner query keeps uniqueness and existence guards before returning a sheet', () => {
  const current = sheetQuery();
  assert.equal(current.run().id, 'exists');
  assert.deepEqual(current.calls, ['window-one', 'remaining', 'window-one-wait', 'window-extra', 'window-extra-wait', 'window-first', 'sheet-first', 'remaining', 'wait', 'sheet-extra', 'sheet-extra-wait', 'sheet-first']);
  const none = sheetQuery({windows: 0}); assert.throws(none.run, /REFUSED/); assert.deepEqual(none.calls, ['window-one', 'remaining', 'window-one-wait']);
  const extra = sheetQuery({windows: 2}); assert.throws(extra.run, /REFUSED/); assert.deepEqual(extra.calls, ['window-one', 'remaining', 'window-one-wait', 'window-extra', 'window-extra-wait']);
  const absent = sheetQuery({exists: false}); assert.throws(absent.run, /REFUSED/); assert.equal(absent.calls.includes('sheet-extra'), false);
  for (const sheets of [0, 2]) { const f = sheetQuery({sheets}); assert.throws(f.run, /REFUSED/); assert.equal(f.calls.filter(c => c === 'sheet-first').length, 1); }
});
test('whole-source lineage preserves all preceding deadline, identity and real action assertions', () => {
  for (const eol of ['\n', '\r\n']) {
    for (const [kind, raw] of [['ui', ui], ['helper', helper]] as const) {
      const source = raw.replace(/\r?\n/g, eol);
      const peeled = pickerWait.restorePickerWait(kind, source);
      assert.notEqual(lineage.restoreWorkspaceQuery101(kind, peeled), peeled);
      assert.throws(() => lineage.restoreWorkspaceQuery101(kind, pickerWait.restorePickerWait(kind, source + eol, {requireSuccessDigest: false})));
    }
    for (const [before, after] of [['guard windowOne else{throw OwnedUI705Error.refused}', 'guard true else{throw OwnedUI705Error.refused}'], ['guard !sheetExtra else{throw OwnedUI705Error.refused}', 'guard sheetExtra else{throw OwnedUI705Error.refused}']] as const) {
      assert.equal(ui.split(before).length, 2);
      assert.throws(() => pickerWait.restorePickerWait('ui', ui.replace(before, after).replace(/\r?\n/g, eol)));
    }
    for (const [before, after] of [['guard inputHittable else', 'guard true else'], ['guard r>0,r<=45 else', 'guard r>0,r<=46 else'], ['cancel.element.click()', 'cancel.element.doubleClick()']] as const) {
      assert.equal(ui.split(before).length, 2);
      const peeled = pickerWait.restorePickerWait('ui', ui.replace(before, after).replace(/\r?\n/g, eol), {requireSuccessDigest: false});
      assert.throws(() => lineage.restoreWorkspaceQuery101('ui', peeled));
    }
  }
});
