/** Static lineage only: never transform runtime bytes, JSON, TAP or evidence. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
export function restoreCloseObservation476(kind,raw){
 if(kind==='ui'||!raw.includes('/*OBS476_'))return raw
 const profiles={
  protocol:['a96609272104b705e3d970a42c48ba15f3cf62ee84ad8d2f9d7c82326e5e80e6','69b5fb718b3d0cd405f8285fd89db3c506872ef80e340360ab69d3f2a6feabe5',2,'BOUNDARY'],
  observer:['b5be419dc5fce13f8555b3f76eea6b6b58a1b7fab234fca8af2020b5f1ece277','5fd01ad1e08c9e8dd3c86882a217f4f92929178ab9f550f4f320ed119f2ee9d2',11,'BOUNDARY'],
  helper:['8e5dad707a9c66cb98bb53bc03562d3cb1dd31e7bb5b2ac524c935d5788704c0','b0e30a4e3d7331dd1af008eee5ac96c673907544f4fda75a2e279ac816cba796',4,'CLOSE'],
  native:['46d852529cfbb6016484b8680d534549303d9c88e0083ffa83d9071b18886e16','0b78022a6efaa334ce97d5d1ccfb9c6d59857997ddefed3ad5f7a0e501fb78a4',1,'CLOSE'],
 }
 assert.ok(Object.hasOwn(profiles,kind))
 const [current,prior,count,label]=profiles[kind],eol=raw.includes('\r\n')?'\r\n':'\n';let value=raw.replace(/\r\n/g,'\n')
 const digest=s=>createHash('sha256').update(s).digest('hex')
 assert.equal(digest(value),current,'exact current 476 observation source')
 if(kind==='helper'){
  const a="/*OBS476_CLOSE_VALUE:69b5fb718b3d0cd405f8285fd89db3c506872ef80e340360ab69d3f2a6feabe5*/'a96609272104b705e3d970a42c48ba15f3cf62ee84ad8d2f9d7c82326e5e80e6'/*OBS476_CLOSE_END_VALUE*/",b="'69b5fb718b3d0cd405f8285fd89db3c506872ef80e340360ab69d3f2a6feabe5'",c='/*OBS476_CLOSE_VALUE_BEGIN*/(code,signal)/*OBS476_CLOSE_VALUE_END*/'
  assert.equal(value.split(a).length,2);assert.equal(value.split(c).length,2);value=value.replace(a,b).replace(c,'code')
 }
 const begin=`/*OBS476_${label}_BEGIN*/`,end=`/*OBS476_${label}_END*/`;assert.equal(value.split(begin).length,count+1);assert.equal(value.split(end).length,count+1)
 value=value.replace(label==='CLOSE'?/\/\*OBS476_CLOSE_BEGIN\*\/[\s\S]*?\/\*OBS476_CLOSE_END\*\//g:/\/\*OBS476_BOUNDARY_BEGIN\*\/[\s\S]*?\/\*OBS476_BOUNDARY_END\*\//g,'')
 if(kind==='observer'){assert.equal(value.split('app,change in').length,2);value=value.replace('app,change in','app,_ in')}
 assert.equal(digest(value),prior,'complete preceding source preserved');return value.replace(/\n/g,eol)
}
export function restoreObservation788(source){
 if(typeof source!=='string')throw Error('OBS788_SOURCE_REQUIRED')
 if(source.includes('/*OBS476_BOUNDARY_BEGIN*/'))source=restoreCloseObservation476(source.includes('final class OwnedRunner705Observer')?'observer':'protocol',source)
 else if(source.includes('/*OBS476_CLOSE_VALUE_BEGIN*/'))source=restoreCloseObservation476('helper',source)
 else if(source.includes('/*OBS476_CLOSE_BEGIN*/'))source=restoreCloseObservation476('native',source)
 return source.replace(/\/\*OBS788_JOIN_BEGIN\*\/[\s\S]*?\/\*OBS788_JOIN_END\*\//g,'').replace(/\/\*OBS788_VALUE:([0-9a-f]{64})\*\/'[0-9a-f]{64}'\/\*OBS788_END_VALUE\*\//g,(_all,prior)=>"'"+prior+"'").replace(/\/\*OBS788_BEGIN\*\/[\s\S]*?\/\*OBS788_END\*\//g,'')
}
