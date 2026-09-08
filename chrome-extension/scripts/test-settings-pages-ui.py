"""Actual App settings pages with synthetic transport; no live config changes."""
from pathlib import Path
import subprocess,tempfile
from playwright.sync_api import sync_playwright
root=Path(__file__).resolve().parent.parent
shots=Path('/private/tmp/cmspark-471-shots');shots.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory() as out:
 subprocess.run(['node','scripts/render-workspace-fixture.cjs',out],cwd=root,check=True)
 with sync_playwright() as p:
  b=p.chromium.launch(channel='chrome',headless=True);page=b.new_page(viewport={'width':1440,'height':900});page.set_default_timeout(6000)
  page.add_init_script('window.recEvents=[];window.SpeechRecognition=class { constructor(){window.fakeRecognition=this} start(){window.activeRecognition=this} stop(){window.recEvents.push("stop");this.onend?.()} abort(){window.recEvents.push("abort");this.aborted=true;this.onend?.()} };')
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto((Path(out)/'index.html').as_uri());page.wait_for_function('Boolean(window.dispatchUI)')
  page.evaluate("window.dispatchUI({type:'OPEN_SETTINGS_SECTION',section:'model'})")
  settings=page.get_by_role('dialog',name='设置',exact=True);settings.wait_for()
  model=page.get_by_placeholder('输入模型名称或从列表选择',exact=True);model.fill('fixture-model-draft')
  pages=['model','voice','export','connection','security','integrations','secrets','experimental']
  for width,height in [(1440,900),(800,700),(390,740),(320,480)]:
   page.set_viewport_size({'width':width,'height':height})
   for id in pages:
    if width>=760:
     settings.locator('.cm-settings-nav button').nth(pages.index(id)).click()
    else:settings.get_by_role('combobox',name='设置分类',exact=True).select_option(id)
    if width>=760:
     current=settings.locator('.cm-settings-nav button[aria-current="page"]')
     assert current.count()==1
     page.mouse.move(0,0)
     page.wait_for_function('getComputedStyle(document.querySelector(".cm-settings-nav button[aria-current=page]")).backgroundColor==="rgb(233, 233, 230)"')
     assert current.evaluate('(el)=>getComputedStyle(el).fontWeight')=='600'
    panel=settings.locator('[data-settings-page="'+id+'"]');panel.wait_for(state='visible')
    assert settings.locator('[data-settings-page]:visible').count()==1
    assert settings.evaluate('(el)=>el.scrollWidth<=el.clientWidth'),(width,id,'horizontal overflow')
    save=settings.get_by_role('button',name='保存并关闭',exact=True).bounding_box();assert save and save['y']+save['height']<=height,(width,id,save)
   page.evaluate("window.dispatchUI({type:'OPEN_SETTINGS_SECTION',section:'model'})")
   model.wait_for();assert model.input_value()=='fixture-model-draft'
   page.wait_for_function('document.activeElement?.id==="settings-page-model"')
   page.screenshot(path=str(shots/f'settings-model-{width}.png'))
  assert not page.evaluate('window.sent.some(x=>x.type==="config.set" || x.type.includes("license_response") || x.type==="terminal.start")')
  page.evaluate("window.dispatchUI({type:'SET_CONFIG',config:{auto_approve_dangerous:true}});window.dispatchUI({type:'OPEN_SETTINGS_SECTION',section:'voice'})")
  settings.get_by_role('button',name='有高权限开关已开启 · 查看安全设置',exact=True).wait_for()
  assert not model.is_visible()
  settings.get_by_role('button',name='有高权限开关已开启 · 查看安全设置',exact=True).click()
  settings.locator('[data-settings-page="security"]').wait_for(state='visible')
  assistant=settings.get_by_test_id('settings-intent-bar')
  settings.locator('.cm-settings-assistant summary').click()
  assistant.get_by_role('button',name='语音',exact=True).click()
  page.evaluate('window.commandRecognition=window.activeRecognition')
  before=page.evaluate('window.fixtureState.voiceDictationMode')
  page.evaluate('window.commandRecognition=window.activeRecognition;window.commandRecognition.onresult({results:[Object.assign([{transcript:"开启连续听写"}],{isFinal:true})]});window.lateEnd=window.commandRecognition.onend;void 0')
  settings.locator('.cm-settings-assistant summary').click()
  page.wait_for_timeout(150)
  page.wait_for_function('window.commandRecognition.aborted===true')
  page.evaluate('window.lateEnd()');page.wait_for_timeout(100)
  assert page.evaluate('window.fixtureState.voiceDictationMode')==before, 'Collapsed voice must not execute queued result'
  settings.locator('.cm-settings-assistant summary').click()
  assistant.get_by_text('语音输入已取消',exact=True).wait_for()
  assistant.get_by_role('button',name='语音',exact=True).click()
  page.evaluate('window.commandRecognition=window.activeRecognition;window.commandRecognition.onresult({results:[Object.assign([{transcript:"开启连续听写"}],{isFinal:true})]})')
  assistant.get_by_role('button',name='停止',exact=True).click()
  page.wait_for_function('window.fixtureState.voiceDictationMode==="continuous"')
  # A real store license payload is global to settings, independent of current category.
  page.set_viewport_size({'width':800,'height':700})
  page.evaluate("window.dispatchUI({type:'SET_DICTATION_HOTKEY_ENABLED',enabled:true})")
  settings.get_by_role('button',name='输入与语音',exact=True).click()
  settings.get_by_role('button',name='按键盘录制',exact=True).click()
  settings.get_by_role('button',name='模型与推理',exact=True).click()
  settings.get_by_role('button',name='输入与语音',exact=True).click()
  settings.get_by_role('button',name='按键盘录制',exact=True).wait_for()
  settings.get_by_role('button',name='模型与推理',exact=True).click()
  page.wait_for_function('document.activeElement?.id==="settings-page-model"')
  model.focus()
  page.evaluate("window.dispatchUI({type:'SET_COMPUTER_MODEL_LICENSE_DOOR',door:{licenseText:'Fixture license text',notice:'Fixture notice'}})")
  license=page.get_by_role('dialog',name='实验层许可证与免责声明',exact=True);license.wait_for()
  assert settings.locator('.cm-settings-content').get_attribute('inert') is not None
  for _ in range(5):
   page.keyboard.press('Tab')
   assert license.evaluate('(el)=>el.contains(document.activeElement)')
  page.keyboard.press('Shift+Tab')
  assert license.evaluate('(el)=>el.contains(document.activeElement)')
  page.keyboard.press('Escape');license.wait_for(state='hidden')
  assert settings.is_visible()
  page.wait_for_function('document.activeElement?.placeholder=== "输入模型名称或从列表选择"')
  assert not page.evaluate('window.sent.some(x=>x.type.includes("license_response"))')
  assert not errors,errors
  b.close()
print('PASS: settings pages responsive, all categories, retained model draft, stable deep links+focus, cross-page safety status, no implicit writes; cancelled voice callbacks, hidden hotkey capture, license keyboard isolation and focus restoration.')
