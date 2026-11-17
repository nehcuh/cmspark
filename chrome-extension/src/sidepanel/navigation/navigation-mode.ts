export const RESIDENT_MIN_WIDTH = 960
export type NavigationSurface = "sidepanel" | "popout" | "workspace"
export function navigationMode(input: { surface: NavigationSurface; innerWidth: number }): "layered" | "resident" {
  return input.innerWidth >= RESIDENT_MIN_WIDTH ? "resident" : "layered"
}
