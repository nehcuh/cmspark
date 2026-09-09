Implement L2 UX copy honesty. Repo: C:\Users\HuChen\Projects\cmspark

ONLY these files (and their existing tests):
- chrome-extension/src/sidepanel/components/ContextPanelHost.tsx
- chrome-extension/src/sidepanel/components/MeetingPanel.tsx
- chrome-extension/src/sidepanel/voice/meeting-diarize-copy.ts
- chrome-extension/tests/meeting-diarize-copy.test.ts
- companion/src/summoner-web.ts (STT_NEED_MODEL / 听写 path strings only)
- companion/src/meeting/diarize-embed.ts (user-facing 设置 → 听写方式 message only)

Do NOT remove MeetingPanel unmount meeting.end (intentional anti-stuck-recording). Dual review: prefer relabel.

1. ContextPanelHost close button: if activePanel==="meeting" AND useAgentStore().meetingCaptureActive, visible text + title + aria-label = 「结束并收起」. Else keep 「收起」/「收起面板」. Need to subscribe to meetingCaptureActive from the store (already imported useAgentStore).
2. Replace user-visible 「设置 → 听写」 and 「设置 › 听写」 with 「设置 → 输入与语音」 in MeetingPanel (lines around 506,768,936,1271,1303,1583).
3. 「设置 → 听写方式」 → 「设置 → 输入与语音」（item 听写方式 may remain in the sentence if it is a control name on that page, e.g. 「设置 → 输入与语音 → 听写方式」). Update meeting-diarize-copy.ts + test + diarize-embed.ts + summoner-web.ts STT_NEED_MODEL.
4. Do not rewrite docs/superpowers specs or audit reviews.

When done: VERDICT: DONE
