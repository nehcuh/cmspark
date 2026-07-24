# G1 envelope scan case builder (WP5 I1 WI-1.5): encodes command-length and
# sentence-pattern sweep commands with the HF tokenizer (same recipe as
# golden_build.py) so the JS runner consumes input_ids directly.
# Output: g1-cases.json — groups: length-sweep (btn_ok + btn_play), pattern-sweep (btn_ok).
import json, os
from transformers import AutoProcessor

ROOT = os.path.dirname(os.path.abspath(__file__))
S1 = os.path.join(ROOT, "..", "s1-tinyclick-onnx")
processor = AutoProcessor.from_pretrained(os.path.join(S1, "model"), trust_remote_code=True)

fgt = json.load(open(os.path.join(ROOT, "fixture-gt.json"), encoding="utf-8-sig"))

def case(cid, group, command, target):
    prompt = ("What to do to execute the command? " + command.strip()).lower()
    enc = processor.tokenizer(prompt, return_tensors="np", add_special_tokens=True)
    ids = [int(x) for x in enc["input_ids"][0]]
    return dict(id=cid, group=group, lang="en", image="fixture.png", command=command,
                gt=fgt[target], input_ids=ids, prompt_tokens=len(ids))

CASES = []

# --- A. length sweep: same target (btn_ok), escalating command length ---------
LENGTH_OK = [
    ("len-04-ok", "click ok"),
    ("len-06-ok", "click on the ok button"),
    ("len-10-ok", "click on the ok button at the bottom right"),
    ("len-13-ok", "click on the ok button at the bottom right of the window"),
    ("len-17-ok", "please click on the ok button that is located at the bottom right of the window"),
    ("len-21-ok", "could you please click on the ok button that is located at the bottom right area of this window"),
    ("len-26-ok", "i want you to click on the ok button which is the button located at the bottom right corner of this application window"),
    ("len-31-ok", "in order to proceed with the operation you need to click on the ok button which is located at the bottom right corner of this application window screen"),
]
for cid, cmd in LENGTH_OK:
    CASES.append(case(cid, "length-sweep", cmd, "btn_ok"))

# same length ladder on a second target (btn_play, center) to check target-dependence
LENGTH_PLAY = [
    ("len-06-play", "click on the play button"),
    ("len-12-play", "click on the play button in the center of the window"),
    ("len-19-play", "please click on the round play button that is located in the center of this window"),
    ("len-27-play", "i want you to click on the round play button which is located right in the middle center area of this application window screen"),
]
for cid, cmd in LENGTH_PLAY:
    CASES.append(case(cid, "length-sweep", cmd, "btn_play"))

# --- B. sentence-pattern sweep: same target (btn_ok), varied phrasing ---------
PATTERNS = [
    ("pat-direct", "click on the ok button"),                        # 直接指称（基线，S-3 已证命中）
    ("pat-please", "please click on the ok button"),                 # 礼貌前缀
    ("pat-want", "i want to click on the ok button"),                # 意图句式
    ("pat-canyou", "can you click on the ok button"),                # 疑问句式
    ("pat-need", "the ok button needs to be clicked"),               # 被动描述
    ("pat-loc-only", "click on the button at the bottom right"),     # 纯位置指称（无文本锚点）
    ("pat-imperative2", "press the ok button"),                      # 近义动词
]
for cid, cmd in PATTERNS:
    CASES.append(case(cid, "pattern-sweep", cmd, "btn_ok"))

out = dict(
    meta=dict(
        prompt_recipe='("What to do to execute the command? " + command).lower()',
        hit_rule="dist(pred, gt_center) <= max(w,h)/2",
        image="fixture.png (960x640 synthetic UI, same as golden fixture group)",
        variant="hybrid",
    ),
    cases=CASES,
)
with open(os.path.join(ROOT, "g1-cases.json"), "w", encoding="utf-8") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
for c in CASES:
    print(f"{c['id']:16s} tokens={c['prompt_tokens']:3d}  {c['command'][:70]}")
print("total:", len(CASES), "cases -> g1-cases.json")
