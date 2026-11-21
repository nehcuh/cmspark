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
    expect(page.locator("[data-navigation-mode]")).to_have_attribute("data-navigation-mode", "layered")
    page.get_by_role("button", name="打开工作区导航", exact=True).click()
    drawer = page.get_by_role("dialog", name="工作区导航", exact=True)
    drawer.get_by_text("资料与工具", exact=True).click()
    drawer.get_by_role("button", name="会议", exact=True).click()
    expect(page.get_by_test_id("meeting-panel")).to_be_visible(timeout=15000)


def meeting_request(page, meeting_id, kind, reply_type, timeout=15000):
    return page.evaluate("""({meetingId, kind, replyType, timeout}) => new Promise((resolve,reject) => {
      const request = "meeting-rpc-" + crypto.randomUUID();
      const stop = () => chrome.runtime.onMessage.removeListener(receive);
      const finish = (error, reply) => {
        clearTimeout(timer); stop(); error ? reject(error) : resolve(reply);
      };
      const timer = setTimeout(() => finish(Error(kind + " timed out")), timeout);
      const receive = m => {
        if (m.id !== request) return;
        if (m.type === 'error' || m.type === 'meeting.error' || m.type === replyType) finish(null, m);
      };
      chrome.runtime.onMessage.addListener(receive);
      chrome.runtime.sendMessage({type:kind, v:1, id:request, meeting_id:meetingId}).then(reply => {
        if (!reply?.ok || reply.sent === false) finish(Error(kind + " was not sent"));
      }, finish);
    })""", {"meetingId": meeting_id, "kind": kind, "replyType": reply_type, "timeout": timeout})


def remaining_ms(end):
    remaining = int((end - time.monotonic()) * 1000)
    assert remaining > 0, "Minutes confirmation and generation exceeded the 100-second budget"
    return remaining


def assert_pending_minutes(session, panel, end):
    assert not (session / "minutes.json").exists() and not (session / "minutes.md").exists()
    assert read_json(session / "meta.json")["status"] not in {"generating", "done"}
    expect(panel.get_by_text("会议纪要 · AI 草稿", exact=True)).to_have_count(0, timeout=remaining_ms(end))


def request_minutes_confirmation(panel, end, target, transcript):
    panel.get_by_role("button", name="生成会议纪要", exact=True).click(timeout=remaining_ms(end))
    preview = panel.get_by_role("region", name="确认纪要发送范围", exact=True)
    expect(preview.get_by_text(target, exact=True)).to_be_visible(timeout=remaining_ms(end))
    preview.get_by_text("预览本次文字", exact=True).click(timeout=remaining_ms(end))
    expect(preview.locator("details").get_by_text(transcript, exact=True)).to_be_visible(timeout=remaining_ms(end))
    return preview


def main():
    p = argparse.ArgumentParser()
    for key in ("extension", "data", "audio", "output", "profile"):
        p.add_argument("--" + key, type=Path, required=True)
    p.add_argument("--version", required=True)
    p.add_argument("--minutes-model", required=True)
    p.add_argument("--minutes-endpoint", required=True)
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
            viewport={"width": 420, "height": 860},
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
            meta, = (a.data / "meetings").glob("*/meta.json")
            session = meta.parent
            imported = read_json(session / "transcript.json")
            canonical_text = "\n".join(
                (f"{row['speaker']}: " if row.get("speaker") else "") + row["text"]
                for row in imported
            ).strip()
            assert canonical_text.split() == transcript.split()
            target = f"{a.minutes_model} · {a.minutes_endpoint}"
            end = time.monotonic() + 100
            assert_pending_minutes(session, panel, end)
            print("Checking that preparing and canceling leave minutes ungenerated", flush=True)
            preview = request_minutes_confirmation(panel, end, target, canonical_text)
            assert_pending_minutes(session, panel, end)
            preview.get_by_role("button", name="取消，保留文字", exact=True).click(timeout=remaining_ms(end))
            expect(preview).to_have_count(0, timeout=remaining_ms(end))
            expect(panel.get_by_test_id("meeting-transcript")).to_have_value(canonical_text, timeout=remaining_ms(end))
            assert_pending_minutes(session, panel, end)
            unconfirmed = meeting_request(
                panel, session.name, "meeting.generate_minutes", "meeting.minutes_result",
                timeout=min(15000, remaining_ms(end)),
            )
            assert unconfirmed["type"] == "meeting.error" and unconfirmed["code"] == "minutes_consent_required"
            assert_pending_minutes(session, panel, end)
            preview = request_minutes_confirmation(panel, end, target, canonical_text)
            assert_pending_minutes(session, panel, end)
            preview.get_by_role("button", name="确认发送并生成", exact=True).click(timeout=remaining_ms(end))
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
            assert files[0].parent == session
            minutes = read_json(files[0])
            raw = minutes["raw_md"].strip()
            assert raw and not minutes.get("stale") and read_json(session / "meta.json")["status"] == "done"
            assert minutes["source_transcript"] == canonical_text
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
            print("UI and disk agree on the raw ASR and generated minutes; checking fresh extension document", flush=True)
            panel.reload()
            response = meeting_request(panel, session.name, "meeting.get", "meeting.get_result")
            assert response["type"] == "meeting.get_result", response.get("code")
            saved = response["meeting"]
            assert saved["id"] == session.name
            assert saved["minutes"]["raw_md"].strip() == raw and saved["transcript"] == rows
            assert saved["original_transcript"] == originals
            (a.output / "transcript.txt").write_text(transcript, encoding="utf-8")
            (a.output / "minutes.md").write_text(raw, encoding="utf-8")
            (a.output / "receipt.json").write_text(json.dumps({
                "version":a.version, "clip":"AMI ES2002a, 30-150s, CC BY 4.0",
                "audio_sha256":"16ea66ffc7a02735b6510bca34c7a74555d115eb8ffb20b2f209f90d351c3fb2",
                "imported_segments":int(match[1]), "total_segments":int(match[2]), "stt_segments":len(originals), "minutes_chars":len(raw), "reload":True,
                "minutes_consent": {"recipient": target, "cancellation_kept_transcript": True, "unconfirmed_request": unconfirmed["code"]},
            }, ensure_ascii=False), encoding="utf-8")
        finally:
            browser.close()


if __name__ == "__main__":
    main()
