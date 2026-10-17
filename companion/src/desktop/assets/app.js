(() => {
  "use strict";
  let generation=null, page="thread.list", compact=true, selectedThread=null;
  const titles={"thread.list":"对话","mcp.list":"MCP","skill.list":"技能","knowledge.list":"知识"};
  const $=id=>document.getElementById(id);
  function post(frame){if(!generation)return;const value={...frame,generation};if(window.webkit?.messageHandlers?.desktop)window.webkit.messageHandlers.desktop.postMessage(value);else if(window.chrome?.webview)window.chrome.webview.postMessage(value)}
  function request(type,thread_id){post({type,id:type,...(thread_id?{thread_id}:{})})}
  function load(){ selectedThread=null; $("title").textContent=titles[page];$("notice").textContent="加载中…";$("list").replaceChildren();$("preview").replaceChildren();document.querySelectorAll("nav button").forEach(b=>b.setAttribute("aria-current",b.dataset.page===page?"page":"false"));request(page)}
  window.cmsparkDesktopReceive=frame=>{
    if(!frame||typeof frame!=="object")return;
    if(frame.type==="desktop.document"){generation=frame.generation;$("status").textContent="已连接 · 只读";load();for(const type of ["mcp.list","skill.list","knowledge.list"])request(type);return}
    if(frame.type==="desktop.offline"){generation=null;selectedThread=null;$("preview").replaceChildren();$("status").textContent="连接已断开";$("notice").textContent="等待原生宿主重新连接。";return}
    if(frame.type==="desktop.error"){
      if(typeof frame.id==="string"&&Object.prototype.hasOwnProperty.call(titles,frame.id)&&frame.id!==page)return;
      if(frame.id==="thread.peek"&&(page!=="thread.list"||!selectedThread))return;
      $("notice").textContent="暂时无法读取，请重试。";return
    }
    if(frame.type==="thread.peek_result"){if(page==="thread.list"&&selectedThread&&frame.thread_id===selectedThread)$("preview").textContent=frame.markdown||"暂无预览。";return}
    if(frame.type!==page)return;
    const rows=frame.threads||frame.servers||frame.skills||frame.docs||[];$("list").replaceChildren();$("notice").textContent=rows.length?(frame.truncated?"仅显示前 64 项。":""):"暂无内容。";
    for(const row of rows){const li=document.createElement("li"), label=document.createElement(page==="thread.list"?"button":"strong");label.textContent=row.title||row.name||row.id||"未命名";if(page==="thread.list"){label.type="button";label.addEventListener("click",()=>{if(page!=="thread.list")return;selectedThread=row.id;$("preview").replaceChildren();request("thread.peek",row.id)})}li.append(label);if(row.description||row.status){const p=document.createElement("p");p.textContent=row.description||row.status;li.append(p)}$("list").append(li)}
  };
  if(window.chrome?.webview)window.chrome.webview.addEventListener("message",e=>window.cmsparkDesktopReceive(e.data));
  document.querySelectorAll("nav button").forEach(b=>b.addEventListener("click",()=>{page=b.dataset.page;load()}));
  $("view").addEventListener("click",()=>{compact=!compact;post({type:"desktop.view",view:compact?"compact":"workspace"})});
})();
