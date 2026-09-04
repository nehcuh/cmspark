// #258 — visible marker when companion applied voice postprocess to a final.

export const POSTPROCESS_BADGE_LABEL = "已后处理"

export function postprocessBadge(flag: boolean | undefined): string | null {
  return flag === true ? POSTPROCESS_BADGE_LABEL : null
}
