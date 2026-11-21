import { useId, type ReactNode } from "react"
import { resolveSettingsDestination, SETTINGS_DESTINATIONS, type SettingsDestinationId } from "../utils/settings-navigation"

/** Keep inactive forms mounted so navigation never discards a draft. */
export function SettingsPage({ id, active, badge, children }: {
  id: SettingsDestinationId; active: boolean; badge?: ReactNode; children: ReactNode
}) {
  const { section, title, description } = SETTINGS_DESTINATIONS[id]
  const headingId = resolveSettingsDestination(section) === id ? `settings-page-${section}` : `settings-destination-${id}`
  return <section data-settings-page={section} data-settings-destination={id} hidden={!active} aria-labelledby={headingId}>
    <header className="cm-settings-page-heading">
      <div className="cm-settings-page-title"><h3 id={headingId} tabIndex={-1}>{title}</h3>{badge}</div>
      <p>{description}</p>
    </header>
    {children}
  </section>
}

export function SettingsNavRow({ title, description, current, onClick, category, destination }: {
  title: string
  description: string
  current?: string
  onClick: () => void
  category?: string
  destination?: string
}) {
  const descriptionId = useId()
  return <button type="button" className="cm-settings-nav-row" aria-label={title} aria-describedby={descriptionId}
    data-settings-open-category={category} data-settings-open-destination={destination} onClick={onClick}>
    <span>
      <strong>{title}</strong>
      <span id={descriptionId}>
        {current && <span className="cm-settings-nav-current">{current}</span>}
        <span className="cm-settings-nav-description">{description}</span>
      </span>
    </span>
    <span className="cm-settings-arrow" aria-hidden="true">›</span>
  </button>
}
