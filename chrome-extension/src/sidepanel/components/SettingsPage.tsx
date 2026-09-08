import type { ReactNode } from "react"
import type { SettingsSectionId } from "../utils/settings-sections"

/** Stable ids preserve existing settings deep links. Display order is task order. */
export const SETTINGS_PAGES: { id: SettingsSectionId; title: string; description: string }[] = [
  { id: "model", title: "模型与推理", description: "配置对话与视觉模型，以及上下文和推理预算。更改后点击保存。" },
  { id: "voice", title: "输入与语音", description: "管理发送快捷键、听写方式和语音模型。偏好即时生效；下载与启用需分别操作。" },
  { id: "export", title: "文件与知识", description: "管理附件限制、会话索引和笔记导出。配置更改后点击保存。" },
  { id: "connection", title: "连接与配对", description: "连接本机 Companion，配对操作在此单独完成。" },
  { id: "security", title: "安全与信任", description: "查看运行自主度与各项权限。每项开关沿用各自的确认和生效规则。" },
  { id: "integrations", title: "本机与工具", description: "管理本机能力、网络授权、MCP 和编程助手。授权操作需单独确认。" },
  { id: "secrets", title: "密钥与环境", description: "管理工具使用的密钥和环境变量。各条目单独保存。" },
  { id: "experimental", title: "实验功能", description: "配置本地视觉定位等实验能力。模型下载、许可和启用分别确认。" },
]

/** Parent hides inactive pages, preserving every child form and draft. */
export function SettingsPage({ id, title, badge, children }: {
  id: SettingsSectionId; title: string; badge?: ReactNode; children: ReactNode
}) {
  return <section data-settings-section={title} aria-labelledby={`settings-page-${id}`}>
    <header className="cm-settings-page-heading">
      <div className="cm-settings-page-title"><h3 id={`settings-page-${id}`} tabIndex={-1}>{title}</h3>{badge}</div>
      <p>{SETTINGS_PAGES.find(page => page.id === id)?.description}</p>
    </header>
    {children}
  </section>
}
