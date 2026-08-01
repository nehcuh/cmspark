// Source-of-truth for the browser_download ToolDefinition object (P1.0 + #au4dch DL).

export const BROWSER_DOWNLOAD_TOOL = {
  type: "function" as const,
  function: {
    name: "browser_download",
    description:
      "Click a download control on a page (CSS selector and/or visible text such as 下载) and wait until the browser finishes saving the file into the user Downloads folder (or a sandboxed subpath). Prefer this over osascript_eval / shell curl for authenticated downloads. Returns absolute path, filename, and bytes. Concurrent downloads on the same tab are rejected (DOWNLOAD_BUSY). When filenameHint (or urlContains) is set, prefer_existing defaults to true: reuses an already-complete chrome.downloads item under Downloads instead of clicking (set force_redownload=true to force a new download). Cache match is by filename/url substring (newest first) — verify the returned url domain before trusting the file; prefer urlContains when the expected host is known. Prefer calling downloads_find first when the user may already have the file.",
    parameters: {
      type: "object",
      properties: {
        tabId: { type: "number", description: "Tab id (required)" },
        selector: {
          type: "string",
          description: "CSS selector for the download control (provide selector and/or text)",
        },
        text: {
          type: "string",
          description:
            "Visible text substring to locate the control (e.g. 下载). exact=false by default (contains).",
        },
        exact: {
          type: "boolean",
          description: "When true, text must match exactly (trimmed). Default false (contains).",
        },
        downloadPath: {
          type: "string",
          description:
            "Optional destination directory. Default: user Downloads. Must stay inside Downloads (P1.0).",
        },
        filenameHint: {
          type: "string",
          description:
            "Filename substring to match completed download (also used for prefer_existing cache).",
        },
        urlContains: {
          type: "string",
          description: "Optional URL substring for prefer_existing / matching completed items",
        },
        prefer_existing: {
          type: "boolean",
          description:
            "If true (default when filenameHint/urlContains set), return existing complete download without clicking. Set false or force_redownload to always click.",
        },
        force_redownload: {
          type: "boolean",
          description: "If true, skip cache and always click/wait for a new download",
        },
        timeoutMs: {
          type: "number",
          description: "Wait for complete (default 60000, max 120000)",
        },
      },
      required: ["tabId"] as string[],
    },
  },
}

/** #au4dch DL-1 — read-only find before download. */
export const DOWNLOADS_FIND_TOOL = {
  type: "function" as const,
  function: {
    name: "downloads_find",
    description:
      "Search the browser's completed Downloads for an existing file by filenameHint and/or urlContains. Use BEFORE browser_download or shell curl when the user may already have the package (e.g. release tar.gz). Returns paths of complete existing items only (read-only).",
    parameters: {
      type: "object",
      properties: {
        filenameHint: {
          type: "string",
          description: "Substring of filename or full path (e.g. black-cat-v1.1.0.tar.gz)",
        },
        urlContains: {
          type: "string",
          description: "Optional substring of the download URL",
        },
        limit: {
          type: "number",
          description: "Max matches (default 5, max 20)",
        },
      },
      required: [] as string[],
    },
  },
}
