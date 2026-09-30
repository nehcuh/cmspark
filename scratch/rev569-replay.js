// Replay same-tool guard over persisted thread files, per adapter.ts rules.
const fs=require('fs');
const LOCATOR=new Set(['ELEMENT_NOT_FOUND','ELEMENT_AMBIGUOUS','SELECTOR_OR_TEXT_REQUIRED','INVALID_SELECTOR']);
const LOCATOR_TEXT=['element_not_found','no visible element matching','element_ambiguous','elements match text'];
const isLocator=(code,err)=>{ if(code&&LOCATOR.has(code))return true; const t=(err||'').toLowerCase(); return LOCATOR_TEXT.some(p=>t.includes(p)); };
const SKIP=new Set(['SITE_OP_BANNED','SITE_OP_ESCALATE']);

for(const id of ['ibg908','98z0ri','a56ebc','p151ef','y7l1tj']){
  const j=JSON.parse(fs.readFileSync('C:/Users/HuChen/.cmspark-agent/threads/'+id+'.json','utf8'));
  const counts={}; const pivoted={};
  let stopAt=null;
  const trace=[];
  for(const m of j.messages){
    if(m.role!=='tool') continue;
    const tc=(m.tool_calls||[])[0]||{};
    const tool=tc.tool_name||'?';
    let r; try{r=JSON.parse(m.content)}catch(e){continue}
    const ts=(m.created_at||'').slice(11,19);
    if(r.success){ delete counts[tool]; delete pivoted[tool]; continue; }
    const code=(tc.result&&tc.result.data&&tc.result.data.error_code)||r.data&&r.data.error_code||null;
    const err=r.error||'';
    if(SKIP.has(code)){ trace.push(`${ts} ${tool} ${code} SKIP(budget-guard)`); continue; }
    counts[tool]=(counts[tool]||0)+1;
    const n=counts[tool];
    if(n<3){ trace.push(`${ts} ${tool} ${code||err.slice(0,40)} count=${n}`); continue; }
    if(!pivoted[tool]&&isLocator(code,err)){ pivoted[tool]=true; counts[tool]=0; trace.push(`${ts} ${tool} ${code} count=${n} -> PIVOT(reset)`); continue; }
    trace.push(`${ts} ${tool} ${code||err.slice(0,40)} count=${n} -> *** STOP (circuit_breaker) ***`);
    stopAt=m.created_at; break;
  }
  console.log('===== '+id+' ===== stop='+(stopAt||'none'));
  trace.forEach(l=>console.log('  '+l));
}
