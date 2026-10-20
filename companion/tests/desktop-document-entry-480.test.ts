// Source-coupled Windows bundle entry contract; no browser/WebView launch.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
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
test("Windows virtual folder entry is the explicit existing index.html document",()=>{
 const origin=literal("document_origin"),document=literal("document_url");assert.equal(origin,"https://cmspark-desktop.invalid/");assert.equal(document,"https://cmspark-desktop.invalid/index.html")
 const url=new URL(document!);assert.equal(url.origin,new URL(origin!).origin);assert.equal(url.search,"");assert.equal(url.hash,"")
 assert.equal(fs.statSync(path.join(companion,"src/desktop/assets",url.pathname)).isFile(),true)
 assert.equal(fs.statSync(path.join(companion,"src/desktop/assets")).isDirectory(),true)
 assert.match(cpp,/SetVirtualHostNameToFolderMapping\(L"cmspark-desktop.invalid",\(root\+L"\\\\assets"\)\.c_str\(\),COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS\)/)
})
function assertDocumentLifecycle(source:string){
 assert.deepEqual(documentBindings(source),Array(5).fill("document_url"))
 assert.match(source,/if\(allow\)\{if\(!retire_browser\(true\)\)ExitProcess\(46\);retire_archive\(\);retire_dialog\(\);retire_confirmation\(0\);generation.clear\(\);requests.clear\(\);style_nonce=random_id\(\)\+random_id\(\);\}/)
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
 const entries=[['index.html','text/html'],['app.css','text/css'],['app.js','text/javascript'],['terminal.css','text/css'],['terminal-fit.js','text/javascript'],['terminal-core.js','text/javascript'],['local-work.js','text/javascript']]
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
 const actual="if(allow){if(!retire_browser(true))ExitProcess(46);retire_archive();retire_dialog();retire_confirmation(0);generation.clear();requests.clear();style_nonce=random_id()+random_id();}"
 assert.equal(cpp.split(actual).length,2)
 for(const changed of [actual.replace("if(!retire_browser(true))ExitProcess(46);",""),actual.replace("retire_browser(true)","retire_browser(false)"),actual.replace("ExitProcess(46)","ExitProcess(45)"),actual.replace("retire_archive();",""),actual.replace("retire_dialog();",""),actual.replace("retire_confirmation(0);",""),actual.replace("generation.clear();",""),actual.replace("requests.clear();",""),actual.replace("style_nonce=random_id()+random_id();",""),actual.replace("style_nonce=random_id()+random_id();","style_nonce=random_id();"),"if(allow){generation.clear();if(!retire_browser(true))ExitProcess(46);retire_archive();retire_dialog();retire_confirmation(0);requests.clear();style_nonce=random_id()+random_id();}"])assert.throws(()=>assertDocumentLifecycle(cpp.replace(actual,changed)))
 assert.throws(()=>assertDocumentLifecycle(cpp.replace("source!=document_url","source!=document_origin")))
 assert.throws(()=>assertDocumentLifecycle(cpp.replace("if(ok&&own&&ready)document();","if(ok&&own)document();")))
})
