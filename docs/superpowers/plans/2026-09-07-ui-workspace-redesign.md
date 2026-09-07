# UI workspace redesign

GitHub: #469. Base8656df94. Branch codex/ui-workspace-redesign.

1. Audit actual component surfaces and record baseline screenshots.
2. Root DESIGN.md governs updated hierarchy; reconcile docs/DESIGN.md.
3. Implement shared visual system and responsive navigation/conversation layout.
4. Improve history keyboard interaction, resource/settings panels and terminal/
   confirmation presentation while retaining all execution gates.
5. Real component browser matrix:320/390/800/1440, short-height, long messages,
   empty state, resources/settings, confirmation, keyboard navigation/escape.
6. Production build/full tests; actual independent Grok4.6 and DeepSeekV4Pro
   design and implementation gates. Fix concrete blockers and re-review.
7. Latest-head CI → PR merge → issue delivery record. No live config/app replace.

Visual evidence uses real React components with synthetic Chrome/WS transport;
not a live-account or native-platform acceptance claim.

## 实现复审修订

窄屏抽屉改为最大28dvh的非模态、流式导航：没有遮罩或焦点陷阱，确认和停止仍可命中。历史箭头归入原生按钮，Escape 限定当前弹层且停止冒泡。所有设置入口通过 Host 在打开设置时关闭上下文。召唤与独立设置 HTML 的样式同步纳入本次范围，非样式源码不变。React 图谱与确认台仅同步表面色；原生平台窗口不在浏览器验收声明内。
