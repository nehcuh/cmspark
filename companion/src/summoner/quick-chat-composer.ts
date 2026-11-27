/** The input belongs to the selected conversation. A socket write is not a chat receipt. */
export const QUICK_CHAT_COMPOSER_JS = String.raw`
function createQuickChatComposer(){
  const input = $("text"), picker = $("files"), sendButton = $("sendGo");
  const drafts = new Map();
  const newDraft = () => ({ text: "", files: null, pending: null, notice: "" });
  let draft = newDraft();

  function paint(){
    sendButton.disabled = !!draft.pending || (!draft.text.trim() && !draft.files?.length);
    const names = Array.from(draft.files || [], file => file.name).join("、");
    $("fileSummary").hidden = !names;
    $("fileNames").textContent = names;
    $("fileNames").title = names;
  }
  function notice(owner, message){
    owner.notice = message;
    if (owner === draft) setStatus(message);
  }
  function select(id){
    if (threadId === id) return;
    if (threadId) drafts.set(threadId, draft);
    draft = drafts.get(id) || (threadId ? newDraft() : draft);
    drafts.set(id, draft);
    input.value = draft.text;
    if (draft.files) picker.files = draft.files;
    else picker.value = "";
    setStatus(draft.notice);
    paint();
  }
  function finish(owner, sent, message, delivered){
    if (owner.pending !== sent) return;
    clearTimeout(sent.timer);
    owner.pending = null;
    if (delivered && owner.text === sent.text) owner.text = "";
    if (delivered && owner.files === sent.files) owner.files = null;
    if (owner === draft){
      input.value = owner.text;
      if (!owner.files) picker.value = "";
      paint();
    }
    notice(owner, message);
  }
  function receive(event){
    const owner = event.thread_id ? drafts.get(event.thread_id) :
      Array.from(drafts.values()).find(item => item.pending && item.pending.id === event.id);
    const sent = owner?.pending;
    if (!sent || (event.id !== sent.id && event.client_message_id !== sent.id)) return false;
    if (event.type === "error" || event.type === "chat.error" || event.type === "file.upload_error"){
      finish(owner, sent, statusFromEvent(event), false);
    } else if (["chat.user","chat.steered","chat.enqueued","file.uploaded"].includes(event.type)){
      const label = event.type === "chat.enqueued" ? "已排队" : event.type === "chat.steered" ? "已追加指示" : "已发送";
      finish(owner, sent, label, true);
    }
    return true;
  }
  async function submit(mode){
    const owner = draft;
    if (owner.pending || (!owner.text.trim() && !owner.files?.length)) return;
    if (owner.files?.length && (busy || mode !== "create")){
      notice(owner, "请等本轮回复结束后发送附件");
      return;
    }
    const sent = { id: "quick-" + crypto.randomUUID(), text: owner.text, files: owner.files, timer: null };
    owner.pending = sent;
    paint();
    notice(owner, "发送中…");
    try {
      const id = await ensureThread();
      if (owner !== draft || id !== threadId) throw new Error("对话已切换，草稿已保留");
      const post = (route, body) => api(route, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const lease = await post("/api/lease", {thread_id:id});
      if (!lease || lease.error || lease.error_code || lease.type === "error" || lease.type === "composer.lease.error") throw new Error(statusFromEvent(lease));
      const body = {thread_id:id,message:sent.text,submission_id:sent.id};
      const hasFiles = !!sent.files?.length;
      if (hasFiles) body.files = await filesToPayload(sent.files);
      else body.mode = mode;
      if (owner !== draft || id !== threadId) throw new Error("对话已切换，草稿已保留");
      const reply = await post(hasFiles ? "/api/files" : "/api/chat", body);
      if (owner.pending !== sent) return; // SSE can arrive before the HTTP response.
      if (reply?.type !== "accepted") throw new Error(statusFromEvent(reply));
      notice(owner, "等待接收…");
      sent.timer = setTimeout(() => finish(owner, sent, "尚未收到回执，请先核对对话记录再决定是否重发", false), 30000);
    } catch (error) {
      finish(owner, sent, error.message || "发送失败，请重试", false);
    }
  }
  input.addEventListener("input", () => { draft.text = input.value; paint(); });
  picker.addEventListener("change", () => { draft.files = picker.files; paint(); });
  $("clearFiles").onclick = () => { picker.value = ""; draft.files = null; paint(); input.focus(); };
  paint();
  return { select, submit, receive };
}
`
