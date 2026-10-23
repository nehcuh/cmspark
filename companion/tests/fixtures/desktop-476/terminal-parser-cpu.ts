/** CPU-only adapter: DOM, input and selection stay inert. Only VT parsing and
 * its public buffer/write callbacks use the same pinned actual xterm package.
 * This adapter is never shipped and is not native DOM/PTY/selection evidence. */
import { Terminal as ActualTerminal } from '@xterm/xterm'
const adapters=new Set<{drain():Promise<void>;dispose():void}>()
export async function cleanupCpuTerminalAdapters747(){for(const adapter of [...adapters]){try{await adapter.drain()}finally{adapter.dispose();adapters.delete(adapter)}}}
export function createNoOpenTerminal747(options: {cols?:number;rows?:number;scrollback?:number} = {}): ActualTerminal {
 return new ActualTerminal({cols:80,rows:24,scrollback:5000,convertEol:false,...options})
}
export function cpuTerminalAdapter747(element:(id:string)=>any,terminals:any[]) {
 return class CpuTerminal747 {
  readonly parser=createNoOpenTerminal747()
  readonly writes:Buffer[]=[]
  private readonly pending=new Set<Promise<void>>()
  private writeFailure:unknown
  element:any
  selection=''
  disposed=false
  data?: (text:string)=>void
  private resizeListener?: (size:{cols:number;rows:number})=>void
  constructor(options?:{cols?:number;rows?:number;scrollback?:number}) {
   if(options?.cols!==undefined||options?.rows!==undefined)this.parser.resize(options?.cols??80,options?.rows??24)
   terminals.push(this);adapters.add(this)
  }
  get cols(){return this.parser.cols}
  get rows(){return this.parser.rows}
  get buffer(){return this.parser.buffer}
  loadAddon(addon:any){addon.term=this}
  open(holder:any){
   this.element=element('owned-xterm');this.element.className='xterm';holder.append(this.element)
   const textarea=element('owned-xterm-textarea');textarea.className='xterm-helper-textarea';this.element.append(textarea)
  }
  onData(callback:(text:string)=>void){this.data=callback}
  onResize(callback:(size:{cols:number;rows:number})=>void){this.resizeListener=callback}
  resizeTo(cols:number,rows:number){this.parser.resize(cols,rows);this.resizeListener?.({cols,rows})}
  write(bytes:Uint8Array,done:()=>void){
   this.writes.push(Buffer.from(bytes))
   let complete!:()=>void,refuse!:(error:unknown)=>void
   const waiting=new Promise<void>((resolve,reject)=>{complete=resolve;refuse=reject})
   this.pending.add(waiting)
   waiting.then(()=>this.pending.delete(waiting),error=>{this.pending.delete(waiting);this.writeFailure??=error})
   try{this.parser.write(Uint8Array.from(bytes),()=>{try{done();complete()}catch(error){refuse(error)}})}catch(error){refuse(error)}
  }
  async drain(){while(this.pending.size)await Promise.all([...this.pending]);if(this.writeFailure!==undefined)throw this.writeFailure}
  // Original CPU selection seam is deliberately inert; native selectAll and
  // getSelection continue to run on the actual opened WebView Terminal.
  selectAll(){this.selection=Buffer.concat(this.writes).toString('utf8')}
  getSelection(){return this.selection}
  dispose(){if(!this.disposed){this.disposed=true;this.parser.dispose()}}
 }
}

/** Exact new-observer inverse; callers still verify the independent old whole hash. */
export function observerInverseForm747(raw:string):string {
 if(raw.includes("\r"))throw Error("OBSERVER_INVERSE_EXPECTS_LF")
 const block=" // Parsed text comes from this actual Terminal's public active buffer. Hard\n // newlines remain separators; only actual softwrapped lines continue a marker.\n function parsedMarker747(terminal,marker){\n  if(!terminal||typeof marker!==\"string\"||marker.length===0||!Number.isSafeInteger(terminal.cols)||terminal.cols<1||terminal.cols>500||!Number.isSafeInteger(terminal.rows)||terminal.rows<1||terminal.rows>200)return false;\n  const buffer=terminal.buffer?.active;if(!buffer||!Number.isSafeInteger(buffer.length)||buffer.length<1||buffer.length>5000+terminal.rows||typeof buffer.getLine!==\"function\")return false;\n  let suffix=\"\",found=false;\n  for(let index=0;index<buffer.length;index++){\n   const line=buffer.getLine(index);if(!line||typeof line.isWrapped!==\"boolean\"||typeof line.translateToString!==\"function\")return false;\n   if(!line.isWrapped)suffix=\"\";\n   const text=line.translateToString(true);if(typeof text!==\"string\")return false;\n   const whole=suffix+text;if(whole.includes(marker))found=true;suffix=whole.slice(-(marker.length-1));\n  }\n  return found;\n }\n // This capture is installed only by the unshipped acceptance form. Construct\n // the original class, keep its prototype/callbacks, and never expose its core.\n function captureTerminal747(host,doc,currentGeneration){\n  const Original=host.Terminal,generation=currentGeneration(),records=[];let restored=false;\n  const proxy=typeof Original===\"function\"?new Proxy(Original,{construct(target,args){const terminal=Reflect.construct(target,args,target);records.push({terminal,generation:currentGeneration()});return terminal}}):null;\n  if(proxy)host.Terminal=proxy;\n  const restore=()=>{if(restored)return;restored=true;if(proxy&&host.Terminal===proxy)host.Terminal=Original};\n  return{restore,count:()=>records.length,bind(operation){\n   if(restored||!proxy||host.Terminal!==proxy||currentGeneration()!==generation||typeof operation!==\"string\"||operation.length<1||operation.length>200||records.length!==1)return undefined;\n   const record=records[0],terminal=record.terminal,element=terminal.element,holder=element?.parentElement,container=doc.getElementById(\"local-terminals\");\n   if(record.generation!==generation||!element||element.ownerDocument!==doc||element.isConnected!==true||!holder||holder.ownerDocument!==doc||holder.isConnected!==true||typeof holder.getAttribute!==\"function\"||holder.getAttribute(\"data-local-terminal\")!==operation||!container||typeof container.contains!==\"function\"||!container.contains(holder))return undefined;\n   restore();return terminal;\n  }};\n }\n const capture=captureTerminal747(window,document,()=>documentGeneration);let ownedTerminal,ownedOperation=null;\n"
 if(raw.split(block).length!==2)throw Error("OBSERVER_CAPTURE_ANCHOR");let value=raw.replace(block,"")
 const pairs:Array<readonly [string,string]>=[["const outputReady=()=>{outputComplete=phase===7&&typedEnter&&new TextEncoder().encode(output).length>16384&&parsedMarker747(ownedTerminal,\"D476_TERMINAL_中\");if(phase===7&&outputComplete&&ackFrames===dataFrames){", "const outputReady=()=>{if(phase===7&&outputComplete&&ackFrames===dataFrames){"], ["const textarea=$(\"local-terminals\").querySelector(\".xterm-helper-textarea\");ownedTerminal=capture.bind(f.operation_id);ownedOperation=f.operation_id;if(!textarea||!ownedTerminal){capture.restore();fail(10);return}textarea.focus();", "const textarea=$(\"local-terminals\").querySelector(\".xterm-helper-textarea\");if(!textarea){fail(10);return}textarea.focus();"], ["if(f.thread_id!==target||f.operation_id!==ownedOperation)return;dataFrames++;", "if(f.thread_id!==target)return;dataFrames++;"], ["   outputReady();return;\n  }\n  if(f.type===\"desktop.terminal.ack.result\")", "   if(phase===7&&typedEnter&&output.includes(\"D476_TERMINAL_中\")&&new TextEncoder().encode(output).length>16384)outputComplete=true;outputReady();return;\n  }\n  if(f.type===\"desktop.terminal.ack.result\")"], ["if(f.thread_id!==target||f.operation_id!==ownedOperation||f.ok!==true){fail(14);return}", "if(f.thread_id!==target||f.ok!==true){fail(14);return}"]]
 for(const [after,before] of pairs){if(value.split(after).length!==2)throw Error("OBSERVER_PREDICATE_ANCHOR");value=value.replace(after,before)}
 return value
}
