"""#492 real native summoner, HTTP/ACL/store/parsers; synthetic microphone and model.

Run from companion after `nvm use 22`:
uv run --no-project --with playwright python scripts/test-summoner-meeting-ui.py
No installed app, ordinary Chrome profile, user configuration, or user audio is used.
"""
from pathlib import Path
import io
import json
import math
import struct
import subprocess
import tempfile
import time
import urllib.request
import wave
import zipfile

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
ARTIFACTS = ROOT.parent / ".omx/artifacts/meeting-492/native"
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def wav_bytes(seconds=2):
    out = io.BytesIO()
    with wave.open(out, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(16000)
        wav.writeframes(b"".join(struct.pack("<h", int(5000 * math.sin(2 * math.pi * 220 * i / 16000)))
                                  for i in range(int(16000 * seconds))))
    return out.getvalue()


def docx_bytes():
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as docx:
        docx.writestr("[Content_Types].xml", '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        docx.writestr("_rels/.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        docx.writestr("word/document.xml", '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Python 周四发布，负责人小王。</w:t></w:r></w:p></w:body></w:document>')
    return out.getvalue()


with tempfile.TemporaryDirectory(prefix="cmspark-native-meeting-") as temporary:
    work = Path(temporary)
    microphone = work / "synthetic-microphone.wav"
    microphone.write_bytes(wav_bytes(12))
    server_log = (ARTIFACTS / "server.log").open("w")
    server = subprocess.Popen(
        ["node", "scripts/serve-summoner-meeting-fixture.cjs", str(work / "data"), str(ARTIFACTS / "native-handler-trace.json")],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=server_log, text=True,
    )
    try:
        while True:
            line = server.stdout.readline()
            if not line:
                raise RuntimeError("native fixture exited: " + (ARTIFACTS / "server.log").read_text())
            if line.startswith('{"port":'):
                addresses = json.loads(line)
                break
        origin = f"http://127.0.0.1:{addresses['port']}"
        control_url = f"http://127.0.0.1:{addresses['controlPort']}"
        local_http = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def control(**changes):
            request = urllib.request.Request(control_url, data=json.dumps(changes).encode() if changes else None,
                                             headers={"Content-Type": "application/json"})
            return json.load(local_http.open(request, timeout=5))

        def events(kind, phase="request", after=0):
            return [item for item in control()["traces"] if item["n"] > after and item.get("phase") == phase and item.get("type") == kind]

        def wait_event(page, kind, phase="request", after=0, timeout=20000):
            deadline = time.monotonic() + timeout / 1000
            while time.monotonic() < deadline:
                matches = events(kind, phase, after)
                if matches:
                    return matches[-1]
                page.wait_for_timeout(50)
            raise AssertionError(f"No {phase} {kind} after {after}; recent trace: {control()['traces'][-8:]}")

        def no_model(after=0):
            assert not events("meeting.generate_minutes", after=after)
            assert not [item for item in control()["traces"] if item["n"] > after and item.get("phase") == "llm"]

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True, args=[
                "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
                f"--use-file-for-fake-audio-capture={microphone}", "--autoplay-policy=no-user-gesture-required",
            ])
            context = browser.new_context(viewport={"width": 390, "height": 780}, permissions=["microphone"])
            page = context.new_page()
            page.set_default_timeout(12000)
            errors, requests = [], []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.on("request", lambda request: requests.append(request.url))
            page.add_init_script("window.resizeTo=()=>{};window.moveTo=()=>{};")
            page.goto(origin)
            expect(page.locator("#meetingStart")).to_be_visible()
            no_model()

            page.locator("#meetingOpen").click()
            expect(page.locator("#meetingDesk")).to_be_visible()
            assert not events("voice.stt.start"), "opening materials must not start capture"
            no_model()
            page.locator("#meetingBack").click()

            # The start entry may open the materials desk; mic starts only on the explicit record button.
            page.locator("#meetingStart").click()
            if page.locator("#meetingPrivacyAck").is_visible():
                page.locator("#meetingPrivacyAck").click()
            expect(page.locator("#meetingDesk")).to_be_visible()
            control(hold=["meeting.append_transcript", "meeting.end"])
            expect(page.locator("#meetingRec")).to_have_attribute("aria-pressed", "true")
            wait_event(page, "voice.stt.start")
            # Live raw text must be visible while its persistence ACK is deliberately pending.
            first_append = wait_event(page, "meeting.append_transcript", "held", timeout=22000)
            expect(page.locator("#meetingLive")).to_contain_text("配森")
            page.screenshot(path=str(ARTIFACTS / "native-live-390.png"), full_page=True)
            no_model()
            assert not events("meeting.end")
            page.locator("#meetingReferenceSection > summary").click()
            page.locator("#meetingReferenceNotes").fill("Python 周四发布，负责人小王。")
            page.locator("#meetingMinutesBtn").click()
            page.wait_for_timeout(250)
            assert not events("meeting.end"), "end ran before the raw append ACK"
            no_model()
            control(release="meeting.append_transcript")
            end_held = wait_event(page, "meeting.end", "held")
            no_model()
            control(release="meeting.end")
            generated = wait_event(page, "meeting.generate_minutes", "ack")
            assert generated["response"]["type"] == "meeting.minutes_result", generated
            append_acks = events("meeting.append_transcript", "ack")
            end_ack = events("meeting.end", "ack")[-1]
            generate_request = events("meeting.generate_minutes")[-1]
            assert all(event["n"] < end_held["n"] for event in append_acks)
            assert end_ack["n"] < generate_request["n"]
            expect(page.locator("#meetingMinutes")).to_contain_text("Python")
            expect(page.locator("#meetingEvidence")).to_contain_text("周四")
            expect(page.locator("#meetingEvidence")).to_contain_text("负责人小王")
            expect(page.locator("#meetingLive")).to_contain_text("配森")
            page.screenshot(path=str(ARTIFACTS / "native-correction-390.png"), full_page=True)
            # HTTP and SSE duplicate delivery must append each STT session exactly once.
            finalized = events("voice.stt.end", "ack")
            assert len(append_acks) == len(finalized), (append_acks, finalized)
            print("PASS native raw immediate, SSE/HTTP dedup, append ACK → end ACK → explicit minutes", flush=True)

            # A failed model call preserves the current transcript/reference and completed draft.
            before_text = page.locator("#meetingLive").inner_text()
            marker = control()["traces"][-1]["n"]
            control(failLlm=True)
            page.locator("#meetingMinutesBtn").click()
            failed = wait_event(page, "meeting.generate_minutes", "ack", after=marker)
            assert failed["response"]["type"] == "meeting.error"
            assert page.locator("#meetingLive").inner_text() == before_text
            expect(page.locator("#meetingReferenceNotes")).to_have_value("Python 周四发布，负责人小王。")
            control(failLlm=False)
            print("PASS native generation failure preserves materials", flush=True)

            marker = control()["traces"][-1]["n"]
            for filename, mime, data, phrase in [
                ("notes.md", "text/markdown", "Python 周四发布，负责人小王。\n".encode(), "Python"),
                ("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx_bytes(), "Python"),
            ]:
                with page.expect_file_chooser() as chooser:
                    page.locator("#meetingReferenceImport").click()
                chooser.value.set_files({"name": filename, "mimeType": mime, "buffer": data})
                expect(page.locator("#meetingReferenceName")).to_contain_text(filename)
                expect(page.locator("#meetingReferenceImport")).to_be_enabled()
                parsed = events("meeting.import_reference", "ack")[-1]["response"]["reference"]
                assert phrase in parsed["text"]
                expect(page.locator("#meetingReferenceNotes")).to_have_value(parsed["text"])
                no_model(after=marker)
            marker = control()["traces"][-1]["n"]
            page.locator("#meetingReferenceSave").click()
            saved = wait_event(page, "meeting.set_reference", "ack", after=marker)
            assert saved["response"]["meeting"]["reference_name"] == "notes.docx"
            expect(page.locator("#meetingAudioImport")).to_be_enabled()
            print("PASS native md/docx production parser and saved reference; no automatic model", flush=True)

            # Decode a real generated WAV with browser WebAudio, then send PCM to the local STT handler.
            marker = control()["traces"][-1]["n"]
            control(text="追加录音保留现有转写。")
            with page.expect_file_chooser() as chooser:
                page.locator("#meetingAudioImport").click()
            chooser.value.set_files({"name": "synthetic.wav", "mimeType": "audio/wav", "buffer": wav_bytes()})
            imported = wait_event(page, "meeting.append_transcript", "ack", after=marker)
            assert imported["response"]["type"] != "meeting.error", imported
            expect(page.locator("#meetingLive")).to_contain_text("追加录音保留现有转写")
            expect(page.locator("#meetingLive")).to_contain_text("配森")
            expect(page.locator("#meetingAudioImport")).to_be_enabled()
            assert events("voice.stt.chunk", after=marker), "audio import never reached PCM upload"
            no_model(after=marker)
            print("PASS native real WAV decode/import appends to existing raw text without generation", flush=True)

            marker = control()["traces"][-1]["n"]
            preserved = page.locator("#meetingLive").inner_text()
            control(failStt=True)
            with page.expect_file_chooser() as chooser:
                page.locator("#meetingAudioImport").click()
            chooser.value.set_files({"name": "failed.wav", "mimeType": "audio/wav", "buffer": wav_bytes()})
            failed_stt = wait_event(page, "voice.stt.end", "ack", after=marker)
            assert failed_stt["response"]["type"] == "voice.stt.error"
            page.wait_for_timeout(100)
            assert page.locator("#meetingLive").inner_text() == preserved
            no_model(after=marker)
            control(failStt=False)
            print("PASS native failed audio import keeps prior materials", flush=True)

            layouts = []
            for width in [390, 960]:
                page.set_viewport_size({"width": width, "height": 780})
                page.wait_for_timeout(100)
                result = page.evaluate("""() => {
                  const ids=['meetingDesk','meetingLive','meetingReferenceNotes','meetingAudioImport','meetingReferenceImport'];
                  return {width:innerWidth, scrollWidth:document.documentElement.scrollWidth,
                    boxes:ids.map(id=>{const el=document.getElementById(id),r=el.getBoundingClientRect();
                      return {id,left:r.left,right:r.right,width:r.width,height:r.height}})};
                }""")
                assert result["scrollWidth"] <= width + 1, result
                assert all(box["left"] >= -1 and box["right"] <= width + 1 and box["width"] > 0 for box in result["boxes"]), result
                live_box = next(box for box in result["boxes"] if box["id"] == "meetingLive")
                assert live_box["height"] >= 140, ("transcript collapsed behind materials/minutes", result)
                layouts.append(result)
                page.screenshot(path=str(ARTIFACTS / f"native-{width}.png"), full_page=True)
            (ARTIFACTS / "layout-evidence.json").write_text(json.dumps(layouts, ensure_ascii=False, indent=2))

            # Drop the request, drop its successful response, or leave only the raw file stale.
            # Every retry must preserve previous imports and commit the same segment once.
            for mode in ["before_send", "after_commit", "partial_write"]:
                expect(page.locator("#meetingRec")).to_be_enabled()
                marker = control()["traces"][-1]["n"]
                control(text=f"恢复追加不重复 {mode}。", partialRawOnce=mode == "partial_write")
                notes_before = page.locator("#meetingReferenceNotes").input_value()
                def lose_append(route):
                    if mode in ["after_commit", "partial_write"]:
                        actual = route.fetch()
                        assert actual.json()["type"] == "meeting.updated"
                    route.abort("failed")
                page.route("**/api/meeting/append", lose_append, times=1)
                page.locator("#meetingRec").click()
                started = wait_event(page, "meeting.start", "ack", after=marker)
                existing = started["response"]["meeting"]
                assert existing["reference_name"] == "notes.docx"
                assert existing["reference_notes"] == notes_before
                wait_event(page, "voice.stt.chunk", after=marker)
                page.locator("#meetingMinutesBtn").click()
                expect(page.locator("#meetingRetry")).to_be_visible()
                expect(page.locator("#meetingMinutesBtn")).to_be_enabled()
                expect(page.locator("#meetingLive")).to_contain_text(f"恢复追加不重复 {mode}")
                expect(page.locator("#meetingLive")).to_contain_text("追加录音保留现有转写")
                no_model(after=marker)
                assert not events("meeting.end", after=marker), "failed save incorrectly ended meeting"
                if mode == "partial_write":
                    fault = [event for event in control()["traces"] if event["n"] > marker and event.get("phase") == "disk-fault"][-1]
                    assert fault["kind"] == mode
                    assert fault["before"]["transcript"] == existing["transcript"]
                    assert fault["after"]["transcript"][:-1] == existing["transcript"]
                    assert fault["after"]["original_transcript"] == existing["original_transcript"]
                    assert fault["after"]["transcript"][-1]["segment_id"] == fault["segment_id"]
                    assert len(fault["after"]["transcript"]) == len(existing["transcript"]) + 1
                page.locator("#meetingRetry").click()
                recovered = wait_event(page, "meeting.end", "ack", after=marker)["response"]["meeting"]
                assert len(recovered["transcript"]) == len(existing["transcript"]) + 1, recovered
                assert len(recovered["original_transcript"]) == len(existing["original_transcript"]) + 1
                assert recovered["transcript"][:-1] == existing["transcript"]
                assert recovered["original_transcript"][:-1] == existing["original_transcript"]
                appended = events("meeting.append_transcript", after=marker)
                assert len(appended) == (1 if mode == "before_send" else 2)
                segment_ids = {event["request"].get("segment_id") for event in appended}
                assert len(segment_ids) == 1 and None not in segment_ids and "" not in segment_ids
                assert recovered["transcript"][-1]["segment_id"] in segment_ids
                assert recovered["original_transcript"][-1] == recovered["transcript"][-1]
                expect(page.locator("#meetingRetry")).to_be_hidden()
                no_model(after=marker)
                page.locator("#meetingMinutesBtn").click()
                regenerated = wait_event(page, "meeting.generate_minutes", "ack", after=marker)
                assert regenerated["response"]["type"] == "meeting.minutes_result", regenerated
                expect(page.locator("#meetingMinutesBtn")).to_be_enabled()
                print(f"PASS native {mode} append failure → retry → end → generation; no duplicate or lost materials", flush=True)

            # Import-first users need no recording session. A new document requires its own consent.
            marker = control()["traces"][-1]["n"]
            control(text="配森将在周五发布。")
            imported_page = context.new_page()
            imported_page.set_default_timeout(12000)
            imported_page.on("pageerror", lambda error: errors.append(str(error)))
            imported_page.on("request", lambda request: requests.append(request.url))
            imported_page.add_init_script("window.resizeTo=()=>{};window.moveTo=()=>{};")
            imported_page.goto(origin)
            imported_page.locator("#meetingOpen").click()
            with imported_page.expect_file_chooser() as chooser:
                imported_page.locator("#meetingReferenceImport").click()
            chooser.value.set_files({"name": "import-first.md", "mimeType": "text/markdown", "buffer": "Python 周四发布，负责人小王。".encode()})
            expect(imported_page.locator("#meetingReferenceName")).to_contain_text("import-first.md")
            expect(imported_page.locator("#meetingAudioImport")).to_be_enabled()
            assert not events("voice.stt.start", after=marker)
            no_model(after=marker)
            imported_page.locator("#meetingAudioImport").click()
            expect(imported_page.locator("#meetingPrivacyAck")).to_be_visible()
            assert not events("voice.stt.start", after=marker)
            imported_page.screenshot(path=str(ARTIFACTS / "native-import-consent-390.png"), full_page=True)
            with imported_page.expect_file_chooser() as chooser:
                imported_page.locator("#meetingPrivacyAck").click()
            chooser.value.set_files({"name": "import-first.wav", "mimeType": "audio/wav", "buffer": wav_bytes()})
            wait_event(imported_page, "meeting.append_transcript", "ack", after=marker)
            expect(imported_page.locator("#meetingAudioImport")).to_be_enabled()
            expect(imported_page.locator("#meetingLive")).to_contain_text("配森")
            expect(imported_page.locator("#meetingReferenceNotes")).to_have_value("Python 周四发布，负责人小王。")
            assert not events("meeting.start", after=marker), "import unexpectedly started microphone recording"
            assert len(events("voice.stt.start", after=marker)) == 1
            no_model(after=marker)
            imported_page.locator("#meetingMinutesBtn").click()
            imported_minutes = wait_event(imported_page, "meeting.generate_minutes", "ack", after=marker)
            assert imported_minutes["response"]["type"] == "meeting.minutes_result", imported_minutes
            expect(imported_page.locator("#meetingEvidence")).to_contain_text("Python")
            print("PASS native import-first materials preserve notes, require explicit audio consent, and generate only on click", flush=True)
            assert not errors, errors
            assert all(url.startswith(origin) for url in requests), requests
            (ARTIFACTS / "browser-evidence.json").write_text(json.dumps({"errors": errors, "requests": requests, "layouts": layouts}, ensure_ascii=False, indent=2))
            print("PASS native 390/960 layouts, no page errors or external requests", flush=True)
            browser.close()
    finally:
        server.terminate()
        server.wait(timeout=8)
        server_log.close()
