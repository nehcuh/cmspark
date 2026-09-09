// Real KnowledgeGraphApp and graph builder; only Chrome storage/runtime are fake.
// Never reads a user knowledge index or starts a Companion connection.
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const out = process.argv[2];
if (!out) throw new Error('output directory required');
const esbuild = require(path.join(root, 'node_modules/esbuild'));

async function main() {
  fs.mkdirSync(out, { recursive: true });
  // The serializer is private in a large router with live configuration imports.
  // Execute its exact source with only that configuration boundary replaced;
  // do not hand-copy the wire keys into a fixture and assume they are correct.
  const router = fs.readFileSync(path.join(root, '../companion/src/message-router.ts'), 'utf8');
  const serializer = router.match(/\nfunction knowledgeGraphFrame\([\s\S]*?\n}\n/)?.[0];
  if (!serializer) throw new Error('production knowledgeGraphFrame definition not found');
  const rebuilding = router.slice(router.indexOf('const graph = skillEngine.getKnowledgeGraph'))
    .match(/if \(!graph\) \{[\s\S]*?return (\{[\s\S]*?\n        \})\n/)?.[1];
  if (!rebuilding) throw new Error('production rebuilding frame definition not found');
  const built = await esbuild.build({
    stdin: { contents: `export {buildKnowledgeGraph} from '../companion/src/skills/knowledge-graph';
      const knowledgeExtractLlmConfig=()=>({provider:'fixture'});
      let knowledgeGraphOrganizeRun=null;export function setOrganizing(value){knowledgeGraphOrganizeRun=value?{}:null;}
      ${serializer}\nexport {knowledgeGraphFrame};
      export function rebuildingFrame(){const actionError=undefined;return ${rebuilding};}`, resolveDir: root, loader: 'ts' },
    bundle: true, platform: 'node', format: 'cjs', write: false,
  });
  const production = new Module(path.join(out, 'graph-builder.cjs'), module);
  production._compile(built.outputFiles[0].text, path.join(out, 'graph-builder.cjs'));
  const { buildKnowledgeGraph, knowledgeGraphFrame, rebuildingFrame, setOrganizing } = production.exports;
  const graphs = { rebuilding: rebuildingFrame() };
  for (const count of [0, 1, 4, 20, 200]) {
    const docs = Array.from({ length: count }, (_, i) => ({
      id: `fixture-${String(i + 1).padStart(3, '0')}`,
      name: `fixture-${i + 1}`, title: ['SQLite 离线检索', 'Orchids 高山兰花', 'Telescope 天文观测', 'Sourdough 面包发酵'][i] || `Knowledge${String(i + 1).padStart(3, '0')}`,
      tags: [], folder: i % 2 ? '旅行' : '开发', bucket: 'global',
      // Deliberately orthogonal: zero TF edges is a real production result.
      vec: { [`unique-${i}`]: 1 }, description: '',
    }));
    graphs[count] = knowledgeGraphFrame(buildKnowledgeGraph(docs));
    if (count === 20) {
      graphs.locked20 = knowledgeGraphFrame(buildKnowledgeGraph(docs, undefined, { lock: { groups: [
        { ids: [docs[0].id, docs[2].id], name: '保留的研究主题', summary: '来自小语料阶段的锁定分组' },
      ] } }));
    }
    if (count === 4) {
      const llm = {
        groups: [{ ids: [docs[0].id, docs[2].id], name: '开发主题', summary: '两篇开发笔记' }],
        relations: [{ a: docs[0].id, b: docs[2].id, reason: '共同讨论开发实践', confidence: 0.9 }],
      };
      graphs.organized = knowledgeGraphFrame(buildKnowledgeGraph(docs, undefined, { llm }));
      setOrganizing(true);
      graphs.organizing = knowledgeGraphFrame(buildKnowledgeGraph(docs, undefined, { llm }));
      setOrganizing(false);
      graphs.locked = knowledgeGraphFrame(buildKnowledgeGraph(docs, undefined, { llm, lock: { groups: llm.groups } }));
      graphs.similar = knowledgeGraphFrame(buildKnowledgeGraph(docs.map((doc, i) => ({ ...doc, description: i < 2 ? 'shared retrieval database indexing' : '' }))));
    }
  }
  fs.writeFileSync(path.join(out, 'builder-output.json'), JSON.stringify(graphs, null, 2));
  const source = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {KnowledgeGraphApp} from './src/knowledge-graph/KnowledgeGraphApp';
import {parseKnowledgeGraphPayload} from './src/knowledge-graph/wire';
import {KNOWLEDGE_GRAPH_SNAPSHOT_KEY as KEY,writeKnowledgeGraphSnapshot,knowledgeGraphErrorPayload} from './src/background/knowledge-graph';
import {KNOWLEDGE_GRAPH_LLM_LABELS_KEY} from './src/knowledge-graph/llm-pref';
const graphs=${JSON.stringify(graphs)};
const listeners=new Set(); const session={}; const local=new URLSearchParams(location.search).has('labels')?{[KNOWLEDGE_GRAPH_LLM_LABELS_KEY]:true}:{};
window.sent=[];window.storageReads=0;window.storageReleased=false;window.sendFailure=false;
let suppressStorageEvent=false;
let release;const initialRead=new Promise(resolve=>release=resolve);
const emit=(changes,area)=>{for(const fn of [...listeners])fn(changes,area)};
window.chrome={runtime:{lastError:undefined,sendMessage:(message,callback)=>{window.sent.push(message);const response={sent:!window.sendFailure};callback?.(response);return Promise.resolve(response)}},storage:{
session:{get:async()=>{window.storageReads++;await initialRead;return {...session}},set:async values=>{Object.assign(session,values);if(!suppressStorageEvent)emit(Object.fromEntries(Object.entries(values).map(([key,newValue])=>[key,{newValue}])), 'session')}},
local:{get:async()=>({...local}),set:async values=>{Object.assign(local,values);emit(Object.fromEntries(Object.entries(values).map(([key,newValue])=>[key,{newValue}])), 'local')}},
onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)}}};
window.graphFixture={graphs,
async publish(key,extra){const payload=key==='error'?knowledgeGraphErrorPayload({type:'error',error:'knowledge.graph fixture failure'}):parseKnowledgeGraphPayload(graphs[key]);if(!payload)throw new Error('invalid production payload');await writeKnowledgeGraphSnapshot(payload,extra);},
async release(key='4',extra){suppressStorageEvent=true;await this.publish(key,extra);suppressStorageEvent=false;window.storageReleased=true;release();},
readSnapshot:()=>session[KEY]};
// Observe real drawing and preserve every native call. Counters alone cannot
// pass the regression: Python also checks native Canvas pixels and dimensions.
window.drawProbe={arcs:0,text:[],frames:0,latestArcs:[],latestText:[],latestLines:[],path:[],frameHistory:[]};
for(const name of ['arc','fillText','clearRect','beginPath','moveTo','lineTo','stroke']){const native=CanvasRenderingContext2D.prototype[name];CanvasRenderingContext2D.prototype[name]=function(...args){const p=window.drawProbe;if(name==='clearRect'){p.frames++;p.latestArcs=[];p.latestText=[];p.latestLines=[]}if(name==='beginPath')p.path=[];if(name==='moveTo'||name==='lineTo'){const t=this.getTransform();p.path.push({x:t.a*args[0]+t.c*args[1]+t.e,y:t.b*args[0]+t.d*args[1]+t.f})}if(name==='stroke'&&p.path.length===2)p.latestLines.push({a:p.path[0],b:p.path[1],dashed:this.getLineDash().length>0});if(name==='arc'){p.arcs++;const t=this.getTransform();p.latestArcs.push({x:t.a*args[0]+t.c*args[1]+t.e,y:t.b*args[0]+t.d*args[1]+t.f,r:args[2]*t.a})}if(name==='fillText'){p.text.push(String(args[0]));p.latestText.push(String(args[0]));if(p.text.length>2000)p.text.splice(0,1000)}return native.apply(this,args)}};
const clearFrame=CanvasRenderingContext2D.prototype.clearRect;
CanvasRenderingContext2D.prototype.clearRect=function(...args){
  const p=window.drawProbe;
  if(p.latestArcs.length&&p.frameHistory.length<120)p.frameHistory.push({frame:p.frames,width:p.frameWidth,height:p.frameHeight,
    nodes:p.latestArcs.length,visible:p.latestArcs.filter(n=>n.x>=0&&n.y>=0&&n.x<p.frameWidth&&n.y<p.frameHeight).length});
  p.frameWidth=this.canvas.width;p.frameHeight=this.canvas.height;
  return clearFrame.apply(this,args);
};
createRoot(document.getElementById('root')).render(<KnowledgeGraphApp/>);
`;
  const baseline = process.argv.includes('--baseline');
  const plugins = baseline ? [{ name: 'baseline-app', setup(build) {
    build.onLoad({ filter: /KnowledgeGraphApp\.tsx$/ }, () => ({
      contents: execFileSync('git', ['show', 'aada096a:chrome-extension/src/knowledge-graph/KnowledgeGraphApp.tsx'], { cwd: root, encoding: 'utf8' }),
      loader: 'tsx', resolveDir: path.join(root, 'src/knowledge-graph'),
    }));
  } }] : [];
  await esbuild.build({ stdin: { contents: source, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: path.join(out, 'app.js'), jsx: 'automatic', plugins });
  fs.writeFileSync(path.join(out, 'index.html'), '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="root"></div><script src="app.js"></script></body></html>');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
