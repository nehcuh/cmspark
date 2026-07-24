# WP5 I2 WI-2.2 — 生成 tinyclick-tokenizer 参考向量（一次性脚本，产物入 git）。
# 用 HF transformers（venv，4.45.2）在 s1 模型目录上编码，锁定 JS BPE 实现零分叉。
import json
import random
import string

from transformers import AutoTokenizer

MODEL_DIR = "scripts/spike/s1-tinyclick-onnx/model"
OUT = "companion/tests/fixtures/tinyclick-tokenizer-vectors.json"

tok = AutoTokenizer.from_pretrained(MODEL_DIR)

cases = []
seen = set()

def add(text):
    if text in seen:
        return
    seen.add(text)
    cases.append({"text": text, "ids": tok.encode(text)})

# 1) 官方 prompt 配方：命令变体
commands = [
    "click on the ok button",
    "Click on the OK button",
    "click on the 'Save' button",
    "open the File menu",
    "press the Enter key",
    "click on the submit button at the bottom",
    "close the dialog",
    "type 'hello world' into the search box",
    "scroll down to the settings section",
    "right-click on the desktop icon",
    "select all text in the document",
    "click on the X to close the window",
    "drag the file to the trash",
    "open a new tab",
    "go back to the previous page",
    "click on the link titled 'Read more...'",
    "enable the Wi-Fi toggle",
    "set the volume to 50%",
    "choose the option 'None (default)'",
    "confirm the deletion of 3 files",
]
for c in commands:
    add(("What to do to execute the command? " + c.strip()).lower())

# 2) 边界形态
for t in [
    "", " ", "  ", "   multiple   spaces   ", "\t", "\n", "a\nb", "trailing ",
    " leading", "it's", "IT'S", "don't", "we're", "they'll", "I'd", "you've",
    "numbers 0123456789", "3.14159", "100%", "a-b_c+d=e", "...", "?!,;:'\"",
    "<loc_282>", "a<loc_5>b", "<s>", "</s>", "<mask>", "x</s>y", "<od>",
    "café", "naïve", "中文测试", "🙂🎉", "mixed 中 english 文", "ÿþ",
    "ALL CAPS SENTENCE", "CamelCaseWords", "snake_case_words", "kebab-case-words",
]:
    add(t)

# 3) 1000 随机 ASCII（种子固定，可复现）
rng = random.Random(20260813)
alphabet = string.printable[:95]  # 可打印 ASCII 32-126（含空格）
for _ in range(1000):
    n = rng.randint(0, 80)
    add("".join(rng.choice(alphabet) for _ in range(n)))

# 4) 200 条数字/标点偏重随机
heavy = string.digits + string.punctuation + "   "
for _ in range(200):
    n = rng.randint(1, 60)
    add("".join(rng.choice(heavy) for _ in range(n)))

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(
        {
            "version": 1,
            "source": "transformers AutoTokenizer @ scripts/spike/s1-tinyclick-onnx/model (Krystianz/TinyClick)",
            "note": "ids 含 RobertaProcessing 包装 [0,...,2]；JS encode 必须逐条全等",
            "cases": cases,
        },
        f,
        ensure_ascii=False,
    )
print(f"cases={len(cases)}")
