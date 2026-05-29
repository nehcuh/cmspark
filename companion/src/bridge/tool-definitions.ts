// Tool definitions in OpenAI function-calling format

export function getToolDefinitions(): any[] {
  return [
    // --- Tab tools ---
    {
      type: "function",
      function: {
        name: "list_tabs",
        description: "列出浏览器所有标签页",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    {
      type: "function",
      function: {
        name: "create_tab",
        description: "打开新标签页",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "要打开的 URL" },
            active: { type: "boolean", description: "是否激活新标签页，默认 true" },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "close_tab",
        description: "关闭标签页",
        parameters: {
          type: "object",
          properties: { tabId: { type: "number", description: "标签页 ID" } },
          required: ["tabId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "navigate",
        description: "标签页导航到指定 URL",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            url: { type: "string", description: "目标 URL" },
          },
          required: ["tabId", "url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "screenshot",
        description: "截取标签页截图，返回 base64 图片",
        parameters: {
          type: "object",
          properties: { tabId: { type: "number", description: "标签页 ID（可选，默认活跃标签页）" } },
          required: [],
        },
      },
    },

    // --- Page read tools ---
    {
      type: "function",
      function: {
        name: "get_page_text",
        description: "提取页面可见文本内容",
        parameters: {
          type: "object",
          properties: { tabId: { type: "number", description: "标签页 ID" } },
          required: ["tabId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_page_html",
        description: "获取页面 HTML 内容，可选 CSS 选择器范围",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            selector: { type: "string", description: "CSS 选择器（可选）" },
          },
          required: ["tabId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_element_info",
        description: "获取元素位置、可见性和文本信息",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            selector: { type: "string", description: "CSS 选择器" },
          },
          required: ["tabId", "selector"],
        },
      },
    },

    // --- Page interaction tools ---
    {
      type: "function",
      function: {
        name: "click",
        description: "点击页面元素",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            selector: { type: "string", description: "CSS 选择器" },
          },
          required: ["tabId", "selector"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "dblclick",
        description: "双击页面元素",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            selector: { type: "string", description: "CSS 选择器" },
          },
          required: ["tabId", "selector"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "type",
        description: "在输入框中输入文本",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            selector: { type: "string", description: "CSS 选择器（可选，不填则输入到当前焦点元素）" },
            value: { type: "string", description: "要输入的文本" },
          },
          required: ["tabId", "value"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fill_form",
        description: "批量填写表单字段",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number", description: "标签页 ID" },
            fields: {
              type: "array",
              description: "字段列表",
              items: {
                type: "object",
                properties: {
                  selector: { type: "string" },
                  value: { type: "string" },
                  clear_first: { type: "boolean", description: "是否先清空，默认 true" },
                },
                required: ["selector", "value"],
              },
            },
          },
          required: ["tabId", "fields"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "scroll",
        description: "滚动页面",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            deltaX: { type: "number", description: "水平滚动量" },
            deltaY: { type: "number", description: "垂直滚动量" },
            amount: { type: "number", description: "垂直滚动量（别名）" },
          },
          required: ["tabId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "press_key",
        description: "发送键盘按键",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            key: { type: "string", description: "按键名称" },
            modifiers: { type: "number", description: "修饰键位掩码: Alt=1, Ctrl=2, Shift=4, Meta=8" },
          },
          required: ["tabId", "key"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "hover",
        description: "鼠标悬停在元素上",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            selector: { type: "string" },
          },
          required: ["tabId", "selector"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "select_option",
        description: "选择下拉框选项",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            selector: { type: "string", description: "select 元素的 CSS 选择器" },
            value: { type: "string", description: "选项值" },
          },
          required: ["tabId", "selector", "value"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "drag_and_drop",
        description: "拖拽元素",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            from_selector: { type: "string" },
            to_selector: { type: "string" },
          },
          required: ["tabId", "from_selector", "to_selector"],
        },
      },
    },

    // --- Advanced tools ---
    {
      type: "function",
      function: {
        name: "wait_for",
        description: "等待条件满足（选择器出现/消失或网络空闲）",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            selector: { type: "string", description: "等待的 CSS 选择器" },
            state: { type: "string", enum: ["visible", "hidden"], description: "等待出现还是消失，默认 visible" },
            timeout: { type: "number", description: "超时毫秒数，默认 15000" },
            network_idle: { type: "boolean", description: "等待网络空闲" },
          },
          required: ["tabId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "evaluate",
        description: "在页面中执行 JavaScript 代码并返回结果",
        parameters: {
          type: "object",
          properties: {
            tabId: { type: "number" },
            code: { type: "string", description: "要执行的 JavaScript 代码" },
            await_promise: { type: "boolean", description: "是否等待 Promise 完成，默认 true" },
          },
          required: ["tabId", "code"],
        },
      },
    },

    // --- Cookie tools ---
    {
      type: "function",
      function: {
        name: "get_cookies",
        description: "读取指定域的 cookie",
        parameters: {
          type: "object",
          properties: { domain: { type: "string", description: "域名" } },
          required: ["domain"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "set_cookie",
        description: "设置 cookie",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string" },
            name: { type: "string" },
            value: { type: "string" },
            domain: { type: "string" },
            path: { type: "string" },
            secure: { type: "boolean" },
            httpOnly: { type: "boolean" },
            expirationDate: { type: "number" },
          },
          required: ["url", "name", "value"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_cookie",
        description: "删除 cookie",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string" },
            name: { type: "string" },
          },
          required: ["url", "name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_all_cookies",
        description: "列出浏览器所有 cookie",
        parameters: { type: "object", properties: {}, required: [] },
      },
    },
    // --- Companion direct tools (no extension needed) ---
    {
      type: "function",
      function: {
        name: "use_skill",
        description: "Load the full instructions of a skill by name. Skills provide step-by-step workflows for specific tasks. Call this ONLY when a skill's name or description matches the user's task — do NOT pre-load all skills.",
        parameters: {
          type: "object",
          properties: {
            name: { type: "string", description: "Skill name to load" },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "osascript_eval",
        description: "(macOS ONLY — does NOT work on Windows/Linux) Execute JavaScript in a Chrome tab via AppleScript. Only use this as a LAST RESORT when both get_page_text and evaluate fail on restricted pages (e.g. X.com with strict CSP). Prefer get_page_text for reading page content.",
        parameters: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL fragment to match the Chrome tab (e.g. 'zhihu.com' matches 'https://www.zhihu.com/hot')" },
            expression: { type: "string", description: "JavaScript expression to execute in the page context" },
          },
          required: ["url", "expression"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "record_experience",
        description: "记录一条操作经验。当用户说'记住这个'或'记录下这条经验'时调用。将经验保存到站点知识库(site_knowledge)或业务域知识库(domain_knowledge)，下次操作该站点时会自动注入。",
        parameters: {
          type: "object",
          properties: {
            target: { type: "string", enum: ["site", "domain"], description: "site=保存到当前站点知识库，domain=保存到全局业务知识库" },
            skill_name: { type: "string", description: "目标 knowledge skill 名称。site 类型时自动从当前 URL 生成（可通过 list_tabs 获取），domain 类型时需指定" },
            category: { type: "string", enum: ["problem", "success", "tip", "rule"], description: "经验类别" },
            content: { type: "string", description: "经验内容，简洁的一句话" },
            tags: { type: "array", items: { type: "string" }, description: "仅 domain_knowledge 类型使用，用于语义匹配" },
          },
          required: ["target", "category", "content"],
        },
      },
    },
  ]
}
