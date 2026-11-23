"""Real Chrome mixer/ASR PCM/IndexedDB/WebM test with synthetic input streams.

From chrome-extension, run: uv run --with playwright python scripts/test-desktop-meeting-mix.py
"""
import json
from pathlib import Path
import subprocess
import tempfile

from playwright.sync_api import sync_playwright


def verify(result, both):
    assert result["remainingFrames"] == 0, result
    assert len(result["evidence"]) == int(both), result
    if both:
        image = result["evidence"][0]
        assert image["recordingId"] == "fixture-both-capture" and image["validHash"], result
        assert image["mime"] == "image/jpeg" and image["timeMs"] >= 1000, result
        assert image["red"] > 210 and image["blue"] > 210, image
        assert (image["width"], image["height"]) == (160, 90), image
        assert result["coverage"]["lastTimeMs"] == image["timeMs"] and result["coverage"]["saved"] == 1, result
    else:
        assert result.get("coverage") is None, result
    assert result["micOpens"] == int(both), result
    assert result["samples"] >= 32000 and result["bytes"] > 0 and result["chunks"] >= 1, result
    for name in ("pcm", "webm"):
        shared, microphone, absent = result[name]
        assert shared > 0.07, (name, result)
        if both:
            assert microphone > 0.07, (name, result)
        else:
            assert microphone < 0.015, (name, result)
        assert absent < 0.015, (name, result)
    frame = result["frame"]
    assert (frame["width"], frame["height"]) == (160, 90), frame
    left, right = frame["left"], frame["right"]
    assert left[0] > 210 and max(left[1:]) < 45, frame
    assert right[2] > 210 and max(right[:2]) < 45, frame


def main():
    project = Path(__file__).resolve().parent.parent
    with tempfile.TemporaryDirectory(prefix="cmspark-880-mix-") as directory:
        bundle = Path(directory, "mix.js")
        subprocess.run(["node", "-e", "require('esbuild').buildSync({entryPoints: "
                        "['scripts/fixtures/desktop-meeting-mix.ts'], bundle:true, outfile: process.argv[1]})",
                        str(bundle)], cwd=project, check=True)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="chrome", headless=True)
            try:
                context = browser.new_context()
                page = context.new_page()
                page.route("**/*", lambda route: route.fulfill(
                    content_type="application/javascript", path=bundle
                ) if route.request.url.endswith("/mix.js") else route.fulfill(
                    content_type="text/html", body='<button>Start synthetic fixture</button><script src="mix.js"></script>'
                ))
                results = {}
                page.goto("http://127.0.0.1/fixture#store")
                page.get_by_role("button").click()
                page.wait_for_function("window.result")
                results["store"] = page.evaluate("window.result")
                assert results["store"] == dict(recovered="legacy", afterDelete=1, foreign="closed", stale="closed",
                                                first="saved", duplicate="duplicate", complete=True), results
                for mode in ("both", "shared-only"):
                    page.goto("http://127.0.0.1/fixture?mode=" + mode + "#" + mode)
                    page.get_by_role("button").click()
                    page.wait_for_function("window.result")
                    result = page.evaluate("window.result")
                    verify(result, mode == "both")
                    results[mode] = result
                page.goto("http://127.0.0.1/fixture#heartbeat")
                page.get_by_role("button").click()
                page.wait_for_function("window.result", timeout=75000)
                heartbeat = page.evaluate("window.result")
                assert heartbeat["count"] == 2 and heartbeat["duplicates"] == 1 and len(set(heartbeat["digests"])) == 2, heartbeat
                assert heartbeat["times"][1] - heartbeat["times"][0] >= 60000, heartbeat
                results["heartbeat"] = heartbeat
                print(json.dumps({"chrome": browser.version, "fixture": "synthetic", "modes": results}))
            finally:
                browser.close()


if __name__ == "__main__":
    main()
