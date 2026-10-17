(function(){
  // Executed only in a separately compiled owned acceptance host. This drives
  // the real bundled form, never inserts a confirmation ID/digest/private action.
  let phase=0;
  const post=id=>{const value={type:"system.ping",id,generation:documentGeneration};if(window.chrome?.webview)window.chrome.webview.postMessage(value);else window.webkit.messageHandlers.desktop.postMessage(value)};
  const original=window.cmsparkDesktopReceive;
  const setCommand=value=>{document.getElementById("mcp-command").value=value;document.getElementById("mcp-save").click()};
  window.cmsparkDesktopReceive=frame=>{
    original(frame);
    if(frame.type==="mcp.list"&&(phase===0||phase===3)){
      const rows=[...document.getElementById("list").children];const row=rows.find(v=>v.querySelector("strong")?.textContent==="owned_native_476");
      if(!row){post("D476_FAIL_ROW");return}phase=phase===0?1:4;row.querySelector("button").click();
    }else if(frame.type==="desktop.mcp.edit.result"&&phase===1){phase=2;setCommand("owned_update_approved")}
    else if(frame.type==="desktop.mcp.save.result"&&phase===2){if(frame.ok!==true){post("D476_FAIL_APPROVE");return}phase=3;post("D476_SAVE_APPROVED")}
    else if(frame.type==="desktop.mcp.edit.result"&&phase===4){phase=5;setCommand("owned_update_denied")}
    else if(frame.type==="desktop.mcp.save.result"&&phase===5){if(frame.ok!==false){post("D476_FAIL_DENY");return}post("D476_SAVE_DENIED");phase=7;document.getElementById("mcp-new").click();document.getElementById("mcp-name").value="owned_added_476";document.getElementById("mcp-command").value="owned_added_inert";document.getElementById("mcp-args").value='["中文 空格"]';document.getElementById("mcp-cwd").value="";document.getElementById("mcp-enabled").checked=false;document.getElementById("mcp-save").click()}
    else if(frame.type==="desktop.mcp.save.result"&&phase===7){if(frame.ok!==true){post("D476_FAIL_ADD");return}phase=8;post("D476_NATIVE_DONE")}
    if(document.body.textContent.includes("OWNED_PRIVATE_476"))post("D476_FAIL_RENDERER_SECRET");
  };
  document.querySelector('[data-page="mcp.list"]').click();
})();
