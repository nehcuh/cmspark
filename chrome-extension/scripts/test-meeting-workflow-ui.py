"""Real meeting UI/adapter/handler/store, isolated Chrome and data, fake STT/LLM.

WAV import uses real Web Audio decoding. --real-mic uses Chrome's fake device
through the unmodified production PCM capture implementation. No user audio.
"""
import argparse
import io
import json
from pathlib import Path
import struct
import subprocess
import tempfile
import wave
import zipfile
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--artifacts', type=Path, required=True)
parser.add_argument('--real-mic', action='store_true')
parser.add_argument('--baseline', action='store_true')
args = parser.parse_args()
args.artifacts.mkdir(parents=True, exist_ok=True)
project = Path(__file__).resolve().parent.parent

def wav_bytes():
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b''.join(struct.pack('<h', 1800 if i % 40 < 20 else -1800) for i in range(32000)))
    return buffer.getvalue()

def docx_bytes():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        archive.writestr('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>术语：Python</w:t></w:r></w:p></w:body></w:document>')
    return buffer.getvalue()

with tempfile.TemporaryDirectory(prefix='cmspark-meeting-492-') as directory:
    temp = Path(directory)
    command = ['node', 'scripts/render-meeting-workflow-fixture.cjs', str(temp/'web')]
    if args.real_mic:
        command.append('--real-mic')
    if args.baseline:
        command.append('--baseline')
    subprocess.run(command, cwd=project, check=True)
    server = subprocess.Popen(['node', 'scripts/meeting-workflow-server.cjs', str(temp/'web'), str(temp/'data'), str(args.artifacts.resolve()/'workflow-frames.json')], cwd=project, stdout=subprocess.PIPE, stderr=open(temp/'server.log','w'), text=True)
    try:
        port = json.loads(server.stdout.readline())['port']
        with sync_playwright() as p:
            browser = p.chromium.launch(channel='chrome', headless=True, args=['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream'])
            page = browser.new_page(viewport={'width':390,'height':844})
            errors = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            if not args.real_mic:
                page.add_init_script('const timer=window.setTimeout.bind(window);window.setTimeout=(f,ms,...rest)=>timer(f,ms===8000?250:ms,...rest)')
            def open_page():
                page.goto(f'http://127.0.0.1:{port}/')
                page.get_by_test_id('meeting-start-capture').wait_for()
                page.wait_for_function('!document.querySelector("[data-testid=meeting-start-capture]").disabled')
            def final(text):
                page.wait_for_function('window.sent.some(m=>m.type==="voice.stt.end")')
                page.evaluate("text=>window.emit({type:'voice.stt.result',sessionId:window.sent.findLast(m=>m.type==='voice.stt.end').sessionId,text})", text)
            def transcript():
                return page.get_by_test_id('meeting-transcript')
            open_page()
            page.get_by_test_id('meeting-asr-refine').check()
            page.get_by_test_id('meeting-start-capture').click()
            page.wait_for_function('window.sent.some(m=>m.type==="voice.stt.start")')
            if not args.real_mic:
                page.evaluate('window.capture.onPcmChunk(new Uint8Array(32000))')
            else:
                page.wait_for_function('window.sent.some(m=>m.type==="voice.stt.chunk")')
            final('讨论配森发布')
            try:
                page.wait_for_function('(document.querySelector("[data-testid=meeting-transcript]")||document.querySelector("textarea[placeholder^=粘贴会议转写]"))?.value.includes("讨论配森发布")', timeout=3000)
            except Exception:
                page.screenshot(path=str(args.artifacts/'live-before-failure.png'),full_page=True)
                (args.artifacts/'live-before-failure.json').write_text(json.dumps(page.evaluate('({sent:window.sent,responses:window.responses,textareas:[...document.querySelectorAll("textarea")].map(e=>e.value)})'),ensure_ascii=False,indent=2))
                raise
            assert page.get_by_test_id('meeting-stop-capture').is_visible()
            assert not page.evaluate('window.responses.some(m=>m.type==="voice.refine.result")')
            print('PASS raw STT final visible while recording and AI correction still pending', flush=True)
            if args.real_mic:
                page.screenshot(path=str(args.artifacts/'real-mic-live.png'), full_page=True)
                assert not errors, errors
                browser.close()
            else:
                page.get_by_test_id('meeting-stop-and-generate').click()
                # A new window may already be active. Finish its final when present.
                page.wait_for_timeout(100)
                if page.evaluate('window.sent.filter(m=>m.type==="voice.stt.end").length>1'):
                    final('确认测试范围')
                page.wait_for_function('window.responses.some(m=>m.type==="meeting.minutes_result")', timeout=12000)
                frames = page.evaluate('window.responses')
                result = next(m for m in reversed(frames) if m['type']=='meeting.minutes_result')
                assert '讨论配森发布' in result['minutes']['source_transcript']
                assert 'voice.refine.result' not in [m['type'] for m in frames]
                print('PASS stop-and-generate completes with saved final text without waiting for optional live AI', flush=True)
                # Hold real handler responses, not fabricated payloads. The new
                # primary action must preserve default segmentation and cannot
                # cross any save/end receipt boundary on a forwarding ACK alone.
                open_page()
                held = {}
                gate_types = {'meeting.append_transcript', 'meeting.end', 'meeting.set_transcript', 'meeting.set_reference'}
                def hold_material_receipt(route):
                    message = route.request.post_data_json['message']
                    response = route.fetch()
                    if message['type'] in gate_types:
                        held[message['type']] = (route, response, message)
                    else:
                        route.fulfill(response=response)
                page.route('**/rpc', hold_material_receipt)
                def wait_gate(kind):
                    page.wait_for_function('kind=>window.sent.some(m=>m.type===kind)', arg=kind)
                    # Playwright dispatches route callbacks while waiting.
                    for _ in range(100):
                        if kind in held:
                            return
                        page.wait_for_timeout(20)
                    raise AssertionError(f'No real handler response reached {kind} receipt gate')
                def release_gate(kind):
                    route, response, _ = held.pop(kind)
                    route.fulfill(response=response)
                page.get_by_test_id('meeting-mtg2-tools').locator('summary').click()
                page.get_by_test_id('meeting-default-speaker').fill('张三')
                assert page.get_by_label('结束时智能分段', exact=False).is_checked()
                raw = ' '.join(f'第{i}项讨论核对版本依赖、部署流程、回滚条件和测试覆盖，所有结论均需负责人确认。' for i in range(1, 13))
                assert len(raw) > 280 and '\n' not in raw
                page.get_by_test_id('meeting-start-capture').click()
                page.wait_for_function('window.sent.some(m=>m.type==="voice.stt.start")')
                page.evaluate('window.capture.onPcmChunk(new Uint8Array(32000))')
                page.get_by_test_id('meeting-stop-and-generate').click()
                final(raw)
                wait_gate('meeting.append_transcript')
                assert transcript().input_value() == f'张三: {raw}'
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.end"||m.type==="meeting.generate_minutes")')
                release_gate('meeting.append_transcript')
                wait_gate('meeting.end')
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.set_transcript"||m.type==="meeting.generate_minutes")')
                release_gate('meeting.end')
                wait_gate('meeting.set_transcript')
                assert held['meeting.set_transcript'][2]['silence_cut'] is True
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.generate_minutes")')
                release_gate('meeting.set_transcript')
                wait_gate('meeting.set_reference')
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.generate_minutes")')
                saved = held['meeting.set_reference'][1].json()['meeting']
                assert len(saved['transcript']) > 1
                assert ''.join(line['text'] for line in saved['transcript']) == raw.replace(' ', '')
                assert saved['transcript'][0].get('speaker') == '张三'
                canonical = '\n'.join((f"{line['speaker']}: " if line.get('speaker') else '') + line['text'] for line in saved['transcript'])
                release_gate('meeting.set_reference')
                page.wait_for_function('window.responses.some(m=>m.type==="meeting.minutes_result")')
                generated = page.evaluate('window.responses.findLast(m=>m.type==="meeting.minutes_result")')
                assert generated['minutes']['source_transcript'] == canonical
                assert transcript().input_value() == canonical
                assert [line['text'] for line in generated['meeting']['original_transcript']] == [raw]
                assert page.evaluate('window.sent.findLast(m=>m.type==="meeting.generate_minutes").text') == canonical
                page.unroute('**/rpc', hold_material_receipt)
                print('PASS default stop-and-generate preserves >280-char sentence segmentation and speaker labels; append/end/transcript/reference real receipts all gate generation; immutable raw remains uncut', flush=True)
                # A fresh meeting owns a fresh raw archive even before an idle
                # updated push happens to arrive for that new owner.
                archive = page.get_by_test_id('meeting-original-transcript')
                archive.locator('summary').click()
                assert raw in archive.locator('pre').inner_text()
                page.get_by_role('button',name='新建会议会话',exact=True).click()
                page.wait_for_function('window.responses.some(m=>m.type==="meeting.created")')
                archive.wait_for(state='detached')
                fresh = page.evaluate('window.responses.findLast(m=>m.type==="meeting.created").meeting')
                assert fresh['id'] != generated['meeting']['id']
                assert not fresh.get('original_transcript')
                print('PASS creating a new meeting clears the prior owner original-recognition archive immediately', flush=True)
                # Independent reference upload parses through production handler.
                open_page()
                transcript().fill('讨论配森发布')
                page.get_by_test_id('meeting-reference-file').set_input_files({'name':'会议笔记.md','mimeType':'text/markdown','buffer':'项目技术栈：Python。'.encode()})
                page.wait_for_function('document.querySelector("[data-testid=meeting-reference-input]").value.includes("Python")')
                assert transcript().input_value()=='讨论配森发布'
                page.get_by_role('button',name='生成会议纪要',exact=True).click()
                page.wait_for_function('window.responses.some(m=>m.type==="meeting.minutes_result")')
                result=page.evaluate('window.responses.findLast(m=>m.type==="meeting.minutes_result")')
                assert result['minutes']['source_transcript']=='讨论配森发布'
                assert result['minutes']['corrected_transcript']=='讨论Python发布'
                assert result['meeting']['transcript'][0]['text']=='讨论配森发布'
                assert result['meeting']['reference_notes']=='项目技术栈：Python。'
                assert transcript().input_value()=='讨论配森发布'
                page.get_by_text('会议纪要 · AI 草稿',exact=True).wait_for()
                corrected=page.get_by_test_id('meeting-corrected-transcript')
                corrected.locator('summary').click()
                assert corrected.locator('pre').inner_text()=='讨论Python发布'
                page.get_by_test_id('meeting-correction-evidence').locator('summary').click()
                page.get_by_test_id('meeting-correction-evidence').scroll_into_view_if_needed()
                page.screenshot(path=str(args.artifacts/'meeting-result-390.png'),full_page=True)
                page.get_by_test_id('meeting-materials').scroll_into_view_if_needed()
                page.screenshot(path=str(args.artifacts/'meeting-390.png'),full_page=True)
                page.set_viewport_size({'width':960,'height':900})
                page.screenshot(path=str(args.artifacts/'meeting-960.png'),full_page=True)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.get_by_test_id('meeting-reference-input').fill('项目技术栈：Python。新增议程待核对。')
                page.get_by_test_id('meeting-minutes-stale').wait_for()
                print('PASS reference import remains separate; production generation validates evidence and preserves original while returning corrected draft', flush=True)
                # Failed persistence must not generate using old server text.
                open_page();transcript().fill('当前编辑稿')
                page.get_by_role('button',name='新建会议会话',exact=True).click()
                page.wait_for_function('window.responses.some(m=>m.type==="meeting.created")')
                page.evaluate('window.failWrite=true')
                page.get_by_role('button',name='生成会议纪要',exact=True).click()
                page.get_by_role('alert').filter(has_text='保存').wait_for()
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.generate_minutes")')
                assert transcript().input_value()=='当前编辑稿'
                print('PASS failed write blocks generation and preserves current draft',flush=True)
                # Actual WebAudio import appends coherently to existing text.
                open_page();transcript().fill('已有文字')
                page.locator('input[type=file][accept^="audio/"]').set_input_files({'name':'synthetic.wav','mimeType':'audio/wav','buffer':wav_bytes()})
                final('新增录音内容')
                last=page.wait_for_function('''() => {
                    const request=window.sent.findLast(m=>m.type==='meeting.set_transcript'&&m.text.includes('新增录音内容'));
                    return request && window.responses.find(m=>m.type==='meeting.updated'&&m.id===request.id)?.meeting;
                }''').json_value()
                assert '已有文字' in '\n'.join(x['text'] for x in last['transcript'])
                assert '已有文字' in transcript().input_value() and '新增录音内容' in transcript().input_value()
                assert [x['text'] for x in last['original_transcript']]==['新增录音内容']
                print('PASS real WAV decode + STT import retains prior transcript locally and in store',flush=True)
                # Deny the actual import append: retain the decoded STT text,
                # show the explicit recovery action, then persist without LLM.
                open_page();transcript().fill('导入前已有文字')
                page.evaluate('window.failWrite=true')
                page.locator('input[type=file][accept^="audio/"]').set_input_files({'name':'synthetic.wav','mimeType':'audio/wav','buffer':wav_bytes()})
                final('失败后可恢复的识别文字')
                page.get_by_role('alert').filter(has_text='保存转写').wait_for()
                assert page.evaluate('window.sent.some(m=>m.type==="meeting.append_transcript")')
                assert '导入前已有文字' in transcript().input_value()
                assert '失败后可恢复的识别文字' in transcript().input_value()
                retained = transcript().input_value()
                page.evaluate('window.failWrite=false')
                page.get_by_role('button',name='保存转写',exact=True).click()
                page.get_by_test_id('meeting-save-status').filter(has_text='已保存转写').wait_for()
                recovered = page.evaluate('window.responses.findLast(m=>m.type==="meeting.updated").meeting')
                assert '导入前已有文字' in '\n'.join(line['text'] for line in recovered['transcript'])
                assert '失败后可恢复的识别文字' in '\n'.join(line['text'] for line in recovered['transcript'])
                assert [line['text'] for line in recovered['original_transcript']] == ['失败后可恢复的识别文字']
                original_archive = page.get_by_test_id('meeting-original-transcript')
                original_archive.locator('summary').click()
                assert original_archive.locator('pre').inner_text() == '失败后可恢复的识别文字'
                assert transcript().input_value() == retained
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.generate_minutes")')
                print('PASS failed audio-import append explains 保存转写 recovery; explicit save restores editable and independent raw archive without generation',flush=True)
                # Lose only the first real append response AFTER the server has
                # committed it. Two local finals then exercise ordered recovery
                # and stable segment ids without forging a server payload.
                open_page()
                page.evaluate('''() => {
                    const originalEmit = window.emit;
                    window.lostAppendAck = null;
                    window.emit = message => {
                        const request = window.sent.find(m => m.type === 'meeting.append_transcript');
                        if (!window.lostAppendAck && request && message.id === request.id && message.type === 'meeting.updated') {
                            window.lostAppendAck = message;
                            return;
                        }
                        originalEmit(message);
                    };
                    const timer = window.setTimeout.bind(window);
                    window.restoreReceiptTimer = () => { window.setTimeout = timer; };
                    window.setTimeout = (f, ms, ...rest) => timer(f, ms === 10000 ? 180 : ms, ...rest);
                }''')
                page.get_by_test_id('meeting-start-capture').click()
                page.wait_for_function('window.sent.some(m=>m.type==="voice.stt.start")')
                page.evaluate('window.capture.onPcmChunk(new Uint8Array(32000))')
                final('第一段提交成功但回执丢失')
                page.wait_for_function('window.lostAppendAck && window.sent.filter(m=>m.type==="voice.stt.start").length>=2')
                committed = page.evaluate('window.lostAppendAck.meeting')
                assert [line['text'] for line in committed['original_transcript']] == ['第一段提交成功但回执丢失']
                page.evaluate('window.capture.onPcmChunk(new Uint8Array(32000))')
                page.get_by_test_id('meeting-stop-capture').click()
                page.wait_for_function('window.sent.filter(m=>m.type==="voice.stt.end").length>=2')
                final('第二段保留并按顺序补存')
                page.get_by_role('alert').filter(has_text='保存转写').wait_for()
                assert transcript().input_value().splitlines() == ['第一段提交成功但回执丢失', '', '第二段保留并按顺序补存']
                assert page.evaluate('window.sent.filter(m=>m.type==="meeting.append_transcript").length') == 1
                page.evaluate('window.restoreReceiptTimer()')
                page.get_by_role('button',name='保存转写',exact=True).click()
                page.get_by_test_id('meeting-save-status').filter(has_text='已保存转写').wait_for()
                recovered = page.evaluate('window.responses.findLast(m=>m.type==="meeting.updated").meeting')
                expected_raw = ['第一段提交成功但回执丢失', '第二段保留并按顺序补存']
                assert [line['text'] for line in recovered['original_transcript']] == expected_raw
                assert [line['text'] for line in recovered['transcript']] == expected_raw
                assert len({line['segment_id'] for line in recovered['original_transcript']}) == 2
                appends = page.evaluate('window.sent.filter(m=>m.type==="meeting.append_transcript")')
                assert len(appends) == 3
                assert appends[0]['segment_id'] == appends[1]['segment_id'] != appends[2]['segment_id']
                assert appends[0]['id'] != appends[1]['id']
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.generate_minutes")')
                print('PASS append committed/ACK lost: explicit Save retries stable segment_id, preserves two raw finals in order, and duplicates neither original nor edited transcript',flush=True)
                open_page();transcript().fill('原始文字不被笔记导入覆盖')
                page.get_by_test_id('meeting-reference-file').set_input_files({'name':'会议笔记.docx','mimeType':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','buffer':docx_bytes()})
                page.wait_for_function('document.querySelector("[data-testid=meeting-reference-input]").value.includes("Python")')
                assert transcript().input_value()=='原始文字不被笔记导入覆盖'
                previous=page.get_by_test_id('meeting-reference-input').input_value()
                page.get_by_test_id('meeting-reference-file').set_input_files({'name':'损坏.docx','mimeType':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','buffer':b'not a Word archive'})
                page.get_by_role('alert').filter(has_text='解析失败').wait_for()
                assert page.get_by_test_id('meeting-reference-input').input_value()==previous
                print('PASS real DOCX import and corrupt-document recovery preserve separate materials',flush=True)
                open_page()
                page.evaluate("window.dispatchUI({type:'SET_VOICE_MODEL_STATE',modelState:{sttEngine:'browser',localModelId:'medium',binary:{status:'ready'},models:{medium:{status:'ready'}}}})")
                page.get_by_test_id('meeting-enable-local-stt').wait_for()
                assert page.get_by_test_id('meeting-start-capture').is_disabled()
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.start"||m.type==="voice.model.set_engine")')
                page.get_by_test_id('meeting-enable-local-stt').click()
                assert page.evaluate('window.sent.some(m=>m.type==="voice.model.set_engine"&&m.engine==="local")')
                print('PASS downloaded model with browser engine is not falsely ready; enabling local STT requires explicit user action',flush=True)
                assert not errors,errors
                browser.close()
    finally:
        server.terminate()
        server.wait(timeout=10)
        (args.artifacts/'server.log').write_text((temp/'server.log').read_text())
