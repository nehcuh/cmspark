// Test bridge: WebSocket ↔ Chrome via AppleScript
// Connects to cmspark-agent companion, intercepts tool calls,
// executes them in Chrome via AppleScript/JXA

import { WebSocket } from "ws";
import { execSync } from "child_process";

const WS_URL = "ws://127.0.0.1:23401";
const CHROME_TAB_INDEX = 3; // bookmarks tab (0-indexed in JS, +1 for AppleScript)

function appleScript(script) {
    try {
        const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
            encoding: "utf-8",
            timeout: 15000,
        });
        return result.trim();
    } catch (e) {
        console.error("  AppleScript error:", e.stderr?.toString().substring(0, 200));
        return JSON.stringify({ success: false, error: String(e.stderr || e.message).substring(0, 500) });
    }
}

function executeJXA(code) {
    try {
        const escaped = code.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
        const script = `tell application "Google Chrome" to set r to execute tab ${CHROME_TAB_INDEX + 1} of window 1 javascript "\\"${escaped}\\""`;
        return appleScript(script);
    } catch (e) {
        return JSON.stringify({ success: false, error: String(e).substring(0, 500) });
    }
}

async function executeTool(toolName, params) {
    switch (toolName) {
        case "list_tabs": {
            const result = appleScript(
                `tell application "Google Chrome"
                    set output to ""
                    set winIdx to 0
                    repeat with w in windows
                        set winIdx to winIdx + 1
                        set tabCount to count of tabs of w
                        set tabNum to 0
                        repeat with t in tabs of w
                            set tabNum to tabNum + 1
                            set output to output & "Win" & winIdx & " Tab" & tabNum & ": [" & title of t & "] (" & URL of t & ")" & return
                        end repeat
                    end repeat
                    return output
                end tell`
            );
            return { success: true, data: { tabs_text: result } };
        }

        case "create_tab": {
            const url = params.url || "about:blank";
            appleScript(
                `tell application "Google Chrome" to make new tab at end of window 1 with properties {URL:"${url}"}`
            );
            return { success: true, data: { created: url } };
        }

        case "get_page_text": {
            const tabOffset = (params.tabId || (CHROME_TAB_INDEX + 1));
            const result = appleScript(
                `tell application "Google Chrome"
                    set r to execute tab ${tabOffset} of window 1 javascript "
(function() { 
    var a = document.querySelectorAll(\\\"article[data-testid=tweet]\\\");
    if (a.length === 0) {
        return JSON.stringify({error: \\\"No tweets found\\\", bodySample: (document.body ? document.body.innerText.substring(0, 500) : \\\"no body\\\")});
    }
    var tweets = [];
    a.forEach(function(el, i) {
        tweets.push({idx: i, text: el.innerText.substring(0, 500)});
    });
    return JSON.stringify({tweetCount: a.length, tweets: tweets, url: window.location.href, title: document.title});
})()"
                    return r
                end tell`
            );
            return { success: true, data: { text: result } };
        }

        case "scroll": {
            const amount = params.amount || params.deltaY || 800;
            const tabOffset = params.tabId || (CHROME_TAB_INDEX + 1);
            appleScript(
                `tell application "Google Chrome"
                    execute tab ${tabOffset} of window 1 javascript "window.scrollBy(0, ${amount})"
                end tell`
            );
            return { success: true, data: { scrolled: amount } };
        }

        case "evaluate": {
            const tabOffset = params.tabId || (CHROME_TAB_INDEX + 1);
            const escapedCode = params.code.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
            const result = appleScript(
                `tell application "Google Chrome"
                    set r to execute tab ${tabOffset} of window 1 javascript "${escapedCode}"
                    return r
                end tell`
            );
            try { return { success: true, data: JSON.parse(result) }; }
            catch { return { success: true, data: { raw: result } }; }
        }

        case "navigate": {
            if (params.tabId) {
                appleScript(
                    `tell application "Google Chrome" to set URL of tab ${params.tabId} of window 1 to "${params.url}"`
                );
            }
            return { success: true, data: { navigated: params.url } };
        }

        case "screenshot": {
            const tabIdx = params.tabId || (CHROME_TAB_INDEX + 1);
            appleScript(
                `tell application "Google Chrome"
                    set t to tab ${tabIdx} of window 1
                    set index of t to 1
                end tell`
            );
            return { success: true, data: { message: "Tab activated. Screenshot not available via AppleScript." } };
        }

        case "wait_for": {
            const timeout = Math.min(params.timeout || 2000, 2000);
            await new Promise((r) => setTimeout(r, timeout));
            return { success: true, data: { waited: timeout } };
        }

        case "click": {
            const tabOffset = params.tabId || (CHROME_TAB_INDEX + 1);
            appleScript(
                `tell application "Google Chrome"
                    execute tab ${tabOffset} of window 1 javascript "document.querySelector('${params.selector}').click()"
                end tell`
            );
            return { success: true, data: { clicked: params.selector } };
        }

        default:
            return { success: false, error: `Tool "${toolName}" not implemented in bridge` };
    }
}

// ---- Main ----
const ws = new WebSocket(WS_URL);
let chatCompleted = false;

ws.on("open", () => {
    console.log("→ Connected to companion");
    ws.send(
        JSON.stringify({
            type: "chat.create",
            thread_id: "test-bookmarks-003",
            message: "帮我看推特书签页的内容。先滚动加载更多推文（scroll再wait），然后提取推文内容，最后用中文简洁总结最近10条推文的核心内容。",
            skill_ids: ["browse"],
        })
    );
    console.log("→ Sent chat.create");
});

ws.on("message", async (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === "connected" || msg.type === "chat.token") return;

    if (msg.type === "chat.stream") {
        process.stdout.write(msg.content || "");
        if (msg.done) {
            console.log("\n\n✓ Chat complete");
            chatCompleted = true;
            ws.close();
        }
        return;
    }

    if (msg.type === "tool.execute") {
        console.log(`\n🔧 ${msg.tool_name}(${JSON.stringify(msg.params).substring(0, 150)})`);
        const result = await executeTool(msg.tool_name, msg.params || {});
        console.log(`   → ${JSON.stringify(result).substring(0, 200)}`);
        ws.send(
            JSON.stringify({
                type: "tool.result",
                tool_call_id: msg.tool_call_id,
                result,
            })
        );
        return;
    }

    if (msg.type === "tool.result") return;
    if (msg.type === "chat.error") { console.log("❌ Chat error:", msg.error); ws.close(); return; }
    if (msg.type === "chat.done") { console.log("✓ Chat session done"); if (!chatCompleted) ws.close(); return; }
    console.log(`← ${msg.type}:`, JSON.stringify(msg).substring(0, 200));
});

ws.on("error", (e) => console.error("WebSocket error:", e.message));
ws.on("close", () => { console.log("WebSocket closed"); process.exit(0); });

setTimeout(() => { if (!chatCompleted) { console.log("\n⏱ Timeout (120s)"); ws.close(); process.exit(1); } }, 120000);
