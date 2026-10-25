// Unshipped observations. Original Boolean operands evaluate once, in order.
export function desktopConfirmationObservationFixture(source, role) {
  if (typeof source !== 'string' || !['LOCAL', 'TERMINAL'].includes(role)) throw Error('D476_CONFIRMATION_OBSERVATION_SOURCE')
  const eol = source.includes('\r\n') ? '\r\n' : '\n', patches = []
  const sites = ['begin', 'frame-received', 'hash-enter', 'hash-returned', 'panel-created', 'controller-enter', 'retire-enter', 'decision-send-enter', 'decision-send-returned'].map((stage,index)=>({site:index+1,kind:'stage',stage}))
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw Error('D476_CONFIRMATION_OBSERVATION_ANCHOR')
    source = source.replace(before, after); patches.push([before, after])
  }
  const original = source
  const members = [
    ' unsigned cf772_round=0;bool cf772_seen[8][128]{};ULONGLONG cf772_origin=GetTickCount64();',
    ' void cf772(unsigned site,unsigned round=0,bool value=true) noexcept {',
    '  if(!round)round=cf772_round;if(site<1||site>128||round<1||round>8||cf772_seen[round-1][site-1])return;',
    '  const DWORD previous_error=GetLastError();cf772_seen[round-1][site-1]=true;',
    `  try{JsonObject frame;put(frame,L"type",L"system.ping");put(frame,L"id",std::wstring(L"D476_CF_${role}_")+std::to_wstring(site)+L"_"+std::to_wstring(round)+L"_"+std::to_wstring(std::min<ULONGLONG>(240,(GetTickCount64()-cf772_origin)/250))+(value?L"_1":L"_0"));(void)send(frame);}catch(...){}`,
    '  SetLastError(previous_error);',
    ' }',
    ' bool cf772_test(unsigned site,bool value) noexcept {cf772(site,0,value);return value;}',
  ].join(eol)
  replace('class Desktop {', 'class Desktop {' + eol + members)
  const begin = ' void begin_confirmation(JsonObject const& frame){', end = ' void accept(std::wstring const& body,unsigned long frame_epoch){'
  const start = source.indexOf(begin), finish = source.indexOf(end, start)
  if (start < 0 || finish < 0 || source.indexOf(begin, start + 1) >= 0) throw Error('D476_CONFIRMATION_OBSERVATION_BOUNDARY')
  const before = source.slice(start, finish)
  if (before.split('}else if(workspace){').length !== 2 || before.split('WNDCLASSW cls{}').length !== 2) throw Error('D476_CONFIRMATION_OBSERVATION_BOUNDARY')
  const scan = (text, visit) => {
    let depth = 0, quote = '', escaped = false
    for (let i = 0; i < text.length; i++) {
      const c = text[i]
      if (quote) { if (escaped) escaped = false; else if (c === '\\') escaped = true; else if (c === quote) quote = ''; continue }
      if (c === '"' || c === "'") { quote = c; continue }
      if ('([{'.includes(c)) depth++
      else if (')]}'.includes(c)) depth--
      if (visit(i,depth) === false) return
    }
  }
  const grouped = text => {
    if (text[0] !== '(' || text.at(-1) !== ')') return false
    let whole = true
    scan(text,(i,depth)=>{if(depth===0 && i!==text.length-1){whole=false;return false}})
    return whole
  }
  let next = 10
  const site = (kind,predicate) => {
    if (next > 128) throw Error('D476_CONFIRMATION_OBSERVATION_SITE_BOUND')
    const number=next++;sites.push({site:number,kind,predicate});return number
  }
  const trace = (condition,prefix='') => {
    const leading = condition.match(/^\s*/)[0], trailing = condition.match(/\s*$/)[0], value = condition.trim()
    if (grouped(value)) return leading+'('+trace(value.slice(1,-1),prefix)+')'+trailing
    if (value.startsWith('!') && grouped(value.slice(1))) return leading+'!'+trace(value.slice(1),prefix)+trailing
    for (const operator of ['||','&&']) {
      const parts=[];let from=0
      scan(value,(i,depth)=>{if(depth===0 && value.slice(i,i+2)===operator){parts.push(value.slice(from,i));from=i+2}})
      if (parts.length) {parts.push(value.slice(from));return leading+parts.map(part=>trace(part,prefix)).join(operator)+trailing}
    }
    return leading+`${prefix}cf772_test(${site('predicate',value)},static_cast<bool>(${value}))`+trailing
  }
  let body = before, cursor = 0
  while (true) {
    const at = body.indexOf('if(',cursor)
    if (at < 0) break
    let pos = -1
    scan(body.slice(at+2),(i,depth)=>{if(depth===0){pos=at+2+i+1;return false}})
    if (pos < 0) throw Error('D476_CONFIRMATION_OBSERVATION_CONDITION')
    const tail=body.slice(pos),direct=tail.startsWith('return;'),retire=tail.startsWith('{retire_confirmation(0);return;}')
    if (!direct && !retire) {cursor=at+3;continue}
    // These fixtures issue local-work only. Other-purpose branches are conserved.
    if(at>=body.indexOf('}else if(workspace){')&&at<body.indexOf('WNDCLASSW cls{}')){cursor=pos;continue}
    const condition=body.slice(at+3,pos-1)
    // Original non-local purpose guards cannot be selected by these two local
    // callers. Leave them exact and reserve observation points for controllers.
    const nonLocal = condition.startsWith('!keys(frame,{L"type",L"request_id"') || condition.startsWith('workspace&&') || condition.startsWith('resource&&') || condition.startsWith('request==requests.end()')
    if(nonLocal){cursor=pos;continue}
    const observed=trace(condition),refusal=site('refusal',condition)
    const action=direct?'return;':'retire_confirmation(0);return;'
    const after=`if(${observed}){cf772(${refusal});${action}}`
    body=body.slice(0,at)+after+body.slice(pos+(direct?'return;'.length:'{retire_confirmation(0);return;}'.length));cursor=at+after.length
  }
  body=body.replace(begin,begin+'if(cf772_round<9)++cf772_round;cf772(1);')
  for(const [old,after] of [
    ['auto bytes=utf8(full);','cf772(3);auto bytes=utf8(full);'],
    ['std::wstring actual;static wchar_t const digits[]','cf772(4);std::wstring actual;static wchar_t const digits[]'],
    ['confirmation->window=panel;','confirmation->window=panel;cf772(5);'],
    ['ShowWindow(panel,SW_SHOW);SetForegroundWindow(panel);SetFocus(cancel);','ShowWindow(panel,SW_SHOW);SetForegroundWindow(panel);SetFocus(cancel);cf772(6);'],
  ]){if(body.split(old).length!==2)throw Error('D476_CONFIRMATION_OBSERVATION_STAGE');body=body.replace(old,after)}
  replace(before,body)
  replace('if(type==L"desktop.confirmation.request"){begin_confirmation(flat(body));return;}','if(type==L"desktop.confirmation.request"){cf772(2,cf772_round<8?cf772_round+1:9);begin_confirmation(flat(body));return;}')
  replace('if(!confirmation)return;auto value=std::move(confirmation);','if(!confirmation)return;cf772(7);auto value=std::move(confirmation);')
  const retirement='decision>=0&&ready&&value->epoch==epoch&&value->generation==generation&&wall_ms()<value->deadline'
  const tracedRetirement=trace(retirement),conditionSite=site('retirement-condition',retirement)
  replace('if('+retirement+')',`if(cf772_test(${conditionSite},static_cast<bool>(${tracedRetirement})))`)
  const send='if(value->purpose==L"resource"||value->purpose==L"workspace"||value->purpose==L"local-work")put(result,L"purpose",value->purpose);send(result);'
  replace(send,send.slice(0,-'send(result);'.length)+'cf772(8);send(result);cf772(9);')
  // Refine the original unshipped confirmation controller's guards too. No
  // native event, button action, owner check or original failure is replaced.
  const controllerName=role==='LOCAL'?'D476LocalAcceptance':'D705TerminalAcceptance'
  const controllerStart=`void ${controllerName}::confirmation(Desktop& h){`
  const controllerAt=source.indexOf(controllerStart)
  if(controllerAt<0||source.indexOf(controllerStart,controllerAt+1)>=0)throw Error('D476_CONFIRMATION_OBSERVATION_CONTROLLER')
  const opening=controllerAt+controllerStart.length-1;let closing=-1
  scan(source.slice(opening),(i,depth)=>{if(depth===0){closing=opening+i+1;return false}})
  if(closing<0)throw Error('D476_CONFIRMATION_OBSERVATION_CONTROLLER')
  const controllerBefore=source.slice(controllerAt,closing);let controller=controllerBefore,position=0
  while(true){
    const at=controller.indexOf('if(',position);if(at<0)break
    let pos=-1;scan(controller.slice(at+2),(i,depth)=>{if(depth===0){pos=at+2+i+1;return false}})
    if(pos<0)throw Error('D476_CONFIRMATION_OBSERVATION_CONTROLLER')
    const condition=controller.slice(at+3,pos-1),tail=controller.slice(pos)
    const refused=tail.startsWith('{failure(h,')||tail.startsWith('{(observe(h,L"D476_LOCAL_FIRST_W_')
    const observed=trace(condition,'h.'),after=`if(${observed})`+(refused?`{h.cf772(${site('controller-refusal',condition)});`:'')
    controller=controller.slice(0,at)+after+controller.slice(pos+(refused?1:0));position=at+after.length
  }
  replace(controllerBefore,controller)
  let inverse=source
  for(const [old,after] of [...patches].reverse()){if(inverse.split(after).length!==2)throw Error('D476_CONFIRMATION_OBSERVATION_INVERSE');inverse=inverse.replace(after,old)}
  if(inverse!==original)throw Error('D476_CONFIRMATION_OBSERVATION_DRIFT')
  return {source,inverse,sites}
}
