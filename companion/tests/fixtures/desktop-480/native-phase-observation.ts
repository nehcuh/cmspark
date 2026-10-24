/** Shared test-only closed parser; no test registration or product runtime import. */
// Test-build-only fixed IDs; observe accepted existing pong responses, never incoming/global auth.
export const nativePhaseNames=["ready_accepted","env_callback","controller_callback","navigation_callback","document_post_attempted","renderer_callback","renderer_admitted","renderer_send_attempted"] as const
export type NativeNavigationObservation={isSuccessHrSucceeded:boolean,isSuccess:boolean,sourceHrSucceeded:boolean,sourceMatches:boolean,readySample:boolean,webErrorHrSucceeded:boolean,webErrorStatus:number|null}
function decodeNativeNavigationId(id:string):NativeNavigationObservation|undefined{
 const match=/^DESKTOP_480_NAV_H([01])B([01])S([01])O([01])R([01])E([01])W(u|0[0-9]|1[0-8])$/.exec(id)
 if(!match||match[0]!==id||(match[6]==="0"&&match[7]!=="u"))return
 return{isSuccessHrSucceeded:match[1]==="1",isSuccess:match[2]==="1",sourceHrSucceeded:match[3]==="1",sourceMatches:match[4]==="1",readySample:match[5]==="1",webErrorHrSucceeded:match[6]==="1",webErrorStatus:match[7]==="u"?null:Number(match[7])}
}
export function recordNativePhaseResponse(data:unknown,phases:Set<string>,navigation:{value?:NativeNavigationObservation}={}):void{
 if(phases.size>=8||!(typeof data==="string"||Buffer.isBuffer(data)))return
 let frame:any;try{frame=JSON.parse(String(data))}catch{return}
 if(!frame||typeof frame!=="object"||Array.isArray(frame)||Object.keys(frame).length!==2||frame.type!=="system.pong"||typeof frame.id!=="string")return
 const observation=decodeNativeNavigationId(frame.id)
 if(observation){if(!phases.has("navigation_callback")){phases.add("navigation_callback");navigation.value=observation}return}
 for(const phase of nativePhaseNames)if(phase!=="navigation_callback"&&frame.id===`DESKTOP_480_PHASE_${phase}`){phases.add(phase);return}
}
export function observeNativePhaseResponses(ws:any,phases:Set<string>,navigation:{value?:NativeNavigationObservation}={}):void{
 const original=ws.send
 ws.send=function(this:unknown,...args:unknown[]){const result=Reflect.apply(original,this,args);try{recordNativePhaseResponse(args[0],phases,navigation)}catch{/* Preserve original send, callback, return and throw behavior. */}return result}
}
