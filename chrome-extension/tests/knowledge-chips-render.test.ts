import test from "node:test"
import assert from "node:assert/strict"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

// #273 Wave B（Gate9 MAJOR-1 / AC-18）：「本轮附带」芯片真实渲染断言
// （renderToStaticMarkup，不是 grep 字符串）。口径：N=|S_post|、M=|S_pre|。

import { RetrievedSourcesChips } from "../src/sidepanel/components/RetrievedSourcesChips"

const SOURCES = [
  { id: "fa1", title: "退款政策", group_label: "policy" },
  { id: "fa2", title: "退款 FAQ", group_label: "policy" },
  { id: "fa3", title: "售后流程" },
  { id: "fa6", title: "退回物流" },
]

function render(routing?: { groupmap: "injected" | "omitted"; m: number }) {
  return renderToStaticMarkup(createElement(RetrievedSourcesChips, { sources: SOURCES, routing }))
}

test("N/M 口径真渲染：路由轮显示 N/M，非路由轮只显示 N", () => {
  const html = render({ groupmap: "omitted", m: 6 })
  assert.ok(html.includes("本轮附带 4/6"), `N=4、M=6 必须渲染出来: ${html.slice(0, 200)}`)
  const plain = renderToStaticMarkup(createElement(RetrievedSourcesChips, { sources: SOURCES.slice(0, 2) }))
  assert.ok(plain.includes("本轮附带 2<"), "无 knowledge_routing 时只显示 N")
  assert.ok(!/本轮附带 2\//.test(plain), "无路由元数据时不出现 /M")
})

test("group_label 与分组概览两态标注真渲染", () => {
  const html = render({ groupmap: "injected", m: 6 })
  assert.ok(html.includes("（policy）"), "来源分组标签渲染")
  assert.ok(html.includes("来源分组"), "tooltip 词渲染进 title 属性")
  assert.ok(html.includes("含分组概览"), "injected 态标注")
  const omitted = render({ groupmap: "omitted", m: 6 })
  assert.ok(omitted.includes("未含分组概览"), "omitted 态标注（groupmap_omitted 可识别）")
})

test("空来源不渲染容器", () => {
  const html = renderToStaticMarkup(createElement(RetrievedSourcesChips, { sources: [] }))
  assert.equal(html, "")
})
