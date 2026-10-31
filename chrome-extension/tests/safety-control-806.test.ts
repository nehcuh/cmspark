import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { renderToStaticMarkup } from "react-dom/server"
import * as jsxRuntime from "react/jsx-runtime"

const file = path.resolve(__dirname, "../../src/sidepanel/components/SettingsSlideout.tsx")
const source = fs.readFileSync(file, "utf8")
const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)

test("security entry explains unavailable controls without presenting fictitious toggles", () => {
  const matches: ts.JsxElement[] = []
  function walk(node: ts.Node): void {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(sf) === "div" &&
        node.children.some(child => ts.isJsxElement(child) && child.getText(sf) === '<div style={styles.label}>安全保护</div>')) matches.push(node)
    ts.forEachChild(node, walk)
  }
  walk(sf)
  assert.equal(matches.length, 1)
  const script = ts.transpileModule(`globalThis.render=()=>(${matches[0].getText(sf)})`, {
    fileName: "owned.tsx", compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const context: any = { exports: {}, styles: { field: {}, label: {}, helpText: {} }, require(name: string) {
    assert.equal(name, "react/jsx-runtime")
    return jsxRuntime
  } }
  vm.runInNewContext(script, context, { timeout: 1000 })
  const html = renderToStaticMarkup(context.render())
  assert.match(html, /安全技能目前不能在此单独开关/)
  assert.match(html, /安全检查和操作确认仍按配置与权限规则执行/)
  assert.doesNotMatch(html, /<(?:input|button|select)\b/i)
  assert.doesNotMatch(source, /toggleSafetySkill|cookie_guard|eval_guard|nav_guard|input_guard/)
})
