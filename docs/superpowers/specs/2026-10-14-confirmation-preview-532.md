# L2 预览降级说明

GitHub: #532（既有 bug）；#530 仅核对时序，不修改范围。

预览 helper 的失败/超时目前都返回 null，确认台仅隐藏图片。新增受限原因元数据，只流向人类确认 UI：target_unavailable、capture_failed、ocr_failed、render_failed、timeout、preview_failed。异常原文、文件路径、OCR 与窗口标题不作为原因。成功、未尝试与旧协议不报截图失败；客户端图像无效/加载失败显示固定提示。确认 id 变化不能复用旧加载失败状态。

保留 helper nullable API；内部完成结果选择后最多回调一次 unavailable reason，晚到 capture/OCR 仅执行现有 finally raw 清理，不改变已发确认。Darwin/Windows admission 把原因带入实际 manager request；manager 与前端 whitelist 再验证枚举。图片/原因只在人类确认通道，不进入工具结果、LLM、知识。

保持 5000ms preview、45000ms confirmation、动作预算、token/nonce/origin/ACL、审批与会话信任判据不变。不增加权限、不自动批准、不关闭 #530 的历史真实 UI 验收。

验收：真实 helper/admission/manager 失败与成功控制；超时后 raw 迟删与一次原因；真实 UI 固定中文说明及 image error；origin mismatch/拒绝仍无 token；旧协议无图不冒报。T3 conservative，能力只增人类可见诊断说明。实现者机核后冻结，独立对抗与 Pi/整批 CI 由主任务执行。
