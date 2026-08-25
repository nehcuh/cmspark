/** Shared GFM+breaks options for chat markdown. Tests import this so a single
 *  `breaks:true` site cannot go stale (Lane C N4). */
export const CHAT_MARKED_OPTIONS = { gfm: true, breaks: true } as const
