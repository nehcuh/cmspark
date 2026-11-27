import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getAssetsDir } from "../paths"

// Both tsc development builds and the installed companion serve the pinned browser
// distribution under the page's existing nonce. No network request is necessary.
const staged = join(getAssetsDir(), "markdown-it.umd.min.js")
const browser = readFileSync(existsSync(staged) ? staged : require.resolve("markdown-it/browser"), "utf8")
  .replace(/^\/\/# sourceMappingURL=.*$/m, "")
  .replace(/<\/script/gi, "<\\/script")

export const OVERLAY_RENDER_MD_JS = `
const chatMarkdown = (function(){
  const module = {exports:{}}, exports = module.exports;
  ${browser}
  const md = new module.exports({html:false, breaks:true});
  md.validateLink = url => url.toLowerCase().startsWith("https://") || url.toLowerCase().startsWith("http://");
  md.renderer.rules.link_open = (tokens, i, options, env, renderer) => {
    tokens[i].attrSet("target", "_blank");
    tokens[i].attrSet("rel", "noopener noreferrer");
    return renderer.renderToken(tokens, i, options);
  };
  md.renderer.rules.image = (tokens, i) => md.utils.escapeHtml(tokens[i].content);
  return md;
})();
function renderMd(src){ return chatMarkdown.render(String(src || "")); }
`
