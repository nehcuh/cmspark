# Plan adversary — #229 召唤器只修快与淡

> 2026-08-27 · 独立对抗（explore）· 实现前  
> Plan: `docs/superpowers/plans/2026-08-27-slice-229-summoner-fast-fade.md`  
> VERDICT: **APPROVE_WITH_NITS**（nits 已折进计划 r2）

根因坐实：`SummonerOverlay.swift` `open()` 在 `.nonactivatingPanel` 上仍 `NSApp.activate(ignoringOtherApps: true)`。Confirm HUD 已禁止这条。`hide()` = `orderOut`；`openFromHotKey` 已 toggle。

Nits 已折：📎/🎙 activate 标成可见 Capture 手势；热键 wrapper 也禁 activate；open 抄 Confirm「do NOT activate」注释；DoD 1 须狗食。

不扩 ACL / 五轨 / HTML 原生 HUD。
