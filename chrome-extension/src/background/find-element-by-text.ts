/**
 * Visible-text element finder for browser_download and click({text}) (web act-loop W1).
 * Pure helpers — unit-testable without Chrome (PR-6 / plan D10 / spec 2026-08-21).
 *
 * Matching rules:
 * - Prefer interactive candidates (buttons, links, form fields, contenteditable)
 * - Fallback: any visible element whose text matches
 * - exact=false (default): case-sensitive substring contains
 * - exact=true: trimmed text equality
 * - 0 → ELEMENT_NOT_FOUND; >1 after prefer → ELEMENT_AMBIGUOUS
 *
 * Side effect in-page: marks hits with hitAttr (download vs click namespaces).
 */

export interface TextMatchSummary {
  tag: string
  text: string
  x: number
  y: number
}

export interface TextMatchResult {
  count: number
  matches: TextMatchSummary[]
}

export const DOWNLOAD_HIT_ATTR = "data-cmspark-dl-hit"
export const CLICK_HIT_ATTR = "data-cmspark-hit"

/** Buttons + form fields so fill_form({text}) does not uniquely match a <label>. */
export const INTERACTIVE_SEL =
  'a,button,[role="button"],[role="link"],[role="menuitem"],[role="tab"],[role="option"],[role="checkbox"],input,textarea,select,[contenteditable="true"],[contenteditable=""],[role="textbox"],[onclick],label,summary'

/**
 * Build a Runtime.evaluate / scripting expression that returns TextMatchResult.
 * Uses JSON.stringify for safe text embedding. hitAttr defaults to download namespace.
 */
export function buildFindByTextExpression(
  text: string,
  exact = false,
  hitAttr: string = DOWNLOAD_HIT_ATTR,
): string {
  const textLit = JSON.stringify(text)
  const exactLit = exact ? "true" : "false"
  const attrLit = JSON.stringify(hitAttr)
  // IIFE — no outer free variables. Marks matches with parameterized hitAttr.
  return `(()=>{
  const needle=${textLit};
  const exact=${exactLit};
  const hitAttr=${attrLit};
  document.querySelectorAll('['+hitAttr+']').forEach(el=>el.removeAttribute(hitAttr));
  function visible(el){
    if(!el||el.nodeType!==1)return false;
    const st=window.getComputedStyle(el);
    if(st.display==='none'||st.visibility==='hidden'||st.opacity==='0')return false;
    const r=el.getBoundingClientRect();
    return r.width>0&&r.height>0;
  }
  function ownText(el){
    let t='';
    for(const n of el.childNodes){
      if(n.nodeType===3) t+=n.textContent||'';
    }
    const aria=(el.getAttribute&& (el.getAttribute('aria-label')||el.getAttribute('title')||el.getAttribute('value')||el.getAttribute('placeholder')))||'';
    const full=((el.innerText||el.textContent||'')+ ' ' + aria).replace(/\\s+/g,' ').trim();
    return full;
  }
  function matches(el){
    const t=ownText(el);
    if(!t)return false;
    if(exact) return t===String(needle).trim();
    return t.includes(needle);
  }
  const interactiveSel=${JSON.stringify(INTERACTIVE_SEL)};
  const interactive=Array.from(document.querySelectorAll(interactiveSel)).filter(visible).filter(matches);
  let pool=interactive;
  if(pool.length===0){
    pool=Array.from(document.querySelectorAll('body *')).filter(visible).filter(matches);
    // Prefer leaf-ish: drop ancestors that contain another match
    const set=new Set(pool);
    pool=pool.filter(el=>{
      for(const o of set){ if(o!==el&&el.contains(o)) return false; }
      return true;
    });
  }
  const formSel='input,textarea,select,[contenteditable="true"],[contenteditable=""],[role="textbox"]';
  const formHits=pool.filter(el=>{ try{ return el.matches(formSel); }catch(e){ return false; } });
  if(formHits.length>0) pool=formHits;
  const matchesOut=pool.slice(0,10).map(el=>{
    const r=el.getBoundingClientRect();
    return {
      tag:(el.tagName||'').toLowerCase(),
      text:ownText(el).slice(0,80),
      x:r.x+r.width/2,
      y:r.y+r.height/2
    };
  });
  if(pool.length===1){
    pool[0].setAttribute(hitAttr,'1');
  } else if(pool.length>1){
    pool.forEach((el,i)=>{ if(i<5) el.setAttribute(hitAttr,String(i+1)); });
  }
  return { count: pool.length, matches: matchesOut };
})()`
}

/** Pure decision helper — used by runBrowserDownload (and unit tests). */
export function classifyTextMatchCount(count: number): "ok" | "ELEMENT_NOT_FOUND" | "ELEMENT_AMBIGUOUS" {
  if (count <= 0) return "ELEMENT_NOT_FOUND"
  if (count === 1) return "ok"
  return "ELEMENT_AMBIGUOUS"
}

/**
 * Pure match-pool selection mirroring the in-page IIFE (no DOM).
 * Covers interactive-prefer + leaf-ancestor filter for unit tests without jsdom.
 */
export interface TextCandidate {
  id: number
  tag: string
  text: string
  interactive: boolean
  visible: boolean
  /** ids of descendants that are also candidates (for leaf filter) */
  descendantIds?: number[]
}

export function selectTextMatchPool(
  candidates: TextCandidate[],
  needle: string,
  exact = false,
): TextCandidate[] {
  const matches = (t: string) => {
    if (!t) return false
    if (exact) return t.trim() === String(needle).trim()
    return t.includes(needle)
  }
  const visible = candidates.filter((c) => c.visible && matches(c.text))
  let pool = visible.filter((c) => c.interactive)
  if (pool.length === 0) {
    pool = visible
    const set = new Set(pool.map((c) => c.id))
    pool = pool.filter((el) => {
      for (const o of pool) {
        if (o.id !== el.id && (el.descendantIds || []).includes(o.id) && set.has(o.id)) {
          return false
        }
      }
      return true
    })
  }
  return pool
}
