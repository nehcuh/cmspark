# Eval case — overlay NSPanel restore 📎 dead / HUD mis-sold

1. **做了什么**: Darwin 快捷提问从 dual-locked C-thin HTML `--app` 改回 Swift NSPanel；画了 📎/`NSOpenPanel` 与 🎙；注释写成 Raycast/uTools 形态。
2. **成功了什么 / 失败了什么**: SHA 锁步 + overlay 单测绿。失败：`type:""` 被 `file.upload` validate 拒；HUD 不映射 `file.upload_error`；640+200pt 轨道仍是迷你工作台；Slice B 规格仍 LOCKED。
3. **归责**: **AI 锅**（实现把「图标可见」当 DoD；测试只 grep 字符串）+ **规格不清/未重锁**（用户否 `--app` 后未 SUPERSEDE 旧 dual）。
4. **保护哪条能力**: overlay 附件必须走真实 `file.upload` 闭环；L0 HUD 不得用 Raycast 名词洗工作台；dual-locked spec 必须 SUPERSEDED 才能反向实现。
