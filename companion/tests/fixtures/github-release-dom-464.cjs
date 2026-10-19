// Actual public HTTP metadata bytes in a controlled DOM scaffold. This is an
// inert serialized-source seam, not an authenticated/hosted browser recording.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),Module=require('node:module'),ts=require('typescript'),{DOMParser}=require('@xmldom/xmldom');
const repo=path.resolve(__dirname,path.basename(path.dirname(__dirname))==='.test-dist'?'../../../..':'../../..'),cache=new Map();
function load(relative){const f=path.join(repo,relative);if(cache.has(f))return cache.get(f).exports;const m=new Module(f,module);m.filename=f;m.paths=Module._nodeModulePaths(path.dirname(f));m.require=function(id){if(id.startsWith('.'))return load(path.relative(repo,path.resolve(path.dirname(f),id))+'.ts');return require(id)};cache.set(f,m);const out=ts.transpileModule(fs.readFileSync(f,'utf8'),{fileName:f,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true},reportDiagnostics:true});if(out.diagnostics.length)throw Error('OWNED_SYNTAX');m._compile(out.outputText,f);return m.exports}
const {readPageHtml}=load('chrome-extension/src/background/page-read-tools.ts'),{PageSanitizer}=load('chrome-extension/src/background/page-sanitizer.ts');
const source=fs.readFileSync(path.join(repo,'chrome-extension/tests/fixtures/github-release-v0.6.11-header-464.html'),'utf8');
const url='https://github.com/nehcuh/cmspark/releases/tag/v0.6.11',selector='.Box-body div.d-flex.flex-row.flex-wrap.color-fg-muted.flex-items-end';
function documentFor(html){
 const doc=new DOMParser({onError:()=>{}}).parseFromString('<html><body><main><div class="Box"><div class="Box-body"><div class="tmp-mb-3 tmp-pb-md-4 border-md-bottom">'+html.replaceAll('&middot;','\u00b7')+'</div></div></div></main></body></html>','application/xml');
 const candidates=()=>Array.from(doc.getElementsByTagName('div')).filter(n=>['d-flex','flex-row','flex-wrap','color-fg-muted','flex-items-end'].every(c=>(n.getAttribute('class')||'').split(/\s+/).includes(c)));
 doc.querySelectorAll=s=>{if(s!==selector)throw Error('UNDECLARED_SELECTOR');return candidates()};doc.querySelector=s=>doc.querySelectorAll(s)[0]||null;
 for(const n of Array.from(doc.getElementsByTagName('*')))Object.defineProperty(n,'outerHTML',{get:()=>n.toString()});
 return doc;
}
async function read({html=source,currentUrl=url,changedUrl=null,channel='isolated',selectorOverride=selector,truncated=false}={}){
 const doc=documentFor(html);let current=currentUrl;
 const result=await readPageHtml(7,selectorOverride,{tab:async()=>({url:current,title:'Release v0.6.11'}),evaluate:async(_id,expression,_request,report)=>{report(channel);const value=vm.runInNewContext(expression,{document:doc,location:{href:current},URL,TextEncoder,atob});if(changedUrl)current=changedUrl;return{result:{value}}},outerHtml:async()=>{throw Error('UNEXPECTED_DOM_FALLBACK')},sanitizer:new PageSanitizer()});
 if(truncated)result.data.provenance.truncated=true;
 return result;
}
module.exports={read,source,url,selector,documentFor};
