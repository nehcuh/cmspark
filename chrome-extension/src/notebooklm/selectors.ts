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
  // Bug fix: NotebookLM UI changed — old `.add-source-button` class may be gone.
  // Cast a wider net: Material fab, button with add icon, button with "add" text.
  css: [
    ".add-source-button",
    'button[aria-label*="Add source"]',
    'button[aria-label*="添加来源"]',
    'button[aria-label*="Add"]',
    'button[aria-label*="添加"]',
    "button.mat-fab",
    "button.mdc-fab",
    ".mat-mdc-fab",
    'button[color="primary"]',
  ],
  textContent: ["Add source", "Add sources", "Add", "添加来源", "添加", "新增来源", "新增"],
  ariaLabel: ["Add source", "Add sources", "Add", "添加来源", "添加", "新增来源"],
}

const dialogContainer: SelectorStrategy = {
  key: "dialogContainer",
  css: ["mat-dialog-container", ".mat-mdc-dialog-container", '[role="dialog"]'],
}

const websiteLinkOption: SelectorStrategy = {
  key: "websiteLinkOption",
  // Bug fix: NotebookLM UI changed — old .drop-zone-icon-button may be gone.
  // Cast wider net: any clickable element whose text/aria mentions link/website/url.
  css: [
    ".drop-zone-icon-button",
    "button[aria-label*='Website']",
    "button[aria-label*='Link']",
    "button[aria-label*='网站']",
    "button[aria-label*='链接']",
    "[role='button'][aria-label*='Website']",
    "[role='button'][aria-label*='Link']",
  ],
  textContent: ["Website", "网站", "Link", "URL", "链接", "Paste any link", "粘贴任何链接", "网址"],
  ariaLabel: ["Website", "网站", "Link", "URL", "链接", "Paste any link", "粘贴任何链接", "网址"],
}

const copiedTextOption: SelectorStrategy = {
  key: "copiedTextOption",
  css: [
    ".drop-zone-icon-button",
    "button[aria-label*='Copied text']",
    "button[aria-label*='Text']",
    "button[aria-label*='复制的文字']",
    "button[aria-label*='文字']",
    "[role='button'][aria-label*='Copied text']",
    "[role='button'][aria-label*='Text']",
  ],
  textContent: ["Copied text", "复制的文字", "Text", "Paste text", "粘贴文字", "在此处粘贴文字", "文字"],
  ariaLabel: ["Copied text", "复制的文字", "Text", "Paste text", "粘贴文字", "文字"],
}

const urlInput: SelectorStrategy = {
  key: "urlInput",
  // Bug fix: also accept <input> (not just textarea) + broader placeholders.
  css: [
    ".urls-input-container textarea",
    ".urls-input-container input",
    "textarea[placeholder*='Paste']",
    "textarea[placeholder*='粘贴']",
    "input[placeholder*='Paste']",
    "input[placeholder*='粘贴']",
    "input[type='url']",
    "input[type='text']",
  ],
  ariaLabel: ["URL", "Website", "Link", "网址", "链接"],
}

const textInput: SelectorStrategy = {
  key: "textInput",
  css: [
    ".copied-text-input-textarea",
    "textarea[placeholder*='Paste text']",
    "textarea[placeholder*='粘贴文字']",
    "textarea[placeholder*='在此处粘贴']",
    "textarea",
  ],
  ariaLabel: ["Text", "Paste text", "文字", "粘贴文字"],
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
