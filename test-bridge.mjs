// Test bridge: WebSocket ↔ Chrome via AppleScript
// Connects to cmspark-agent companion, intercepts tool calls,
// executes them in Chrome via AppleScript/JXA

import { WebSocket } from "ws";
import { execSync } from "child_process";

const WS_URL = "ws://127.0.0.1:23401";
const CHROME_TAB_INDEX = 5; // bookmarks tab in window 1

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
                    repeat with w in windows
                        repeat with t in tabs of w
                            set output to output & "Window " & (index of w) & " Tab " & (index of t) & ": [" & title of t & "] (" & URL of t & ")" & "\\n"
                        end repeat
                    end repeat
                    return output
                end tell`
            );
            return { success: true, data: { tabs_text: result } };
        }

        case "get_page_text": {
            const tabIdx = params.tabId ? params.tabId : CHROME_TAB_INDEX + 1;
            const result = executeJXA(
                `(function() { 
                    var a = document.querySelectorAll("article[data-testid=tweet]");
                    if (a.length === 0) {
                        return JSON.stringify({error: "No tweets found", bodyText: (document.body?.innerText || "").substring(0, 1000)});
                    }
                    var tweets = [];
                    a.forEach(function(el, i) {
                        tweets.push({idx: i, text: el.innerText.substring(0, 500)});
                    });
                    return JSON.stringify({tweetCount: a.length, tweets: tweets});
                })()`
            );
            return { success: true, data: { text: result } };
        }

        case "scroll": {
            const amount = params.amount || params.deltaY || 500;
            const result = executeJXA(
                `(function() { window.scrollBy(0, ${amount}); return JSON.stringify({scrolled: ${amount}}); })()`
            );
            return { success: true, data: JSON.parse(result || {}) || { scrolled: amount } };
        }

        case "evaluate": {
            const result = executeJXA(params.code);
            try {
                return { success: true, data: JSON.parse(result) };
            } catch {
                return { success: true, data: { raw: result } };
            }
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
            const tabIdx = params.tabId || CHROME_TAB_INDEX + 1;
            appleScript(
                `tell application "Google Chrome"
                    set t to tab ${tabIdx} of window 1
                    set visible of t to true
                    set index of window 1 to 1
                end tell`
            );
            return { success: true, data: { message: "Tab focused. Screenshot via Chrome DevTools not available." } };
        }

        case "wait_for": {
            const timeout = params.timeout || 3000;
            await new Promise((r) => setTimeout(r, Math.min(timeout, 2000)));
            return { success: true, data: { waited: timeout } };
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
            thread_id: "test-bookmarks-002",
            message: "我现在打开了推特书签页 https://x.com/i/bookmarks。请帮我总结最近书签的10条推特内容，用中文简洁总结每条。先滚动加载更多，再提取推文。",
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

    if (msg.type === "tool.result") return; // our own result echoed

    if (msg.type === "chat.error") {
        console.log("❌ Chat error:", msg.error);
        ws.close();
        return;
    }

    if (msg.type === "chat.done") {
        console.log("✓ Chat session done");
        if (!chatCompleted) ws.close();
        return;
    }

    console.log(`← ${msg.type}:`, JSON.stringify(msg).substring(0, 200));
});

ws.on("error", (e) => console.error("WebSocket error:", e.message));
ws.on("close", () => {
    console.log("WebSocket closed");
    process.exit(0);
});

setTimeout(() => {
    if (!chatCompleted) {
        console.log("\n⏱ Timeout (120s)");
        ws.close();
        process.exit(1);
    }
}, 120000);
