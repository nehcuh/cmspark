"""Actual App settings pages with synthetic transport; no live config changes."""
from pathlib import Path
import subprocess, tempfile
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent
shots = Path(tempfile.gettempdir()) / 'cmspark-settings-shots'
shots.mkdir(exist_ok=True)
categories = {
    '模型与服务': ('对话模型', 'model-chat'),
    '输入与交互': ('发送与听写快捷键', 'input-shortcuts'),
    '数据与知识': ('文件上传', 'data-files'),
    '隐私与权限': ('运行自主度', 'privacy-autonomy'),
    '工具与集成': ('本机能力', 'tools-capabilities'),
    '连接与维护': ('配对 Companion', 'connection-pairing'),
}

with tempfile.TemporaryDirectory() as out:
    subprocess.run(['node', 'scripts/render-workspace-fixture.cjs', out], cwd=root, check=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 900})
        page.set_default_timeout(6000)
        page.add_init_script('window.recEvents=[];window.SpeechRecognition=class { constructor(){window.fakeRecognition=this} start(){window.activeRecognition=this} stop(){window.recEvents.push("stop");this.onend?.()} abort(){window.recEvents.push("abort");this.aborted=true;this.onend?.()} };')
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto((Path(out) / 'index.html').as_uri())
        page.wait_for_function('Boolean(window.dispatchUI)')
        page.evaluate("window.dispatchUI({type:'SET_SETTINGS_OPEN',open:true})")
        settings = page.get_by_role('dialog', name='设置', exact=True)
        settings.wait_for()
        home = settings.get_by_role('region', name='设置首页', exact=True)
        home.wait_for()
        assistant = home.get_by_test_id('settings-intent-bar')
        assistant.wait_for()
        assert home.get_by_role('textbox').count() == 1
        home.get_by_role('button', name='尚未配对 · 前往连接设置', exact=True).wait_for()
        page.evaluate("""() => {
            window.settingsLocal = {};
            const storage = chrome.storage.local, read = storage.get, save = storage.set;
            storage.get = (key, callback) => key === 'cmspark.ui.show_reasoning' && !callback
                ? Promise.resolve({[key]: window.settingsLocal[key]}) : read(key, callback);
            storage.set = (values, callback) => {
                if (!Object.hasOwn(values, 'cmspark.ui.show_reasoning') || callback) return save(values, callback);
                Object.assign(window.settingsLocal, values);
                return Promise.resolve();
            };
        }""")
        assistant.get_by_role('textbox').fill('把思考过程收起来')
        assistant.get_by_role('button', name='预览变更', exact=True).click()
        assert page.evaluate('window.settingsLocal["cmspark.ui.show_reasoning"]') is None
        assistant.get_by_role('button', name='确认更改显示', exact=True).click()
        assistant.get_by_text('已保存并核对思考过程的显示方式。', exact=True).wait_for()
        assert page.evaluate('window.settingsLocal["cmspark.ui.show_reasoning"]') == 'always_collapsed'
        assert not page.evaluate('window.sent.some(x=>x.type.includes("settings.assistant"))')
        assistant.get_by_role('textbox').fill('思考过程在哪')
        assistant.get_by_role('button', name='打开设置', exact=True).click()
        settings.locator('[data-settings-destination="input-display"]').wait_for()
        settings.get_by_role('button', name='返回输入与交互', exact=True).click()
        settings.get_by_role('button', name='返回设置首页', exact=True).click()
        page.evaluate("""() => {
            window.dispatchUI({type:'SET_CONFIG_SNAPSHOT', config: window.fixtureState.config, revision:'fixture:1'})
            window.dispatchUI({type:'SET_CONFIG_HYDRATED', hydrated:true})
        }""")
        page.wait_for_function('window.fixtureState.configHydratedFromCompanion===true && window.fixtureState.settingsDraft')
        model = page.get_by_placeholder('输入模型名称或从列表选择', exact=True)
        page.evaluate("window.dispatchUI({type:'OPEN_SETTINGS_SECTION',section:'model'})")
        page.wait_for_function('document.activeElement?.id==="settings-page-model"', timeout=6000)
        model.fill('fixture-model-draft')
        settings.get_by_role('button', name='返回模型与服务', exact=True).click()
        model_center = settings.get_by_role('region', name='模型与服务', exact=True)
        for label in ['对话模型', '看图与截图', '听写纠错', '聊天听写', '会议转写', '会议纪要', '活动提取', '本机模型', '后台任务']:
            model_center.get_by_role('button', name=label, exact=True).wait_for()
        assert model_center.get_by_text('未配置模型', exact=True).count() > 0
        page.evaluate("""() => {
            window.fixtureResponse = (message, callback) => {
                let reply
                if (message.type === 'model.center.get') reply = {type:'model.center.state',
                    config_revision:window.fixtureState.configRevision,model_center:{chat_profile_id:null,
                    meeting_minutes_profile_id:'owned-minutes',profiles:[{id:'owned-minutes',name:'纪要用模型',
                        base_url:'https://minutes.example.test/v1',model_name:'minutes-model',has_key:true}]}}
                if (message.type === 'meeting.asr.get') reply = {type:'meeting.asr.state',state:{mode:'external',
                    style:'openai',baseUrl:'https://asr.example.test/v1',normalizedUrl:'https://asr.example.test/v1/audio/transcriptions',
                    model:'fixture-asr',keyConfigured:true,ready:true,segmentMs:30000,requestTimeoutMs:60000,configIdentity:'a'.repeat(64)}}
                if (reply) {
                    const ack = {ok:true,id:message.id}
                    queueMicrotask(() => { callback?.(ack); window.emitRuntime({...reply,id:message.id}) })
                    return Promise.resolve(ack)
                }
            }
            window.dispatchUI({type:'SET_CONFIG_SNAPSHOT', revision:'fixture:2', config:{...window.fixtureState.config,
                api_key:'***',api_key_set:true,base_url:'https://user:fixture-password@chat.example.test:8080/v1?secret=fixture-query'}})
        }""")
        model_center.get_by_text('纪要用模型 · minutes-model · minutes.example.test', exact=True).wait_for()
        model_center.get_by_role('button', name='对话模型', exact=True).get_by_text('deepseek-v4-flash · chat.example.test:8080', exact=True).wait_for()
        assert 'fixture-password' not in model_center.inner_text() and 'fixture-query' not in model_center.inner_text()
        settings.get_by_role('button', name='返回设置首页', exact=True).click()
        home.get_by_role('button', name='模型与服务', exact=True).click()
        model_center.get_by_text('导入用外部转写 · fixture-asr · asr.example.test', exact=True).wait_for()
        page.evaluate("""() => {
            window.dictationFixture = {
                sttEngine:'local', localModelId:'large-v3-turbo', recommendedModelId:'large-v3-turbo',
                models:{}, binary:{status:'ready'}, diskBudgetMB:4096, diskUsedMB:0,
            };
            window.dispatchUI({type:'SET_VOICE_MODEL_STATE',modelState:window.dictationFixture});
        }""")
        model_center.get_by_role('button', name='聊天听写', exact=True).click()
        dictation = settings.locator('[data-settings-destination="input-dictation-engine"]')
        dictation.get_by_role('radio', name='外部转写', exact=False).check()
        dictation.get_by_label('密钥', exact=True).fill('fixture-transcription-key')
        dictation.get_by_role('button', name='保存外部转写', exact=True).click()
        page.wait_for_function('window.sent.some(x=>x.type==="voice.external.set" && x.source==="settings")')
        page.evaluate("""() => {
            const external = {style:'deepseek',baseUrl:'',normalizedUrl:'https://api.deepseek.com/v1/tools/asr',
                model:'whisper-1',keyConfigured:true,limitNote:'deepseek-docs'};
            window.dictationFixture = {...window.dictationFixture,external};
            window.dispatchUI({type:'SET_VOICE_MODEL_STATE',modelState:window.dictationFixture});
        }""")
        dictation.get_by_role('checkbox', name='停止录音后', exact=False).check()
        dictation.get_by_role('button', name='启用外部转写', exact=True).click()
        page.wait_for_function('window.sent.some(x=>x.type==="voice.model.set_engine" && x.engine==="external" && x.privacy_ack_external_v1)')
        page.evaluate("""window.dispatchUI({type:'SET_VOICE_MODEL_STATE',
            modelState:{...window.dictationFixture,sttEngine:'external'}})""")
        dictation.get_by_role('button', name='外部转写已启用', exact=True).wait_for()
        settings.get_by_role('button', name='返回模型与服务', exact=True).click()
        model_center.get_by_text('外部转写 · DeepSeek · api.deepseek.com', exact=True).wait_for()
        page.wait_for_function('document.activeElement?.getAttribute("aria-label")==="聊天听写"')
        settings.get_by_role('button', name='返回设置首页', exact=True).click()
        for width, height in [(1440, 900), (800, 700), (390, 740), (320, 480)]:
            page.set_viewport_size({'width': width, 'height': height})
            page.screenshot(path=str(shots / f'settings-home-{width}.png'))
            for category, (destination, route) in categories.items():
                home.get_by_role('button', name=category, exact=True).click()
                category_view = settings.get_by_role('region', name=category, exact=True)
                category_view.get_by_role('button', name=destination, exact=True).click()
                panel = settings.locator(f'[data-settings-destination="{route}"]')
                panel.wait_for(state='visible')
                if width >= 760:
                    current = settings.locator('.cm-settings-nav button[aria-current="page"]')
                    assert current.count() == 1 and current.inner_text() == category
                    assert current.evaluate('(el)=>getComputedStyle(el).fontWeight') == '600'
                assert settings.locator('[data-settings-destination]:visible').count() == 1
                assert settings.evaluate('(el)=>el.scrollWidth<=el.clientWidth'), (width, route, 'horizontal overflow')
                assert not assistant.is_visible()
                save = settings.get_by_role('button', name='保存', exact=True).bounding_box()
                assert save and save['y'] + save['height'] <= height, (width, route, save)
                if route == 'model-chat':
                    assert model.input_value() == 'fixture-model-draft'
                    page.screenshot(path=str(shots / f'settings-model-{width}.png'))
                settings.get_by_role('button', name=f'返回{category}', exact=True).click()
                settings.get_by_role('button', name='返回设置首页', exact=True).click()
                page.wait_for_function('(category) => document.activeElement?.getAttribute("aria-label")===category', arg=category)
        assert not page.evaluate('window.sent.some(x=>x.type==="config.set" || x.type.includes("license_response") || x.type==="terminal.start")')
        page.evaluate("window.dispatchUI({type:'SET_CONFIG',config:{auto_approve_dangerous:true}});window.dispatchUI({type:'OPEN_SETTINGS_SECTION',section:'input-dictation-engine'})")
        settings.get_by_role('button', name='有高权限开关已开启 · 查看安全设置', exact=True).wait_for()
        settings.locator('[data-settings-destination="input-dictation-engine"]').wait_for()
        assert not model.is_visible()
        settings.get_by_role('button', name='有高权限开关已开启 · 查看安全设置', exact=True).click()
        settings.locator('[data-settings-destination="privacy-autonomy"]').wait_for()
        settings.get_by_role('button', name='返回隐私与权限', exact=True).click()
        settings.get_by_role('button', name='返回设置首页', exact=True).click()
        assistant.get_by_role('button', name='语音', exact=True).click()
        before = page.evaluate('window.fixtureState.voiceDictationMode')
        page.evaluate('window.commandRecognition=window.activeRecognition;window.commandRecognition.onresult({results:[Object.assign([{transcript:"开启连续听写"}],{isFinal:true})]});window.lateEnd=window.commandRecognition.onend;void 0')
        home.get_by_role('button', name='输入与交互', exact=True).click()
        page.wait_for_function('window.commandRecognition.aborted===true')
        page.evaluate('window.lateEnd()')
        assert page.evaluate('window.fixtureState.voiceDictationMode') == before
        settings.get_by_role('button', name='返回设置首页', exact=True).click()
        assistant.get_by_text('语音输入已取消', exact=True).wait_for()
        assistant.get_by_role('button', name='语音', exact=True).click()
        page.evaluate('window.commandRecognition=window.activeRecognition;window.commandRecognition.onresult({results:[Object.assign([{transcript:"开启连续听写"}],{isFinal:true})]})')
        assistant.get_by_role('button', name='停止', exact=True).click()
        assert page.evaluate('window.fixtureState.voiceDictationMode') == before
        assert assistant.get_by_role('textbox').input_value() == '开启连续听写'
        assistant.get_by_text('语音已填入草稿', exact=False).wait_for()
        # Capture stops when its owning destination is hidden.
        page.set_viewport_size({'width': 800, 'height': 700})
        page.evaluate("window.dispatchUI({type:'SET_DICTATION_HOTKEY_ENABLED',enabled:true});window.dispatchUI({type:'OPEN_SETTINGS_SECTION',section:'input-shortcuts'})")
        settings.get_by_role('button', name='按键盘录制', exact=True).click()
        page.evaluate("window.dispatchUI({type:'OPEN_SETTINGS_SECTION',section:'model'})")
        model.wait_for()
        assert not settings.get_by_role('button', name='按下组合键…（Esc 取消）', exact=True).is_visible()
        page.evaluate("window.dispatchUI({type:'OPEN_SETTINGS_SECTION',section:'input-shortcuts'})")
        settings.get_by_role('button', name='按键盘录制', exact=True).wait_for()
        page.evaluate("window.dispatchUI({type:'OPEN_SETTINGS_SECTION',section:'model'})")
        page.wait_for_function('document.activeElement?.id==="settings-page-model"')
        model.focus()
        page.evaluate("window.dispatchUI({type:'SET_COMPUTER_MODEL_LICENSE_DOOR',door:{licenseText:'Fixture license text',notice:'Fixture notice'}})")
        license_dialog = page.get_by_role('dialog', name='实验层许可证与免责声明', exact=True)
        license_dialog.wait_for()
        assert settings.locator('.cm-settings-content').get_attribute('inert') is not None
        for _ in range(5):
            page.keyboard.press('Tab')
            assert license_dialog.evaluate('(el)=>el.contains(document.activeElement)')
        page.keyboard.press('Shift+Tab')
        assert license_dialog.evaluate('(el)=>el.contains(document.activeElement)')
        page.keyboard.press('Escape')
        license_dialog.wait_for(state='hidden')
        assert settings.is_visible()
        page.wait_for_function('document.activeElement?.placeholder=== "输入模型名称或从列表选择"')
        assert not page.evaluate('window.sent.some(x=>x.type.includes("license_response"))')
        # The composer handles a missing local model through the same destination.
        settings.get_by_role('button', name='关闭设置', exact=True).click()
        page.evaluate("""window.dispatchUI({type:'SET_ACTIVE_THREAD',threadId:window.demoThreads[0].id});
            window.dispatchUI({type:'SET_VOICE_MODEL_STATE',modelState:{
            sttEngine:'local', localModelId:'medium', recommendedModelId:'small', models:{},
            binary:{status:'ready'}, autoFallbackToBrowser:false, diskBudgetMB:4096, diskUsedMB:0
        }})""")
        page.get_by_test_id('voice-mic-btn').click()
        page.get_by_test_id('voice-cta-open-settings').click()
        settings.locator('[data-settings-destination="input-dictation-engine"]').wait_for()
        page.wait_for_function('document.activeElement?.id==="settings-destination-input-dictation-engine"')
        page.evaluate("window.dispatchUI({type:'OPEN_SETTINGS_SECTION',section:'data-knowledge'})")
        settings.get_by_role('button', name='打开知识面板', exact=True).click()
        settings.wait_for(state='hidden')
        page.get_by_role('searchbox', name='筛选知识文档', exact=True).wait_for()
        assert not errors, errors
        browser.close()
print('PASS: settings home, six categories, destination and back focus, four widths, drafts, deep links, safety status, voice cancellation, and license focus.')
