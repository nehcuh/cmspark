# 实验层：Qwen3-VL 本机视觉定位

> 面向使用者：如何在设置页完成「检测 → 下载 → 启用」。  
> 架构上：**Chrome 插件不跑模型**；检测 / 下载 / 推理全部在本机 **Companion**。  
>  
> **产品设计 SoT**（研发）：[2026-08-01-qwen3-vl-experimental-layer-product-design.md](superpowers/specs/2026-08-01-qwen3-vl-experimental-layer-product-design.md)  
> **实施 plan**（开工）：[2026-08-01-qwen3-vl-experimental-layer-impl.md](superpowers/plans/2026-08-01-qwen3-vl-experimental-layer-impl.md)

## 1. 用户旅程（正确预期）

```text
打开 Side Panel 设置
    → Companion 已连接
    → 实验功能区自动 get_state（含环境预检）
    → ① 看「就绪」与下一步清单
    → ② 选下载源（大陆：自动 / 魔搭）
    → ③ 选规模 2B/4B/8B（有硬件推荐）
    → ④ 下载模型（权重写入 ~/.cmspark-agent/models/qwen3-vl-*）
    → ⑤ 开启实验层（可能生物识别）
    → Computer Use 任务中 UIA/OCR 未命中时，L2 给出建议点 → 仍须人工确认
```

**不能**指望：只装扩展、不装 Companion / Python，点一下就「插件内推理」。

## 2. 依赖（必须本机具备）

| 用途 | 依赖 |
|------|------|
| 下载（HF / 镜像） | `python3` + `pip install huggingface_hub` |
| 下载（ModelScope） | `python3` + `pip install modelscope` |
| 推理（启用后） | `pip install transformers torch pillow`（可选 accelerate） |

设置页会列出可复制的 `pip install …` 命令；未齐时「下载模型」会禁用或失败并给出原因。

## 3. 硬件与「直接启用」

- Companion **会探测**：总内存、可用磁盘、NVIDIA/CUDA、Apple MPS（best-effort）。
- **会推荐**规模（2B/4B/8B），但**不会**在资源不足时强行禁止下载（只提示 tight/insufficient）。
- **可以启用**的条件（`canEnable`）：
  1. 当前变体权重已在盘（`config.json` 存在）；
  2. Python + transformers/torch/pillow 可用；
  3. 许可证已接受且未永久拒绝；
  4. 用户在设置页打开开关（+ 生物识别门，若配置要求）。

**没有**「检测到模型就自动开启」——安全模型要求显式 opt-in。

## 4. 中国大陆下载

| 源 | 说明 |
|----|------|
| **自动（默认）** | 探测 HF / ModelScope 连通性；中文 locale 且魔搭可达时优先 ModelScope |
| **魔搭 ModelScope** | `modelscope` 包拉取 `Qwen/Qwen3-VL-*-Instruct` |
| **HF 镜像** | `HF_ENDPOINT=https://hf-mirror.com`（或配置 `computer.modelMirror`） |
| **Hugging Face** | 官方源，海外网络适用 |

环境变量：

- `CMSPARK_MODEL_SOURCE=modelscope` — 强制魔搭  
- `HF_ENDPOINT=https://hf-mirror.com` — 镜像  

不做 IP 地理位置库；用 **连通性探测 + 语言环境** 更稳、更少误判。

## 5. 数据目录

```text
~/.cmspark-agent/models/qwen3-vl-2b/
~/.cmspark-agent/models/qwen3-vl-4b/
~/.cmspark-agent/models/qwen3-vl-8b/
```

## 6. 故障速查

| 现象 | 处理 |
|------|------|
| 下载按钮灰 | 看就绪清单：缺 Python / hub 包 |
| `modelscope-missing` | `pip install modelscope` 或改 HF 镜像 |
| `hf-hub-missing` | `pip install huggingface_hub` 或改魔搭 |
| 开启后定位仍无实验层 | 确认 Computer Use 主开关、App 坐标权限；L2 仅在 UIA/OCR 未命中后尝试 |
| 建议点错误 | 预期内：未校准；务必看确认台再批 |

## 7. 与 TinyClick 的关系

本层已替换 TinyClick ONNX 路径。旧 `modelVariant: hybrid|int8` 会迁移为 `2b`。许可证需重新接受。
