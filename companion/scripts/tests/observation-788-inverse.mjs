/** Static lineage only: never transform runtime bytes, JSON, TAP or evidence. */
export function restoreObservation788(source){
 if(typeof source!=='string')throw Error('OBS788_SOURCE_REQUIRED')
 return source.replace(/\/\*OBS788_VALUE:([0-9a-f]{64})\*\/'[0-9a-f]{64}'\/\*OBS788_END_VALUE\*\//g,(_all,prior)=>"'"+prior+"'").replace(/\/\*OBS788_BEGIN\*\/[\s\S]*?\/\*OBS788_END\*\//g,'')
}
