"""Exercise the Mini page, real browser recording, persisted WAV/WebM and history in an isolated profile."""

import json
import math
import os
import sys
import struct
import subprocess
import tempfile
import time
import wave
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
# Owned microphone and tab imagery/tones keep the fixture independent of installed devices.
INPUTS = """
const mkTone = async (hz) => {
  const ctx = new AudioContext(), out = ctx.createMediaStreamDestination(), osc = ctx.createOscillator();
  const gain = ctx.createGain(); gain.gain.value=.3; osc.frequency.value=hz;
  osc.connect(gain).connect(out); osc.start(); await ctx.resume(); return out.stream;
};
Object.defineProperty(navigator.mediaDevices, "getUserMedia",{value:()=>mkTone(1250)});
if(!window.testNativeTab)Object.defineProperty(navigator.mediaDevices, "getDisplayMedia",{value:async () => {
  if(!navigator.userActivation.isActive)throw Error("Missing source selection gesture");
  const canvas = document.createElement("canvas"); canvas.width=240; canvas.height=120;
  const paint=canvas.getContext("2d"); let frame=0;
  function draw(){paint.fillStyle="rgb(20,140,60)";paint.fillRect(0,0,240,120);paint.fillStyle="white";paint.fillText(String(frame++),90,60)}
  draw();setInterval(draw,40);
  const display=canvas.captureStream(25), track=display.getVideoTracks()[0], settings=track.getSettings.bind(track);
  Object.defineProperty(track,"getSettings",{value:()=>({...settings(),displaySurface:"window"})});
  if(!window.testNoSharedAudio)display.addTrack((await mkTone(500)).getAudioTracks()[0]);
  return display;
}});
"""


def tone(samples, rate, frequency):
    size = len(samples)
    return (
        2
        * math.hypot(
            sum(
                s * math.sin(i * 2 * math.pi * frequency / rate)
                for i, s in enumerate(samples)
            ),
            sum(
                s * math.cos(i * 2 * math.pi * frequency / rate)
                for i, s in enumerate(samples)
            ),
        )
        / size
    )


def main():
    native_tab = "--tab" in sys.argv
    monitor = "--monitor" in sys.argv
    tone_process = None
    with tempfile.TemporaryDirectory() as tmp, sync_playwright() as play:
        data = Path(tmp)
        server = subprocess.Popen(
            ["node", "tests/fixtures/mini-recording-server.cjs"],
            cwd=ROOT,
            env={**os.environ, "CMSPARK_DATA_DIR": tmp, "CMSPARK_SKIP_LOGIN_ENV": "1"},
        )
        try:
            port = data / "port"
            for _ in range(180):
                if port.exists():
                    break
                if server.poll() is not None:
                    raise RuntimeError("fixture host stopped")
                time.sleep(0.1)
            base = "http://127.0.0.1:" + port.read_text()
            flags = ["--autoplay-policy=no-user-gesture-required"]
            if native_tab:
                flags.append(
                    "--auto-select-tab-capture-source-by-title=CMspark-926-owned-source"
                )
            browser = play.chromium.launch(
                channel="chrome", args=flags, ignore_default_args=["--mute-audio"]
            )
            ctx = browser.new_context(accept_downloads=True)
            ctx.add_init_script(
                "window.testNativeTab="
                + json.dumps(native_tab)
                + ";window.testNoSharedAudio="
                + json.dumps(monitor)
                + ";"
                + INPUTS
            )
            if native_tab:
                source = ctx.new_page()
                source.route(
                    base + "/fixture-source",
                    lambda route: route.fulfill(
                        content_type="text/html",
                        body="<title>CMspark-926-owned-source</title><body style='background:rgb(20,140,60)'>Synthetic meeting</body>",
                    ),
                )
                source.goto(base + "/fixture-source")
                source.evaluate("""async ()=>{const ctx=new AudioContext(),gain=ctx.createGain(),osc=ctx.createOscillator();
                  gain.gain.value=.8;osc.frequency.value=500;osc.connect(gain).connect(ctx.destination);osc.start();await ctx.resume();
                  window.tone=[ctx,gain,osc];}""")
            if monitor:
                assert (
                    sys.platform.startswith("linux")
                    and os.environ.get("PULSE_SINK") == "cmspark_test"
                ), "Use the isolated CI null sink"
                signal_file = data / "source.wav"
                with wave.open(str(signal_file), "wb") as sound:
                    sound.setparams((1, 2, 16000, 0, "NONE", "NONE"))
                    period = b"".join(
                        struct.pack("<h", round(10000 * math.sin(i * math.pi / 16)))
                        for i in range(32)
                    )
                    sound.writeframes(period * 30000)
                tone_process = subprocess.Popen(
                    ["paplay", "--device=cmspark_test", str(signal_file)]
                )
            page = ctx.new_page()
            page.on("pageerror", lambda e: print("browser error", e, flush=True))
            # Local development on a Mac exercises the browser branch; CI runs the real platform choices.
            if sys.platform == "darwin":

                def platform_override(route):
                    response = route.fetch()
                    route.fulfill(
                        response=response,
                        body=response.text().replace(
                            'var miniPlatform="darwin"', 'var miniPlatform="win32"'
                        ),
                    )

                page.route(base + "/", platform_override)
            page.goto(base + "/#meeting")
            page.locator("#meetingRecordingMode").select_option("video")
            page.locator("#meetingRec").click()
            if page.locator("#meetingPrivacyAck").is_visible():
                page.locator("#meetingPrivacyAck").click()
            page.locator("#meetingChooseSource").click()
            if monitor:
                page.get_by_role(
                    "button", name="录制电脑播放的全部声音（含其他应用）"
                ).click()
            page.locator("#meetingDesk.recording").wait_for(state="attached")
            page.get_by_text("录制中 00:03", exact=True).wait_for()
            page.locator("#meetingRec").click()
            page.wait_for_selector("#meetingRecordings video", state="attached")
            page.reload()
            page.locator("#meetingHistToggle").click()
            page.locator("#meetingHistList button").first.click()
            for tag in ["audio", "video"]:
                player = page.locator("#meetingRecordings " + tag)
                player.wait_for(state="attached")
                result = player.evaluate("""async p=>{
                  p.parentElement.open=true; p.muted=true; await p.play();
                  await new Promise(r=>setTimeout(r,220)); p.pause();
                  return {elapsed:p.currentTime,width:p.videoWidth||0,src:p.src};
                }""")
                assert result["elapsed"] > 0 and (
                    tag == "audio"
                    or (result["width"] > 0 if native_tab else result["width"] == 240)
                ), result
                with page.expect_download() as event:
                    player.locator("..").locator("a").click()
                saved = data / (tag + ".copy")
                event.value.save_as(saved)
                original = next(
                    (data / "meetings").glob(
                        "*/recordings/*." + ("wav" if tag == "audio" else "webm")
                    )
                )
                assert (
                    saved.read_bytes() == original.read_bytes()
                    and saved.stat().st_size > 1000
                )
            with wave.open(str(data / "audio.copy")) as wav:
                rate = wav.getframerate()
                wav.setpos(rate)
                samples = [
                    n[0] / 32768 for n in struct.iter_unpack("<h", wav.readframes(rate))
                ]
                width = rate // 10
                windows = [
                    samples[i : i + width]
                    for i in range(0, len(samples) - width + 1, width)
                ]
                amplitudes = [
                    max(tone(window, rate, freq) for window in windows)
                    for freq in (500, 1250)
                ]
                assert min(amplitudes) > 0.04, amplitudes
            print(
                json.dumps(
                    {
                        "platform": sys.platform,
                        "nativeTab": native_tab,
                        "pulseMonitor": monitor,
                        "saved": ["WAV", "WebM"],
                        "shared_mic_tones": amplitudes,
                        "historyPlayback": True,
                        "downloadExact": True,
                    }
                )
            )
            browser.close()
        except Exception:
            if "page" in locals() and not page.is_closed():
                print(
                    "Mini status:",
                    page.locator("#meetingHint").text_content(),
                    page.locator("#meetingWorkflowStatus").text_content(),
                )
            raise
        finally:
            if tone_process is not None:
                tone_process.terminate()
                tone_process.wait(timeout=5)
            server.terminate()
            server.wait(timeout=10)


if __name__ == "__main__":
    main()
