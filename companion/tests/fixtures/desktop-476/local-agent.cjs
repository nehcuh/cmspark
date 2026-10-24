// Hosted owned process only. No model, tool execution, network or repository access.
'use strict'
const fs=require('node:fs'),readline=require('node:readline');let prompt
const send=frame=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',...frame})+'\n')
readline.createInterface({input:process.stdin}).on('line',line=>{const frame=JSON.parse(line)
 if(frame.method==='initialize')send({id:frame.id,result:{protocolVersion:1}})
 else if(frame.method==='session/new')send({id:frame.id,result:{sessionId:'owned-local-session'}})
 else if(frame.method==='session/prompt'){prompt=frame.id;const goal=JSON.stringify(frame.params);if(goal.includes('owned native hang'))send({method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:{text:'D476_AGENT_RUNNING'}}}});else send({id:'permission',method:'session/request_permission',params:{title:'owned forbidden fixture operation'}})}
 else if(frame.id==='permission'){const decision=frame.result?.outcome?.outcome||frame.result?.outcome;fs.writeFileSync(process.env.OWNED_LOCAL_PERMISSION_FILE,decision==='cancelled'?'DENIED':'UNEXPECTED',{flag:'wx'});if(decision!=='cancelled')return;send({method:'session/update',params:{update:{sessionUpdate:'agent_message_chunk',content:{text:'D476_AGENT_PERMISSION_DENIED'}}}});send({id:prompt,result:{stopReason:'end_turn'}})}
})
