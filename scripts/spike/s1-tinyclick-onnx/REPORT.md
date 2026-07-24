# S-1 门禁裁决报告 — TinyClick 可导出为可用 ONNX

> **结论：PASS**（token 级精确一致；坐标偏差 0px）
> 日期：2026-07-20 ｜ 分支：computer-use-w8-windows ｜ 执行者：WP5 spike subagent

## 验证问题

TinyClick（0.27B，Florence-2 架构，trust_remote_code 自定义代码）能否导出 ONNX 并被 ORT 加载推理，输出与 PyTorch 参考一致。

**裁决：能。** 4 图导出物在 onnxruntime 1.27.0（CPU）下完成贪心解码，**输出 token ids 与 PyTorch 参考逐位相同**，解析出的点击坐标 **(157, 211) 完全一致（偏差 0px）**。

## 模型来源与出处核查（实测）

| 项 | 事实 |
|---|---|
| 论文 | arXiv:2410.11871（Pawlowski, Zawistowski 等，Samsung R&D Poland） |
| 官方渠道现状 | `Samsung/TinyClick`（HF）已不可匿名访问（hf-mirror API 返回 "Invalid username or password"，即 gated/下架）；`github.com/SamsungLabs/TinyClick` 现为 **404**（实测 curl -sIL 确认） |
| **实际采用源** | **`Krystianz/TinyClick`**（HF）—— 论文二作 Krystian Zawistowski 账号，README 明示 "Mirror of TinyClick by Samsung"，MIT license，含完整 safetensors + tokenizer + processor 配置 |
| 下载方式 | `HF_ENDPOINT=https://hf-mirror.com` + `huggingface_hub.snapshot_download`，12 文件 73s 完成（huggingface.co 直连在本机超时不可用） |
| 权重哈希 | `model.safetensors` 1083.9 MB，sha256 **`d52f93704cd178f4dc2ccaf5d17042e85113447c416847f45c7554df16db00a3`**（fp32） |

## trust_remote_code 安全审查（纪律项，已执行）

`Krystianz/TinyClick` 仓库内**无 .py 文件**；其 `config.json`/`preprocessor_config.json` 的 auto_map 指向 `microsoft/Florence-2-base` 的 3 个文件 —— 即 trust_remote_code=True 时实际下载并执行的是微软官方 Florence-2 代码：

| 执行文件（revision 5ca5edf5） | sha256 | 审查结论 |
|---|---|---|
| configuration_florence2.py (15 KB) | `de2e45a9…3bdf` | 纯配置类，无风险 |
| modeling_florence2.py (127 KB) | `5162bf46…8a24` | 扫描 requests/urllib/socket/subprocess/eval/exec/base64/pickle.loads/ctypes 均**无命中**（仅 docstring 示例中出现 requests.get） |
| processing_florence2.py (49 KB) | `f146023a…8e98` | 同上，无网络回调、无文件写入、无动态执行 |

**关键校验**：审查副本与 transformers 模块缓存中**实际被执行的字节**逐文件 sha256 比对一致（见上表，缓存路径 `~/.cache/huggingface/modules/transformers_modules/microsoft/Florence-2-base/5ca5edf5…/`）。审查结论：**安全，可执行**。

## 环境（实测）

- Windows 11 x64，Python 3.12.13（uv venv），CPU-only
- torch 2.5.1+cpu ｜ transformers 4.45.2 ｜ timm 1.0.7 ｜ einops 0.8.0（对齐 wrapper 仓库 requirements 的已知好组合；transformers 5.14.1 首试后主动降级 —— Florence-2 自定义代码面向 4.4x API）
- onnx 1.22.0 ｜ onnxruntime 1.27.0 ｜ numpy 2.5.1 ｜ pillow 12.3.0
- 依赖安装走清华 PyPI 镜像（官方源在本机慢）；模型走 hf-mirror.com

## 导出链路与布局（对齐 onnx-community/Florence-2-base 先例）

4 图分离（`export_onnx.py`，torch.onnx.export 传统 tracer，opset 17 / IR 8，do_constant_folding）：

| 图 | 输入 → 输出 | 体积 |
|---|---|---|
| vision_encoder.onnx | pixel_values [B,3,768,768] → image_features [B,577,768]（DaViT + 2D 位置嵌入 + projection，即 `_encode_image`） | 366.5 MB |
| embed_tokens.onnx | input_ids [B,T] → text embeddings [B,T,768]（共享词嵌入） | 157.6 MB |
| encoder_model.onnx | concat(image,text) [B,592,768] + mask → encoder_hidden_states | 173.4 MB |
| decoder_model.onnx | decoder_input_ids + encoder_hidden_states + mask → logits [B,T,51289] | 545.5 MB |

**取舍记录**：
1. **decoder 采用无 past 单图 + 全前缀重算**，未做 with-past/merged。原因：传统 tracer 会把 `past_key_values_length` 烘焙为 Python int 常量，with-past 图在非 trace 长度下位置编码错位（optimum 靠 ModelPatcher 规避）。TinyClick 输出仅 ~7 token，全前缀重算代价可忽略；正确性优先。
2. **int8 量化：跳过**。fp32 奇偶校验已达成门禁目标；量化属 WP5 体积优化项，非导出门禁问题。4 图 fp32 共 ~1.24 GB，WP5 若需瘦身可用 `onnxruntime.quantization` 对 matmul 做动态量化（先例：onnx-community 提供 _int8/_q4 变体）。
3. trace 时的 TracerWarning（shape 断言、is_causal 常量烘焙）经分析无害：贪心解码只读最后位置 logits，无因果掩码时最后位置感受野与因果掩码等价 —— 且被 token 级精确一致实测证实。

## 比对数据（实测输出摘录）

测试输入：`.tmp/cu-fix/shot1.png`（560×400 合成 GUI 夹具：标题栏 + 输入框 + 「确定」按钮），prompt 按官方配方 `"What to do to execute the command? click on the ok button".lower()`，processor resize 768²。

**PyTorch 参考**（`reference.py`，greedy 与 beam-3 结果相同）：

```
[greedy] text: </s><s>click <loc_282><loc_528></s>
[greedy] parsed: {'action': 'click', 'click_point': (157, 211), 'loc_raw': [282, 528]}
```

**ORT 推理**（`ort_infer.py`，4 会话 CPUExecutionProvider，全前缀贪心）：

```
onnxruntime: 1.27.0
enc_hidden max|diff| vs torch: 9.651e-04
step-1 logits max|diff| vs torch: 1.764e-05
ort text: </s><s>click <loc_282><loc_528></s>
ort parsed: {'action': 'click', 'click_point': (157, 211), 'loc_raw': [282, 528]}
token_ids match torch greedy: True
click_point ort: (157, 211) ref: (157, 211) delta(px): (0, 0)
```

数值级：encoder hidden 最大绝对差 9.7e-4、step-1 logits 最大绝对差 1.8e-5（fp32 导出噪声量级）；**决策级：token ids 逐位相同、坐标偏差 0px**。

## 导出物哈希（sha256）

| 文件 | sha256 |
|---|---|
| onnx/vision_encoder.onnx | `af0962398dca078c537eb163842de2aec0726f3c9f9a4ff28003aabc2957558e` |
| onnx/embed_tokens.onnx | `b59e88b766dce012a8fae545ce17ca44202482b116891a8ff34ee041a85f6ce0` |
| onnx/encoder_model.onnx | `2127af828aa3ff3e20b2ff13d7666c8bf49f6f839a34321c98ba259a1d170834` |
| onnx/decoder_model.onnx | `012cdafe5d7cdce50af87be48778651a20564b5d6e8dd6dbd4b1381d3380ae9a` |
| model/model.safetensors（源权重） | `d52f93704cd178f4dc2ccaf5d17042e85113447c416847f45c7554df16db00a3` |

## 对 WP5 下载门禁的建议

1. **权重源**：官方 `Samsung/TinyClick` 不可匿名拉取（gated/下架），WP5 下载门禁应以 `Krystianz/TinyClick` 为源（作者本人 MIT 镜像），并**钉死 sha256 `d52f9370…00a3`** 做完整性校验；huggingface.co 直连在目标网络可能超时，需内置 hf-mirror 回退（本 spike 实测镜像 1.1GB / 73s）。
2. **代码执行面**：trust_remote_code 实际执行的是 `microsoft/Florence-2-base@5ca5edf5` 的 3 个文件（已审无恶意）。WP5 若不允许运行时远程代码，可将这 3 个文件随应用 vendored（sha256 见上表），transformers 支持本地 auto_map。
3. **运行时**：导出物为 IR 8 / opset 17 —— S-2 已验证 onnxruntime-node 1.27.0 在 SEA 布局可加载，两者衔接无版本障碍。JS 侧需自备：图像预处理（resize 768² + ImageNet 归一化）、tokenizer（tokenizer.json 2.3MB 可用 `@huggingface/transformers` 的 tokenizer 组件或自研 BPE）、贪心解码循环（~7 步全前缀重算）。
4. **解码参数**：生产用 greedy 即可（本例 beam-3 与 greedy 输出相同）；generation_config 的 num_beams=3/no_repeat_ngram_size=3 是官方默认但非必需。
5. **with-past 优化**：如需 KV-cache 版 decoder，建议走 optimum ModelPatcher 路径或手工把 past 长度改为显式 tensor 输入后重导；对 TinyClick 短输出非必需。

## 复现

```bash
cd scripts/spike/s1-tinyclick-onnx
uv venv .venv --python 3.12
uv pip install --python .venv/Scripts/python.exe torch==2.5.1 transformers==4.45.2 \
  timm==1.0.7 einops==0.8.0 onnx onnxruntime pillow numpy \
  --index-url https://pypi.tuna.tsinghua.edu.cn/simple
HF_ENDPOINT=https://hf-mirror.com .venv/Scripts/python.exe -c \
  "from huggingface_hub import snapshot_download; snapshot_download('Krystianz/TinyClick', local_dir='model')"
cp ../../.tmp/cu-fix/shot1.png test_image.png
HF_ENDPOINT=https://hf-mirror.com .venv/Scripts/python.exe reference.py    # PyTorch 参考 -> reference.json
HF_ENDPOINT=https://hf-mirror.com .venv/Scripts/python.exe export_onnx.py  # 4 图导出 -> onnx/
HF_ENDPOINT=https://hf-mirror.com .venv/Scripts/python.exe ort_infer.py    # ORT 比对 -> ort_result.json
```

脚本：`reference.py`、`export_onnx.py`、`ort_infer.py`；结果：`reference.json`、`ort_result.json`。二进制（.venv/model/onnx/图片/npz）均已 gitignore。
