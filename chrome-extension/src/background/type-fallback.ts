/**
 * type() DOM fallback expression (web act-loop W4).
 * INPUT/TEXTAREA may set el.value; contenteditable / role=textbox must NOT.
 */

export type TypeFallbackResult =
  | { ok: true; kind: "value" | "insertText" }
  | { ok: false; reason: "no_element" | "unsupported" }

/**
 * Build a Runtime.evaluate / scripting IIFE.
 * Callers interpret {ok:false, reason:"unsupported"} as TYPE_UNSUPPORTED_EDITOR.
 */
export function buildTypeFallbackExpression(value: string, selector?: string): string {
  const valueLit = JSON.stringify(String(value))
  const elExpr = selector
    ? `document.querySelector(${JSON.stringify(selector)})`
    : `document.activeElement`
  return `(()=>{
    const el=${elExpr};
    if(!el||el===document.body||el===document.documentElement) return {ok:false,reason:'no_element'};
    const tag=String(el.tagName||'').toUpperCase();
    const isField=tag==='INPUT'||tag==='TEXTAREA';
    const ce=el.isContentEditable===true||el.getAttribute('contenteditable')==='true'||el.getAttribute('contenteditable')===''||el.getAttribute('role')==='textbox';
    if(isField){
      el.focus();
      el.value=${valueLit};
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return {ok:true,kind:'value'};
    }
    if(ce){
      el.focus();
      let inserted=false;
      try{ inserted=!!document.execCommand('insertText',false,${valueLit}); }catch(e){}
      if(!inserted){
        el.dispatchEvent(new InputEvent('input',{bubbles:true,data:${valueLit},inputType:'insertText'}));
      }
      return {ok:true,kind:'insertText'};
    }
    return {ok:false,reason:'unsupported'};
  })()`
}
