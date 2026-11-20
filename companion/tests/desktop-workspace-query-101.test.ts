import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const lineage = require(path.resolve('scripts/tests/workspace-query-101-inverse.cjs'));
const pickerWait = require(path.resolve('scripts/tests/picker-wait-inverse.cjs'));

const ui = fs.readFileSync(path.resolve('tests/fixtures/workspace-ui-705/WorkspacePickerUITests.swift'), 'utf8');
const helper = fs.readFileSync(path.resolve('tests/helpers/workspace-xctest-owned-705.ts'), 'utf8');
// Project the actual Swift query statements. This controls query semantics; it
// does not execute XCTest or claim a native performance measurement.
function sheetQuery({windows = 1, windowSeen = true, sheets = 1, exists = true, stage = 3} = {}) {
  const start = ui.indexOf('func sheet(_ stage:Int) throws ->XCUIElement {');
  const end = ui.indexOf('\n  }\n  uiStage=2;', start);
  assert(start >= 0 && end > start);
  let body = ui.slice(ui.indexOf('{', start) + 1, end);
  for (const [before, after, times] of [
    ['matching(identifier:scene.nonce)', 'matching({identifier:scene.nonce})', 2],
    ['element(boundBy:0)', 'element({boundBy:0})', 2],
    ['min(windowCount,2)', 'Math.min(windowCount,2)', 2],
    ['waitForExistence(timeout:windowTimeout)', 'waitForExistence({timeout:windowTimeout})', 2],
    ['waitForExistence(timeout:try remaining())', 'waitForExistence({timeout:remaining()})', 2],
    ['min(sheetCount,2)', 'Math.min(sheetCount,2)', 2],
    ['guard windowOne else{throw OwnedUI705Error.refused}', "if(!windowOne){throw Error('REFUSED')}", 2],
    ['guard windowCount==1 else{throw OwnedUI705Error.refused}', "if(windowCount!==1){throw Error('REFUSED')}", 2],
    ['guard exists else{throw OwnedUI705Error.refused}', "if(!exists){throw Error('REFUSED')}", 2],
    ['guard sheetCount==1 else{throw OwnedUI705Error.refused}', "if(sheetCount!==1){throw Error('REFUSED')}", 2],
  ] as [string, string, number][]) { assert.equal(body.split(before).length, times, before); body = body.replaceAll(before, after); }
  assert.equal(body.split('try remaining()').length, 2); body = body.replaceAll('try remaining()', 'remaining()');
  body = body.replaceAll('let ', 'const ');
  assert.doesNotMatch(body, /\bguard\b|\btry\b|OwnedUI705Error/);
  assert.equal(ui.split('let w=windows.firstMatch').length, 2);
  assert.equal(ui.split('w.sheets.firstMatch.waitForExistence').length, 2);
  assert.equal(ui.split('return w.sheets.firstMatch').length, 2);
  const calls: string[] = [];
  const returned = {id: 'sheet'};
  const sheet = {
    get count() { calls.push('sheet-count'); return sheets; },
    get firstMatch() { calls.push('sheet-first'); return {waitForExistence({timeout}: {timeout: number}) { calls.push('wait'); assert.equal(timeout, 2); return exists; }, id: 'exists'}; },
  };
  const window = {sheets: sheet};
  const query = {
    get count() { calls.push('window-count'); return windows; },
    element({boundBy}: {boundBy: number}) {
      assert.equal(boundBy, 0); calls.push('window-one');
      return {waitForExistence({timeout}: {timeout: number}) {
        calls.push('window-one-wait'); assert.equal(timeout, 2); return windowSeen;
      }};
    },
    get firstMatch() { calls.push('window-first'); return window; },
  };
  const scope = {stage, scene: {nonce: 'INERT'}, app: {windows: {matching({identifier}: {identifier: string}) { assert.equal(identifier, 'INERT'); return query; }}}, remaining() { calls.push('remaining'); return 2; }, observeUIStage() {}};
  return {calls, returned, run: () => vm.runInNewContext('(function(){let uiStage=0,uiDetail=0;' + body + ';return w.sheets.firstMatch;})()', scope)};
}
const SHEET_BOTH = 'uiStage=stage+2;uiDetail=0;observeUIStage();let sheetCount=w.sheets.count;uiDetail=min(sheetCount,2)+1;observeUIStage();guard sheetCount==1 else{throw OwnedUI705Error.refused};return w.sheets.firstMatch';
const UI_RESTORED = '2eca9be781a3c401b6d96bf8cba6b41f9c8fe32f9be5052be094d0ae27c972b8';
const HELPER_RESTORED = '56cb1183b0e057b879d11567424c5b325362e7dbfd373edeca4faa5dd73751e5';
const PRIOR_UI_COMMENT = 'fb446e0d2b32e5a55e05a03e369fa5635b98448513a59fe9ea91bd098590b076';
const CURRENT_UI = 'cae70de5964a0bdd3b7d1e460385188584a2b09729f91a5a079fb86b9017d2a9';
test('stage 15 still refuses a second sheet', () => {
  const second = sheetQuery({stage: 15, sheets: 2});
  assert.throws(second.run, /REFUSED/);
  assert.deepEqual(second.calls, ['remaining', 'window-one', 'window-one-wait', 'window-count', 'window-first', 'sheet-first', 'remaining', 'wait', 'sheet-count']);
  const first = sheetQuery({stage: 3, sheets: 2});
  assert.throws(first.run, /REFUSED/);
  assert.equal(first.calls.includes('sheet-count'), true);
});
test('sheet sentence peels once before the old digests', () => {
  assert.equal(ui.split(SHEET_BOTH).length, 2);
  assert.equal(ui.includes('if stage != 15'), false);
  assert.equal(ui.split('uiStage=18;uiDetail=0;observeUIStage();let cancelOne=').length, 2);
  assert.equal(ui.split('uiStage=19;uiDetail=0;observeUIStage();let cancelHittable=').length, 2);
  assert.equal(ui.split('uiStage=20;uiDetail=0;observeUIStage();_ = try remaining();cancel.element.click()').length, 2);
  assert.throws(() => pickerWait.restorePickerWait('ui', ui.replace(SHEET_BOTH, '')), (error: Error) => error.message.includes('PICKER_WAIT_UI_ONCE') && !error.message.includes(UI_RESTORED));
  assert.equal(createHash('sha256').update(pickerWait.restorePickerWait('ui', ui)).digest('hex'), UI_RESTORED);
  const quoted = helper.slice(helper.indexOf(`/*OBS788_VALUE:${PRIOR_UI_COMMENT}*/'`) + `/*OBS788_VALUE:${PRIOR_UI_COMMENT}*/'`.length, helper.indexOf(`/*OBS788_VALUE:${PRIOR_UI_COMMENT}*/'`) + `/*OBS788_VALUE:${PRIOR_UI_COMMENT}*/'`.length + 64);
  assert.equal(quoted, CURRENT_UI);
  assert.equal(pickerWait.NEW_DIGEST, CURRENT_UI);
  assert.equal(createHash('sha256').update(ui).digest('hex'), CURRENT_UI);
  assert.equal(helper.split(PRIOR_UI_COMMENT).length, 2);
  assert.equal(createHash('sha256').update(pickerWait.restorePickerWait('helper', helper)).digest('hex'), HELPER_RESTORED);
  assert.throws(() => pickerWait.restorePickerWait('helper', helper.replace(pickerWait.NEW_DIGEST, pickerWait.NEW_DIGEST + pickerWait.NEW_DIGEST)), (error: Error) => error.message.includes('PICKER_WAIT_HELPER_DIGEST_ONCE'));
});
test('actual owner query keeps uniqueness and existence guards before returning a sheet', () => {
  const current = sheetQuery();
  assert.equal(current.run().id, 'exists');
  assert.deepEqual(current.calls, ['remaining', 'window-one', 'window-one-wait', 'window-count', 'window-first', 'sheet-first', 'remaining', 'wait', 'sheet-count', 'sheet-first']);
  const none = sheetQuery({windows: 0, windowSeen: false}); assert.throws(none.run, /REFUSED/); assert.deepEqual(none.calls, ['remaining', 'window-one', 'window-one-wait']);
  const extra = sheetQuery({windows: 2}); assert.throws(extra.run, /REFUSED/); assert.deepEqual(extra.calls, ['remaining', 'window-one', 'window-one-wait', 'window-count']);
  const vanished = sheetQuery({windows: 0, windowSeen: true}); assert.throws(vanished.run, /REFUSED/); assert.equal(vanished.calls.at(-1), 'window-count');
  const absent = sheetQuery({exists: false}); assert.throws(absent.run, /REFUSED/); assert.equal(absent.calls.includes('sheet-count'), false);
  for (const sheets of [0, 2]) { const f = sheetQuery({sheets}); assert.throws(f.run, /REFUSED/); assert.equal(f.calls.filter(c => c === 'sheet-first').length, 1); }
});
test('whole-source lineage preserves all preceding deadline, identity and real action assertions', () => {
  for (const eol of ['\n', '\r\n']) {
    for (const [kind, raw] of [['ui', ui], ['helper', helper]] as const) {
      const source = raw.replace(/\r?\n/g, eol);
      const peeled = pickerWait.restorePickerWait(kind, source);
      assert.notEqual(lineage.restoreWorkspaceQuery101(kind, peeled), peeled);
      assert.throws(() => lineage.restoreWorkspaceQuery101(kind, pickerWait.restorePickerWait(kind, source + eol, {requireSuccessDigest: false})), (error: Error) => kind !== 'helper' || error.message.includes('QUERY101_COMPLETE_CURRENT_SOURCE'));
    }
    for (const [before, after] of [['guard windowOne else{throw OwnedUI705Error.refused}', 'guard true else{throw OwnedUI705Error.refused}'], ['guard sheetCount==1 else{throw OwnedUI705Error.refused}', 'guard sheetCount>=1 else{throw OwnedUI705Error.refused}'], ['guard cancelCount==1 else{throw OwnedUI705Error.refused}', 'guard cancelCount>=1 else{throw OwnedUI705Error.refused}']] as const) {
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
