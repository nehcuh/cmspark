// Selector registry for driving the NotebookLM UI.
//
// Sourced from jetpack's lib/selectors.ts (verified working as of 2026-07) plus
// Web Importer's lib/config.ts. Every entry has multiple strategies so a single
// class rename or text change doesn't break us.
//
// Maintenance contract: when NotebookLM updates and one of these breaks, ADD a
// new strategy to the array (don't replace) so we keep backwards-compat. Surface
// the failure to the user via the import report's error field.

import type { SelectorRegistry, SelectorStrategy } from "./types"

const addSourceButton: SelectorStrategy = {
  key: "addSourceButton",
  css: [".add-source-button", 'button[aria-label*="Add source"]', 'button[aria-label*="添加来源"]'],
  textContent: ["Add source", "添加来源"],
  ariaLabel: ["Add source", "添加来源"],
}

const dialogContainer: SelectorStrategy = {
  key: "dialogContainer",
  css: ["mat-dialog-container", ".mat-mdc-dialog-container", '[role="dialog"]'],
}

const websiteLinkOption: SelectorStrategy = {
  key: "websiteLinkOption",
  // .drop-zone-icon-button whose inner <img> has text/icon matching "link"
  css: [".drop-zone-icon-button"],
  textContent: ["Website", "网站", "Link", "Paste any link", "粘贴任何链接"],
}

const copiedTextOption: SelectorStrategy = {
  key: "copiedTextOption",
  css: [".drop-zone-icon-button"],
  textContent: ["Copied text", "复制的文字", "Text", "Paste text here", "在此处粘贴文字"],
}

const urlInput: SelectorStrategy = {
  key: "urlInput",
  css: [".urls-input-container textarea", "textarea[placeholder*='Paste any link']", "textarea[placeholder*='粘贴任何链接']"],
}

const textInput: SelectorStrategy = {
  key: "textInput",
  css: [".copied-text-input-textarea", "textarea[placeholder*='Paste text here']", "textarea[placeholder*='在此处粘贴文字']"],
}

const submitButton: SelectorStrategy = {
  key: "submitButton",
  css: ["mat-dialog-container .submit-button", ".submit-button", 'button[type="submit"]'],
  textContent: ["Insert", "插入", "Add", "添加", "Save", "保存"],
}

const backButton: SelectorStrategy = {
  key: "backButton",
  css: ['.mat-mdc-dialog-container button[aria-label="Back"]', "button.back-button"],
  textContent: ["Back", "返回"],
  ariaLabel: ["Back", "返回"],
}

const sourceRow: SelectorStrategy = {
  key: "sourceRow",
  css: [".single-source-container", ".source-row", "[data-source-id]"],
}

const sourceTitle: SelectorStrategy = {
  key: "sourceTitle",
  css: [".source-title", ".source-title-column"],
}

export const SELECTORS: SelectorRegistry = {
  addSourceButton,
  dialogContainer,
  websiteLinkOption,
  copiedTextOption,
  urlInput,
  textInput,
  submitButton,
  backButton,
  sourceRow,
  sourceTitle,
}
