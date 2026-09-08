/** Small adapter over the same thread.update owner used by the extension. */
export const SUMMONER_THREAD_MANAGEMENT_JS = String.raw`
  var editingMetadata=null,metadataTrigger=null,metadataSaving=false;
  function metadataTags(raw){
    var seen={};
    return raw.split(/[,，\n]/).map(function(v){return v.normalize("NFC").replace(/[\x00-\x1f\x7f]/g,"").replace(/\s+/g," ").trim()}).filter(function(v){var key=v.toLowerCase();if(!v||Object.prototype.hasOwnProperty.call(seen,key))return false;Object.defineProperty(seen,key,{value:true});return true});
  }
  function threadEntries(items,view){
    var rows=[];
    items.forEach(function(t){
      var groups=view==="folders"?[t.topic_folder||"未分组"]:view==="ai"?[(t.digest&&t.digest.tags||[])[0]||"待 AI 整理"]:view==="tags"?metadataTags((t.user_tags||[]).concat(t.digest&&t.digest.tags||[]).join(",")):[];
      if(!groups.length)groups=[view==="tags"?"未标注":""];
      groups.forEach(function(group){rows.push({thread:t,group:group})});
    });
    if(view!=="recent") rows.sort(function(a,b){return a.group.localeCompare(b.group,"zh")});
    return rows;
  }
  function closeThreadMetadata(){
    if(metadataSaving)return;
    $("threadMetadata").hidden=true;editingMetadata=null;
    if(metadataTrigger&&metadataTrigger.isConnected)metadataTrigger.focus();
    metadataTrigger=null;
  }
  function openThreadMetadata(t,trigger){
    if(metadataSaving)return;
    editingMetadata=t.id;metadataTrigger=trigger;
    $("metadataTitle").textContent="分类 · "+(t.title||t.alias||t.id);
    $("metadataTags").value=(t.user_tags||[]).join("，");
    $("metadataFolder").value=t.topic_folder||"";
    $("metadataError").textContent="";
    $("threadFolders").replaceChildren();
    Array.from(new Set(threads.map(function(row){return row.topic_folder}).filter(Boolean))).forEach(function(name){var option=document.createElement("option");option.value=name;$("threadFolders").appendChild(option)});
    $("threadMetadata").hidden=false;$("metadataTags").focus();
  }
  $("metadataCancel").onclick=closeThreadMetadata;
  $("threadMetadata").addEventListener("keydown",function(e){if(e.key==="Escape"&&!metadataSaving){e.preventDefault();e.stopPropagation();closeThreadMetadata()}});
  $("threadMetadata").onsubmit=function(e){
    e.preventDefault();if(!editingMetadata||metadataSaving)return;
    var owner=editingMetadata,tags=metadataTags($("metadataTags").value);
    if(tags.length>20||tags.some(function(tag){return tag.length>40})){$("metadataError").textContent="最多 20 个标签，每个不超过 40 字";return}
    var folder=$("metadataFolder").value.normalize("NFC").replace(/[\x00-\x1f\x7f\\/]/g,"").trim()||null;
    var updates={user_tags:tags,topic_folder:folder};
    metadataSaving=true;$("metadataSave").disabled=true;$("metadataCancel").disabled=true;$("metadataTags").disabled=true;$("metadataFolder").disabled=true;$("metadataSave").textContent="保存中…";$("metadataError").textContent="";
    api("/api/thread?id="+encodeURIComponent(owner),{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(updates)}).then(function(d){
      if(!d||d.type!=="thread.updated"||!d.thread||d.thread.id!==owner)throw new Error(d&&d.error||"未收到分类保存确认");
      var saved=d.thread;
      if(JSON.stringify(metadataTags((saved.user_tags||[]).join(",")).map(function(t){return t.toLowerCase()}).sort())!==JSON.stringify(tags.map(function(t){return t.toLowerCase()}).sort())||(saved.topic_folder||null)!==folder)throw new Error("服务端未保存所提交的分类，请更新 Companion 后重试");
      threads=threads.map(function(t){return t.id===owner?Object.assign({},t,saved):t});
      renderThreads();$("threadMetadata").hidden=true;editingMetadata=null;
      var next=Array.from(document.querySelectorAll("#threads .thread-classify")).find(function(button){return button.dataset.threadId===owner});
      (next||$("threadSearch")).focus();
      setStatus("分类已保存");
    }).catch(function(err){$("metadataError").textContent=err&&err.message||"分类保存失败"}).finally(function(){
      metadataSaving=false;$("metadataSave").disabled=false;$("metadataCancel").disabled=false;$("metadataTags").disabled=false;$("metadataFolder").disabled=false;$("metadataSave").textContent="保存";
    });
  };
`
