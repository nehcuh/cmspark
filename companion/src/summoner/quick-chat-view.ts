import { readFileSync } from "node:fs"
import { join } from "node:path"
import { getAssetsDir } from "../paths"

const paths = {
  history: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  compose: '<path d="M12 5H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6M15.5 5.5l3 3M10 15l3.5-.8L21 6.7a1.7 1.7 0 0 0-3-3l-7.5 7.5z"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  tasks: '<rect x="4" y="4.5" width="16" height="16" rx="3"/><path d="m8 12 2.5 2.5 5.5-6"/>',
  notes: '<path d="M6 3.5h8l4 4v13H6zM13.5 3.5V8H18M9 12h6M9 15.5h4"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/>',
  folder: '<path d="M3.5 7V5.5a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1V18a1.5 1.5 0 0 1-1.5 1.5H5A1.5 1.5 0 0 1 3.5 18z"/>',
  controls: '<path d="M4 8h4m5 0h7M4 16h9m5 0h2"/><circle cx="10.5" cy="8" r="2.5"/><circle cx="15.5" cy="16" r="2.5"/>',
  pin: '<path d="m8 3 9 0-2 3v5l3 3v1H6v-1l3-3V6zM12 15v6"/>',
  resize: '<path d="M14 4h6v6M20 4l-7 7M10 20H4v-6m0 6 7-7"/>',
  down: '<path d="M12 4v15m-6-6 6 6 6-6"/>',
} as const

export function chatIcon(name: keyof typeof paths): string {
  return `<svg class="chat-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`
}

// The installed desktop icon is shared with the installer. The wordmark also
// works in distributions that omit optional desktop artwork.
function desktopIcon(): string {
  try {
    const png = readFileSync(join(getAssetsDir(), "cmspark.png"))
    return `url("data:image/png;base64,${png.toString("base64")}")`
  } catch {
    return "none"
  }
}

export const QUICK_CHAT_CSS = `
:root {
  --app-icon:${desktopIcon()};
  --desk:#f8f8f4; --paper:#fff; --canvas:#eeefea; --rail-bg:#efefea;
  --text:#202922; --secondary:#45534b; --faint:#58665d; --line:#d8ddd5;
  --tint:#e5efe6; --accent:#266249; --accent-ink:#fff; --keyline:#688571;
  --press:#dae6dc; --menu-shadow:0 12px 32px rgba(36,49,38,.13),0 2px 6px rgba(36,49,38,.06);
  --inset:clamp(16px,4vw,28px);
}
@media(prefers-color-scheme:dark){
  :root{color-scheme:dark;--desk:#1b211f;--paper:#252d29;--canvas:#2f3932;--rail-bg:#19201c;
    --text:#eef2e9;--secondary:#ccd6cc;--faint:#a6b6aa;--line:#414c44;--tint:#2c4035;
    --accent:#a6d9b9;--accent-ink:#17291d;--keyline:#718d79;--press:#344b3c;
    --indigo:#c0baff;--indigo-soft:#37364a;--menu-shadow:0 12px 32px rgba(0,0,0,.32)}
  #attachSilent,#openConfirm,.privacy-sheet .cta-actions button,#meetingRec{background:var(--indigo);color:#211e32}
  .cta-box,.privacy-sheet{background:var(--canvas);color:var(--text)}
  .rail-btn[aria-current="true"],.item.active{background:var(--canvas);color:var(--text)}
}
body,.hud,.main,.composer{background:var(--desk)}
.main{position:relative}
.brand{padding:10px var(--inset);min-height:64px;flex-wrap:nowrap;gap:12px;border-bottom:1px solid var(--line);background:var(--desk)}
.brand-identity{display:flex;align-items:center;min-width:0;flex:1;gap:10px}
.brand-identity::before{content:"";width:31px;height:31px;flex:none;background:var(--app-icon) center/contain no-repeat}
.brand-caption{min-width:0}
.wordmark{display:block;font:650 16px/1.15 system-ui,sans-serif;letter-spacing:-.045em}
.brand-id{display:block;margin-top:3px;color:var(--faint);font-size:12px;font-weight:450;line-height:1.35}
.brand-actions{display:flex;align-items:center;gap:3px;flex-wrap:nowrap;margin:0}
.chat-icon{width:18px;height:18px;flex:none;fill:none;stroke:currentColor;stroke-width:1.65;stroke-linecap:round;stroke-linejoin:round}
.brand-actions>button{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:36px;min-width:36px;padding:0 8px;background:transparent;color:var(--secondary);font:inherit;font-weight:500;font-size:13px}
.brand-actions>button:hover,#moreActions[aria-expanded="true"],#historyOpen[aria-expanded="true"]{background:var(--canvas);color:var(--text)}
#newChat{padding:0 10px;background:var(--paper);border:1px solid var(--line);border-radius:9px;color:var(--text)}
#quickActions{position:absolute;right:var(--inset);top:58px;z-index:6;display:grid;width:min(216px,calc(100% - 24px));max-height:calc(100% - 64px);overflow:auto;padding:5px;gap:1px;border:1px solid var(--line);border-radius:14px;background:var(--paper);box-shadow:var(--menu-shadow)}
#quickActions[hidden],#quickActions button[hidden],#fileSummary[hidden],#pinnedNotice[hidden],#jumpLatest[hidden]{display:none}
#quickActions button{display:flex;align-items:center;gap:11px;color:var(--text);background:transparent;font:inherit;font-weight:450;min-height:35px;text-align:left;padding:7px 11px;border:0;border-radius:8px}
#quickActions .chat-icon{width:16px;height:16px;color:var(--faint)}
#quickActions button:hover,#quickActions button:focus-visible{background:var(--canvas)}
#quickActions .cruise-chip{max-width:none;background:transparent!important;color:var(--text)!important}
.menu-rule{height:1px;background:var(--line);margin:3px 8px}
#pinnedNotice{height:100%;display:grid;place-content:center;justify-items:center;gap:14px;color:var(--secondary)}
#returnChat,#jumpLatest{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 13px;color:var(--text);background:var(--paper);border:1px solid var(--line);border-radius:20px;font:inherit;cursor:pointer}
#jumpLatest{position:absolute;bottom:10px;align-self:center;font-size:12px;box-shadow:var(--menu-shadow);z-index:1}
#jumpLatest .chat-icon{width:14px;height:14px}
.log{width:100%;max-width:740px;margin-inline:auto;padding:24px var(--inset);gap:26px;scrollbar-width:thin;overscroll-behavior:contain}
.msg{flex:none;min-width:0;max-width:100%;font-size:15px;line-height:1.75;overflow-wrap:anywhere}
.msg.user{max-width:86%;background:var(--tint);color:var(--text);border:0;border-radius:16px 16px 5px 16px;padding:10px 15px}
.msg.assistant{width:100%;padding:0}
.speaker{display:flex;align-items:center;gap:7px;margin:0 0 9px;font:600 12px/1.3 system-ui,sans-serif;letter-spacing:.01em;color:var(--secondary)}
.speaker::before{content:"";width:17px;height:17px;background:var(--app-icon) center/contain no-repeat}
.msg.assistant p{margin:0 0 .65em}
.msg.assistant h1,.msg.assistant h2,.msg.assistant h3{line-height:1.45;margin:1em 0 .45em}
.msg.assistant li+li{margin-top:.35em}
.msg.assistant pre{white-space:pre;max-width:100%;box-sizing:border-box;padding:12px 14px;border:1px solid var(--line);background:var(--paper)}
.msg.assistant blockquote{border-color:var(--keyline)}
.msg.assistant table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse;margin:.6em 0}
.msg.assistant :is(th,td){border:1px solid var(--line);padding:.35em .65em}
.msg.assistant th{background:var(--canvas)}
.msg.assistant.streaming::after{content:none}
.msg.streaming .reply::after{content:"▍";color:var(--accent);animation:streamBlink 1s steps(2) infinite}
.empty{align-items:flex-start;text-align:left;width:100%;max-width:480px;margin:auto;padding:18px 0;gap:20px}
.empty strong{margin:0;color:var(--text);font:550 clamp(26px,5vw,34px)/1.3 "Songti SC","Noto Serif CJK SC","Source Han Serif SC",SimSun,serif;letter-spacing:-.045em}
.starters{display:flex;gap:8px;flex-wrap:wrap}
.starters button{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:7px 12px;border:1px solid var(--line);border-radius:10px;color:var(--secondary);background:var(--paper);font:inherit;font-size:13px;cursor:pointer}
.starters .chat-icon{width:16px;height:16px;color:var(--accent)}
.starters button:hover,#newChat:hover,#returnChat:hover,#jumpLatest:hover{background:var(--tint);border-color:var(--keyline)}
.composer{gap:6px;padding:8px var(--inset) max(16px,env(safe-area-inset-bottom));background:var(--desk)}
.composer-row{max-width:calc(740px - 2 * var(--inset));margin-inline:auto}
.field{padding:12px 12px 8px;gap:5px;border:1px solid var(--line);border-radius:18px;background:var(--paper);box-shadow:0 3px 10px rgba(18,39,23,.05)}
.field:focus-within{border-color:var(--keyline);background:var(--paper);box-shadow:0 0 0 2px var(--tint)}
.field textarea{padding:0 4px;font:inherit;font-size:15px;line-height:1.5;min-height:38px;height:2.8em;color:var(--text)}
.field textarea:focus-visible{outline:0}
.composer-actions{gap:4px}
.composer-actions .icon-btn{width:34px;height:34px;color:var(--secondary);border-radius:9px}
#mic{margin-left:auto}
#sendGo{background:var(--accent);color:var(--accent-ink);border-radius:11px}
#sendGo:disabled{background:var(--canvas);color:var(--faint);opacity:1;cursor:default}
#stopGo{border:1px solid var(--keyline);color:var(--text)}
.input-feedback{flex:1;min-width:0;color:var(--faint);font-size:12px;line-height:1.45}
#status{margin:0;padding:0;width:auto;max-height:5em;overflow:auto;color:var(--secondary);background:transparent;border:0;border-radius:0;font-size:inherit;overflow-wrap:anywhere}
#status:not(:empty)+#sendHint{display:none}
#fileSummary{display:flex;align-items:center;gap:6px;background:var(--canvas);color:var(--secondary);padding:4px 8px;border-radius:8px;font-size:12px}
#fileNames{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#clearFiles{margin-left:auto;flex:none;border:0;background:transparent;color:var(--indigo);min-height:28px;cursor:pointer}
.list-head{font-size:13px;font-weight:600;color:var(--text)}.list-scroll{scrollbar-width:thin}
button:active:not(:disabled){filter:brightness(.93)}
@media(min-width:760px){.brand-actions>#historyOpen{display:none}.composer{padding-inline:var(--inset)}.hud{background:var(--rail-bg)}}
@media(max-width:759px){.hud.history .list{max-height:48vh}.hud.history .list-scroll{overflow:auto}}
@media(max-height:500px){.brand{min-height:50px;padding-block:5px}#quickActions{top:48px;max-height:calc(100% - 54px)}.log{padding-block:12px;gap:16px}.empty{padding:4px 0;gap:10px}.composer{padding-block:5px 8px}}
@media(pointer:coarse){.brand-actions>button,.composer-actions .icon-btn,.starters button,#quickActions button{min-height:44px;min-width:44px}}
`
