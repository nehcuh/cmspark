"""Exercise actual settings components with synthetic transport and no live config."""
from pathlib import Path
import json
import os
import subprocess
import tempfile
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parent.parent

with tempfile.TemporaryDirectory(prefix="cmspark-vision-904-") as out:
    subprocess.run(["node", "scripts/render-workspace-fixture.cjs", out], cwd=root, check=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="chrome", headless=True)
        for width in (390, 1440):
            page = browser.new_page(viewport={"width": width, "height": 900})
            page.set_default_timeout(6000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto((Path(out) / "index.html").as_uri())
            page.wait_for_function("Boolean(window.dispatchUI)")
            page.evaluate("""() => {
                window.dispatchUI({type:'SET_CONFIG_SNAPSHOT', revision:'vision:1', config:{
                    ...window.fixtureState.config, model_name:'gpt-4o', base_url:'https://main.invalid/v1',api_key_set:true,
                    native_vision:'auto',vision_enabled:true,vision_reuse_main_model:false,
                    vision_base_url:'https://vision.invalid/v1',vision_model_name:'separate-vl',
                    vision_api_key:'owned-vision-fixture',vision_protocol:'anthropic'
                }});
                window.dispatchUI({type:'SET_CONFIG_HYDRATED',hydrated:true});
                window.dispatchUI({type:'OPEN_SETTINGS_SECTION',section:'model-vision'});
            }""")
            settings = page.get_by_role("dialog", name="设置", exact=True)
            vision = settings.locator('[data-settings-destination="model-vision"]')
            vision.wait_for()
            settings.get_by_role("button", name="返回模型与服务", exact=True).click()
            settings.get_by_text("附图 · gpt-4o · main.invalid / 截图 · separate-vl · vision.invalid", exact=True).wait_for()
            settings.get_by_role("button", name="看图与截图", exact=True).click()
            reuse = vision.get_by_role("checkbox", name="复用主模型", exact=True)
            independent = vision.get_by_role("group", name="独立视觉模型配置", exact=True)
            inputs = independent.locator("input, select")
            assert not reuse.is_checked()
            assert all(inputs.nth(i).is_enabled() for i in range(inputs.count()))
            reuse.check()
            assert all(inputs.nth(i).is_disabled() for i in range(inputs.count()))
            vision.get_by_text("当前使用：gpt-4o · main.invalid", exact=True).wait_for()
            # Reuse never copies the main settings or clears the dedicated key.
            assert independent.locator('input[type="password"]').input_value() == "owned-vision-fixture"
            assert independent.locator('input[type="text"]').nth(0).input_value() == "https://vision.invalid/v1"
            page.evaluate("window.dispatchUI({type:'EDIT_SETTINGS_DRAFT',config:{model_name:'claude-test',base_url:'https://next.invalid/v1'}})")
            vision.get_by_text("当前使用：claude-test · next.invalid", exact=True).wait_for()
            assert reuse.is_checked()
            reuse.uncheck()
            assert all(inputs.nth(i).is_enabled() for i in range(inputs.count()))
            assert independent.locator('input[type="text"]').nth(1).input_value() == "separate-vl"
            page.evaluate("window.dispatchUI({type:'EDIT_SETTINGS_DRAFT',config:{model_name:'deepseek-chat'}})")
            assert reuse.is_disabled() and not reuse.is_checked()
            assert all(inputs.nth(i).is_enabled() for i in range(inputs.count()))
            page.evaluate("window.dispatchUI({type:'EDIT_SETTINGS_DRAFT',config:{model_name:'gpt-4o',native_vision:'off'}})")
            assert reuse.is_disabled()
            page.evaluate("window.dispatchUI({type:'EDIT_SETTINGS_DRAFT',config:{native_vision:'auto'}})")
            assert reuse.is_enabled() and not reuse.is_checked()
            reuse.check()
            settings.locator("button.cm-settings-save").click()
            page.wait_for_function("window.sent.some(x=>x.type==='config.set')")
            submitted = page.evaluate("window.sent.filter(x=>x.type==='config.set').at(-1).config")
            assert submitted["vision_reuse_main_model"] is True
            assert "vision_base_url" not in submitted or submitted["vision_base_url"] == "https://vision.invalid/v1"
            assert "vision_api_key" not in submitted or submitted["vision_api_key"] == "owned-vision-fixture"
            master = vision.get_by_role("checkbox", name="启用截图视觉分析", exact=True)
            master.uncheck()
            assert reuse.count() == 0
            master.check()
            assert reuse.is_checked()
            page.evaluate("window.dispatchUI({type:'SET_CONFIG',config:{vision_enabled:false}})")
            settings.get_by_role("button", name="返回模型与服务", exact=True).click()
            settings.get_by_text("附图 · gpt-4o · main.invalid / 截图 · 未启用", exact=True).wait_for()
            assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth")
            assert not errors, errors
            print(f"PASS actual vision settings at {width}px: reuse, disabled controls, preserved fields, model switch, save payload, master switch")
            page.close()
        web_html = subprocess.check_output(
            ["node", "-e", "process.stdout.write(require('../companion/.test-dist/src/settings-web.js').SETTINGS_HTML)"],
            cwd=root, env={**os.environ, "CMSPARK_DATA_DIR": str(Path(out) / "data")},
        ).decode("utf-8")
        for width in (390, 1440):
            page = browser.new_page(viewport={"width": width, "height": 900})
            page.set_default_timeout(6000)
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            requests = []

            def web_route(route):
                if "/api/config" in route.request.url:
                    if route.request.method == "POST":
                        requests.append(route.request.post_data_json)
                        reply = {"ok": True, "config_revision": "web:2"}
                    else:
                        reply = {"config_revision": "web:1", "llm": {
                            "model_name": "gpt-4o", "base_url": "https://main.invalid/v1",
                            "api_key": "main****mask", "native_vision_available": True,
                        }, "vision": {"enabled": True, "reuse_main_model": False,
                            "base_url": "https://vision.invalid/v1", "model_name": "separate-vl",
                            "api_key": "vision****mask", "protocol": "anthropic"}}
                    route.fulfill(content_type="application/json", body=json.dumps(reply))
                elif "/api/testVision" in route.request.url:
                    requests.append(route.request.post_data_json)
                    route.fulfill(content_type="application/json", body='{"ok":true,"message":"fixture"}')
                else:
                    route.fulfill(content_type="text/html", body=web_html)

            page.route("http://settings-904.test/**", web_route)
            page.goto("http://settings-904.test/?token=fixture")
            page.wait_for_function("!document.getElementById('modelName').disabled")
            reuse = page.locator("#visionReuseMain")
            assert not reuse.is_checked()
            reuse.check()
            assert page.locator("#visionApiKey").is_disabled()
            assert page.locator("#visionModel").input_value() == "separate-vl"
            page.locator("#testVisionBtn").click()
            page.wait_for_function("document.getElementById('visionResult').textContent==='fixture'")
            assert requests[-1]["reuse_main_model"] is True
            assert requests[-1]["api_key"] == "main****mask"
            reuse.uncheck()
            assert page.locator("#visionApiKey").is_enabled()
            page.locator("#saveBtn").click()
            page.wait_for_function("document.getElementById('savedFlash').classList.contains('show')")
            assert requests[-1]["vision"]["reuse_main_model"] is False
            assert requests[-1]["vision"]["api_key"] == "vision****mask"
            page.locator("#modelName").fill("deepseek-chat")
            assert reuse.is_disabled() and not reuse.is_checked()
            assert page.locator("#visionModel").is_enabled()
            assert not errors, errors
            print(f"PASS actual web settings at {width}px: reuse, preserved model, saved preference, selected probe credentials")
            page.close()
        browser.close()
