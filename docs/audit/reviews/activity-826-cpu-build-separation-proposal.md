# #826 Windows CPU driver 构建/测试分离：只读提案

2026-11-03，head0666fc8d。未改源码、未跑新实验/CI；须 B 独立设计与实际 GLM 设计批准后才实施。

## 已证事实

新 file-fd/cwd 版本在一个 Windows native VM 已通过 CPU helper 与原 MCP，另一个 Windows census VM 仍在 compiler20秒门 ETIMEDOUT。warning/template note 和此前 link/vctip 留存不能识别 MSVC 内部原因；pipe/cwd 可达机制也不能据此认作历史原因。

`build-desktop-windows.mjs:114–123` 的既有构建 `checked()` 使用120秒、error/status守卫；`--test-fixtures` 的所有未分发原生夹具在该 build 路径编译。当前新 CPU helper 自己在30秒业务case内做工具链发现及20秒编译，是新测试对构建和业务的耦合。原产品/MCP20秒无需改变。

真实调用顺序有两个必要约束：

- `.github/workflows/ci.yml:254–290`：step11 Desktop build helper controls 先于 step14 Build native desktop fixtures、step15 TS编译、step16 native消费者。不能单把编译移走却让原step11 runtime case读取尚不存在的artifact。
- Ubuntu不走step14；现早期CPU helper在Linux/macOS也有真实运行。改动必须保留这些平台的原控制，Windows必须在native/census两个lane的build后显式执行业务消费者，不能用缺产物skip。

## 建议的最小完整方向

1. 只为Windows将 driver 编译迁回已有 `testFixtures` build 路径，复用同一工具链、同一生成源、既有120秒构建契约和error/status守卫。保持filefd/stablecwd/owned产物位置，编译失败阻止该artifact发布。它是构建阶段，不在业务test内变相加长20秒。
2. 从当前MJS抽出唯一真实driver生成器（不注册test、不运行consumer）。builder和测试共同调用，仍由实际生产/fixture/header生成，不能维护一份简化影子driver。实际worker/reader、same-wire/UNKNOWN/BigInt和live-fd控制不改。
3. 原step11继续运行source/inverse/EOL/真实AST纯控制；Windows runtime case显式迁至step14之后现有native测试入口。Windows业务case仍30秒，每个exe仍6秒，原生MCP20秒不变。macOS/Linux保留当前真实CPU路径；不添加平台skip或删除census覆盖。
4. Windows消费者核固定测试artifact：当前生成源及所有生成输入hash、platform/arch/Node、实际binary digest。既有普通文件/私有artifact检查沿用；缺失、改源未重建、digest漂移或平台不符直接fail，不以二进制存在放行，也不现场重编译回退。只需该夹具有限manifest，不扩通用缓存/发布框架。
5. 真实case的构建端与消费者分离要可机验：生成源完全一致、build error/status非0不发布、缺/旧/异平台/损坏artifact拒绝、业务验证仍覆盖全部9排程与大ID/文件控制。当前Windows live-descendant整目录删除/latewrite仍必须运行。
6. 新消费者追加到现有step16明确命令，在两个Windows lane都执行；保留原命令项与顺序，按既有方法同步750/760源码契约。不要改sealed历史fixture/hash。完整验证必须包含新实际consumer，不只import/tsc。

若root选择先做更小观察，现 `built` 已有直接进程status/signal/error；把这些有限值与已有失败日志同时保留，能区分直接进程退出状态。但它不能解释具体compiler/link内部耗时，也不能据status0声称全部后代已回收。本提案不建议再猜flags、再减STL或无变化rerun。

以上是有真实调用约束的备选设计，尚非机器验证完的实施方案或Windows验收。若按标准build路径仍失败，必须保留真实构建失败继续定位；不放宽业务门或skip。
