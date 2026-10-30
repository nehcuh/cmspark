'use strict';
// Real shell builder with owned files and inert tool stubs; never executes Mach-O or signing.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
const builder=fs.readFileSync(path.resolve(__dirname,'../../companion/scripts/build-cmspark-whisper.sh'));
const ompRule=fs.readFileSync(path.resolve(__dirname,'../whisper-omp-name.sh'));
const generationHelper=fs.readFileSync(path.resolve(__dirname,'../whisper-generation.mjs'));
function fixture(t,libs){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cmspark-soname-783-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const dir=p=>fs.mkdirSync(path.join(root,p),{recursive:true}),write=(p,v)=>fs.writeFileSync(path.join(root,p),v);for(const p of ['companion/scripts','scripts','w/lib','g/lib','stubs'])dir(p);
 write('companion/scripts/build-cmspark-whisper.sh',builder);write('scripts/whisper-omp-name.sh',ompRule);write('scripts/whisper-generation.mjs',generationHelper);write('source','OWNED_CLI');for(const [p,v] of Object.entries(libs))write(p,v);
 const stub=(n,body)=>{write('stubs/'+n,'#!/bin/sh\n'+body+'\n');fs.chmodSync(path.join(root,'stubs',n),0o700)};
 stub('uname','case "$1" in -s) printf Darwin;; -m) printf arm64;; esac');stub('brew','case "$2" in whisper-cpp) printf "%s" "$OWNED_ROOT/w";; ggml) printf "%s" "$OWNED_ROOT/g";; esac');
 stub('otool','printf "%s:\\n\\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1.0.0)\\n" "$2"');stub('install_name_tool','exit 0');stub('codesign','exit 0');
 stub('node','exec "$NODE_BINARY" "$@"');
 const env={PATH:path.join(root,'stubs')+':/usr/bin:/bin',OWNED_ROOT:root,CMSPARK_WHISPER_SRC:path.join(root,'source'),NODE_BINARY:process.execPath};
 const run=()=>cp.spawnSync('/bin/bash',[path.join(root,'companion/scripts/build-cmspark-whisper.sh')],{cwd:root,env,encoding:'utf8'});
 return {root,run,lib:n=>{const store=path.join(root,'companion/dist/.whisper-generations');const dirs=fs.readdirSync(store);assert.equal(dirs.length,1);return path.join(store,dirs[0],'lib',n)}};
}
test('actual builder preserves regular files whose names already equal their sonames',t=>{
 const f=fixture(t,{'w/lib/libwhisper.1.dylib':'WHISPER','g/lib/libggml.0.dylib':'GGML','g/lib/libggml-base.0.dylib':'BASE'}),r=f.run();assert.equal(r.status,0,r.stderr);
 for(const [base,bytes] of [['libwhisper.1.dylib','WHISPER'],['libggml.0.dylib','GGML'],['libggml-base.0.dylib','BASE']]){assert.equal(fs.lstatSync(f.lib(base)).isFile(),true);assert.equal(fs.readFileSync(f.lib(base),'utf8'),bytes)}
 for(const [alias,target] of [['libwhisper.dylib','libwhisper.1.dylib'],['libggml.dylib','libggml.0.dylib'],['libggml-base.dylib','libggml-base.0.dylib']]){assert.equal(fs.readlinkSync(f.lib(alias)),target);assert.ok(fs.readFileSync(f.lib(alias)).length>0)}
});
test('actual builder links versioned libraries without overwriting regular aliases',t=>{
 const f=fixture(t,{'w/lib/libwhisper.1.2.dylib':'WHISPER','g/lib/libggml.0.2.dylib':'GGML','g/lib/libggml-base.0.2.dylib':'BASE'}),r=f.run();assert.equal(r.status,0,r.stderr);
 for(const [alias,target] of [['libwhisper.1.dylib','libwhisper.1.2.dylib'],['libggml.0.dylib','libggml.0.2.dylib'],['libggml-base.0.dylib','libggml-base.0.2.dylib']]){assert.equal(fs.readlinkSync(f.lib(alias)),target);assert.ok(fs.readFileSync(f.lib(alias)).length>0)}
});
test('actual builder rejects conflicting regular soname rather than deleting it',t=>{
 const f=fixture(t,{'w/lib/libwhisper.1.2.dylib':'NEW','w/lib/libwhisper.1.dylib':'EXISTING','g/lib/libggml.0.dylib':'GGML'}),r=f.run();assert.equal(r.status,1);assert.match(r.stderr,/conflicting library alias: libwhisper\.1\.dylib/);assert.equal(fs.lstatSync(f.lib('libwhisper.1.dylib')).isFile(),true);assert.equal(fs.readFileSync(f.lib('libwhisper.1.dylib'),'utf8'),'EXISTING');
});
for(const [family,libs,alias] of [
 ['ggml',{'w/lib/libwhisper.1.dylib':'W','g/lib/libggml.0.2.dylib':'NEW','g/lib/libggml.0.dylib':'EXISTING'},'libggml.0.dylib'],
 ['ggml-base',{'w/lib/libwhisper.1.dylib':'W','g/lib/libggml.0.dylib':'G','g/lib/libggml-base.0.2.dylib':'NEW','g/lib/libggml-base.0.dylib':'EXISTING'},'libggml-base.0.dylib'],
])test('actual builder refuses conflicting '+family+' soname',t=>{
 const f=fixture(t,libs),r=f.run();assert.equal(r.status,1);assert.match(r.stderr,/conflicting library alias/);assert.equal(fs.lstatSync(f.lib(alias)).isFile(),true);assert.equal(fs.readFileSync(f.lib(alias),'utf8'),'EXISTING');
});
test('actual builder propagates an alias creation failure',t=>{
 const f=fixture(t,{'w/lib/libwhisper.1.2.dylib':'W','g/lib/libggml.0.dylib':'G'}),stub=path.join(f.root,'stubs','ln');fs.writeFileSync(stub,'#!/bin/sh\nexit 47\n');fs.chmodSync(stub,0o700);const r=f.run();assert.equal(r.status,47);assert.equal(fs.readFileSync(f.lib('libwhisper.1.2.dylib'),'utf8'),'W');
});
test('actual alias helper rejects dangling links and directories without replacing them',t=>{
 const f=fixture(t,{}),source=builder.toString('utf8'),match=source.match(/^    create_soname_alias\(\) \{[\s\S]*?^    \}/m);assert.ok(match);const dir=path.join(f.root,'alias-control');fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'library.real'),'OWNED');
 for(const kind of ['dangling','directory']){const alias=path.join(dir,'alias');if(kind==='dangling')fs.symlinkSync('missing',alias);else fs.mkdirSync(alias);const r=cp.spawnSync('/bin/bash',['-c','set -e; cd "$1"; '+match[0]+'; create_soname_alias library.real alias','owned',dir],{env:{PATH:'/usr/bin:/bin'},encoding:'utf8'});assert.equal(r.status,1);assert.match(r.stderr,/conflicting library alias/);assert.equal(fs.lstatSync(alias).isSymbolicLink(),kind==='dangling');assert.equal(fs.readFileSync(path.join(dir,'library.real'),'utf8'),'OWNED');if(kind==='dangling')fs.unlinkSync(alias);else fs.rmdirSync(alias)}
});
