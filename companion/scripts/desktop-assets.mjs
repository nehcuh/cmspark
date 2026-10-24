/** Copy fixed offline renderer dependencies. Does not install, compile or execute anything. */
import fs from 'node:fs'
import path from 'node:path'
import {createRequire} from 'node:module'
const {transformXtermStyleNonce}=createRequire(import.meta.url)('./desktop-xterm-style-nonce.cjs')
export const DESKTOP_ASSET_NAMES=Object.freeze(['index.html','app.css','app.js','local-work.js','terminal-core.js','terminal-fit.js','terminal.css','terminal-core.LICENSE.txt','terminal-fit.LICENSE.txt'])
const vendors=[['terminal-core.js','@xterm/xterm','6.0.0','lib/xterm.js'],['terminal-fit.js','@xterm/addon-fit','0.11.0','lib/addon-fit.js'],['terminal.css','@xterm/xterm','6.0.0','css/xterm.css'],['terminal-core.LICENSE.txt','@xterm/xterm','6.0.0','LICENSE'],['terminal-fit.LICENSE.txt','@xterm/addon-fit','0.11.0','LICENSE']]
export function copyDesktopAssets(root,destination,dependencies=path.join(root,'node_modules')){
 fs.mkdirSync(destination,{recursive:true});if(!fs.lstatSync(destination).isDirectory()||fs.lstatSync(destination).isSymbolicLink())throw Error('DESKTOP_ASSET_REDIRECT')
 const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'))
 const sources=new Map(['index.html','app.css','app.js','local-work.js'].map(name=>[name,path.join(root,'src/desktop/assets',name)]))
 for(const [name,pkg,version,relative]of vendors){
  const installed=path.join(dependencies,pkg),entry=lock.packages['node_modules/'+pkg]
  if(entry?.version!==version||JSON.parse(fs.readFileSync(path.join(installed,'package.json'),'utf8')).version!==version)throw Error('DESKTOP_ASSET_PIN')
  sources.set(name,path.join(installed,relative))
 }
 for(const name of DESKTOP_ASSET_NAMES){
  const source=sources.get(name),st=fs.lstatSync(source);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error('DESKTOP_ASSET_SOURCE')
  const target=path.join(destination,name);if(fs.existsSync(target)){const old=fs.lstatSync(target);if(!old.isFile()||old.isSymbolicLink()||old.nlink!==1)throw Error('DESKTOP_ASSET_REDIRECT');fs.unlinkSync(target)}
  if(name==='terminal-core.js')fs.writeFileSync(target,transformXtermStyleNonce(fs.readFileSync(source),'6.0.0'),{flag:'wx'})
  else fs.copyFileSync(source,target,fs.constants.COPYFILE_EXCL)
 }
}
