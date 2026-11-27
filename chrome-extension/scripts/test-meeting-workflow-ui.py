"""Real meeting UI/adapter/handler/store, isolated Chrome and data, fake STT/LLM.

Live capture feeds Chrome's fake device through the production PCM controller
and local queue. WAV import uses real Web Audio decoding. No user audio.
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
parser.add_argument('--external-asr', action='store_true')
parser.add_argument('--minutes-only', action='store_true')
args = parser.parse_args()
args.artifacts.mkdir(parents=True, exist_ok=True)
project = Path(__file__).resolve().parent.parent

def wav_bytes(seconds=2):
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes((struct.pack('<h', 1800) * 20 + struct.pack('<h', -1800) * 20) * (seconds * 400))
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
    if args.external_asr:
        command.append('--external-asr')
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
                if not args.baseline:
                    page.wait_for_function('window.responses.some(m=>m.type==="meeting.asr.state")')
            def select_view(label):
                if not args.baseline:
                    page.get_by_role('button', name=label, exact=True).click()
            def new_live_meeting(texts):
                page.get_by_role('button',name='新建会议会话',exact=True).click()
                page.wait_for_function('window.responses.some(m=>m.type==="meeting.created")')
                response=page.request.post(f'http://127.0.0.1:{port}/recognizer',data=texts)
                assert response.ok
            def begin_live():
                page.get_by_test_id('meeting-start-capture').click()
                page.wait_for_function('window.responses.some(m=>m.type==="voice.stt.partial" && m.queue_contract===1 && m.credits.length>0)')
            def wait_live_text(text):
                page.wait_for_function('text=>document.querySelector("[data-testid=meeting-transcript]").value.includes(text)',arg=text,timeout=22000)

            def final(text):
                page.wait_for_function('window.sent.some(m=>m.type==="voice.stt.end")')
                page.evaluate("text=>window.emit({type:'voice.stt.result',sessionId:window.sent.findLast(m=>m.type==='voice.stt.end').sessionId,text})", text)
            def transcript():
                return page.get_by_test_id('meeting-transcript')
            def verify_minutes(use_audio_import=False):
                open_page()
                raw = '讨论配森发布'
                if use_audio_import:
                    select_view("材料与设置")
                    page.locator('input[type=file][accept^="audio/"]').set_input_files({
                        'name':'synthetic.wav','mimeType':'audio/wav','buffer':wav_bytes(),
                    })
                    final(raw)
                    page.get_by_test_id('meeting-import-status').filter(has_text='音频导入完成').wait_for()
                else:
                    transcript().fill(raw)
                select_view("材料与设置")
                page.get_by_test_id('meeting-reference-file').set_input_files({'name':'会议笔记.md','mimeType':'text/markdown','buffer':'项目技术栈：Python。'.encode()})
                page.wait_for_function('document.querySelector("[data-testid=meeting-reference-input]").value.includes("Python")')
                assert transcript().input_value() == raw
                select_view("AI 纪要")
                page.get_by_role('button',name='生成会议纪要',exact=True).click()
                confirmation = page.get_by_role('region', name='确认纪要发送范围', exact=True)
                confirmation.get_by_text('参考笔记', exact=False).first.wait_for()
                confirmation.get_by_text('synthetic · https://unused.invalid/', exact=True).wait_for()
                confirmation.get_by_role('button',name='取消，保留文字',exact=True).click()
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.generate_minutes")')
                select_view("AI 纪要")
                page.get_by_role('button',name='生成会议纪要',exact=True).click()
                confirmation.get_by_role('button',name='确认发送并生成',exact=True).click()
                page.wait_for_function('window.responses.some(m=>m.type==="meeting.minutes_result")')
                result=page.evaluate('window.responses.findLast(m=>m.type==="meeting.minutes_result")')
                assert result['minutes']['source_transcript'] == raw
                assert result['minutes']['corrected_transcript']=='讨论Python发布'
                assert result['meeting']['transcript'][0]['text'] == raw
                assert result['meeting']['reference_notes']=='项目技术栈：Python。'
                assert transcript().input_value() == raw
                if use_audio_import:
                    assert [line['text'] for line in result['meeting']['original_transcript']] == [raw]
                    select_view("转写")
                    archive = page.get_by_test_id('meeting-original-transcript')
                    archive.locator('summary').click()
                    assert archive.locator('pre').inner_text() == raw
                    counts = page.evaluate('''() => ({
                        prepared: window.sent.filter(m => m.type === 'meeting.prepare_minutes').length,
                        generated: window.sent.filter(m => m.type === 'meeting.generate_minutes').length,
                    })''')
                    assert counts == {'prepared': 2, 'generated': 1}
                select_view("AI 纪要")
                page.get_by_text('会议纪要 · AI 草稿',exact=True).wait_for()
                corrected=page.get_by_test_id('meeting-corrected-transcript')
                corrected.locator('summary').click()
                assert corrected.locator('pre').inner_text()=='讨论Python发布'
                page.get_by_test_id('meeting-correction-evidence').locator('summary').click()
                page.get_by_test_id('meeting-correction-evidence').scroll_into_view_if_needed()
                page.screenshot(path=str(args.artifacts/'meeting-result-390.png'),full_page=True)
                select_view("材料与设置")
                page.get_by_test_id('meeting-materials').scroll_into_view_if_needed()
                page.screenshot(path=str(args.artifacts/'meeting-390.png'),full_page=True)
                page.set_viewport_size({'width':960,'height':900})
                page.screenshot(path=str(args.artifacts/'meeting-960.png'),full_page=True)
                assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
                page.get_by_test_id('meeting-reference-input').fill('项目技术栈：Python。新增议程待核对。')
                select_view("AI 纪要")
                page.get_by_test_id('meeting-minutes-stale').wait_for()
                print('PASS reference import remains separate; cancellation gates generation; original survives correction', flush=True)

            def verify_history_reader():
                identifier = 'mtg_reader_sample'
                turns = [
                    {'speaker': '林悦', 't0': 8, 'text': '第一轮访谈已经完成，大家都希望会议纪要能直接定位到发言。'},
                    {'speaker': '周澄', 't0': 94, 'text': '我们决定先给试用团队开放小窗口。'},
                    {'speaker': '林悦', 't0': 207, 'text': '我周五整理反馈，再决定下一轮的范围。'},
                ]
                markdown = """### TL;DR
- 访谈反馈集中在如何核对原文。〔会议纪要能直接定位到发言〕
- 小窗口先向试用团队开放。〔先给试用团队开放小窗口〕
### 决议
- 首轮开放范围为试用团队。〔先给试用团队开放小窗口〕
### 待办
- [ ] 林悦周五整理反馈。〔我周五整理反馈〕
### 风险 / 开放问题
- 下一轮范围待确认。〔再决定下一轮的范围〕"""
                def fetch_history(route):
                    msg = route.request.post_data_json['message']
                    if msg.get('type') != 'meeting.get' or msg.get('meeting_id') != identifier:
                        route.continue_()
                        return
                    route.fulfill(json={'id': msg['id'], 'v': 1, 'type': 'meeting.get_result', 'meeting': {
                        'id': identifier, 'title': '产品体验周会', 'status': 'ended',
                        'original_transcript': turns, 'transcript': turns,
                        'minutes': {'raw_md': markdown, 'generated_at': '2026-11-20T02:00:00Z'},
                    }})
                page.route('**/rpc', fetch_history)
                try:
                    page.set_viewport_size({'width': 760, 'height': 900})
                    page.goto('about:blank')
                    page.goto(f'http://127.0.0.1:{port}/#{identifier}')
                    page.get_by_role('heading', name='产品体验周会').wait_for()
                    doc = page.locator('article.meeting-document')
                    doc.get_by_role('heading', name='会议概览').wait_for()
                    assert doc.get_by_role('checkbox').count() == 1
                    doc.screenshot(path=str(args.artifacts/'meeting-minutes-document.png'))
                    doc.get_by_role('button', name='原文 03:27').first.click()
                    assert page.locator('[data-turn-index="2"]').evaluate('e=>e===document.activeElement')
                    select_view('章节')
                    page.get_by_role('button', name='01:34 小窗口先向试用团队开放。').click()
                    assert page.locator('[data-turn-index="1"]').evaluate('e=>e===document.activeElement')
                    print('PASS saved minutes, topic timestamps, and source navigation', flush=True)
                finally:
                    page.unroute('**/rpc', fetch_history)

            if args.minutes_only:
                verify_minutes(use_audio_import=True)
                if not args.baseline:
                    verify_history_reader()
                assert not errors, errors
                browser.close()
                raise SystemExit(0)
            if args.external_asr:
                open_page()
                form = page.get_by_test_id('meeting-asr-settings')
                page.get_by_test_id('meeting-asr-current').filter(has_text='本机转写').wait_for()
                form.get_by_label('转写方式').select_option('external')
                form.get_by_label('服务协议').select_option('openai')
                form.get_by_label('服务地址').fill(f'http://127.0.0.1:{port}/v1')
                form.get_by_label('模型名称').fill('fixture-whisper')
                form.get_by_label('会议转写密钥').fill('synthetic-asr')
                form.get_by_role('button', name='保存', exact=True).click()
                page.get_by_test_id('meeting-asr-current').filter(has_text='fixture-whisper').wait_for()
                source = {'name':'synthetic-long.wav','mimeType':'audio/wav','buffer':wav_bytes(92)}
                select_view("材料与设置")
                audio_input = page.locator('input[type=file][accept^="audio/"]')
                audio_input.set_input_files(source)
                approval = page.get_by_role('region', name='确认发送导入录音')
                approval.wait_for()
                confirmation = approval.inner_text()
                for value in ('synthetic-long.wav', f'http://127.0.0.1:{port}/v1/audio/transcriptions', 'fixture-whisper', '共 3 段'):
                    assert value in confirmation, confirmation
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.asr.authorize"||m.type==="meeting.asr.segment")')
                approval.get_by_role('button', name='取消', exact=True).click()
                select_view("材料与设置")
                page.get_by_test_id('meeting-import-status').filter(has_text='音频未发送').wait_for()
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.asr.authorize"||m.type==="meeting.asr.segment")')
                audio_input.set_input_files(source)
                approval.get_by_role('button', name='确认发送并转写').click()
                select_view("材料与设置")
                page.get_by_test_id('meeting-import-status').filter(has_text='服务正在限流').wait_for()
                assert '已完成 1/3 段' in page.get_by_test_id('meeting-import-status').inner_text()
                assert '该段音频已发送' in page.get_by_test_id('meeting-import-status').inner_text()
                assert transcript().input_value() == '第一段外部转写'
                assert page.evaluate('window.sent.filter(m=>m.type==="meeting.asr.segment").map(m=>m.index)') == [0, 1]
                assert not page.evaluate('window.sent.some(m=>m.type==="voice.stt.start"||m.type==="meeting.generate_minutes")')
                trace = json.loads((args.artifacts/'workflow-frames.json').read_text(encoding='utf-8'))
                assert [item['asrBoundary'] for item in trace if 'asrBoundary' in item] == [
                    {'status': 200, 'wavBytes': 1440044, 'model': 'fixture-whisper'},
                    {'status': 429, 'wavBytes': 1440044, 'model': 'fixture-whisper'},
                ]
                persisted = [item['response']['meeting'] for item in trace if item.get('request', {}).get('type') == 'meeting.set_transcript']
                assert [line['text'] for line in persisted[-1]['original_transcript']] == ['第一段外部转写']
                page.screenshot(path=str(args.artifacts/'meeting-asr-partial.png'), full_page=True)
                assert not errors, errors
                print('PASS meeting ASR settings, per-file refusal, long PCM segmentation, provider rejection and retained completed text', flush=True)
                browser.close()
                raise SystemExit(0)
            open_page()
            if args.baseline:
                # The historical negative control predates credit-based capture.
                # Drive its actual PCM adapter and preserve the failing UI/frames.
                select_view("材料与设置")
                page.get_by_test_id('meeting-asr-refine').check()
                page.get_by_test_id('meeting-start-capture').click()
                page.wait_for_function('window.sent.some(m=>m.type==="voice.stt.start")')
                page.evaluate('window.capture.onPcmChunk(new Uint8Array(32000))')
                final('讨论配森发布')
                try:
                    page.wait_for_function('Array.from(document.querySelectorAll("textarea")).some(t=>t.value.includes("讨论配森发布"))',timeout=3000)
                except Exception:
                    page.screenshot(path=str(args.artifacts/'live-before-failure.png'),full_page=True)
                    (args.artifacts/'live-before-failure.json').write_text(json.dumps(page.evaluate('({sent:window.sent,responses:window.responses,textareas:[...document.querySelectorAll("textarea")].map(e=>e.value)})'),ensure_ascii=False,indent=2),encoding='utf-8')
                    raise
                raise AssertionError('Expected the pinned pre-fix panel to miss the live raw final')
            new_live_meeting(['讨论配森发布'])
            select_view("材料与设置")
            page.get_by_test_id('meeting-asr-refine').check()
            begin_live()
            wait_live_text('讨论配森发布')
            assert page.evaluate('window.sent.some(m=>m.type==="voice.stt.chunk" && m.frame_count>0 && m.credit_id>0)')
            assert page.get_by_test_id('meeting-stop-capture').is_visible()
            assert not page.evaluate('window.responses.some(m=>m.type==="voice.refine.result")')
            print('PASS raw STT final visible while recording and AI correction still pending', flush=True)
            if args.real_mic:
                page.screenshot(path=str(args.artifacts/'real-mic-live.png'), full_page=True)
                assert not errors, errors
                browser.close()
            else:
                page.get_by_test_id('meeting-stop-and-generate').click()
                confirmation=page.get_by_role('region',name='确认纪要发送范围')
                confirmation.get_by_text('synthetic · https://unused.invalid/',exact=True).wait_for()
                assert page.evaluate('window.sent.some(m=>m.type==="voice.stt.end" && m.final_sample_end>0)')
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.generate_minutes")')
                confirmation.get_by_role('button',name='确认发送并生成',exact=True).click()
                page.wait_for_function('window.responses.some(m=>m.type==="meeting.minutes_result")', timeout=12000)
                frames = page.evaluate('window.responses')
                result = next(m for m in reversed(frames) if m['type']=='meeting.minutes_result')
                assert '讨论配森发布' in result['minutes']['source_transcript']
                assert '讨论配森发布' in result['minutes']['raw_md']
                assert result['minutes']['actions']==[]
                assert 'voice.refine.result' not in [m['type'] for m in frames]
                print('PASS stop-and-generate completes with saved final text without waiting for optional live AI', flush=True)
                # Hold real handler responses, not fabricated payloads. The new
                # primary action must preserve default segmentation and cannot
                # cross any save/end receipt boundary on a forwarding ACK alone.
                open_page()
                held = {}
                gate_types = {'voice.stt.end', 'meeting.end', 'meeting.set_transcript', 'meeting.set_reference'}
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
                select_view("材料与设置")
                page.get_by_test_id('meeting-mtg2-tools').locator('summary').click()
                page.get_by_test_id('meeting-default-speaker').fill('张三')
                assert page.get_by_label('结束时智能分段', exact=False).is_checked()
                raw = ' '.join(f'第{i}项讨论核对版本依赖、部署流程、回滚条件和测试覆盖，所有结论均需负责人确认。' for i in range(1, 13))
                assert len(raw) > 280 and '\n' not in raw
                new_live_meeting([raw])
                begin_live()
                wait_live_text(raw)
                page.get_by_test_id('meeting-stop-and-generate').click()
                wait_gate('voice.stt.end')
                assert held['voice.stt.end'][2]['final_sample_end'] > 0
                assert transcript().input_value() == f'张三: {raw}'
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.generate_minutes")')
                release_gate('voice.stt.end')
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
                confirmation = page.get_by_role('region', name='确认纪要发送范围', exact=True)
                confirmation.get_by_text('synthetic · https://unused.invalid/', exact=True).wait_for()
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.generate_minutes")')
                confirmation.get_by_role('button', name='确认发送并生成', exact=True).click()
                page.wait_for_function('window.responses.some(m=>m.type==="meeting.minutes_result")')
                generated = page.evaluate('window.responses.findLast(m=>m.type==="meeting.minutes_result")')
                assert generated['minutes']['source_transcript'] == canonical
                assert '第1项讨论核对版本依赖、部署流程、回滚条件和测试覆盖' in generated['minutes']['raw_md']
                assert generated['minutes']['actions']==[]
                assert transcript().input_value() == canonical
                assert [line['text'] for line in generated['meeting']['original_transcript']] == [raw]
                assert page.evaluate('window.sent.findLast(m=>m.type==="meeting.generate_minutes").text') == canonical
                page.unroute('**/rpc', hold_material_receipt)
                print('PASS default stop-and-generate preserves >280-char sentence segmentation and speaker labels; seal/end/transcript/reference real receipts precede generation; immutable raw remains uncut', flush=True)
                # A fresh meeting owns a fresh raw archive even before an idle
                # updated push happens to arrive for that new owner.
                select_view("转写")
                archive = page.get_by_test_id('meeting-original-transcript')
                archive.locator('summary').click()
                assert raw in archive.locator('pre').inner_text()
                page.get_by_role('button',name='新建会议会话',exact=True).click()
                page.wait_for_function('previous=>window.responses.some(m=>m.type==="meeting.created" && m.meeting.id!==previous)',arg=generated['meeting']['id'])
                archive.wait_for(state='detached')
                fresh = page.evaluate('window.responses.findLast(m=>m.type==="meeting.created").meeting')
                assert fresh['id'] != generated['meeting']['id']
                assert not fresh.get('original_transcript')
                print('PASS creating a new meeting clears the prior owner original-recognition archive immediately', flush=True)
                verify_minutes()
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
                select_view("转写")
                page.get_by_role('button',name='保存转写',exact=True).click()
                select_view("转写")
                page.get_by_test_id('meeting-save-status').filter(has_text='已保存转写').wait_for()
                recovered = page.evaluate('window.responses.findLast(m=>m.type==="meeting.updated").meeting')
                assert '导入前已有文字' in '\n'.join(line['text'] for line in recovered['transcript'])
                assert '失败后可恢复的识别文字' in '\n'.join(line['text'] for line in recovered['transcript'])
                assert [line['text'] for line in recovered['original_transcript']] == ['失败后可恢复的识别文字']
                select_view("转写")
                original_archive = page.get_by_test_id('meeting-original-transcript')
                original_archive.locator('summary').click()
                assert original_archive.locator('pre').inner_text() == '失败后可恢复的识别文字'
                assert transcript().input_value() == retained
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.generate_minutes")')
                print('PASS failed audio-import append explains 保存转写 recovery; explicit save restores editable and independent raw archive without generation',flush=True)
                # The importer still uses explicit append receipts. Drop its second
                # ACK after commit and ensure Save replays the same segment ID.
                open_page()
                page.evaluate("""() => {
                    const emit=window.emit;window.lostAppendAck=null;
                    window.emit=m=>{
                      const appends=window.sent.filter(req=>req.type==='meeting.append_transcript');
                      if(!window.lostAppendAck && appends.length===2 && m.id===appends[1].id && m.type==='meeting.updated'){
                        window.lostAppendAck=m;return;
                      }
                      emit(m);
                    };
                    const timer=window.setTimeout.bind(window);
                    window.setTimeout=(fn,ms,...rest)=>timer(fn,ms===10000?300:ms,...rest);
                }""")
                select_view("材料与设置")
                audio_input=page.locator('input[type=file][accept^="audio/"]')
                audio_input.set_input_files({'name':'two-windows.wav','mimeType':'audio/wav','buffer':wav_bytes(47)})
                final('第一段提交成功')
                page.wait_for_function('window.sent.filter(m=>m.type==="voice.stt.end").length===2')
                final('第二段提交成功但回执丢失')
                page.get_by_role('alert').filter(has_text='保存转写').wait_for()
                expected=['第一段提交成功','第二段提交成功但回执丢失']
                assert [line['text'] for line in page.evaluate('window.lostAppendAck.meeting.original_transcript')]==expected
                select_view("转写")
                page.get_by_role('button',name='保存转写',exact=True).click()
                select_view("转写")
                page.get_by_test_id('meeting-save-status').filter(has_text='已保存转写').wait_for()
                recovered=page.evaluate('window.responses.findLast(m=>m.type==="meeting.updated").meeting')
                assert [line['text'] for line in recovered['original_transcript']]==expected
                assert [line['text'] for line in recovered['transcript']]==expected
                requests=page.evaluate('window.sent.filter(m=>m.type==="meeting.append_transcript")')
                assert len(requests)==3
                assert requests[0]['segment_id']!=requests[1]['segment_id']==requests[2]['segment_id']
                assert requests[1]['id']!=requests[2]['id']
                print('PASS lost real append ACK: explicit Save retries the stable ID and preserves both finals exactly once',flush=True)
                # The queue commits its own raw finals. Drop the notification for the
                # first committed range, then verify the next sync recovers both in order.
                open_page()
                new_live_meeting(['第一段提交成功但回执丢失','第二段保留并按顺序补存'])
                page.evaluate("""() => {
                    const emit=window.emit;window.lostCommit=0;
                    window.emit=m=>{
                      if(m.type==='meeting.capture.status' && !m.id && m.committed_end>0){
                        window.lostCommit ||= m.committed_end;
                        if(m.committed_end===window.lostCommit)return;
                      }
                      emit(m);
                    }
                }""")
                begin_live()
                wait_live_text('第二段保留并按顺序补存')
                assert page.evaluate('window.lostCommit>0')
                page.get_by_test_id('meeting-stop-capture').click()
                page.wait_for_function('window.responses.some(m=>m.type==="meeting.ended")')
                select_view("转写")
                page.get_by_role('button',name='保存转写',exact=True).click()
                select_view("转写")
                page.get_by_test_id('meeting-save-status').filter(has_text='已保存转写').wait_for()
                recovered=page.evaluate('window.responses.findLast(m=>m.type==="meeting.updated").meeting')
                expected_raw=['第一段提交成功但回执丢失','第二段保留并按顺序补存']
                assert [line['text'] for line in recovered['original_transcript']]==expected_raw
                assert [line['text'] for line in recovered['transcript']]==expected_raw
                assert len({line['segment_id'] for line in recovered['original_transcript']})==2
                assert not page.evaluate('window.sent.some(m=>m.type==="meeting.generate_minutes")')
                print('PASS lost first committed status: later sync and explicit Save preserve two finalized segments in order without duplicates',flush=True)
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
        (args.artifacts/'server.log').write_bytes((temp/'server.log').read_bytes())
