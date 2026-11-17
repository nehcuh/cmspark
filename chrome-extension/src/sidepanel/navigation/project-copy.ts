export const projectCopy = {
  loading: "正在读取项目",
  updating: "正在更新项目列表",
  empty: "还没有项目",
  archiveEmpty: "没有归档项目",
  noMatch: "没有匹配的项目",
  listFailed: "项目列表没有取回",
  saveFailed: "项目没有保存",
  offlineEmpty: "无法取回项目列表",
  emptyProject: "这个项目还没有对话",
  bindFailed: "新对话已创建在项目外；归入尚未确认",
  bindOk: "新对话已归入这个项目",
  createFailed: "新对话尚未确认创建，请刷新核实。",
  restoreInvalid: "上次对话已不在，已回到项目首页",
  restoreNone: "没有可恢复的上次对话",
  offline: "离线",
  busyMove: "先结束执行或处理待确认操作，再整理。",
  offlineMove: "连接断开，归属整理已停用。",
  workspaceUnbound: "未绑定工作目录",
  workspaceStale: "工作目录暂时无法刷新",
  workspaceUnrefreshed: "未能刷新",
  executionOffline: "执行状态：离线",
  executionConnecting: "执行状态：正在连接",
  connectingMove: "正在连接，归属整理已停用。",
  executionIdle: "执行状态：空闲",
  executionBusy: "执行状态：执行中",
  executionPending: "执行状态：待确认",
  showArchived: "查看归档",
  showActive: "返回未归档",
  clearSearch: "清除搜索",
  createSummary: "新建项目",
  manageSummary: "管理项目",
  moveLegend: "更改当前会话归属",
  moveOut: "移出项目",
  back: "返回",
  projects: "项目",
  recent: "最近对话",
  tools: "工具",
  settings: "设置",
  currentTools: "当前任务",
  otherTools: "其他工具",
  outside: "项目外",
  inProject: "项目内新对话",
} as const

export function offlineCached(fetchedAt: string): string {
  return `离线，列表更新于 ${fetchedAt}`
}

export function falseEmptyCopy(text: string): boolean {
  return text.includes(projectCopy.empty) || text.includes("没有会话")
}
