// Source-of-truth for the browser_download ToolDefinition object (P1.0 + #au4dch DL).

export const BROWSER_DOWNLOAD_TOOL = {
  type: "function" as const,
  function: {
    name: "browser_download",
    description:
      "Click a download control on a page (CSS selector and/or visible text such as 下载 / Download ZIP) and wait until Chrome saves the file into Downloads. Prefer this over shell curl for authenticated GitHub. Concurrent downloads on the same tab are rejected (DOWNLOAD_BUSY). prefer_existing defaults true when filenameHint/urlContains set. GitHub repo ZIP: either navigate to /archive/refs/heads/main.zip then download, OR two-step UI — click text=Code (or Code 按钮) then text=\"Download ZIP\" with filenameHint like repo-main.zip. After complete, skill_install({ zip_path }) for skills. Prefer downloads_find first if the user may already have the file.",
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
      "Search completed Chrome Downloads by filenameHint and/or urlContains (read-only). Use BEFORE re-download. GitHub Code ZIP basenames are often <repo>-main.zip or <repo>-master.zip. If this tool errors or returns empty after a known download: fall back to browser_download (Code → Download ZIP) or archive URL, then skill_install({ zip_path }) — do not use shell curl by default. conflict_hint_zh when multiple size/mtime differ.",
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
