export const CHAT_SHELL_TITLE_PAGE = "要对这页做什么？"
export const CHAT_SHELL_TITLE_NONE = "要我帮你做什么？"
export const CHAT_SHELL_PAGE_CHIP_PREFIX = "当前页："
export const CHAT_SHELL_CHIPS = [
  { label: "总结这一页", fill: "请总结当前页面的要点" },
  { label: "用更简单的话讲这一页", fill: "用更简单的话讲这一页在干什么" },
  { label: "列出我能在这页替你做的操作", fill: "列出当前页我可以替你执行的操作" },
] as const

export function chatShellEmpty(pageTitle: string | null): {
  title: string
  pageChip: string | null
  chips: { label: string; fill: string }[]
} {
  const title = (pageTitle || "").trim()
  if (!title) {
    return { title: CHAT_SHELL_TITLE_NONE, pageChip: null, chips: [] }
  }
  return {
    title: CHAT_SHELL_TITLE_PAGE,
    pageChip: `${CHAT_SHELL_PAGE_CHIP_PREFIX}${title}`,
    chips: CHAT_SHELL_CHIPS.map((c) => ({ label: c.label, fill: c.fill })),
  }
}
