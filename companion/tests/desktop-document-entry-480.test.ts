// Source-coupled Windows bundle entry contract; no browser/WebView launch.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
const companion=path.resolve(__dirname,"../..")
const cpp=fs.readFileSync(path.join(companion,"src/desktop/native/DesktopHost.cpp"),"utf8")
function literal(name:string){return new RegExp(`static constexpr wchar_t ${name}\\[\\]=L"([^"]+)";`).exec(cpp)?.[1]}
function documentBindings(source=cpp){return [
 /return web->Navigate\((\w+)\);/.exec(source)?.[1],
 /bool allow=uri&&std::wstring\(uri\)==(\w+);/.exec(source)?.[1],
 /bool own=uri&&std::wstring\(uri\)==(\w+);/.exec(source)?.[1],
 /void renderer\([^\n]+?source!=(\w+)\|\|generation.empty\(\)\)return;/.exec(source)?.[1],
 /resources\{\{(\w+),\{L"index.html",L"text\/html"\}\}/.exec(source)?.[1]
]}
test("Windows intercepted entry is the explicit existing index.html document",()=>{
 const origin=literal("document_origin"),document=literal("document_url");assert.equal(origin,"https://cmspark-desktop.invalid/");assert.equal(document,"https://cmspark-desktop.invalid/index.html")
 const url=new URL(document!);assert.equal(url.origin,new URL(origin!).origin);assert.equal(url.search,"");assert.equal(url.hash,"")
 assert.equal(fs.statSync(path.join(companion,"src/desktop/assets",url.pathname)).isFile(),true)
 assert.equal(fs.statSync(path.join(companion,"src/desktop/assets")).isDirectory(),true)
 assert.doesNotMatch(cpp,/SetVirtualHostNameToFolderMapping\(/)
})
function assertDocumentLifecycle(source:string){
 assert.deepEqual(documentBindings(source),Array(5).fill("document_url"))
 assert.match(source,/if\(allow\)\{retire_local\(\);retire_workspace\(\);if\(!retire_browser\(true\)\)ExitProcess\(46\);retire_archive\(\);retire_dialog\(\);retire_confirmation\(0\);generation.clear\(\);requests.clear\(\);style_nonce=random_id\(\)\+random_id\(\);\}/)
 assert.match(source,/if\(ok&&own&&ready\)document\(\);/)
 assert.match(source,/if\(!ready\|\|source!=document_url\|\|generation.empty\(\)\)return;/)
}
test("Navigate, main-frame start/completion, renderer and HTML map use the same exact file identity",()=>{
 assertDocumentLifecycle(cpp)
})
test("all five source-bound document identities reject directory, aliases and foreign documents",()=>{
 const bindings=documentBindings().map(name=>literal(name||""));assert.equal(bindings.length,5)
 const expected="https://cmspark-desktop.invalid/index.html",rejected=["https://cmspark-desktop.invalid/",expected+"?x=1",expected+"#fragment","https://cmspark-desktop.invalid/other.html","https://cmspark-desktop.invalid/app.js","http://cmspark-desktop.invalid/index.html","https://foreign.invalid/index.html","https://cmspark-desktop.invalid/%69ndex.html","https://cmspark-desktop.invalid/INDEX.HTML"]
 for(const target of bindings){assert.equal(expected===target,true);for(const value of rejected)assert.equal(value===target,false)}
})
test("origin-relative CSS and JS retain their original exact bundle resources",()=>{
 const origin=literal("document_origin"),document=literal("document_url");assert.ok(origin);assert.ok(document)
 for(const name of ["app.css","app.js"]){assert.equal(new URL(name,document!).href,new URL(name,origin!).href);assert.equal(fs.statSync(path.join(companion,"src/desktop/assets",name)).isFile(),true)}
 assert.match(cpp,/std::wstring\(document_origin\)\+L"app.css",\{L"app.css",L"text\/css"\}/)
 assert.match(cpp,/std::wstring\(document_origin\)\+L"app.js",\{L"app.js",L"text\/javascript"\}/)
 const html=fs.readFileSync(path.join(companion,"src/desktop/assets/index.html"),"utf8");assert.match(html,/href="app.css"/);assert.match(html,/src="app.js"/);assert.match(html,/default-src 'none'/);assert.match(html,/connect-src 'none'/)
 // xterm files are build-produced assets, not source assets. Bind their exact
 // native URI map here; the original source app.css/app.js checks above remain.
 const entries=[['index.html','text/html'],['app.css','text/css'],['app.js','text/javascript'],['local-work.js','text/javascript'],['terminal-core.js','text/javascript'],['terminal-fit.js','text/javascript'],['terminal.css','text/css']]
 const mapping=(source:string)=>/std::map<std::wstring,std::pair<std::wstring,std::wstring>> resources(\{[^;]+\});auto found=resources.find\(u\);/.exec(source)?.[1]
 const expected='{'+entries.map(([name,mime])=>`{${name==='index.html'?'document_url':`std::wstring(document_origin)+L"${name}"`},{L"${name}",L"${mime}"}}`).join(',')+'}'
 assert.equal(mapping(cpp),expected)
 for(const [name] of entries)assert.equal(new URL(name,document!).href,new URL(name,origin!).href)
 assert.equal(fs.statSync(path.join(companion,'src/desktop/assets/local-work.js')).isFile(),true)
 const styles=[...html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)].map(row=>row[1]);assert.deepEqual(styles,['app.css','terminal.css'])
 const scripts=[...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(row=>row[1]);assert.deepEqual(scripts,['terminal-core.js','terminal-fit.js','local-work.js','app.js'])
 for(const [name,mime] of entries){
  const key=name==='index.html'?'document_url':`std::wstring(document_origin)+L"${name}"`,row=`{${key},{L"${name}",L"${mime}"}}`
  assert.equal(cpp.split(row).length,2)
  for(const replacement of [row.replace(key,'document_origin'),row.replace(`L"${name}",L"${mime}"`,`L"wrong-asset",L"${mime}"`),row.replace(`L"${mime}"`,'L"application/octet-stream"')])assert.notStrictEqual(mapping(cpp.replace(row,replacement)),expected)
 }
 assert.notStrictEqual(mapping(cpp.replace('};auto found=resources.find(u);',',{std::wstring(document_origin)+L"extra.js",{L"extra.js",L"text/javascript"}}};auto found=resources.find(u);')),expected)
})

test("document identity and archive-aware retirement remain strict for LF/CRLF and source mutations",()=>{
 for(const source of [cpp,cpp.replace(/\r?\n/g,"\r\n")])assertDocumentLifecycle(source)
 const actual="if(allow){retire_local();retire_workspace();if(!retire_browser(true))ExitProcess(46);retire_archive();retire_dialog();retire_confirmation(0);generation.clear();requests.clear();style_nonce=random_id()+random_id();}"
 assert.equal(cpp.split(actual).length,2)
 for(const changed of [actual.replace("retire_local();",""),actual.replace("retire_workspace();",""),actual.replace("style_nonce=random_id()+random_id();",""),actual.replace("style_nonce=random_id()+random_id();","style_nonce=random_id();"),actual.replace("if(!retire_browser(true))ExitProcess(46);",""),actual.replace("retire_browser(true)","retire_browser(false)"),actual.replace("ExitProcess(46)","ExitProcess(45)"),actual.replace("retire_archive();",""),actual.replace("retire_dialog();",""),actual.replace("retire_confirmation(0);",""),actual.replace("generation.clear();",""),actual.replace("requests.clear();",""),"if(allow){generation.clear();if(!retire_browser(true))ExitProcess(46);retire_archive();retire_dialog();retire_confirmation(0);requests.clear();}"])assert.throws(()=>assertDocumentLifecycle(cpp.replace(actual,changed)))
 assert.throws(()=>assertDocumentLifecycle(cpp.replace("source!=document_url","source!=document_origin")))
 assert.throws(()=>assertDocumentLifecycle(cpp.replace("if(ok&&own&&ready)document();","if(ok&&own)document();")))
})

function assertInterceptedRoute(source:string){
 // Microsoft documents that virtual-host mapping bypasses WebResourceRequested.
 // This is a source contract, not an emulated WebView dispatch implementation.
 assert.doesNotMatch(source,/SetVirtualHostNameToFolderMapping\(/)
 const navigate=source.indexOf('return web->Navigate(document_url);');assert.ok(navigate>0)
 for(const [name,call]of [['navigation_start','add_NavigationStarting'],['resource_filter','AddWebResourceRequestedFilter'],['resource_handler','add_WebResourceRequested']]){
  const registration=source.indexOf(`auto ${name}_result=web->${call}(`)
  const failure=source.indexOf(`if(FAILED(${name}_result)){ExitProcess(54);return ${name}_result;}`)
  assert.ok(registration>0&&failure>registration&&failure<navigate,`${name} must reject registration failure before Navigate`)
 }
 assert.match(source,/AddWebResourceRequestedFilter\(L"\*",COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL\)/)
 assert.match(source,/found==resources.end\(\)\)environment->CreateWebResourceResponse\(nullptr,403,L"Denied"/)
 assert.ok(source.includes('found->second.first==L"index.html"&&!desktop_style_html(data,style_nonce)'))
 assert.ok(source.includes('X-Content-Type-Options: nosniff\\r\\n'))
}
test('Windows has one intercepted asset path and rejects setup failure before navigation',()=>{
 for(const source of [cpp,cpp.replace(/\r?\n/g,'\r\n')])assertInterceptedRoute(source)
 // Reintroducing the old competing producer must fail even when the response
 // handler body itself is unchanged and individually passes its nonce tests.
 assert.throws(()=>assertInterceptedRoute(cpp+'\nweb->SetVirtualHostNameToFolderMapping("cmspark-desktop.invalid",root,0);'))
 for(const name of ['navigation_start','resource_filter','resource_handler']){
  const failure=`if(FAILED(${name}_result)){ExitProcess(54);return ${name}_result;}`
  for(const changed of ['',failure.replace('FAILED','SUCCEEDED'),failure.replace('ExitProcess(54);',''),failure.replace(`return ${name}_result;`,'')])assert.throws(()=>assertInterceptedRoute(cpp.replace(failure,changed)))
 }
})

function nonceResponse(input:string,nonce:string,sourceText=cpp){
 // Lower #705's complete two-marker helper, not #747's different one-marker helper.
 // All source predicates and replacement order remain; this is string semantics only.
 const body=/static bool desktop_style_html\(std::string& data,std::wstring const& nonce\)\{([\s\S]*?)\n\}\nstatic JsonObject parse/.exec(sourceText.replace(/\r\n/g,'\n'))?.[1];assert.ok(body)
 const loop='for(auto marker:{"__CMSPARK_STYLE_NONCE_CSP__","__CMSPARK_STYLE_NONCE_META__"})'
 assert.equal(body.split(loop).length,3)
 let js=body.split(loop).join('for(const marker of ["__CMSPARK_STYLE_NONCE_CSP__","__CMSPARK_STYLE_NONCE_META__"])').replace(/auto /g,'const ').replace(/data.find\(/g,'data.indexOf(').replace(/std::string::npos/g,'-1').replace(/std::strlen\(marker\)/g,'marker.length')
 js=js.replace('data.replace(data.indexOf(marker),marker.length,value);','data=data.slice(0,data.indexOf(marker))+value+data.slice(data.indexOf(marker)+marker.length);').replace('return data.indexOf("__CMSPARK_STYLE_NONCE_")==-1;','return data.indexOf("__CMSPARK_STYLE_NONCE_")==-1?data:false;')
 assert.doesNotMatch(js,/std::|\bauto\b|\.find\(|data\.replace\(/)
 return new Function('data','nonce','hex','utf8',js)(input,nonce,(s:string,n:number)=>s.length===n&&/^[a-f0-9]+$/.test(s),(s:string)=>s) as string|false
}
function styleFactories(){
 const vendor=fs.readFileSync(path.join(companion,'node_modules/@xterm/xterm/lib/xterm.js'))
 const {transformXtermStyleNonce}=require(path.join(companion,'scripts/desktop-xterm-style-nonce.cjs'))
 // The production transform checks exact version, length, SHA and full inverse.
 const emitted=transformXtermStyleNonce(vendor,'6.0.0').toString('utf8')
 const expressions=[...emitted.matchAll(/\/\*CMSPARK_STYLE_NONCE_476\*\/(\(\(d\)=>\{[\s\S]*?\}\))\((s\.mainDocument|this\._document|document)\)/g)]
 assert.equal(expressions.length,4)
 return expressions.map(row=>vm.runInNewContext(row[1],Object.create(null),{timeout:1000}))
}
function styleFrom(factory:(doc:unknown)=>unknown,html:string){
 const metas=[...html.matchAll(/<meta name="cmspark-style-nonce" content="([^"]*)">/g)].map(row=>({content:row[1]})),element:{nonce?:string}={};let creations=0
 const document={createElement(name:string){assert.equal(name,'style');creations++;return element},querySelectorAll(selector:string){assert.equal(selector,'meta[name="cmspark-style-nonce"]');return metas}}
 const returned=factory(document);assert.equal(returned,element);assert.equal(creations,1);return element
}
test('actual packaged HTML fails all four pinned style factories until the real nonce helper produces the response',()=>{
 const raw=fs.readFileSync(path.join(companion,'src/desktop/assets/index.html'),'utf8'),factories=styleFactories()
 // Only source extraction canonicalizes line endings; actual HTML bytes are never rewritten.
 const expected=nonceResponse(raw,'a'.repeat(64))
 for(const profile of [cpp.replace(/\r\n/g,'\n'),cpp.replace(/\r?\n/g,'\r\n')]){assert.equal(nonceResponse(raw,'a'.repeat(64),profile),expected);assert.equal(nonceResponse(raw,'',profile),false)}
 for(const marker of ['__CMSPARK_STYLE_NONCE_CSP__','__CMSPARK_STYLE_NONCE_META__'])assert.equal(raw.split(marker).length,2)
 for(const factory of factories)assert.throws(()=>styleFrom(factory,raw),/XTERM_STYLE_NONCE_UNAVAILABLE/)
 // Distinct synthetic navigation nonces enter the actual producer helper. They
 // are shape controls, not a claim of observed native randomness or rendering.
 for(const nonce of ['a'.repeat(64),'b'.repeat(64)]){
  const response=nonceResponse(raw,nonce);assert.equal(typeof response,'string');if(response===false)throw Error('NONCE_RESPONSE')
  assert.ok(response.includes(`'nonce-${nonce}'`));assert.ok(!response.includes('__CMSPARK_STYLE_NONCE_'))
  for(const factory of factories)assert.equal(styleFrom(factory,response).nonce,nonce)
  // Already-substituted/stale HTML is never admitted as a fresh response.
  assert.equal(nonceResponse(response,'c'.repeat(64)),false)
 }
 for(const nonce of ['', 'a'.repeat(63), 'A'.repeat(64), '__CMSPARK_STYLE_NONCE_META__'])assert.equal(nonceResponse(raw,nonce),false)
 for(const marker of ['__CMSPARK_STYLE_NONCE_CSP__','__CMSPARK_STYLE_NONCE_META__']){
  for(const html of [raw.replace(marker,''),raw+marker])assert.equal(nonceResponse(html,'a'.repeat(64)),false)
 }
 for(const html of [raw+raw,raw+'__CMSPARK_STYLE_NONCE_UNKNOWN__'])assert.equal(nonceResponse(html,'a'.repeat(64)),false)
 // This helper validates marker uniqueness, not HTML tag identity. The unchanged
 // style factory must reject a missing nonce meta; do not invent a helper guard.
 const wrongMeta=nonceResponse(raw.replace('name="cmspark-style-nonce"','name="other"'),'a'.repeat(64));assert.equal(typeof wrongMeta,'string');if(wrongMeta===false)throw Error('NONCE_RESPONSE')
 for(const factory of factories)assert.throws(()=>styleFrom(factory,wrongMeta),/XTERM_STYLE_NONCE_UNAVAILABLE/)
})
test('actual native resource map rejects foreign, unlisted and traversal URI strings before file selection',()=>{
 const body=/std::map<std::wstring,std::pair<std::wstring,std::wstring>> resources(\{[^;]+\});auto found=resources.find\(u\);/.exec(cpp)?.[1];assert.ok(body)
 const rows=[...body.matchAll(/\{(document_url|std::wstring\(document_origin\)\+L"([^"]+)"),\{L"([^"]+)",L"([^"]+)"\}\}/g)]
 const entries=new Map(rows.map(row=>[row[1]==='document_url'?literal('document_url')!:literal('document_origin')!+row[2],{file:row[3],mime:row[4]}]));assert.equal(entries.size,7)
 const origin=literal('document_origin')!
 for(const uri of [origin,origin+'unknown.js',origin+'terminal-core.LICENSE.txt',origin+'../index.html',origin+'%2e%2e/index.html',origin+'%69ndex.html',origin+'index.html?x=1',origin+'index.html#x',origin+'INDEX.HTML','http://cmspark-desktop.invalid/index.html','https://foreign.invalid/index.html','file:///index.html'])assert.equal(entries.get(uri),undefined,uri)
 assert.deepEqual(entries.get(literal('document_url')!),{file:'index.html',mime:'text/html'})
 // This string-map check deliberately does not claim browser URL canonicalization.
 assert.match(cpp,/if\(found==resources.end\(\)\)environment->CreateWebResourceResponse\(nullptr,403,L"Denied"/)
})
