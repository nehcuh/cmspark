"""Actual App+AppsPanel/reducer, recorded production handler output at controlled PsRunner seam.
Uses isolated headless Chromium and synthetic runtime transport. No native Windows claim.
Compile companion test sources first. No live app/config/credentials or candidate execution.
"""
import json
import subprocess
import tempfile
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parent.parent
receipt = json.loads(Path(sys.argv[1]).read_text()) if len(sys.argv)>1 else json.loads(subprocess.check_output(['node', str(root.parent/'companion/tests/fixtures/record-apps-discovery-644.cjs')], cwd=root))
assert receipt['boundary'] == 'controlled-PsRunner;real-parser-handler-JSON'
results=[]
with tempfile.TemporaryDirectory(prefix='cmspark-registry-ui-644-') as directory:
    subprocess.run(['node','scripts/render-workspace-fixture.cjs',directory,'--real-hook'],cwd=root,check=True,stdout=subprocess.DEVNULL)
    with sync_playwright() as playwright:
        browser=playwright.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1100})
        page.route('http://**/*',lambda route: route.abort())
        page.route('https://**/*',lambda route: route.abort())
        page.set_default_timeout(6000)
        errors=[]
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto((Path(directory)/'index.html').as_uri())
        page.wait_for_function('window.dispatchUI && window.fixtureState && window.runtimeListeners.size>0')
        page.evaluate("window.dispatchUI({type:'SET_APPS_STATE',enabled:true,entries:[],presets:[],platform:'win32'})")
        tools=page.locator('details').filter(has=page.locator('summary').filter(has_text='资料与工具'))
        if not tools.evaluate('(el)=>el.open'): tools.locator('summary').click()
        page.get_by_role('button',name='应用',exact=True).click()
        page.get_by_role('button',name='+ 添加应用',exact=True).click()
        def deliver(name):
            payload=receipt['payloads'][name]
            page.evaluate('(p)=>window.emitRuntime(p)',payload)
            page.wait_for_function('(length)=>window.fixtureState.appCandidates?.length===length',arg=len(payload['candidates']))
        deliver('partial')
        page.get_by_text('注册表候选发现不完整，部分应用可能未列出。',exact=True).wait_for()
        assert page.get_by_text('注册表候选',exact=True).count()==2
        assert page.get_by_text('注册表路径可能只是图标所在程序，请核对后再添加。',exact=True).is_visible()
        assert not page.evaluate("window.sent.some(m=>m.type==='apps.add'||m.type==='host_app'||m.type==='computer.set_enabled'||m.type==='apps.set_policy')")
        results.append('partial_source_caution_no_auto_mutation')
        page.get_by_text('Owned CMD',exact=True).click(force=True)
        assert not page.get_by_text('已选',exact=False).is_visible()
        results.append('blocked_candidate_not_picked')
        page.get_by_text('Owned Normal',exact=True).click()
        page.get_by_role('button',name='添加',exact=True).click()
        message=page.evaluate("window.sent.filter(m=>m.type==='apps.add').at(-1)")
        assert message=={'type':'apps.add','kind':'gui','path':'C:\\Owned644\\Normal.exe','display_name':'Owned Normal','origin':'enumerate','policy':'ai'},message
        assert 'registry_summary' not in message and 'source' not in message
        results.append('explicit_pick_original_add_contract')
        deliver('complete')
        page.wait_for_function('window.fixtureState.appRegistrySummary?.status==="complete"')
        assert page.get_by_text('注册表候选发现不完整，部分应用可能未列出。',exact=True).count()==0
        results.append('complete_not_partial')
        deliver('zero')
        page.get_by_text('注册表候选发现不完整，部分应用可能未列出。',exact=True).wait_for()
        assert page.get_by_text('注册表候选',exact=True).count()==0
        results.append('zero_row_output_limit_visible')
        deliver('unavailable')
        page.get_by_text('当前无法读取注册表候选，部分应用可能未列出。',exact=True).wait_for()
        results.append('unavailable_distinct')
        for name in ['legacy','malformed']:
            deliver(name)
            page.wait_for_function('window.fixtureState.appRegistrySummary===null')
            assert page.get_by_text('当前无法读取注册表候选，部分应用可能未列出。',exact=True).count()==0
            assert page.get_by_text('注册表候选发现不完整，部分应用可能未列出。',exact=True).count()==0
            assert 'RAW_UNTRUSTED_REASON' not in page.locator('body').inner_text()
            results.append(name+'_unreported_clears_old_status')
        page.get_by_title('重新枚举',exact=True).click()
        page.wait_for_function('window.fixtureState.appCandidates===null && window.fixtureState.appRegistrySummary===null')
        results.append('refresh_atomic_clear')
        assert errors==[],errors
        browser.close()
print(json.dumps({'boundary':receipt['boundary'],'actualApp':True,'actualWebSocketHook':True,'syntheticRuntime':True,'nativeWindows':False,'pass':len(results),'checks':results},ensure_ascii=False))
