import { useAgentStore } from "../store/agentStore"
import { runShellEnableNavigation, shellEnableNavigationFor, type ShellEnableNavigation } from "../utils/shell-enable-navigation"
import { useContextPanelHostOptional } from "./ContextPanelHost"

export function ShellFailureNavigation({ text }: { text: string }) {
  const navigation = shellEnableNavigationFor(text)
  if (!navigation) return null
  return <ShellEnableActions navigation={navigation} />
}

export function ShellEnableActions({ navigation }: { navigation: ShellEnableNavigation }) {
  const host = useContextPanelHostOptional()
  const { dispatch } = useAgentStore()
  return (
    <div>
      <button type="button" onClick={() => runShellEnableNavigation("packs", {
        openPacks: () => { void host?.openPanelForce("packs") },
        dispatch,
      })}>打开场景里的本机能力</button>
      <button type="button" onClick={() => runShellEnableNavigation("integrations", {
        openPacks: () => { void host?.openPanelForce("packs") },
        dispatch,
      })}>打开能力档</button>
    </div>
  )
}
