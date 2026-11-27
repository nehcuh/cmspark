import { tokens } from "../ui/tokens"

export const meetingReaderStyles = `
.meeting-workspace {container-type:inline-size}
.meeting-workspace nav.meeting-views {display:flex;gap:1.4em;border-bottom:1px solid ${tokens.border};margin:8px 0}
.meeting-views button {background:transparent;border:0;border-bottom:2px solid transparent;padding:8px 1px;font-weight:600;line-height:1.5;font-family:inherit;font-size:14px;color:${tokens.textSecondary};cursor:pointer}
.meeting-views button[aria-pressed=true] {border-color:${tokens.accent};color:${tokens.text};font-weight:650}
.meeting-workspace .meeting-document {background:${tokens.bgElevated};border:1px solid ${tokens.border};border-radius:14px;overflow:hidden;overflow-wrap:anywhere}
.meeting-document header {padding:clamp(20px,5cqw,42px);background:${tokens.accentSoft};border-bottom:1px solid ${tokens.border}}
.meeting-document header h2 {margin:0;font:600 clamp(23px,4cqw,36px)/1.35 Georgia,"Songti SC",serif}
.meeting-document time,.meeting-turn small {font-variant-numeric:tabular-nums;color:${tokens.textSecondary}}
.meeting-document header time {display:block;margin-top:10px}
.meeting-outline,.meeting-document-body {padding:12px clamp(16px,4cqw,36px)}
.meeting-document-body {font-size:15px;line-height:1.8;overflow-x:auto}
.meeting-document-body :is(h1,h2,h3,h4) {margin:1.4em 0 .45em;color:${tokens.text};font-size:1.2em}
.meeting-document-body :is(h1,h2,h3,h4):first-child {margin-top:0}
.meeting-document-body li {margin:.45em 0}
.meeting-document-body :is(ul,ol) {padding-left:1.5em}
.meeting-document-body blockquote {border-inline-start:3px solid ${tokens.accent};margin-inline:0;padding-inline:1em}
.meeting-document-body :is(td,th) {border:1px solid ${tokens.border};padding:4px 8px}
.meeting-document-body table {border-collapse:collapse}
.meeting-document button {border:0;background:${tokens.accentSoft};border-radius:5px;color:${tokens.accentText};cursor:pointer;padding:3px 6px;margin:2px;font:inherit;font-size:12px}
.meeting-turn {padding:12px 0;border-bottom:1px solid ${tokens.border};scroll-margin-top:16px}
.meeting-turn:focus {outline:2px solid ${tokens.accent};outline-offset:2px}
.meeting-turn p {margin:5px 0 0;font-size:15px;line-height:1.75;white-space:pre-wrap;overflow-wrap:anywhere}
.meeting-chapter {display:flex;align-items:baseline;gap:1em;text-align:start;color:${tokens.text};width:100%;border:0;border-bottom:1px solid ${tokens.border};padding:14px 4px;background:transparent;font:inherit;cursor:pointer}
.meeting-chapter time {color:${tokens.accentText};font-variant-numeric:tabular-nums}
.meeting-setup {display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:12px 0}
.meeting-setup label {display:flex;align-items:center;gap:5px;font-size:12px}
.meeting-setup select {max-width:100%;padding:6px;border-radius:6px;color:${tokens.text};background:${tokens.bgElevated};border:1px solid ${tokens.border}}
`
