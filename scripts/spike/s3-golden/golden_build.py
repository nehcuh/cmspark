# S-3 golden set builder: encodes commands with the HF processor tokenizer
# (100% fidelity; JS eval consumes input_ids directly) and extracts the
# <loc_N> token-id map from added_tokens.json.
import json, os
from transformers import AutoProcessor

ROOT = os.path.dirname(os.path.abspath(__file__))
S1 = os.path.join(ROOT, "..", "s1-tinyclick-onnx")
processor = AutoProcessor.from_pretrained(os.path.join(S1, "model"), trust_remote_code=True)

CASES = [
    # --- fixture group (fixture.jpg 960x640, gt from fixture-gt.json) ---
    dict(id="f-ok-en",       group="fixture", lang="en", image="fixture.jpg", command="click on the ok button",                                  target="btn_ok"),
    dict(id="f-ok-zh",       group="fixture", lang="zh", image="fixture.jpg", command="点击右下角的确定按钮",                                    target="btn_ok"),
    dict(id="f-file-zh",     group="fixture", lang="zh", image="fixture.jpg", command="点击左上角的文件按钮",                                    target="btn_file"),
    dict(id="f-setting-zh",  group="fixture", lang="zh", image="fixture.jpg", command="点击右上角的设置按钮",                                    target="btn_setting"),
    dict(id="f-help-zh",     group="fixture", lang="zh", image="fixture.jpg", command="点击左下角的帮助按钮",                                    target="btn_help"),
    dict(id="f-play-en",     group="fixture", lang="en", image="fixture.jpg", command="click on the play button in the center of the window",    target="btn_play"),
    dict(id="f-play-zh",     group="fixture", lang="zh", image="fixture.jpg", command="点击窗口正中间的播放按钮",                                target="btn_play"),
    dict(id="f-search-zh",   group="fixture", lang="zh", image="fixture.jpg", command="点击搜索输入框",                                          target="input_search"),
    dict(id="f-icon-en",     group="fixture", lang="en", image="fixture.jpg", command="click on the blue square icon",                           target="icon_square"),
    dict(id="f-long-zh",     group="fixture", lang="zh", image="fixture.jpg", command="请点击窗口中间偏上位置那一段用于验证长命令定位能力的中文说明文字", target="lbl_long"),
    # --- desktop group (shot-baseline.jpg 1920x1080, manual annotation) ---
    dict(id="d-start-zh",    group="desktop", lang="zh", image="shot-baseline.jpg", command="点击左下角的开始按钮",        gt=dict(cx=760,  cy=1057, w=28,  h=28)),
    dict(id="d-search-zh",   group="desktop", lang="zh", image="shot-baseline.jpg", command="点击任务栏上的搜索框",        gt=dict(cx=875,  cy=1057, w=150, h=28)),
    dict(id="d-taskchrome-zh", group="desktop", lang="zh", image="shot-baseline.jpg", command="点击任务栏上的谷歌浏览器图标", gt=dict(cx=1025, cy=1057, w=28,  h=28)),
    dict(id="d-deskchrome-en", group="desktop", lang="en", image="shot-baseline.jpg", command="click on the google chrome icon on the desktop", gt=dict(cx=26, cy=243, w=32, h=40)),
    dict(id="d-taskexp-zh",  group="desktop", lang="zh", image="shot-baseline.jpg", command="点击任务栏上的文件资源管理器图标", gt=dict(cx=1058, cy=1057, w=28, h=28)),
    # --- settings group (shot-settings-win.jpg 1920x1044, manual annotation) ---
    dict(id="s-search-zh",   group="settings", lang="zh", image="shot-settings-win.jpg", command="点击顶部的查找设置搜索框",   gt=dict(cx=955,  cy=18,  w=380, h=24)),
    dict(id="s-home-zh",     group="settings", lang="zh", image="shot-settings-win.jpg", command="点击左侧导航栏的主页",       gt=dict(cx=52,   cy=120, w=120, h=30)),
    dict(id="s-bt-zh",       group="settings", lang="zh", image="shot-settings-win.jpg", command="点击左侧的蓝牙和其他设备",   gt=dict(cx=84,   cy=182, w=160, h=30)),
    dict(id="s-rename-zh",   group="settings", lang="zh", image="shot-settings-win.jpg", command="点击重命名这台电脑按钮",     gt=dict(cx=1385, cy=255, w=130, h=30)),
]

# fixture ground truth from fixture-gt.json
fgt = json.load(open(os.path.join(ROOT, "fixture-gt.json"), encoding="utf-8-sig"))

# <loc_N> id map
added = json.load(open(os.path.join(S1, "model", "added_tokens.json"), encoding="utf-8"))
loc_map = {int(v): int(k[5:-1]) for k, v in added.items() if k.startswith("<loc_") and k.endswith(">")}
print("loc tokens:", len(loc_map), "min id:", min(loc_map), "max id:", max(loc_map))

for c in CASES:
    if "gt" not in c:
        t = fgt[c.pop("target")]
        c["gt"] = dict(cx=t["cx"], cy=t["cy"], w=t["w"], h=t["h"])
    else:
        c.pop("target", None)
    prompt = ("What to do to execute the command? " + c["command"].strip()).lower()
    enc = processor.tokenizer(prompt, return_tensors="np", add_special_tokens=True)
    c["input_ids"] = [int(x) for x in enc["input_ids"][0]]

out = dict(
    meta=dict(prompt_recipe='("What to do to execute the command? " + command).lower()',
              hit_rule="dist(pred, gt_center) <= max(w,h)/2",
              images=dict(**{img: None for img in sorted({c["image"] for c in CASES})})),
    loc_id_to_value={str(k): v for k, v in loc_map.items()},
    cases=CASES,
)
with open(os.path.join(ROOT, "golden.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(f"golden.json: {len(CASES)} cases; langs: zh={sum(1 for c in CASES if c['lang']=='zh')} en={sum(1 for c in CASES if c['lang']=='en')}")