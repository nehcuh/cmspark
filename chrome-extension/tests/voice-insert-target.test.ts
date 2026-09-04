import test from "node:test"
import assert from "node:assert/strict"
import {
  isEditableTarget,
  decideInsertTarget,
  PAGE_INSERT_FALLBACK_HINT,
} from "../src/sidepanel/voice/insert-target"

test("isEditableTarget: input/textarea/contenteditable only", () => {
  assert.equal(isEditableTarget({ tagName: "INPUT", isContentEditable: false }), true)
  assert.equal(isEditableTarget({ tagName: "TEXTAREA", isContentEditable: false }), true)
  assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: true }), true)
  assert.equal(isEditableTarget({ tagName: "DIV", isContentEditable: false }), false)
  assert.equal(isEditableTarget({ tagName: "BUTTON", isContentEditable: false }), false)
  assert.equal(isEditableTarget(null), false)
})

test("decideInsertTarget: page chord + editable → page; otherwise composer", () => {
  assert.equal(decideInsertTarget({ source: "page", pageEditable: true }), "page")
  assert.equal(decideInsertTarget({ source: "page", pageEditable: false }), "composer")
  assert.equal(decideInsertTarget({ source: "sidepanel", pageEditable: true }), "composer")
})

test("fallback hint copy is honest", () => {
  assert.equal(PAGE_INSERT_FALLBACK_HINT, "已插入侧栏输入框")
})
