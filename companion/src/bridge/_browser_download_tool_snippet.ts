// Source-of-truth for the browser_download ToolDefinition object (P1.0).

export const BROWSER_DOWNLOAD_TOOL = {
  type: "function" as const,
  function: {
    name: "browser_download",
    description:
      "Click a download control on a page (CSS selector and/or visible text such as 下载) and wait until the browser finishes saving the file into the user Downloads folder (or a sandboxed subpath). Prefer this over osascript_eval / shell curl for authenticated downloads. Returns absolute path, filename, and bytes. Concurrent downloads on the same tab are rejected (DOWNLOAD_BUSY).",
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
          description: "Optional filename substring to match the completed download item",
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
