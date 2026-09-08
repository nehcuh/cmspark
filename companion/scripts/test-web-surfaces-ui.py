"""Presentation-only checks of the real HTML constants; scripts removed, no services."""
from pathlib import Path
import re, subprocess, tempfile
from playwright.sync_api import sync_playwright
project=Path(__file__).resolve().parent.parent
shots=Path('/private/tmp/cmspark-469-shots');shots.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as out:
    subprocess.run(['node','scripts/render-web-surface-fixtures.cjs',out],cwd=project,check=True)
    with sync_playwright() as p:
        browser=p.chromium.launch(channel='chrome',headless=True)
        page=browser.new_page()
        page.route('**/*',lambda route:route.abort())
        for name in ['capture','settings']:
            html=(Path(out)/(name+'.html')).read_text()
            base=subprocess.check_output(['git','show','8656df94:companion/src/'+('summoner-web.ts' if name=='capture' else 'settings-web.ts')],cwd=project,text=True)
            current=(project/'src'/('summoner-web.ts' if name=='capture' else 'settings-web.ts')).read_text()
            if name=='settings':
                assert re.findall(r'<script\b[^>]*>(.*?)</script>',base,re.S)==re.findall(r'<script\b[^>]*>(.*?)</script>',current,re.S), 'Settings script changed'
            else: assert '>山</div>' not in current

            # Same safe initial label as the production handler's fallback; no live config.
            html=html.replace('%%CRUISE_LABEL%%','每次确认')
            page.set_content(re.sub(r'<script\b[^>]*>.*?</script>','',html,flags=re.S))
            for width,height in [(320,480),(390,740),(900,800)]:
                page.set_viewport_size({'width':width,'height':height})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),(name,width)
                page.screenshot(path=str(shots/f'{name}-{width}.png'))
        browser.close()
print('PASS: capture/settings real HTML CSS reflow; settings script unchanged and no summoner decorative mark. Scripts not executed.')
