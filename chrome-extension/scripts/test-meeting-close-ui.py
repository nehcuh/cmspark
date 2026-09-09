"""Production Host/Meeting/adapter, synthetic PCM + transport. No real audio."""
from pathlib import Path
import subprocess
import tempfile
from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='cmspark-meeting-close-') as directory:
    subprocess.run(['node', 'scripts/render-meeting-close-fixture.cjs', directory], cwd=project, check=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel='chrome', headless=True)
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        def open_fixture(standalone=False):
            page.goto((Path(directory)/'index.html').as_uri() + ('?standalone' if standalone else ''))
            page.get_by_test_id('meeting-start-capture').wait_for()
            page.wait_for_function('!document.querySelector("[data-testid=meeting-start-capture]").disabled')
        def start():
            page.get_by_test_id('meeting-start-capture').click()
            page.wait_for_function('window.sent.some(m=>m.type==="voice.stt.start")')
            page.evaluate('window.capture.onPcmChunk(new Uint8Array(32000))')
        def final(text='最后一段合成转写'):
            page.wait_for_function('window.sent.some(m=>m.type==="voice.stt.end")')
            assert page.get_by_test_id('meeting-panel').is_visible()
            assert not page.evaluate('window.sent.some(m=>m.type==="meeting.end")')
            page.evaluate("text=>window.emit({type:'voice.stt.result',sessionId:window.sent.find(m=>m.type==='voice.stt.end').sessionId,text})", text)
        for action in ['host', 'inner', 'skills', 'escape', 'settings', 'latest', 'owner']:
            open_fixture(); start()
            if action == 'host': page.get_by_role('button',name='结束并收起',exact=True).click()
            elif action == 'inner': page.get_by_role('button',name='结束录制并收起面板',exact=True).click()
            elif action == 'skills': page.get_by_role('button',name='切换技能',exact=True).click()
            elif action == 'settings': page.get_by_role('button',name='打开设置',exact=True).click()
            elif action == 'latest':
                page.get_by_role('button',name='切换技能',exact=True).click()
                page.get_by_role('button',name='切换知识',exact=True).click()
            elif action == 'owner':
                page.get_by_role('button',name='结束并收起',exact=True).click()
                page.evaluate("window.emit({type:'meeting.created',meeting:{id:'other-meeting'}})")
            else:
                page.get_by_role('button',name='结束并收起',exact=True).focus()
                page.keyboard.press('Escape')
            final()
            page.wait_for_function('window.activePanel!=="meeting"')
            assert page.evaluate('window.persisted') == ['最后一段合成转写']
            assert page.evaluate('window.captureStops') == 1
            assert page.evaluate('window.captureAborts') == 0
            types = page.evaluate('window.sent.map(m=>m.type)')
            assert types.index('meeting.append_transcript') < types.index('meeting.get') < types.index('meeting.end')
            assert page.evaluate("window.sent.filter(m=>['meeting.append_transcript','meeting.get','meeting.end'].includes(m.type)).every(m=>m.meeting_id===window.owner&&m.id!==window.owner)")
            if action == 'settings': assert page.get_by_test_id('settings-state').inner_text() == '设置已打开'
            if action == 'latest': assert page.evaluate('window.activePanel') == 'knowledge'
        # A successful forwarding ACK / incorrect persisted snapshot must not close.
        open_fixture(); start(); page.evaluate('window.failRead=true')
        page.get_by_role('button',name='结束并收起',exact=True).click(); final()
        page.get_by_role('alert').filter(has_text='尚未确认保存').wait_for()
        assert page.evaluate('window.activePanel') == 'meeting'
        assert not page.evaluate('window.sent.some(m=>m.type==="meeting.end")')
        page.evaluate('window.failRead=false')
        page.get_by_role('button',name='收起面板',exact=True).click()
        page.wait_for_function('window.activePanel===null')
        # Review finding 2: failure retains the meeting and a repeated Settings
        # action retries successfully; it must not force-close or silently lose text.
        open_fixture(); start(); page.evaluate('window.failRead=true')
        settings_button = page.get_by_role('button',name='打开设置',exact=True)
        settings_button.click(); final()
        page.get_by_role('alert').filter(has_text='尚未确认保存').wait_for()
        assert page.evaluate('window.activePanel') == 'meeting'
        assert page.get_by_test_id('settings-state').inner_text() == '设置未打开'
        assert settings_button.is_enabled()
        assert not page.evaluate('window.sent.some(m=>m.type==="meeting.end")')
        assert page.evaluate('window.persisted') == ['最后一段合成转写']
        page.evaluate('window.failRead=false')
        settings_button.click()
        page.wait_for_function('window.activePanel===null')
        assert page.get_by_test_id('settings-state').inner_text() == '设置已打开'
        assert page.evaluate('window.sent.filter(m=>m.type==="meeting.get").length') == 2
        print('PASS settings readback failure: visible error + meeting retained; repeated Settings action completes after recovery')
        # Review finding 3: no Host and no registerBeforeClose prop. The inner
        # button still uses the production fallback guard and delays onClose.
        open_fixture(standalone=True); start(); page.evaluate('window.deferEnd=true')
        page.get_by_role('button',name='结束录制并收起面板',exact=True).click(); final()
        page.wait_for_function('window.sent.some(m=>m.type==="meeting.end")')
        assert page.get_by_test_id('meeting-panel').is_visible()
        assert not page.evaluate('window.sent.some(m=>m.type==="fixture.closed")')
        page.evaluate("window.replyEnd()")
        page.wait_for_function('window.activePanel===null')
        assert page.evaluate('window.persisted') == ['最后一段合成转写']
        types = page.evaluate('window.sent.map(m=>m.type)')
        assert types.index('meeting.append_transcript') < types.index('meeting.get') < types.index('meeting.end') < types.index('fixture.closed')
        assert types.count('fixture.closed') == 1
        print('PASS standalone MeetingPanel without registerBeforeClose: final → persisted readback → end ACK → exactly one onClose')
        # Final dispatch is not end confirmation: keep the owner mounted until ACK.
        open_fixture(); start(); page.evaluate('window.deferEnd=true')
        page.get_by_role('button',name='结束并收起',exact=True).click(); final()
        page.wait_for_function('window.sent.some(m=>m.type==="meeting.end")')
        assert page.evaluate('window.activePanel') == 'meeting'
        page.evaluate("window.emit({type:'meeting.ended',meeting:{id:'other'}})")
        assert page.evaluate('window.activePanel') == 'meeting'
        page.evaluate("window.replyEnd()")
        page.wait_for_function('window.activePanel===null')
        # Closing before meeting.started must not acquire a mic when start arrives.
        open_fixture(); page.evaluate('window.deferStart=true')
        page.get_by_test_id('meeting-start-capture').click()
        page.get_by_role('button',name='结束并收起',exact=True).click()
        page.wait_for_timeout(20)
        page.evaluate("window.emit({type:'meeting.started',meeting:window.snapshot()})")
        page.wait_for_function('window.activePanel===null')
        assert not page.evaluate('window.sent.some(m=>m.type==="voice.stt.start")')
        # Import stop keeps the current final, saves it, and skips remaining segments.
        open_fixture()
        page.locator('input[type=file][accept^="audio/"]').set_input_files({'name':'synthetic.wav','mimeType':'audio/wav','buffer':b'synthetic decoder fixture'})
        page.wait_for_function('window.sent.some(m=>m.type==="voice.stt.end")')
        page.get_by_role('button',name='结束并收起',exact=True).click()
        final()
        page.wait_for_function('window.activePanel===null')
        assert page.evaluate('window.persisted') == ['最后一段合成转写']
        assert page.evaluate('window.sent.filter(m=>m.type==="voice.stt.start").length') == 1
        assert not page.evaluate('window.sent.some(m=>m.type==="meeting.end")')
        # Closing while decoding cancels before creating a meeting or STT session.
        open_fixture(); page.evaluate('window.deferDecode=true')
        page.locator('input[type=file][accept^="audio/"]').set_input_files({'name':'synthetic.wav','mimeType':'audio/wav','buffer':b'synthetic decoder fixture'})
        page.wait_for_function('!!window.finishDecode')
        page.get_by_role('button',name='结束并收起',exact=True).click()
        page.wait_for_timeout(20); page.evaluate('window.finishDecode()')
        page.wait_for_function('window.activePanel===null')
        assert not page.evaluate('window.sent.some(m=>m.type==="voice.stt.start"||m.type==="meeting.create")')
        # Old equal/suffix text and stale server pushes must not consume a failed
        # new write or replace the local final. Explicit save is a recoverable path.
        for text in ['好', '你好']:
            open_fixture(); start()
            page.evaluate("window.persisted=['你好'];window.failWrite=true")
            page.get_by_role('button',name='结束并收起',exact=True).click(); final(text)
            page.get_by_role('alert').filter(has_text='保存转写').wait_for()
            textarea = page.get_by_test_id('meeting-transcript')
            assert textarea.input_value() == text
            page.evaluate("window.reply('appended',{id:'stale-after-idle'});window.emit(window.recorded.oldRead.response)")
            assert textarea.input_value() == text
            assert page.evaluate('window.activePanel') == 'meeting'
            assert not page.evaluate('window.sent.some(m=>m.type==="meeting.end")')
            # A denied full replacement must not erase the original write failure.
            page.get_by_role('button',name='保存转写',exact=True).click()
            page.get_by_role('alert').filter(has_text='草稿仍保留').wait_for()
            assert textarea.input_value() == text
            page.evaluate('window.failWrite=false')
            page.get_by_role('button',name='保存转写',exact=True).click()
            page.get_by_test_id('meeting-save-status').filter(has_text='已保存转写').wait_for()
            assert page.evaluate('window.persisted') == [text]
            assert page.evaluate('window.snapshot().original_transcript.map(line=>line.text)') == [text]
            page.get_by_role('button',name='收起面板',exact=True).click()
            page.wait_for_function('window.activePanel===null')
            assert not page.evaluate('window.sent.some(m=>m.type==="meeting.generate_minutes")')
        print('PASS stale suffix/equal write receipts rejected; textarea retains unconfirmed final after idle and stale pushes; denied save retains draft; explicit successful save recovers close without LLM')
        # An unregistered guard cannot create another read/end on later settings.
        requests = page.evaluate('window.sent.filter(m=>m.type==="meeting.get"||m.type==="meeting.end").length')
        page.get_by_role('button',name='打开设置',exact=True).click()
        assert page.get_by_test_id('settings-state').inner_text() == '设置已打开'
        assert page.evaluate('window.sent.filter(m=>m.type==="meeting.get"||m.type==="meeting.end").length') == requests
        print('PASS guard effect unregisters on unmount; subsequent settings does not run stale meeting guard')
        # Normal Stop precedes Close: actual store contract independently verifies
        # endMeetingRecording remains idempotent and returns both receipts.
        open_fixture(); start()
        page.get_by_test_id('meeting-stop-capture').click(); final()
        page.wait_for_function('window.sent.some(m=>m.type==="meeting.end")')
        page.get_by_role('button',name='收起面板',exact=True).click()
        page.wait_for_function('window.activePanel===null')
        print('PASS normal stop followed by close completes with final text intact')
        # Failed import replacement also preserves its local final for recovery.
        open_fixture(); page.evaluate('window.failWrite=true')
        page.locator('input[type=file][accept^="audio/"]').set_input_files({'name':'synthetic.wav','mimeType':'audio/wav','buffer':b'synthetic decoder fixture'})
        page.wait_for_function('window.sent.some(m=>m.type==="voice.stt.end")')
        page.get_by_role('button',name='结束并收起',exact=True).click(); final()
        page.get_by_role('alert').filter(has_text='保存转写').wait_for()
        assert page.get_by_test_id('meeting-transcript').input_value() == '最后一段合成转写'
        page.evaluate('window.failWrite=false')
        page.get_by_role('button',name='保存转写',exact=True).click()
        page.get_by_test_id('meeting-save-status').filter(has_text='已保存转写').wait_for()
        assert page.evaluate('window.snapshot().original_transcript.map(line=>line.text)') == ['最后一段合成转写']
        page.get_by_role('button',name='收起面板',exact=True).click()
        page.wait_for_function('window.activePanel===null')
        assert not page.evaluate('window.sent.some(m=>m.type==="meeting.end")')
        print('PASS failed import set_transcript preserves textarea and explicit save enables retry')
        # Accelerate only the production 20s stop deadline; transport/final absent.
        page.add_init_script("const timeout=window.setTimeout.bind(window);window.setTimeout=(f,ms,...args)=>timeout(f,ms===20000?40:ms,...args)")
        open_fixture(); start()
        page.get_by_role('button',name='结束并收起',exact=True).click()
        page.get_by_role('alert').filter(has_text='未完整处理').wait_for()
        assert page.evaluate('window.activePanel') == 'meeting'
        assert not page.evaluate('window.sent.some(m=>m.type==="meeting.end")')
        assert not errors, errors
        browser.close()
print('PASS meeting final PCM → STT result → append → readback → end → all close/navigation paths; failure retained/retry; pending start never opens mic; import in-flight final saved and next segment canceled; decode canceled before meeting creation')
