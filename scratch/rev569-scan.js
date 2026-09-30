const fs=require('fs');
const lines=fs.readFileSync(process.env.HOME+'/.cmspark-agent/logs/companion-2026-09-30.log','utf8').split('\n').filter(Boolean);
const usage={};
const postKill={};
const killAt={'98z0ri':'2026-09-30T04:40:37.532Z','a56ebc':'2026-09-30T04:41:35.269Z'};
for(const l of lines){
  let j;try{j=JSON.parse(l)}catch(e){continue}
  const d=j.data||{};
  if(j.event==='llm.usage'){
    usage[d.thread_id]=usage[d.thread_id]||{rounds:0,last:null};
    usage[d.thread_id].rounds=Math.max(usage[d.thread_id].rounds,d.round||0);
    usage[d.thread_id].last=j.ts;
  }
  for(const tid of Object.keys(killAt)){
    if(JSON.stringify(d).includes(tid)&&j.ts>killAt[tid]) (postKill[tid]=postKill[tid]||[]).push(j.ts+' '+j.event);
  }
}
for(const t of ['ibg908','98z0ri','a56ebc','p151ef','y7l1tj']) console.log(t, JSON.stringify(usage[t]));
console.log('--- post-kill events mentioning dead threads ---');
for(const t of Object.keys(postKill)){console.log(t+':'); postKill[t].slice(0,20).forEach(x=>console.log('  ',x)); console.log('   total:',postKill[t].length);}
