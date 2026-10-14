/** #644 finite discovery diagnostics. Missing/contradictory metadata is unreported. */
export const registryDiscoveryReasons = ["KEY_LIMIT","CANDIDATE_LIMIT","OUTPUT_LIMIT","VALUE_LIMIT","ACCESS_DENIED","REGISTRY_READ_FAILED"] as const
export type RegistryDiscoverySummary = {status:"complete"|"partial"|"unavailable";reasons:(typeof registryDiscoveryReasons[number])[]}
export function registrySummaryFromMessage(raw: unknown, registryRows: number): RegistryDiscoverySummary|null {
 if(!raw||typeof raw!=="object"||Array.isArray(raw))return null
 const v=raw as Record<string,unknown>
 if(Object.keys(v).some(k=>k!=="status"&&k!=="reasons")||!Array.isArray(v.reasons)||v.reasons.length>6)return null
 const reasons=v.reasons
 if(reasons.some(r=>typeof r!=="string"||!(registryDiscoveryReasons as readonly string[]).includes(r))||new Set(reasons).size!==reasons.length)return null
 if(v.status==="complete"?reasons.length!==0:v.status==="partial"?reasons.length===0:v.status==="unavailable"?reasons.length===0||registryRows>0||reasons.some(r=>r!=="ACCESS_DENIED"&&r!=="REGISTRY_READ_FAILED"):true)return null
 return{status:v.status as RegistryDiscoverySummary["status"],reasons:registryDiscoveryReasons.filter(r=>reasons.includes(r))}
}
