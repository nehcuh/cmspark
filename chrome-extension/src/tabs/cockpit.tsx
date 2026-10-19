// Plasmo tab page → tabs/cockpit.html (L2 Cockpit window)
import { CockpitRoot } from "../cockpit/CockpitApp"

// #723: a non-secret protective marker, not an authenticated window identity.
// Set before mounting the confirmation UI; legacy loaded builds may lack it.
if (typeof document !== "undefined") document.title = "CMspark Confirmation Cockpit [723]"

export default function CockpitPage() {
  return <CockpitRoot />
}
