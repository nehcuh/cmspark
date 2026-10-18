(function(){
  // Unshipped native resource acceptance: consume real renderer/channel ACKs.
  let started=false,phase=0;const $=id=>document.getElementById(id);
  const send=f=>{if(window.chrome?.webview)window.chrome.webview.postMessage(f);else window.webkit.messageHandlers.desktop.postMessage(f)};
  const note=id=>send({type:"system.ping",id,generation:documentGeneration});
  const fail=()=>note("D476_RES_FAIL");
  const skill="---\nname: native-resource-skill\ndescription: 原生技能\ntype: prompt_template\n---\n\n原生 技能正文\n";
  const knowledge="---\nname: native-resource-note\ntitle: 原生知识\ndescription: 文档说明\ntype: domain_knowledge\n---\n\n原生 知识正文\n";
  function importText(text){$("resource-import").click();$("resource-text").value=text;$("resource-save").click()}
  function open(id){const row=[...document.querySelectorAll("[data-resource-id]")].find(b=>b.getAttribute("data-resource-id")===id);if(!row){fail();return}row.click()}
  function start(){if(started)return;started=true;document.querySelector('[data-page="skill.list"]').click()}
  document.addEventListener("keyup",event=>{if(phase!==4||event.key!=="Escape")return;if(event.isTrusted!==true||!$("resource-editor").hidden){fail();return}const row=[...document.querySelectorAll("[data-resource-id]")].find(b=>b.getAttribute("data-resource-id")==="native-resource-note");if(!row||document.activeElement!==row){fail();return}note("D476_RES_ESCAPE_OK");row.click()});
  const original=window.cmsparkDesktopReceive;
  window.cmsparkDesktopReceive=frame=>{
    original(frame);
    if(frame.type==="desktop.document"){start();return}
    if(frame.type==="desktop.offline"){
      const ok=phase===8&&$("resource-text").value==="未确认的原生知识正文"&&$("resource-save").disabled&&$("resource-feedback").textContent.includes("未知");
      send({type:"D476.resource.offline",generation:documentGeneration,result:ok?"ok":"fail"});return;
    }
    if(frame.type==="skill.list"&&phase===0){phase=1;importText(skill);return}
    if(frame.type==="knowledge.list"&&phase===2){phase=3;importText(knowledge);return}
    if(frame.type==="desktop.resource.read.result"){
      if(frame.ok!==true||frame.doc.complete!==true||frame.doc.writable!==true){fail();return}
      if(phase===1){if(frame.doc.resource_id!=="native-resource-skill"||!frame.doc.text.includes("原生 技能正文")){fail();return}note("D476_RES_SKILL_IMPORTED");phase=2;document.querySelector('[data-page="knowledge.list"]').click();return}
      if(phase===3){if(frame.doc.resource_id!=="native-resource-note"||!frame.doc.text.includes("原生 知识正文")){fail();return}note("D476_RES_KNOWLEDGE_IMPORTED");phase=4;$("resource-text").focus();note("D476_RES_ESCAPE_REQUEST");return}
      if(phase===4){note("D476_RES_REOPENED");phase=5;$("resource-name").value="已编辑 原生知识";$("resource-save").click();return}
      if(phase===5){if($("resource-name").value!=="已编辑 原生知识"){fail();return}note("D476_RES_UPDATED");phase=6;$("resource-remove").click();return}
      if(phase===7){if(frame.doc.resource_id!=="native-resource-skill"){fail();return}$("resource-remove").click();return}
      if(phase===9){if(frame.doc.resource_id!=="native-resource-note"||$("resource-name").value!=="已编辑 原生知识"){fail();return}phase=8;$("resource-text").value="未确认的原生知识正文";note("D476_RES_BEFORE_LOST_ACK");$("resource-save").click();return}
    }
    if(frame.type==="desktop.resource.remove.result"&&phase===6){if(frame.outcome!=="denied"||frame.ok!==false){fail();return}note("D476_RES_DENIED");phase=7;document.querySelector('[data-page="skill.list"]').click();return}
    if(frame.type==="skill.list"&&phase===7){open("native-resource-skill");return}
    if(frame.type==="desktop.resource.remove.result"&&phase===7){if(frame.ok!==true||frame.outcome!=="committed"){fail();return}note("D476_RES_REMOVED");phase=9;document.querySelector('[data-page="knowledge.list"]').click();return}
    if(frame.type==="knowledge.list"&&phase===9){open("native-resource-note");return}
    if(typeof frame.type==="string"&&frame.type.startsWith("desktop.resource.")&&frame.ok===false&&!(frame.type==="desktop.resource.remove.result"&&phase===7))fail();
  };
  if($("status").textContent==="已连接 · MCP 保存需确认")start();
})();
