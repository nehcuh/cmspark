"""Exercise the released extension in an empty Chromium profile on an owned VM."""
import argparse
import hashlib
import json
import re
import time
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def open_meeting(page):
    page.wait_for_function("() => document.readyState === 'complete' && document.body.innerText.length > 20")
    page.get_by_role("navigation", name="工作区", exact=True).get_by_role("button", name="工具", exact=True).click()
    page.get_by_role("region", name="工具", exact=True).get_by_role("button", name="会议", exact=True).click()
    expect(page.get_by_test_id("meeting-panel")).to_be_visible(timeout=15000)


def main():
    p = argparse.ArgumentParser()
    for key in ("extension", "data", "audio", "output", "profile"):
        p.add_argument("--" + key, type=Path, required=True)
    p.add_argument("--version", required=True)
    p.add_argument("--ready-only", action="store_true")
    a = p.parse_args()
    manifest = read_json(a.extension / "manifest.json")
    assert manifest["version"] == a.version
    assert hashlib.file_digest(a.audio.open("rb"), "sha256").hexdigest() == "16ea66ffc7a02735b6510bca34c7a74555d115eb8ffb20b2f209f90d351c3fb2"
    assert not a.profile.exists()
    assert not list((a.data / "meetings").glob("*/meta.json"))
    a.output.mkdir(exist_ok=False)
    with sync_playwright() as pw:
        browser = pw.chromium.launch_persistent_context(
            str(a.profile), channel="chromium", headless=True,
            args=[f"--disable-extensions-except={a.extension}", f"--load-extension={a.extension}"],
        )
        try:
            worker = next(iter(browser.service_workers), None) or browser.wait_for_event("serviceworker")
            url = worker.url.split("/", 3)[:3]
            panel = browser.new_page()
            panel.goto("/".join(url) + "/" + manifest["side_panel"]["default_path"])
            secret = (a.data / "ws_secret").read_text(encoding="utf-8").strip()
            assert panel.evaluate("(s) => chrome.runtime.sendMessage({type:'ws.setSecret',secret:s}).then(r=>r.ok)", secret)
            del secret
            open_meeting(panel)
            panel.get_by_test_id("meeting-voice-privacy-v2-accept").click()
            panel.get_by_role("button", name="我已了解", exact=True).click()
            # The released Companion was configured for local STT. The optional
            # enable button disappears when its authenticated model state arrives.
            try:
                expect(panel.get_by_test_id("meeting-start-capture")).to_be_enabled(timeout=30000)
            except AssertionError:
                scene = panel.get_by_test_id("meeting-panel")
                print("Readiness:", scene.inner_text()[:1300] if scene.count() else "meeting panel closed", flush=True)
                raise
            upload = panel.get_by_test_id("meeting-import-audio")
            expect(upload).to_be_enabled()
            if a.ready_only:
                print("Candidate paired; both consent prompts and real local STT readiness passed", flush=True)
                return
            # The original panel owns the file picker, audio decode, PCM chunking and STT.
            with panel.expect_file_chooser() as picker:
                upload.click()
            picker.value.set_files(str(a.audio))
            status = panel.get_by_test_id("meeting-import-status")
            end = time.monotonic() + 900
            alert = panel.get_by_test_id("meeting-panel").get_by_role("alert")
            while time.monotonic() < end:
                if alert.is_visible():
                    raise RuntimeError("Audio import: " + alert.inner_text()[:300])
                text = status.inner_text() if status.count() else ""
                if "失败" in text or "中止" in text or "未完成" in text:
                    raise RuntimeError("Audio import did not complete: " + text[:150])
                match = re.search(r"音频导入完成\s*(\d+)/(\d+)", text)
                if match:
                    assert int(match[1]) == int(match[2]) > 0
                    break
                panel.wait_for_timeout(500)
            else:
                raise RuntimeError("Audio import provided no completion receipt")
            transcript = panel.get_by_test_id("meeting-transcript").input_value().strip()
            assert transcript
            panel.get_by_role("button", name="生成会议纪要", exact=True).click()
            end = time.monotonic() + 100
            while time.monotonic() < end:
                if alert.is_visible():
                    raise RuntimeError("Minutes generation: " + alert.inner_text()[:300])
                files = list((a.data / "meetings").glob("*/minutes.json"))
                if len(files) == 1 and (files[0].parent / "minutes.md").is_file():
                    break
                panel.wait_for_timeout(400)
            else:
                raise RuntimeError("The minutes request did not produce stored minutes")
            expect(panel.get_by_test_id("meeting-minutes-stale")).to_have_count(0)
            session = files[0].parent
            minutes = read_json(files[0])
            raw = minutes["raw_md"].strip()
            assert raw and not minutes.get("stale") and read_json(session / "meta.json")["status"] == "done"
            assert (session / "minutes.md").read_text(encoding="utf-8").strip() == raw
            rows = read_json(session / "transcript.json")
            originals = read_json(session / "original-transcript.json")
            assert originals and all(row.get("source") == "stt" and row["text"].strip() in transcript for row in originals)
            assert rows and all(row["text"].strip() for row in rows)
            assert all(row["text"].strip() in transcript for row in rows)
            minutes_view = panel.locator("pre:visible").filter(has_text=raw)
            expect(minutes_view).to_have_count(1)
            expect(minutes_view).to_have_text(raw)
            # Reopen the extension document and load through its normal Companion API.
            panel.reload()
            saved = panel.evaluate("""id => new Promise((resolve,reject) => {
              const stop = () => chrome.runtime.onMessage.removeListener(receive);
              const timer = setTimeout(() => { stop(); reject(Error("reload timed out")) }, 15000);
              const receive = m => {
                if (m.type === 'meeting.get_result' && m.meeting?.id === id) {
                  clearTimeout(timer); stop(); resolve(m.meeting);
                }
              };
              chrome.runtime.onMessage.addListener(receive);
              chrome.runtime.sendMessage({type:'meeting.get', v:1, meeting_id:id});
            })""", session.name)
            assert saved["minutes"]["raw_md"].strip() == raw and saved["transcript"] == rows
            assert saved["original_transcript"] == originals
            (a.output / "transcript.txt").write_text(transcript, encoding="utf-8")
            (a.output / "minutes.md").write_text(raw, encoding="utf-8")
            (a.output / "receipt.json").write_text(json.dumps({
                "version":a.version, "clip":"AMI ES2002a, 30-150s, CC BY 4.0",
                "audio_sha256":"16ea66ffc7a02735b6510bca34c7a74555d115eb8ffb20b2f209f90d351c3fb2",
                "stt_segments":len(originals), "minutes_chars":len(raw), "reload":True,
            }, ensure_ascii=False), encoding="utf-8")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
