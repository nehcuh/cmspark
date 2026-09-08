// Crisp state-colored connection marks; 32px PNG and multi-size Windows ICO.
import { writeFileSync, mkdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { renderMark, encodePNG, encodeICO } from "../../scripts/lib/brand-icon.mjs"
const assetsDir=join(dirname(fileURLToPath(import.meta.url)), "..", "assets")
mkdirSync(assetsDir,{recursive:true})
for(const scheme of ["green","red","yellow","template"]) {
  const images=[16,32,48].map(size=>({size,png:encodePNG(size,size,renderMark(size,scheme))}))
  writeFileSync(join(assetsDir,`tray-icon-${scheme}.png`),images[1].png)
  writeFileSync(join(assetsDir,`tray-icon-${scheme}.ico`),encodeICO(images))
}
console.log("Connection tray icons generated (32px PNG, 16/32/48 ICO).")

// Windows desktop/Start menu/installer: static brand, independent of live tray status.
const appImages=[16,24,32,48,64,128,256].map(size=>({size,png:encodePNG(size,size,renderMark(size,"green",true))}))
writeFileSync(join(assetsDir,"cmspark.ico"),encodeICO(appImages))
