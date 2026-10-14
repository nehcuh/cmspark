// Isolated browser fixture: real component/helper/reducer/CSS, no extension APIs.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const frontend = path.join(root, 'chrome-extension');
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });
const entry = `
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { TaskRelationshipNav } from './src/sidepanel/components/TaskRelationshipNav';
import { resolveTaskRelationship } from './src/sidepanel/utils/task-relationship';
import { agentReducer, initialState } from './src/sidepanel/store/agentStore';
import { workspaceCSS } from './src/sidepanel/ui/workspace-styles';
const style = document.createElement('style'); style.textContent = workspaceCSS; document.head.append(style);
const parent = { id:'parent', alias:'Office 文档兼容性与主任务的整体进度'.repeat(4), created_at:'2026-10-13', updated_at:'2026-10-13', config_override:initialState.config, tool_whitelist:null, pinned_tabs:[], active_skill_ids:[] };
const child = {id:'child',alias:'入口诊断',worker_role_label:'格式入口与质量检查'.repeat(4),agent_role:'worker',parent_thread_id:'parent',orchestrator_run_id:'run',paused:false,status:'idle',tab_locks:[]};
const root = createRoot(document.getElementById('task'));
window.navigationCalls = [];
window.showCase = kind => {
  const directParent = kind==='multilevel' ? {...parent,id:'middle',alias:'上级子任务',agent_role:'worker',parent_thread_id:'parent'} : parent;
  const currentChild = kind==='multilevel' ? {...child,parent_thread_id:'middle'} : child;
  const rows = kind==='missing' ? [] : kind==='multilevel' ? [parent,directParent] : [{...parent, ...(kind==='trashed' ? {trashed_at:'2026-10-13'} : kind==='cycle' ? {parent_thread_id:'child'} : {})}];
  const relation = resolveTaskRelationship('child',rows,[currentChild]);
  root.render(createElement(TaskRelationshipNav,{relationship:relation,onNavigate:id=>{
    const parentMessage = {id:'main-message',thread_id:directParent.id,role:'user',content:'主任务消息',created_at:'2026-10-13'};
    const childMessage = {...parentMessage,id:'child-message',thread_id:'child',content:'子任务消息'};
    let state = {...initialState,threads:[...rows,{...parent,...currentChild}],activeThreadId:directParent.id,messages:[parentMessage],threadBusyById:{parent:true,child:true},composerRestore:{text:'待发送草稿',token:1}};
    state = agentReducer(state,{type:'SET_ACTIVE_THREAD',threadId:'child'});
    state = agentReducer(state,{type:'SET_MESSAGES',messages:[childMessage]});
    state = agentReducer(state,{type:'SET_ACTIVE_THREAD',threadId:id});
    window.navigationCalls.push({type:'thread.select',threadId:state.activeThreadId,busy:state.threadBusyById,message:state.messages[0]?.content,childCache:state.messagesByThreadId.child?.[0]?.content,draft:state.composerRestore?.text,uploadClearSeq:state.composerUploadClearSeq});
  }}));
};
window.showCase('available');
`;
const result = require('esbuild').buildSync({stdin:{contents:entry,resolveDir:frontend,loader:'tsx'},bundle:true,platform:'browser',format:'iife',jsx:'automatic',write:false,define:{'process.env.NODE_ENV':'"production"'}});
fs.writeFileSync(path.join(out,'fixture.js'),result.outputFiles[0].text);
fs.writeFileSync(path.join(out,'fixture.html'),'<!doctype html><meta charset="utf-8"><style>body{margin:0} .cm-workspace{width:100%;box-sizing:border-box} .cm-status-rail{display:flex;align-items:center;gap:2px;padding:6px 10px;box-sizing:border-box;width:100%} #task{display:contents}</style><div class="cm-workspace"><main class="cm-workspace-main"><div class="cm-status-rail"><button type="button">导航</button><span>CMspark</span><div id="task"></div><button type="button">⋯</button></div></main></div>');
console.log(out);
