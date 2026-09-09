"""Real graph builder + KnowledgeGraphApp, delayed storage, isolated Chrome.

Run after nvm use 22:
  uv run --with playwright python scripts/test-knowledge-graph-ui.py
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--baseline', action='store_true', help='Capture the pre-fix failure without hiding its assertion')
parser.add_argument('--artifacts', type=Path, default=Path(__file__).resolve().parents[2] / '.omx/artifacts/knowledge-graph-490')
args = parser.parse_args()
args.artifacts.mkdir(parents=True, exist_ok=True)
project = Path(__file__).resolve().parent.parent

with tempfile.TemporaryDirectory(prefix='cmspark-knowledge-graph-') as directory:
    subprocess.run(['node', 'scripts/render-knowledge-graph-fixture.cjs', directory] + (['--baseline'] if args.baseline else []), cwd=project, check=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page(viewport={'width': 1280, 'height': 800})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto((Path(directory) / 'index.html').as_uri())
        page.wait_for_function('window.storageReads===1')
        assert page.locator('canvas').count() == 0, 'Initial storage read must remain asynchronous'
        page.evaluate("window.graphFixture.release('4')")
        page.locator('canvas').wait_for()
        if args.baseline:
            page.wait_for_timeout(400)
            evidence = page.evaluate('''() => {
                const c=document.querySelector('canvas');
                return {storageReleased:window.storageReleased, snapshotNodes:window.graphFixture.readSnapshot().nodes.length,
                    canvasWidth:c.width,canvasHeight:c.height,cssWidth:c.getBoundingClientRect().width,
                    drawnArcs:window.drawProbe.arcs,drawnFrames:window.drawProbe.frames,
                    opaquePixels:[...c.getContext('2d').getImageData(0,0,c.width,c.height).data].filter((v,i)=>i%4===3&&v>0).length};
            }''')
            page.screenshot(path=str(args.artifacts / 'before.png'), full_page=True)
            (args.artifacts / 'before.json').write_text(json.dumps(evidence, indent=2) + '\n')
            print(json.dumps(evidence, indent=2), flush=True)
            assert evidence['drawnArcs'] >= 4 and evidence['opaquePixels'] > 0, 'Async snapshot mounted a Canvas but never started the drawing effect'
        def painted(count):
            pixels = page.wait_for_function('''(count) => {
                const c=document.querySelector('canvas');if(!c)return false;
                const ctx=c.getContext('2d');
                const bg=[...ctx.getImageData(0,0,1,1).data];
                const arcs=window.drawProbe.latestArcs;
                const visible=arcs.filter(p=>p.x>=0&&p.x<c.width&&p.y>=0&&p.y<c.height);
                const colored=visible.filter(p=>{
                    const pixel=[...ctx.getImageData(Math.floor(p.x),Math.floor(p.y),1,1).data];
                    return pixel[3]>0&&pixel.some((v,i)=>i<3&&v!==bg[i]);
                });
                if(arcs.length<count||bg[3]!==255||!colored.length)return false;
                return {width:c.width,height:c.height,css:c.getBoundingClientRect().width,
                    dpr:devicePixelRatio,backgroundAlpha:bg[3],visible:visible.length,colored:colored.length};
            }''', arg=count).json_value()
            assert pixels['width'] == int(pixels['css'] * pixels['dpr']), pixels
            assert pixels['height'] >= 280, pixels
            assert pixels['backgroundAlpha'] == 255 and pixels['colored'] > 0, pixels
            return pixels

        def open_fixture(count):
            page.goto((Path(directory) / 'index.html').as_uri())
            page.wait_for_function('window.storageReads===1')
            assert page.locator('canvas').count() == 0
            page.evaluate('(count)=>window.graphFixture.release(String(count))', count)
            if count == 0:
                page.get_by_text('知识库暂无可展示的文档', exact=False).wait_for()
                return
            page.get_by_test_id('knowledge-graph-canvas').wait_for()
            painted(count)

        painted(4)
        summaries = []
        for count in [1, 4, 20, 200]:
            open_fixture(count)
            page.wait_for_function("window.drawProbe.latestText.some(text=>text.includes('SQLite'))")
            assert page.locator('button[data-node-id]').count() == count
            assert page.evaluate('window.graphFixture.readSnapshot().edges.length') == 0
            page.get_by_text('暂无明确关联，仍可浏览全部知识', exact=True).wait_for()
            assert not page.evaluate("window.sent.some(m=>m.organize||m.type==='knowledge_graph.open_doc')")
            if count == 200:
                page.wait_for_function('window.drawProbe.frameHistory.length>=20')
                initial_frames = page.evaluate('window.drawProbe.frameHistory.slice(0,20)')
                assert all(frame['nodes'] == 200 and frame['visible'] == 200 for frame in initial_frames), initial_frames
                (args.artifacts / 'initial-200-frames.json').write_text(json.dumps(initial_frames, indent=2) + '\n')
            summaries.append({'nodes': count, **painted(count)})
            page.screenshot(path=str(args.artifacts / f'after-{count}.png'), full_page=True)
        print('PASS 1/4/20/200: delayed storage, real node pixels, default titles, every document listed, honest zero-edge state')

        # Removing a Canvas must stop its loop; a later success creates a working
        # new Canvas, independently of the mount that originally saw null refs.
        page.evaluate("window.oldCanvas=document.querySelector('canvas');window.graphFixture.publish('error')")
        page.locator('canvas').wait_for(state='detached')
        page.get_by_text('图谱加载失败', exact=False).wait_for()
        stopped_frames = page.evaluate('window.drawProbe.frames')
        page.wait_for_timeout(80)
        assert page.evaluate('window.drawProbe.frames') == stopped_frames
        page.get_by_role('button', name='刷新图谱', exact=True).click()
        assert page.evaluate("window.sent.some(m=>m.type==='knowledge_graph.refresh')")
        page.evaluate("window.drawProbe.latestArcs=[];window.graphFixture.publish('4')")
        painted(4)
        assert page.evaluate("window.oldCanvas!==document.querySelector('canvas')")
        print('PASS ok → error stops drawing → refresh → ok remount draws real nodes')

        page.evaluate('window.sendFailure=true')
        page.get_by_role('button', name='刷新图谱', exact=True).click()
        page.get_by_text('无法连接 CMspark', exact=False).wait_for()
        painted(4)
        assert page.locator('button[data-node-id]').count() == 4
        page.evaluate('window.sendFailure=false')
        page.get_by_role('button', name='刷新图谱', exact=True).click()
        assert page.evaluate('window.sent[window.sent.length-1].llm_labels') is False
        page.evaluate("window.graphFixture.publish('4')")
        print('PASS failed send reports connection error while preserving the usable snapshot; default-off refresh does not enable AI')

        search = page.get_by_role('textbox', name='搜索知识', exact=True)
        search.fill('不存在的知识')
        assert page.locator('button[data-node-id]').count() == 0
        assert page.locator('canvas').is_visible()
        search.fill('Telescope')
        assert page.locator('button[data-node-id]').count() == 1
        page.locator('button[data-node-id="fixture-003"]').click()
        assert not page.evaluate("window.sent.some(m=>m.type==='knowledge_graph.open_doc')")
        page.get_by_role('button', name='在知识面板打开', exact=True).click()
        assert page.evaluate("window.sent.filter(m=>m.type==='knowledge_graph.open_doc').map(m=>m.id)") == ['fixture-003']
        search.fill('')
        radius = page.evaluate('window.drawProbe.latestArcs[0].r')
        page.get_by_role('button', name='放大', exact=True).click()
        page.wait_for_function('(r)=>window.drawProbe.latestArcs[0].r>r', arg=radius)
        enlarged = page.evaluate('window.drawProbe.latestArcs[0].r')
        page.get_by_role('button', name='缩小', exact=True).click()
        page.wait_for_function('(r)=>window.drawProbe.latestArcs[0].r<r', arg=enlarged)
        page.get_by_role('button', name='适应画布', exact=True).click()
        painted(4)
        page.get_by_role('button', name='收起列表', exact=True).click()
        assert page.get_by_role('complementary', name='知识浏览', exact=True).count() == 0
        page.get_by_role('button', name='浏览知识', exact=True).click()
        page.get_by_role('complementary', name='知识浏览', exact=True).wait_for()
        print('PASS search incl. empty results, local selection, explicit document open, camera and list controls')

        # Exercise actual keyboard events against the focused Canvas. Wait for
        # the physical simulation to settle so movement proves the key handler,
        # rather than merely observing an unrelated animation frame.
        canvas = page.get_by_test_id('knowledge-graph-canvas')
        canvas.focus()
        page.keyboard.press('Escape')
        page.wait_for_function('''() => {
            const arc=window.drawProbe.latestArcs[0];if(!arc)return false;
            const last=window.keyboardLastArc;
            window.keyboardStableFrames=last&&Math.abs(last.x-arc.x)<0.001&&Math.abs(last.y-arc.y)<0.001
                ? (window.keyboardStableFrames||0)+1 : 0;
            window.keyboardLastArc={x:arc.x,y:arc.y};
            return window.keyboardStableFrames>=6;
        }''')
        page.keyboard.press('0')
        page.wait_for_timeout(50)
        fitted_arc = page.evaluate('({...window.drawProbe.latestArcs[0]})')
        page.keyboard.press('ArrowLeft')
        page.wait_for_function('(x)=>Math.abs(window.drawProbe.latestArcs[0].x-x-40)<0.1', arg=fitted_arc['x'])
        page.keyboard.press('Home')
        page.wait_for_function('(x)=>Math.abs(window.drawProbe.latestArcs[0].x-x)<0.1', arg=fitted_arc['x'])
        page.keyboard.press('ArrowRight')
        page.wait_for_function('(x)=>Math.abs(window.drawProbe.latestArcs[0].x-x+40)<0.1', arg=fitted_arc['x'])
        page.keyboard.press('0')
        page.wait_for_function('(x)=>Math.abs(window.drawProbe.latestArcs[0].x-x)<0.1', arg=fitted_arc['x'])
        page.keyboard.press('+')
        page.wait_for_function('(r)=>Math.abs(window.drawProbe.latestArcs[0].r-r*1.25)<0.01', arg=fitted_arc['r'])
        page.keyboard.press('-')
        page.wait_for_function('(r)=>Math.abs(window.drawProbe.latestArcs[0].r-r)<0.01', arg=fitted_arc['r'])
        keyboard_document = page.locator('button[data-node-id="fixture-002"]')
        keyboard_document.focus()
        page.keyboard.press('Enter')
        page.wait_for_function('document.querySelector("button[data-node-id=fixture-002]").getAttribute("aria-pressed")==="true"')
        page.get_by_role('region', name='选中知识', exact=True).get_by_text('Orchids 高山兰花', exact=True).wait_for()
        assert page.evaluate("window.sent.filter(m=>m.type==='knowledge_graph.open_doc').length") == 1
        canvas.focus()
        page.keyboard.press('Escape')
        page.get_by_role('region', name='选中知识', exact=True).wait_for(state='detached')
        assert keyboard_document.get_attribute('aria-pressed') == 'false'
        print('PASS actual keyboard: ArrowLeft/Right change native Canvas positions; Home/0 restore fit; +/- change native radii; list Enter selects the correct document and Canvas Escape clears selection')

        # CDP injects real trusted touch input through Chrome's input pipeline.
        # DOM dispatchEvent cannot test the UA's implicit pointer-capture release.
        page.evaluate('''() => {
            window.touchEvidence=[];
            const c=document.querySelector('canvas');
            for(const type of ['pointerdown','pointermove','pointercancel','gotpointercapture','lostpointercapture']){
                c.addEventListener(type,event=>{
                    if(event.pointerType==='touch')window.touchEvidence.push({type:event.type,
                        pointerId:event.pointerId,isTrusted:event.isTrusted,
                        captureDuringEvent:c.hasPointerCapture(event.pointerId)});
                });
            }
        }''')
        cdp = page.context.new_cdp_session(page)
        cdp.send('Emulation.setTouchEmulationEnabled', {'enabled': True, 'maxTouchPoints': 1})
        canvas_box = canvas.bounding_box()
        assert canvas_box
        touch_x, touch_y = canvas_box['x'] + 25, canvas_box['y'] + 25
        before_touch = page.evaluate('({...window.drawProbe.latestArcs[0]})')
        opened_before_touch = page.evaluate("window.sent.filter(m=>m.type==='knowledge_graph.open_doc').length")
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': touch_x, 'y': touch_y, 'id': 7}]})
        pointer_id = page.evaluate("window.touchEvidence.find(event=>event.type==='pointerdown').pointerId")
        capture_after_start = page.evaluate('(id)=>document.querySelector("canvas").hasPointerCapture(id)', pointer_id)
        assert capture_after_start is True
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': touch_x + 30, 'y': touch_y + 20, 'id': 7}]})
        page.wait_for_function('(x)=>Math.abs(window.drawProbe.latestArcs[0].x-x-30)<0.1', arg=before_touch['x'])
        cdp.send('Input.dispatchTouchEvent', {'type': 'touchCancel', 'touchPoints': []})
        page.wait_for_function('''(id)=>window.touchEvidence.some(event=>event.type==='pointercancel'&&event.pointerId===id)
            && !document.querySelector('canvas').hasPointerCapture(id)''', arg=pointer_id)
        capture_after_cancel = page.evaluate('(id)=>document.querySelector("canvas").hasPointerCapture(id)', pointer_id)
        touch_events = page.evaluate('window.touchEvidence')
        assert all(event['isTrusted'] and event['pointerId'] == pointer_id for event in touch_events), touch_events
        assert any(event['type'] == 'lostpointercapture' for event in touch_events), touch_events
        assert page.evaluate("window.sent.filter(m=>m.type==='knowledge_graph.open_doc').length") == opened_before_touch
        assert page.get_by_role('region', name='关联理由', exact=True).count() == 0
        after_cancel = page.evaluate('({...window.drawProbe.latestArcs[0]})')
        # A leftover dragRef would move the camera on subsequent pointermove,
        # even though no new press started a drag. These are real mouse events.
        page.mouse.move(touch_x + 70, touch_y + 55)
        page.mouse.move(touch_x + 110, touch_y + 85)
        page.wait_for_timeout(80)
        after_hover = page.evaluate('({...window.drawProbe.latestArcs[0]})')
        assert abs(after_hover['x'] - after_cancel['x']) < 0.1 and abs(after_hover['y'] - after_cancel['y']) < 0.1, (after_cancel, after_hover)
        cdp.send('Emulation.setTouchEmulationEnabled', {'enabled': False})
        cdp.detach()
        touch_result = {'pointerId': pointer_id, 'captureAfterStart': capture_after_start,
                        'captureAfterCancel': capture_after_cancel, 'events': touch_events,
                        'cameraAfterCancel': after_cancel, 'cameraAfterUnpressedMoves': after_hover}
        (args.artifacts / 'pointercancel.json').write_text(json.dumps(touch_result, indent=2) + '\n')
        print('PASS trusted CDP touchStart → touchMove → touchCancel: capture true → false, lostpointercapture delivered, no document/reason opening and no drag left on subsequent unpressed pointer moves')
        print('POINTERCANCEL EVIDENCE ' + json.dumps(touch_result))

        # Production builder emits the organized group and AI relation; its
        # serializer controls optional wire keys and no fixture invents nodes.
        page.evaluate("window.graphFixture.publish('organized')")
        group = page.get_by_role('combobox', name='筛选分组', exact=True)
        page.wait_for_function("[...document.querySelectorAll('select option')].some(o=>o.textContent.includes('开发主题'))")
        group_key = page.evaluate("Object.keys(window.graphFixture.readSnapshot().labels)[0]")
        group.select_option(group_key)
        assert page.locator('button[data-node-id]').count() == 2
        group.select_option('')
        page.locator('button[data-node-id="fixture-001"]').click()
        page.get_by_text('AI 关联理由：共同讨论开发实践', exact=True).wait_for()
        print('PASS production organized group filtering and readable AI relationship reason')

        def painted_line(dashed):
            page.wait_for_function('''(dashed)=>{
                const c=document.querySelector('canvas'),ctx=c.getContext('2d');
                const bg=[...ctx.getImageData(0,0,1,1).data];if(bg[3]!==255)return false;
                return window.drawProbe.latestLines.filter(line=>line.dashed===dashed).some(line=>{
                    for(let step=2;step<19;step++)for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++){
                        const x=Math.floor(line.a.x+(line.b.x-line.a.x)*step/20)+dx;
                        const y=Math.floor(line.a.y+(line.b.y-line.a.y)*step/20)+dy;
                        if(x<0||y<0||x>=c.width||y>=c.height)continue;
                        const pixel=[...ctx.getImageData(x,y,1,1).data];
                        if(pixel[3]>0&&pixel.some((v,i)=>i<3&&v!==bg[i]))return true;
                    }return false;
                });
            }''', arg=dashed)
        painted_line(True)
        groups = page.locator('details').filter(has=page.locator('summary').filter(has_text='分组说明与管理'))
        if groups.get_attribute('open') is None:
            groups.locator('summary').click()
        page.get_by_role('button', name='保留这版分组', exact=True).click()
        assert page.evaluate('window.sent[window.sent.length-1].lock_group') == group_key
        page.evaluate("window.graphFixture.publish('locked')")
        page.get_by_role('button', name='解锁', exact=True).click()
        assert page.evaluate('window.sent[window.sent.length-1].unlock_group') == group_key
        page.get_by_text('AI 与分组', exact=True).click()
        page.get_by_role('button', name='重新整理', exact=True).click()
        assert page.evaluate('window.sent[window.sent.length-1].organize') is True
        page.evaluate("window.graphFixture.publish('organizing')")
        assert page.get_by_role('button', name='整理中…', exact=True).is_disabled()
        page.evaluate('window.sendFailure=true')
        groups.get_by_role('button', name='保留这版分组', exact=True).click()
        page.get_by_text('请求未发送', exact=False).wait_for()
        assert page.get_by_role('button', name='整理中…', exact=True).is_disabled()
        page.get_by_role('switch', name='AI 分组命名', exact=True).click()
        assert page.get_by_role('button', name='整理中…', exact=True).is_disabled()
        page.get_by_role('switch', name='AI 分组命名', exact=True).click()
        assert page.get_by_role('button', name='整理中…', exact=True).is_disabled()
        page.evaluate('window.sendFailure=false')
        page.evaluate("window.graphFixture.publish('organized')")
        assert page.get_by_role('button', name='重新整理', exact=True).is_enabled()
        page.evaluate('window.sendFailure=true')
        page.get_by_role('button', name='重新整理', exact=True).click()
        assert page.get_by_role('button', name='重新整理', exact=True).is_enabled()
        page.evaluate('window.sendFailure=false')
        print('PASS failed lock/naming requests preserve confirmed organizing busy state; a failed new organize request restores the confirmed idle state')
        page.evaluate("window.graphFixture.publish('similar')")
        painted(4)
        painted_line(False)
        assert page.evaluate('window.graphFixture.readSnapshot().edges.length') > 0
        print('PASS native dashed AI and solid similarity lines have pixels; lock/unlock and explicit organize retain their transport contracts')

        # A real viewport resize must resize the Canvas bitmap; responsive
        # layout must not leave its controls as opaque overlays on the graph.
        for width, height in [(1440, 900), (960, 720), (760, 740), (390, 844), (320, 480), (1280, 800)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.get_by_role('button', name='适应画布', exact=True).click()
            page.wait_for_function('''() => {
                const c=document.querySelector('canvas');return c.width===Math.floor(c.getBoundingClientRect().width*devicePixelRatio);
            }''')
            painted(4)
            canvas_box = page.locator('canvas').bounding_box()
            aside_box = page.get_by_role('complementary', name='知识浏览', exact=True).bounding_box()
            assert canvas_box and aside_box
            overlap_w = min(canvas_box['x'] + canvas_box['width'], aside_box['x'] + aside_box['width']) - max(canvas_box['x'], aside_box['x'])
            overlap_h = min(canvas_box['y'] + canvas_box['height'], aside_box['y'] + aside_box['height']) - max(canvas_box['y'], aside_box['y'])
            assert overlap_w <= 1 or overlap_h <= 1, (canvas_box, aside_box)
            assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
            page.screenshot(path=str(args.artifacts / f'after-width-{width}.png'), full_page=True)
        print('PASS desktop/mobile resize: correctly sized real Canvas, non-overlapping browser, no horizontal overflow')

        # A native details element keeps a user's toggle when React re-renders
        # with an unchanged open prop. Exercise both default-open and default-
        # closed lanes via actual query and hover updates, not DOM mutation.
        details_evidence = []
        for count in [4, 20]:
            open_fixture(count)
            groups = page.locator('details').filter(has=page.locator('summary').filter(has_text='分组说明与管理'))
            expected_default = count <= 19
            assert (groups.get_attribute('open') is not None) is expected_default
            groups.locator('summary').click()
            expected_open = not expected_default
            assert (groups.get_attribute('open') is not None) is expected_open
            page.get_by_role('textbox', name='搜索知识', exact=True).fill('SQLite')
            assert page.locator('button[data-node-id]').count() == 1
            assert (groups.get_attribute('open') is not None) is expected_open
            canvas.scroll_into_view_if_needed()
            hovered = page.evaluate('''() => {
                const c=document.querySelector('canvas'),box=c.getBoundingClientRect(),arc=window.drawProbe.latestArcs[0];
                return {x:box.x+arc.x/devicePixelRatio,y:box.y+arc.y/devicePixelRatio};
            }''')
            page.mouse.move(hovered['x'], hovered['y'])
            page.get_by_role('status').filter(has_text='SQLite 离线检索').wait_for()
            assert (groups.get_attribute('open') is not None) is expected_open
            if count == 20:
                page.evaluate("window.graphFixture.publish('locked20')")
                assert (groups.get_attribute('open') is not None) is True
                unlock = groups.get_by_role('button', name='解锁', exact=True)
                unlock.wait_for()
                unlock.click()
                lock_key = page.evaluate("Object.keys(window.graphFixture.readSnapshot().labels).find(key=>window.graphFixture.readSnapshot().labels[key].locked)")
                assert page.evaluate('window.sent[window.sent.length-1].unlock_group') == lock_key
            details_evidence.append({'nodes': count, 'defaultOpen': expected_default,
                                     'manualOpenAfterQueryAndHover': expected_open, 'unlockReachable': count == 20})
        (args.artifacts / 'details-toggle.json').write_text(json.dumps(details_evidence, indent=2) + '\n')
        print('PASS native details: manually collapsed 4-node and expanded 20-node groups survive query/hover re-renders; 20-node locked group has a reachable working unlock button')

        open_fixture(4)
        start_radius = page.evaluate('window.drawProbe.latestArcs[0].r')
        page.get_by_role('button', name='放大', exact=True).click()
        page.wait_for_function('(r)=>Math.abs(window.drawProbe.latestArcs[0].r-r*1.25)<0.01', arg=start_radius)
        canvas.focus()
        def before_camera_change():
            return page.evaluate('''() => {
                const c=document.querySelector('canvas');
                return {frame:window.drawProbe.frames,width:c.width,height:c.height};
            }''')
        def camera_after_draw(before, previous=None, resized=False, viewport=None):
            # Assert and return the evidence in one JavaScript evaluation. The
            # native Canvas bitmap, CSS box and latest completed drawing frame
            # must describe the same new size, after the triggering operation.
            return page.wait_for_function('''({before,previous,resized,viewport}) => {
                const c=document.querySelector('canvas'),p=window.drawProbe;
                const n=p.latestArcs[0],box=c.getBoundingClientRect(),dpr=devicePixelRatio;
                if(!n||p.frames<=before.frame)return false;
                if(c.width!==Math.floor(box.width*dpr)||c.height!==Math.floor(box.height*dpr))return false;
                if(p.frameWidth!==c.width||p.frameHeight!==c.height)return false;
                if(resized&&c.width===before.width&&c.height===before.height)return false;
                if(viewport&&(innerWidth!==viewport[0]||innerHeight!==viewport[1]))return false;
                const sample={radius:n.r,xFromCenter:n.x-c.width/2,yFromCenter:n.y-c.height/2,
                    width:c.width,height:c.height,cssWidth:box.width,cssHeight:box.height,dpr,
                    beforeFrame:before.frame,drawnFrame:p.frames,drawnFrameWidth:p.frameWidth,
                    drawnFrameHeight:p.frameHeight,viewportWidth:innerWidth,viewportHeight:innerHeight};
                if(previous&&(Math.abs(sample.radius-previous.radius)>=0.01
                    ||Math.abs(sample.xFromCenter-previous.xFromCenter)>=0.1
                    ||Math.abs(sample.yFromCenter-previous.yFromCenter)>=0.1))return false;
                return sample;
            }''', arg={'before': before, 'previous': previous, 'resized': resized, 'viewport': viewport}).json_value()
        before_pan = before_camera_change()
        page.keyboard.press('ArrowLeft')
        custom_camera = camera_after_draw(before_pan)
        camera_evidence = [{'action': 'custom zoom and pan', **custom_camera}]
        before_close = before_camera_change()
        page.get_by_role('button', name='收起列表', exact=True).click()
        camera_evidence.append({'action': 'close list', **camera_after_draw(before_close, custom_camera, resized=True)})
        before_open = before_camera_change()
        page.get_by_role('button', name='浏览知识', exact=True).click()
        camera_evidence.append({'action': 'open list', **camera_after_draw(before_open, custom_camera, resized=True)})
        for width, height in [(1440, 900), (960, 720), (390, 844), (1280, 800)]:
            before_resize = before_camera_change()
            page.set_viewport_size({'width': width, 'height': height})
            camera_evidence.append({'action': f'resize {width}x{height}',
                **camera_after_draw(before_resize, custom_camera, resized=True, viewport=[width, height])})
        (args.artifacts / 'camera-preservation.json').write_text(json.dumps(camera_evidence, indent=2) + '\n')
        print('PASS custom native scale and world center remain unchanged when toggling the list or resizing desktop/mobile viewports; all 200 node centers were visible in every initial recorded frame')

        open_fixture(0)
        assert page.locator('canvas').count() == 0

        page.goto((Path(directory) / 'index.html').as_uri())
        page.wait_for_function('window.storageReads===1')
        page.evaluate("window.graphFixture.release('error')")
        page.get_by_text('图谱加载失败', exact=False).wait_for()
        page.get_by_role('button', name='刷新图谱', exact=True).click()
        assert page.evaluate('window.sent[window.sent.length-1].llm_labels') is False
        page.evaluate("window.graphFixture.publish('4')")
        painted(4)
        print('PASS initially cached error snapshot can refresh and recover without closing the page')

        page.goto((Path(directory) / 'index.html').as_uri() + '?labels')
        page.wait_for_function('window.storageReads===1')
        page.evaluate("window.graphFixture.release('4')")
        painted(4)
        page.get_by_role('button', name='刷新图谱', exact=True).click()
        assert page.evaluate('window.sent[window.sent.length-1].llm_labels') is True
        assert not page.evaluate('window.sent.some(m=>m.organize)')
        print('PASS refresh preserves a previously enabled AI naming preference without automatically organizing')

        page.goto((Path(directory) / 'index.html').as_uri())
        page.wait_for_function('window.storageReads===1')
        page.evaluate("window.graphFixture.release('rebuilding',{focus_id:'fixture-003'})")
        assert page.locator('canvas').count() == 0
        page.evaluate("window.graphFixture.publish('4')")
        painted(4)
        page.get_by_role('region', name='选中知识', exact=True).get_by_text('Telescope 天文观测', exact=True).wait_for()
        print('PASS a requested document remains selected across rebuilding → success with no new focus id')

        page.goto((Path(directory) / 'index.html').as_uri())
        page.wait_for_function('window.storageReads===1')
        page.evaluate("window.graphFixture.publish('4')")
        painted(4)
        page.evaluate("window.graphFixture.release('error')")
        page.wait_for_timeout(50)
        painted(4)
        assert page.locator('button[data-node-id]').count() == 4
        print('PASS a stale initial storage result cannot overwrite a newer successful storage event')
        assert not errors, errors
        (args.artifacts / 'after.json').write_text(json.dumps(summaries, indent=2) + '\n')
        assert not errors, errors
        browser.close()
print('PASS delayed storage → real Canvas node drawing')
