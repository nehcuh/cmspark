import { tokens } from "./tokens"

/** Scoped shell styles; colors remain owned by tokens.ts. */
export const workspaceCSS = `
.cm-workspace{display:flex;height:100dvh;min-height:0;width:100%;overflow:hidden;background:${tokens.bg};font-family:${tokens.font};color:${tokens.text}}
.cm-workspace-main{display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;position:relative}
.cm-navigation{width:220px;height:100%;box-sizing:border-box;flex-shrink:0;display:flex;flex-direction:column;padding:20px 12px 12px;background:${tokens.bgMuted};border-right:1px solid ${tokens.border};gap:6px;overflow-y:auto}
[aria-label="工作区导航"] .cm-navigation{width:100%}
.cm-nav-brand{display:flex;align-items:center;gap:10px;padding:0 8px 20px;font-size:15px;letter-spacing:-.03em}
.cm-nav-brand .cm-icon-button{margin-left:auto}
.cm-nav-new,.cm-nav-item,.cm-nav-thread{font:inherit;border:0;border-radius:${tokens.radiusMd}px;cursor:pointer;display:flex;align-items:center;gap:10px;text-align:left;min-height:36px;width:100%;padding:8px 10px;color:${tokens.text};background:transparent;font-size:13px;flex-shrink:0}
.cm-nav-new{background:${tokens.bgElevated};border:1px solid ${tokens.border};margin-bottom:10px;font-weight:500}
.cm-nav-item:hover,.cm-nav-thread:hover,.cm-icon-button:hover{background:${tokens.bgHover}}
.cm-nav-resources{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin-bottom:16px}
.cm-nav-resources .cm-nav-item{font-size:12px;gap:6px;padding:8px 6px;min-width:0}
.cm-nav-resources .cm-nav-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-nav-section{display:flex;align-items:center;justify-content:space-between;font-size:12px;color:${tokens.textSecondary};padding:0 8px}
.cm-nav-search{box-sizing:border-box;width:100%;border:1px solid ${tokens.border};border-radius:${tokens.radiusMd}px;padding:9px 10px;font:inherit;font-size:12px;background:${tokens.bgElevated};color:${tokens.text}}
.cm-nav-threads{flex:1;min-height:80px;overflow-y:auto;margin-top:4px}
.cm-nav-thread{min-height:38px;color:${tokens.textSecondary}}
.cm-nav-thread>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.cm-nav-item[aria-current="true"],.cm-nav-thread[aria-current="page"]{background:${tokens.navSelected};color:${tokens.text};font-weight:500}
.cm-nav-running{color:${tokens.success};font-size:20px}
.cm-nav-empty{font-size:12px;color:${tokens.textSecondary};padding:8px}
.cm-nav-settings{margin-top:12px;border-top:1px solid ${tokens.border};border-radius:0;padding-top:14px}
.cm-icon-button{display:inline-flex;align-items:center;justify-content:center;min-width:32px;min-height:32px;border:0;background:transparent;color:${tokens.textSecondary};border-radius:${tokens.radiusMd}px;cursor:pointer;font-size:18px}
.cm-task-title{font-size:13px;font-weight:500;min-width:0;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-left:8px}
.cm-chat-content,.cm-composer-dock{width:100%;max-width:780px;margin-left:auto;margin-right:auto;box-sizing:border-box}
.cm-composer-dock{padding:12px 20px 18px!important}
.cm-composer-actions{display:flex;align-items:center;gap:8px;min-width:0}
.cm-composer-capsule:focus-within{border-color:${tokens.accent}!important;box-shadow:${tokens.shadowFocus}!important}
.cm-workspace button:focus-visible,.cm-workspace [role="button"]:focus-visible,.cm-workspace input:focus-visible,.cm-workspace textarea:focus-visible,[role="dialog"] button:focus-visible,[role="dialog"] input:focus-visible{outline:2px solid ${tokens.accent};outline-offset:3px}
.cm-workspace button:disabled{cursor:not-allowed}
.cm-settings-panel{width:min(780px,100vw - 32px)!important;max-height:88dvh!important;border-radius:${tokens.radiusSheet}px!important;box-shadow:${tokens.shadowLg}}
.cm-settings-header{padding:20px 24px!important}
.cm-settings-body{padding:8px 24px 24px!important}
.cm-context-panel{max-height:min(36dvh,360px)!important;margin:0 16px;border:1px solid ${tokens.border};border-radius:${tokens.radiusLg}px;box-shadow:${tokens.shadowSm}}
.cm-history-group{flex:1;border:0;background:transparent;color:inherit;font:inherit;text-align:left;min-height:32px;cursor:pointer;padding:4px 0}
.cm-navigation-toggle{gap:4px;flex-shrink:0}
.cm-history-panel{max-width:720px;margin:0 auto}
.cm-history-panel button:focus-visible,.cm-history-panel [role="button"]:focus-visible{outline:2px solid ${tokens.accent};outline-offset:-2px}
@media(min-width:760px){.cm-navigation-toggle{display:none!important}.cm-status-rail{padding:12px 24px!important;border-bottom:1px solid ${tokens.border}!important}.cm-chat-scroll{padding:28px 32px!important}.cm-composer-dock{padding-bottom:24px!important}}
@media(max-width:759px){.cm-workspace{flex-direction:column}.cm-navigation-disclosure{flex-shrink:0;max-height:28dvh;overflow:auto;border-bottom:1px solid ${tokens.border}}.cm-navigation-disclosure .cm-navigation{height:auto;width:100%}.cm-task-title{font-size:12px}.cm-composer-dock{padding:8px 12px 12px!important}.cm-settings-panel{align-self:flex-end;width:100%!important;max-height:90dvh!important;border-radius:16px 16px 0 0!important}.cm-settings-header{padding:16px!important}.cm-settings-body{padding:8px 16px 16px!important}}
@media(max-height:560px){.cm-context-panel{max-height:28dvh!important}.cm-composer-dock{padding-top:4px!important;padding-bottom:6px!important}.cm-navigation{padding-top:10px}.cm-nav-brand{padding-bottom:8px}.cm-nav-resources{margin-bottom:4px}.cm-nav-new{margin-bottom:2px}}
@media(prefers-reduced-motion:reduce){.cm-workspace *{animation:none!important;transition:none!important;scroll-behavior:auto!important}}

.cm-settings-panel{width:min(980px,100vw - 32px)!important;height:88dvh;max-height:88dvh!important}
.cm-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
.cm-settings-content{display:flex;flex-direction:column;flex:1;min-height:0}
.cm-settings-save-scope{font-size:11px;color:${tokens.textSecondary};line-height:1.5}
.cm-settings-panel button{min-height:36px}
.cm-settings-page-heading h3:focus-visible,.cm-settings-panel select:focus-visible,.cm-settings-panel summary:focus-visible{outline:2px solid ${tokens.accent};outline-offset:3px}
.cm-settings-layout{display:flex;flex:1;min-height:0;overflow:hidden}
.cm-settings-nav{box-sizing:border-box;width:172px;flex-shrink:0;padding:16px 10px;background:${tokens.bgMuted};border-right:1px solid ${tokens.border};overflow-y:auto}
.cm-settings-nav button{display:block;width:100%;min-height:40px;padding:10px 12px;margin:2px 0;border:0;border-radius:8px;background:transparent;color:${tokens.textSecondary};font:inherit;font-size:13px;text-align:left;cursor:pointer}
.cm-settings-nav button[aria-current="page"]{background:${tokens.navSelected};color:${tokens.text};font-weight:600}
.cm-settings-nav button:hover{background:${tokens.bgHover}}
.cm-settings-layout .cm-settings-body{flex:1;min-width:0;padding:20px 28px 28px!important;overflow:auto}
.cm-settings-page-heading{padding:0 0 20px;margin-bottom:16px;border-bottom:1px solid ${tokens.border}}
.cm-settings-page-title{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.cm-settings-page-heading h3{font-size:20px;font-weight:600;letter-spacing:-.03em;margin:0 0 8px}
.cm-settings-page-heading p{font-size:12px;line-height:1.7;color:${tokens.textSecondary};margin:8px 0 0}
.cm-settings-status{display:flex;gap:8px;flex-wrap:wrap;padding:0 24px 8px}
.cm-settings-status:not(:has(button)){padding:0}
.cm-settings-status button{background:${tokens.warningSoft};color:${tokens.text};border:1px solid ${tokens.border};border-radius:8px;padding:6px 10px;min-height:36px;font:inherit;font-size:12px;cursor:pointer}
.cm-settings-assistant{margin-bottom:20px;font-size:12px;color:${tokens.textSecondary}}
.cm-settings-assistant summary{cursor:pointer;min-height:36px}
.cm-settings-mobile-category{display:none}
.cm-settings-footer{flex-wrap:wrap;padding:12px 24px!important;gap:8px!important}
.cm-settings-footer button{min-height:36px}
.cm-settings-footer .cm-settings-save{background:${tokens.actionPrimary}!important}
.cm-settings-body input,.cm-settings-body select,.cm-settings-body textarea{max-width:100%;box-sizing:border-box}
@media(max-width:759px){.cm-settings-panel{height:94dvh;max-height:94dvh!important;width:100%!important}.cm-settings-layout{flex-direction:column}.cm-settings-nav{display:none}.cm-settings-mobile-category{display:flex;align-items:center;gap:12px;padding:10px 16px;background:${tokens.bgMuted};border-bottom:1px solid ${tokens.border};font-size:12px;color:${tokens.textSecondary}}.cm-settings-mobile-category select{flex:1;min-width:0;min-height:36px;border:1px solid ${tokens.border};border-radius:8px;padding:6px 10px;background:${tokens.bg};color:${tokens.text};font:inherit}.cm-settings-layout .cm-settings-body{padding:16px!important}.cm-settings-status{padding:0 16px 8px}.cm-settings-page-heading h3{font-size:18px}.cm-settings-footer{padding:10px 16px!important}}
.cm-settings-body input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),.cm-settings-body select{min-height:36px}
`
