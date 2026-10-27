/** Closed test-only diagnostics. Never action, authority, success or process identity. */
export function joinDiagnostic788(message) {
 if(typeof message!=='string')return null
 const native='D476_OBS788_JOIN_',complete='D476_WORKSPACE_COMPLETE_788 '
 if(!message.startsWith(native)&&!message.startsWith(complete))return null
 const unknown=()=>({status:'UNKNOWN',reason:'INVALID_SNAPSHOT'})
 if(message.length>512)return unknown()
 if(message.startsWith(native)){
  const m=/^D476_OBS788_JOIN_([0-3])([0-3])([12])([12])([012])([0-4])$/.exec(message)
  if(!m||m[0]!==message)return unknown()
  const [documentEntries,activeEntries,first,last,owner,foreground]=m.slice(1).map(Number)
  if(!(documentEntries+activeEntries)||first===1&&!documentEntries||first===2&&!activeEntries||last===1&&!documentEntries||last===2&&!activeEntries||(owner===1?foreground===0:foreground!==0))return unknown()
  return{status:'OBSERVED',snapshot:{schema:1,documentEntries,activeEntries,countsCap:3,first:first===1?'DOCUMENT':'ACTIVE',last:last===1?'DOCUMENT':'ACTIVE',owner:['NOT_CHECKED','CURRENT','INVALID'][owner],foreground:['NOT_READ','NULL','OWNED_MAIN','OTHER','NOT_VISIBLE'][foreground]}}
 }
 try{
  const raw=message.slice(complete.length),v=JSON.parse(raw),keys=['schema','aborted','invalid','observerClosed','xcodeClosed','observerExit','xcodeExit']
  if(!v||Array.isArray(v)||Object.keys(v).join()!==keys.join()||v.schema!==1||['aborted','invalid','observerClosed','xcodeClosed'].some(k=>typeof v[k]!=='boolean'))return unknown()
  for(const [closed,exit]of[[v.observerClosed,v.observerExit],[v.xcodeClosed,v.xcodeExit]])if(closed?!['ZERO','NONZERO','UNKNOWN'].includes(exit):exit!=='NOT_CLOSED')return unknown()
  const snapshot=Object.fromEntries(keys.map(k=>[k,v[k]]));if(JSON.stringify(snapshot)!==raw)return unknown()
  return{status:'OBSERVED',snapshot}
 }catch{return unknown()}
}
