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
  1. 当前变体已按发版钉死的 `qwen-vl.manifest.json` 通过完整性校验（`config.json` 存在 **且** 清单内每个文件 size+sha256 匹配，含全部 `*.safetensors` 权重；缺文件 `model-file-missing`，哈希错 `sha256-mismatch`，二者都拒绝启用）；
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

发版钉死清单：`companion/assets/qwen-vl.manifest.json`（随 release 进仓库，**运行时不拉网、下载后不生成**）。HF / hf-mirror / ModelScope 只换下载 origin，sha256 与 size 不变。校验失败会把 `modelEnabled` 关掉，不会留在「已启用但权重被改过」的状态。

### 5.1 4.5GB 全量哈希时延（不得退化成 stat-only）

2B 权重约 4.26GB，4B/8B 分片合计更大。`probeQwenModelDir` **对清单内每个文件先比 size 再做流式 sha256**（1MiB chunk），包括全部 safetensors——没有「size 对了就跳过哈希」的捷径。

| 时机 | 是否全量哈希 | 说明 |
|------|----------------|------|
| 设置页 `get_state` / 环境预检 | 是 | 打开实验区时一次，秒级（SSD） |
| 下载结束 | 是 | 不过关不算下载成功 |
| 启用 / admission / worker load | 是 | load 前再验一次（TOCTOU）；不过关拒加载、不 infer |
| 每次点击 / 每次 locate | 否 | 已 load 进内存的权重不按点击重哈希 |

故意改盘上某个 safetensors（即便文件大小不变）→ `sha256-mismatch`，实验层不得 ready。

## 6. 故障速查

| 现象 | 处理 |
|------|------|
| 下载按钮灰 | 看就绪清单：缺 Python / hub 包 |
| `modelscope-missing` | `pip install modelscope` 或改 HF 镜像 |
| `hf-hub-missing` | `pip install huggingface_hub` 或改魔搭 |
| `model-file-missing` | 权重不完整或被删；重新下载 |
| `sha256-mismatch` / `size-mismatch` | 文件与发版钉死清单不符（损坏或被改）；删除后换源重下。镜像只换地址，哈希不变 |
| 开启后定位仍无实验层 | 确认 Computer Use 主开关、App 坐标权限；L2 仅在 UIA/OCR 未命中后尝试 |
| 建议点错误 | 预期内：未校准；务必看确认台再批 |

## 7. 与 TinyClick 的关系

本层已替换 TinyClick ONNX 路径。旧 `modelVariant: hybrid|int8` 会迁移为 `2b`。许可证需重新接受。
