"""macOS offscreen comparison of the production Swift path and shared JS exporter.
Run from repo root: uv run --no-project --with pillow python companion/scripts/test-brand-rendering.py
Does not launch tray or touch user configuration.
"""
from pathlib import Path
import subprocess,tempfile,json
from PIL import Image
root=Path(__file__).resolve().parents[2]
s=(root/'companion/src/tray/Tray.swift').read_text()
body=s[s.index('func makeStatusIcon('):s.index('// ---------------------------------------------------------------------------\n// Menu tag')]
with tempfile.TemporaryDirectory() as temp:
 out=Path(temp)
 swift='import AppKit\nenum CompanionStatus { case running, stopped, unknown }\n'+body+'''
let out = CommandLine.arguments[1]
for (name,status) in [("green",CompanionStatus.running),("red",.stopped),("yellow",.unknown)] {
 for size in [16,18,22,32,36,54] {
  let rep = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:size,pixelsHigh:size,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
  NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:rep)
  makeStatusIcon(status,ws:false,size:NSSize(width:size,height:size)).draw(in:NSRect(x:0,y:0,width:size,height:size))
  NSGraphicsContext.restoreGraphicsState()
  try rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:"\\(out)/swift-\\(name)-\\(size).png"))
 }
}
'''
 (out/'render.swift').write_text(swift)
 subprocess.run(['swift',str(out/'render.swift'),str(out)],check=True)
 module=(root/'scripts/lib/brand-icon.mjs').as_uri()
 code=f'''import {{renderMark,encodePNG}} from {json.dumps(module)};import {{writeFileSync}} from 'node:fs';for(const color of ['green','red','yellow'])for(const size of [16,18,22,32,36,54])writeFileSync({json.dumps(str(out))}+`/js-${{color}}-${{size}}.png`,encodePNG(size,size,renderMark(size,color)))'''
 subprocess.run(['node','--input-type=module','-e',code],check=True)
 minimum=1
 for color in ['green','red','yellow']:
  for size in [16,18,22,32,36,54]:
   a=Image.open(out/f'swift-{color}-{size}.png').convert('RGBA');b=Image.open(out/f'js-{color}-{size}.png').convert('RGBA')
   assert a.size==b.size==(size,size)
   am=[p[3]>127 for p in a.getdata()];bm=[p[3]>127 for p in b.getdata()]
   iou=sum(x and y for x,y in zip(am,bm))/sum(x or y for x,y in zip(am,bm));minimum=min(minimum,iou)
   assert iou>=.85,(color,size,iou)
   assert a.getpixel((0,0))[3]==b.getpixel((0,0))[3]==0
   ac=a.getpixel((size//2,size//2));bc=b.getpixel((size//2,size//2))
   if color == 'red': assert max(ac[3],bc[3]) <= 32,(color,size,ac,bc)
   else: assert max(abs(x-y) for x,y in zip(ac,bc))<=2,(color,size,ac,bc)
   node=(round(size*5/24),round(size*5/24))
   assert max(abs(x-y) for x,y in zip(a.getpixel(node),b.getpixel(node)))<=2,(color,size,'node color')
 print(f'PASS: Swift/JS 18 combinations, silhouette IoU >= {minimum:.3f}; state color, dimensions, transparency verified.')
