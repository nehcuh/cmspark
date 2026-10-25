// Unshipped #773 inheritance-only observations. Production source is never rewritten.
export const bootstrapObservationSites773 = Object.freeze([
  'preConsume', 'parentCleared', 'sentinelChecker', 'descendantChecker',
  'CreateCoreWebView2EnvironmentWithOptions', 'environmentCallback', 'CreateCoreWebView2Controller', 'controllerCallback',
  'get_CoreWebView2', 'get_Settings', 'put_AreDevToolsEnabled', 'put_AreDefaultContextMenusEnabled',
  'put_AreDefaultScriptDialogsEnabled', 'put_IsStatusBarEnabled', 'put_IsWebMessageEnabled',
  'add_NavigationStarting', 'add_FrameNavigationStarting', 'add_NewWindowRequested', 'add_PermissionRequested',
  'downloadsQueryInterface', 'add_DownloadStarting', 'AddWebResourceRequestedFilter', 'add_WebResourceRequested',
  'add_NavigationCompleted', 'add_WebMessageReceived', 'acceptanceAttach', 'GetClientRect', 'put_Bounds', 'Navigate', 'resourceCallback',
])
const declarations = `
 // #773 fixed first-eight-per-site observations; native clock is process-first-hook only.
 struct ObRow773 { unsigned point,ordinal,edge,bucket,code,present; };
 inline static ObRow773 obRows773[192]{};
 inline static bool obSeen773[31][9][3]{};
 inline static unsigned obOrdinals773[31]{},obCount773=0,obSent773=0;
 inline static bool obStarted773=false;
 inline static ULONGLONG obStart773=0;
 inline static Desktop* obHost773=nullptr;
 static unsigned obBegin773(unsigned);
 static void obRecord773(unsigned,unsigned,unsigned,unsigned,unsigned);
 static void obFlush773();
 public:
 struct ObScope773 { unsigned point,ordinal; explicit ObScope773(unsigned p):point(p),ordinal(obBegin773(p)){} ~ObScope773(){obRecord773(point,ordinal,1,0,2);} };
 template<class F> static auto obApi773(unsigned point,F call){unsigned ordinal=obBegin773(point);auto value=call();obRecord773(point,ordinal,1,static_cast<unsigned>(value),2);return value;}
 template<class F> static auto obMeasure773(unsigned point,F call){unsigned ordinal=obBegin773(point);auto value=call();obRecord773(point,ordinal,1,0,2);return value;}
 static void obCallback773(unsigned point,HRESULT code,bool present){unsigned ordinal=obBegin773(point);obRecord773(point,ordinal,2,static_cast<unsigned>(code),present?1:0);}
 private:
`;
const implementation = `
// #773 unshipped inheritance source; missing observations never replace original success/failure.
unsigned D480Acceptance::obBegin773(unsigned point){
 if(point<1||point>30)return 0;
 unsigned ordinal=++obOrdinals773[point];
 obRecord773(point,ordinal,0,0,2);return ordinal;
}
void D480Acceptance::obRecord773(unsigned point,unsigned ordinal,unsigned edge,unsigned code,unsigned present){
 try{
  if(point<1||point>30||ordinal<1||ordinal>8||edge>2||present>2||obCount773>=192||obSeen773[point][ordinal][edge])return;
  obSeen773[point][ordinal][edge]=true;
  if(!obStarted773){obStart773=GetTickCount64();obStarted773=true;}
  auto elapsed=GetTickCount64()-obStart773;
  unsigned bucket=elapsed<90000?static_cast<unsigned>(elapsed/250):361;
  ObRow773 row{point,ordinal,edge,bucket,code,present};obRows773[obCount773++]=row;
  obFlush773();
 }catch(...){/* Diagnostic failure cannot replace original native behavior. */}
}
void D480Acceptance::obFlush773(){
 try{
 if(!obHost773)return;
 while(obSent773<obCount773){auto const& row=obRows773[obSent773++];
  emit(*obHost773,L"BOOT_"+std::to_wstring(row.point)+L"_"+std::to_wstring(row.ordinal)+L"_"+std::to_wstring(row.edge)+L"_"+std::to_wstring(row.bucket)+L"_"+std::to_wstring(row.code)+L"_"+std::to_wstring(row.present));
 }
 }catch(...){/* No diagnostic formatter or send failure may escape into original auth. */}
}
`;
function one(text, needle) {
  const at = text.indexOf(needle)
  if (at < 0 || text.indexOf(needle, at + needle.length) >= 0) throw Error('BOOT773_ANCHOR')
  return at
}
// Scan one actual C++ expression/body, preserving every original byte, operand and callback.
function balanced(text, start, open, close) {
  if (text[start] !== open) throw Error('BOOT773_BALANCE')
  let depth=0, quote='', line=false, block=false
  for (let i=start;i<text.length;i++) {
    const c=text[i],next=text[i+1]
    if(line){if(c==='\n')line=false;continue}
    if(block){if(c==='*'&&next==='/'){block=false;i++}continue}
    if(quote){if(c==='\\'){i++;continue}if(c===quote)quote='';continue}
    if(c==='/'&&next==='/'){line=true;i++;continue}
    if(c==='/'&&next==='*'){block=true;i++;continue}
    if(c==='"'||c==="'"){quote=c;continue}
    if(c===open)depth++
    if(c===close&&--depth===0)return i+1
  }
  throw Error('BOOT773_BALANCE')
}
export function desktopBootstrapObservationFixture773(original) {
  if(typeof original!=='string'||!original.length||original.length>2*1024*1024||original.includes('obRecord773'))throw Error('BOOT773_SOURCE')
  let source=original;const patches=[]
  const patchAt=(at,before,after)=>{if(source.slice(at,at+before.length)!==before)throw Error('BOOT773_SPAN');source=source.slice(0,at)+after+source.slice(at+before.length);patches.push([at,before,after])}
  const patch=(before,after)=>patchAt(one(source,before),before,after)
  patch('class D480Acceptance {','class D480Acceptance {'+declarations)
  const scope=(anchor,point)=>{one(source,anchor);patch(anchor,anchor+`D480Acceptance::ObScope773 obScope773(${point});`)}
  scope('void D480Acceptance::preConsume(HANDLE input){',1)
  scope('void D480Acceptance::parentCleared(HANDLE parent){',2)
  scope('void D480Acceptance::attach(Desktop& h){',26)
  patch('CheckerResult result=inheritedChecker(receiver,L"--sentinel");','CheckerResult result=obMeasure773(3,[&](){return inheritedChecker(receiver,L"--sentinel");});')
  patch('result=inheritedChecker(receiver,L"--descendant");','result=obMeasure773(4,[&](){return inheritedChecker(receiver,L"--descendant");});')
  patch('void D480Acceptance::auth(Desktop& h){','void D480Acceptance::auth(Desktop& h){obHost773=&h;obFlush773();')
  // Use exact original callback values. Guards remain byte-for-byte and still own decisions.
  patch('DESKTOP_TEST_NOTE(env_callback)if(FAILED(hr)||!env)', 'DESKTOP_TEST_NOTE(env_callback)D480Acceptance::obCallback773(6,hr,env!=nullptr);if(FAILED(hr)||!env)')
  patch('DESKTOP_TEST_NOTE(controller_callback)if(FAILED(code)||!host)', 'DESKTOP_TEST_NOTE(controller_callback)D480Acceptance::obCallback773(8,code,host!=nullptr);if(FAILED(code)||!host)')
  const calls=[
    ['host->get_CoreWebView2',9],['web->get_Settings',10],['settings->put_AreDevToolsEnabled',11],
    ['settings->put_AreDefaultContextMenusEnabled',12],['settings->put_AreDefaultScriptDialogsEnabled',13],
    ['settings->put_IsStatusBarEnabled',14],['settings->put_IsWebMessageEnabled',15],
    ['web->add_NavigationStarting',16],['web->add_FrameNavigationStarting',17],['web->add_NewWindowRequested',18],
    ['web->add_PermissionRequested',19],['web.As',20],['downloads->add_DownloadStarting',21],
    ['web->AddWebResourceRequestedFilter',22],['web->add_WebResourceRequested',23],
    ['web->add_NavigationCompleted',24],['web->add_WebMessageReceived',25],
    ['GetClientRect',27],['controller->put_Bounds',28],['web->Navigate',29],
    ['env->CreateCoreWebView2Controller',7],['CreateCoreWebView2EnvironmentWithOptions',5],
  ]
  for(const [callee,point]of calls){
    const begin=one(source,'void build_webview(){'),finish=source.indexOf('\n std::wstring profile;',begin)
    if(finish<0)throw Error('BOOT773_BUILD_SCOPE')
    const body=source.slice(begin,finish),at=one(body,callee+'('),open=at+callee.length,end=balanced(body,open,'(',')')
    const expression=body.slice(at,end)
    // The complete expression is restored by inverse; original return type is auto-preserved.
    patchAt(begin+at,expression,`D480Acceptance::obApi773(${point},[&](){return ${expression};})`)
  }
  // Observe the first eight actual resource callback instances independently.
  const marker='[this](ICoreWebView2*,ICoreWebView2WebResourceRequestedEventArgs* args)->HRESULT{'
  patch(marker,marker+'D480Acceptance::ObScope773 resourceScope773(30);')
  source+=implementation
  let inverse=source.slice(0,-implementation.length)
  for(const [at,before,after]of [...patches].reverse()){if(inverse.slice(at,at+after.length)!==after)throw Error('BOOT773_INVERSE_SPAN');inverse=inverse.slice(0,at)+before+inverse.slice(at+after.length)}
  if(inverse!==original)throw Error('BOOT773_INVERSE')
  return{source,inverse,sites:bootstrapObservationSites773}
}
