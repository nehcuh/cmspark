# macOS 原生工作区选择框验收

PR #879 的 `596dbe50`（测试合并提交 `bc6942e2`）在 #476 的第 4 个用例达到 45 秒上限。原生回执记录了第一次选择的目录身份、工作区绑定以及第二个选择框。第二次取消按钮唯一且可点击。XCTest 进入真实点击时剩余 798 毫秒，最后一项活动是定位 Cancel 按钮。截止时尚未收到点击返回、选择框取消或原生子进程退出回执。该用例随后拒绝释放独占测试窗口，local-work、archive 和 terminal 分别在获取该窗口时达到原来的 45、20、45 秒上限。[失败作业](https://github.com/nehcuh/cmspark/actions/runs/44923487191/job/136904374269) · [XCTest 活动工件](https://github.com/nehcuh/cmspark/actions/runs/44923487191/artifacts/14715166808)

| 先前提交 | 工作区用例耗时 | 点击取消耗时 |
| --- | ---: | ---: |
| [961442c1](https://github.com/nehcuh/cmspark/actions/runs/44920945518/job/136896619762) | 33.17 秒 | 1.30 秒 |
| [2f9eca63](https://github.com/nehcuh/cmspark/actions/runs/44922295348/job/136900745977) | 33.41 秒 | 1.27 秒 |
| [752d0d7a](https://github.com/nehcuh/cmspark/actions/runs/44922722435/job/136902043983) | 31.63 秒 | 1.10 秒 |

这三次 macOS 作业均通过。失败运行里，第一次选择的 Choose/Open 按钮从 XCTest 活动时间 11.15 秒起等待存在，到 13.31 秒才开始另一次唯一性查询。夹具现在直接查询原 sheet 内匹配按钮的个数。一个匹配项就检查可点击性，零个就在原截止时间内等待后重新计数，多个则拒绝。选择和取消仍使用原生点击。

在 Windows 上编译测试并通过 224 项相关检查，另在隔离的 Linux 临时目录通过 267 项工作区、选择框取证和宿主构建检查。新夹具仍需由托管 macOS 作业执行原 45 秒端到端用例，实际节省时间以该作业为准。
