# #758 精确 CI 与 Windows 首错观察

首次head `ef5ead11119894a2879ba0ff2e99dfc75230252c`，run [39697875453](https://github.com/nehcuh/cmspark/actions/runs/39697875453)。真实Linux X11专项1PASS/0SKIP；Ubuntu/macOS smoke及build已成功。Windows native job `119559595047` 在本次新增case失败：10,047ms后 `OWNED_ACTIVITY_FIXTURE_NOT_READY`；尚未执行应用枚举、被动截图、OCR或通知，不冒Windows产品已验收。Windows census与ACP restart仍在运行。

原始日志只有就绪等待超时，夹具stderr被忽略，内部原因 **UNKNOWN**，不能从10秒推断需要提高预算、抬窗或调整权限。原日志已按自有窗口数据留存于platform-758可视化证据目录。

后续差量严格限 **T1测试观察**：保留10秒receipt及90秒原case预算、全部身份/截图/最小化/通知断言、真实close后的lease释放。仅捕获并持续drain自有fixture stderr的4KiB前缀；自有PS夹具首拒原子记录固定阶段、异常类型/HResult和512字符消息；阶段是最后到达观察点，非根因或完成证明。事件错误仍关闭并拒绝，不吞成成功。没有生产代码、原生API、输入、配置或CI工作流变化；原生产T3对抗/Pi意见按字节复用。

CPU通过实际controller函数验证首拒优先于close、stderr保留及观察器退订；连同平台原12项共15PASS/0FAIL。受控Linux原生仍1PASS/0SKIP。该增量只为下一次真实Windows取得首错，不宣称已修复就绪问题；禁止无变化重试。

自查实际controller的ready+同tick close负控先RED（2PASS/1FAIL），修正close分支只读首拒且不接受ready后GREEN（3项观察控制+原平台12项）。保留原先观察器也必须拒绝已观察的进程退出；没有把ready当活进程证明。原Linux实测再次1PASS。
