// Source-coupled Windows bundle entry contract; no browser/WebView launch.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
const companion=path.resolve(__dirname,"../..")
const cpp=fs.readFileSync(path.join(companion,"src/desktop/native/DesktopHost.cpp"),"utf8")
function literal(name:string){return new RegExp(`static constexpr wchar_t ${name}\\[\\]=L"([^"]+)";`).exec(cpp)?.[1]}
function documentBindings(){return [
 /return web->Navigate\((\w+)\);/.exec(cpp)?.[1],
 /bool allow=uri&&std::wstring\(uri\)==(\w+);/.exec(cpp)?.[1],
 /bool own=uri&&std::wstring\(uri\)==(\w+);/.exec(cpp)?.[1],
 /void renderer\([^\n]+?source!=(\w+)\|\|generation.empty\(\)\)return;/.exec(cpp)?.[1],
 /resources\{\{(\w+),\{L"index.html",L"text\/html"\}\}/.exec(cpp)?.[1]
]}
test("Windows virtual folder entry is the explicit existing index.html document",()=>{
 const origin=literal("document_origin"),document=literal("document_url");assert.equal(origin,"https://cmspark-desktop.invalid/");assert.equal(document,"https://cmspark-desktop.invalid/index.html")
 const url=new URL(document!);assert.equal(url.origin,new URL(origin!).origin);assert.equal(url.search,"");assert.equal(url.hash,"")
 assert.equal(fs.statSync(path.join(companion,"src/desktop/assets",url.pathname)).isFile(),true)
 assert.equal(fs.statSync(path.join(companion,"src/desktop/assets")).isDirectory(),true)
 assert.match(cpp,/SetVirtualHostNameToFolderMapping\(L"cmspark-desktop.invalid",\(root\+L"\\\\assets"\)\.c_str\(\),COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS\)/)
})
test("Navigate, main-frame start/completion, renderer and HTML map use the same exact file identity",()=>{
 assert.deepEqual(documentBindings(),Array(5).fill("document_url"))
 assert.match(cpp,/if\(allow\)\{generation.clear\(\);requests.clear\(\);\}/)
 assert.match(cpp,/if\(ok&&own&&ready\)document\(\);/)
 assert.match(cpp,/if\(!ready\|\|source!=document_url\|\|generation.empty\(\)\)return;/)
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
})
