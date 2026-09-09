from pathlib import Path
import json, tempfile, subprocess, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

root=Path('/Users/huchen/Projects/cmspark')
out=root/'.omx/artifacts/knowledge-graph-490'
class Quiet(SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

with tempfile.TemporaryDirectory(prefix='cmspark-built-graph-') as temp:
    subprocess.run(['node','scripts/render-knowledge-graph-fixture.cjs',temp],cwd=root/'chrome-extension',check=True)
    graph=json.loads((Path(temp)/'builder-output.json').read_text())['4']
    server=ThreadingHTTPServer(('127.0.0.1',0),functools.partial(Quiet,directory=str(root/'chrome-extension/build/chrome-mv3-prod')))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    setup="""window.chrome={runtime:{id:'isolated-built-smoke',getURL:p=>location.origin+'/'+p,sendMessage:(m,cb)=>{window.sent.push(m);cb?.({ok:true,sent:true})}},storage:{local:{get:async()=>({}),set:async()=>{}},session:{get:async()=>({'cmspark.knowledge_graph_snapshot':GRAPH})},onChanged:{addListener(){},removeListener(){}}}};window.sent=[];""".replace('GRAPH',json.dumps(graph))
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='chrome',headless=True)
        page=browser.new_page(); errors=[]
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.add_init_script(setup)
        for width,height in [(1440,900),(390,740)]:
            page.set_viewport_size({'width':width,'height':height})
            page.goto(f'http://127.0.0.1:{server.server_port}/tabs/knowledge-graph.html')
            page.wait_for_function("document.querySelectorAll('button[data-node-id]').length===4")
            result=page.wait_for_function("""() => {
                const c=document.querySelector('canvas');if(!c)return false;
                const data=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
                let colored=0;for(let i=0;i<data.length;i+=4)if(data[i+3]&&data[i]!==23)colored++;
                if(!colored)return false;
                return {bodyMargin:getComputedStyle(document.body).margin,htmlMargin:getComputedStyle(document.documentElement).margin,overflow:document.documentElement.scrollWidth>innerWidth,width:c.width,height:c.height,colored};
            }""").json_value()
            assert result['bodyMargin']=='0px' and result['htmlMargin']=='0px',result
            assert not result['overflow'],result
            assert not page.evaluate('window.sent.some(m=>m.organize||m.llm_labels===true)')
            page.screenshot(path=str(out/f'built-{width}.png'),full_page=True)
            print('PASS actual Plasmo HTML and JS',width,result,flush=True)
        assert not errors,errors
        browser.close()
    server.shutdown();server.server_close()
