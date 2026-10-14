"""Actual confirmation UI, recorded controlled producer frames; never connects to services."""
import json
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parent.parent
checks = []
shots = Path(tempfile.gettempdir()) / 'cmspark-532-preview-shots'
shots.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix='cmspark-preview532-ui-') as out:
    subprocess.run(['node', 'scripts/render-confirmation-preview-fixture.cjs', out], cwd=project, check=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page(viewport={'width':900,'height':600})
        page.set_default_timeout(5000)
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.route('**/*', lambda route: route.abort())
        page.set_content((Path(out)/'fixture.html').read_text())
        page.add_script_tag(content=(Path(out)/'fixture.js').read_text())
        status = page.get_by_role('status')
        status.wait_for()
        assert '预览不可用（降级确认）' in status.inner_text()
        assert '无法获取目标窗口截图' in status.inner_text()
        assert not page.get_by_role('img').count()
        page.screenshot(path=str(shots/'capture-unavailable.png'))
        for mode, copy in [('no_window','未找到可预览的目标窗口'),('timeout','预览生成超时')]:
            page.evaluate('(v) => window.showCase(v[0],v[1])', [mode, mode+'-id'])
            page.wait_for_function('(copy) => document.querySelector("[role=status]")?.textContent.includes(copy)', arg=copy)
            assert copy in status.inner_text()
        checks.append('recorded capture/target/timeout reasons visibly distinct')
        page.evaluate("window.showCase('success','valid-image')")
        image = page.get_by_role('img', name='标注截图', exact=True)
        image.wait_for()
        page.wait_for_function('document.querySelector("img")?.complete && document.querySelector("img")?.naturalWidth>0')
        assert status.count() == 0
        image.evaluate('(img) => img.dispatchEvent(new Event("error"))')
        page.wait_for_function('document.querySelector("[role=status]")?.textContent.includes("预览图片加载失败")')
        assert not image.count()
        page.screenshot(path=str(shots/'image-load-failed.png'))
        checks.append('actual image onError becomes visible failure')
        # Same mounted component, new confirmation id: no old image failure leaks.
        page.evaluate("window.showCase('unattempted','old-protocol-unattempted')")
        page.wait_for_function('!document.querySelector("[role=status]") && !document.querySelector("img")')
        page.evaluate("window.showCase('success','fresh-valid-image')")
        image.wait_for()
        page.wait_for_function('document.querySelector("img")?.complete && document.querySelector("img")?.naturalWidth>0')
        assert status.count() == 0
        checks.append('new confirmation id clears prior error; unattempted/old protocol remains neutral')
        page.get_by_role('button', name='拒绝', exact=True).click()
        sent = page.evaluate('window.sent')
        assert len(sent) == 1 and sent[0]['confirmation_id'] == 'fresh-valid-image'
        assert sent[0]['approved'] is False
        assert not sent[0]['add_to_thread_whitelist'] and not sent[0]['add_to_session_trust']
        assert page.evaluate('window.resolved') == ['fresh-valid-image']
        checks.append('deny targets current confirmation without granting trust')
        assert not errors, errors
        page.screenshot(path=str(shots/'confirmation-preview.png'))
        browser.close()
(shots/'evidence.json').write_text(json.dumps({'checks':checks,'sent':sent,'browser_errors':errors},ensure_ascii=False,indent=2))
print('PASS: '+ '; '.join(checks))
