export const RESIDENT_MIN_WIDTH = 760
const POPOUT_RESIDENT_MIN_WIDTH = 960
export type NavigationSurface = "sidepanel" | "popout" | "workspace"
export function residentMinWidth(surface: NavigationSurface): number {
  return surface === "popout" ? POPOUT_RESIDENT_MIN_WIDTH : RESIDENT_MIN_WIDTH
}

export function navigationMode(input: { surface: NavigationSurface; innerWidth: number }): "layered" | "resident" {
  return input.innerWidth >= residentMinWidth(input.surface) ? "resident" : "layered"
}
