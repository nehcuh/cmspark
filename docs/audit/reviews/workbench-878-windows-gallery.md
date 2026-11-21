# Windows Gallery #70 采样超时

PR #879 的 `077edab4` 在标准 Windows smoke 的固定发行包采样步骤失败。Node 收到的错误为 `killed=true`、`signal=SIGTERM`、`code=null`。生产脚本在子进程自己的时钟上记录 `SIGNATURE_ENTERED=870 ms` 和 `SIGNATURE_RETURNED=1251 ms`，没有记录 `COMPLETE`。原 15 秒上限覆盖整个 PowerShell 子进程。该收据无法确定子进程停在签名状态检查、证书字段读取、JSON 输出，还是其他未观测的等待。归档中的预建 JSON 为 0 字节，没有签名成功收据。[失败作业](https://github.com/nehcuh/cmspark/actions/runs/44920255498/job/136894522546) · [归档](https://github.com/nehcuh/cmspark/actions/runs/44920255498/artifacts/14713606445)

本 PR 的相邻两次 Windows 运行均实际完成同一采样。已逐一核对 CI workflow、catalog、JS 采集器、PowerShell 采样脚本和原 `runPs` 文件在三个 head 的 Git blob ID 相同。从两个较早的归档提取各自两条 `nativeStdout`，通过现行 `parseSample` 重新解析。Notepad++ 和 Visual Studio Code 均为 x64、签名 Valid，包、EXE、叶证书 DER 的 SHA-256 分别与固定参考相符。

| PR head | 真实采样归档 | 原 JSON 字节数 | JSON SHA-256 |
| --- | --- | ---: | --- |
| `08770803` | [Windows 采样](https://github.com/nehcuh/cmspark/actions/runs/44917501336/artifacts/14712164084) | 2987 | `edfc569f28fa777b4a1afe0ba7d346cab2c565bea3255fbaad7b883c3c4be61a` |
| `2d5e93c0` | [Windows 采样](https://github.com/nehcuh/cmspark/actions/runs/44919353852/artifacts/14712484391) | 2987 | `c33b56a059e633389c81c8b8a47b441331e556c1f7f0323aa9762902f8a5f5f9` |

两次托管采样的 PowerShell 版本均为 5.1.26100.33822。本机 Node 22.23.4 x64 上，原 collector CPU 检查通过 58/58。另取采样脚本从签名状态判断到 JSON 输出的原文，用实际 `runPs` 与系统自带、签名有效的 `powershell.exe` 测量。本机 PowerShell 5.1.28000.3365 的三个独立进程均自然退出，末段分别为 73、55、51 毫秒，含启动和签名读取的总耗时为 332、241、212 毫秒。该测量没有运行托管专用的固定发行包采样。

目前能确认的是原作业越过子进程时限。没有材料可以把延迟归因到具体调用。本次保留原门禁，后续 head 的采样结果应按其实际作业记录。
