// Test-only, byte-reversible instrumentation. Normal production CPP is never written.
import assert from 'node:assert/strict'

export const probe572 = Object.freeze({ version: 1, capacity: 5, rowWords: 6, headerWords: 5,
  exportName: 'CUiProbeRead572', dll: 'computer-uia-native-probe-572.dll' })
const tag = 'UIA572_NATIVE_PROBE'
function decode(source) {
  assert.ok(Buffer.isBuffer(source))
  const text = source.toString('utf8')
  assert.ok(Buffer.from(text, 'utf8').equals(source), 'UIA572_PROBE_UTF8')
  return text
}
function one(text, anchor) {
  const at = text.indexOf(anchor)
  assert.ok(at >= 0 && text.indexOf(anchor, at + anchor.length) < 0, 'UIA572_PROBE_UNIQUE_ANCHOR')
  return at
}
export function stripNativeProbe572(source) {
  let text = decode(source)
  const names = [...text.matchAll(/\/\*UIA572_NATIVE_PROBE_(\d+)_BEGIN\*\//g)].map(match => match[1])
  assert.equal(new Set(names).size, names.length, 'UIA572_PROBE_DUPLICATE_MARKER')
  assert.equal(names.length, 17, 'UIA572_PROBE_MARKER_COUNT')
  for (let i = 0; i < names.length; i++) {
    assert.ok(names.includes(String(i)), 'UIA572_PROBE_MARKER_SEQUENCE')
    const begin = `/*${tag}_${i}_BEGIN*/`, end = `/*${tag}_${i}_END*/`
    const first = one(text, begin), last = one(text, end)
    assert.ok(last > first, 'UIA572_PROBE_MARKER_ORDER')
    text = text.slice(0, first) + text.slice(last + end.length)
  }
  assert.ok(!text.includes(tag), 'UIA572_PROBE_UNOWNED_MARKER')
  return Buffer.from(text, 'utf8')
}
export function generateNativeProbe572(source) {
  const text = decode(source)
  assert.ok(!text.includes(tag), 'UIA572_PROBE_ALREADY_INSTRUMENTED')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const inserts = []
  const add = (anchor, body, after = false) => inserts.push({ at: one(text, anchor) + (after ? anchor.length : 0), body })
  add('#include <utility>', '\n#include <atomic>\n#include <cstring>', true)
  add('int32_t boundary(Request const& r){', String.raw`
// ABI words: version,count,overflow,rowWords,completed; then count rows of six int32.
// Row: phase(1..5), foreground(0 unknown/1 none/2 known), entryEqual, rootEqual,
// getterSucceeded, readback(0 unknown/1 FALSE/2 TRUE). No pointer/identifier escapes.
struct Probe572 {
  int32_t words[35]{}; HWND entry=nullptr,root=nullptr;
  IUIAutomation2* client=nullptr;
};
static_assert(sizeof(int32_t)==4 && 5+5*6==35,"probe ABI width/capacity");
Probe572 probe572;
std::atomic<int32_t> probeState572{0};
thread_local Probe572* activeProbe572=nullptr;
struct ProbeScope572 {
  bool owned=false;
  explicit ProbeScope572(HWND root) noexcept {
    int32_t expected=0;
    owned=probeState572.compare_exchange_strong(expected,1);
    if(owned){probe572.root=root;probe572.entry=GetForegroundWindow();activeProbe572=&probe572;
      probe572.words[0]=1;probe572.words[3]=6;}
  }
  ~ProbeScope572(){if(owned){activeProbe572=nullptr;probe572.words[4]=1;
    probeState572.store(2,std::memory_order_release);}}
};
void probeStage572(int32_t phase) noexcept {
  Probe572* p=activeProbe572;if(!p)return;
  int32_t count=p->words[1];if(phase<=count)return;
  if(count>=5||phase!=count+1){p->words[2]=1;return;}
  int32_t* row=&p->words[5+count*6];row[0]=phase;
  HWND foreground=GetForegroundWindow();
  row[1]=foreground?2:1;
  row[2]=(foreground&&p->entry&&foreground==p->entry)?1:0;
  row[3]=(foreground&&foreground==p->root)?1:0;
  BOOL focus=TRUE;
  if(p->client){HRESULT hr=p->client->get_AutoSetFocus(&focus);
    row[4]=SUCCEEDED(hr)?1:0;
    row[5]=SUCCEEDED(hr)?(focus==FALSE?1:focus==TRUE?2:0):0;}
  p->words[1]=count+1;
}
`)
  add('  // Obtain each pattern from the element resolved by this same no-focus client.', '\n  probeStage572(2);\n')
  add('  if(hr==UIA_E_NOTSUPPORTED || (SUCCEEDED(hr)&&!out))return UNSUPPORTED;', '  probeStage572(3);\n')
  for (const action of ['Invoke()', 'SetValue(value.p)', 'Select()', 'Toggle()', 'Scroll(h,v)']) {
    const anchor = `hr=p->${action};`
    add(anchor, 'probeStage572(4);')
    add(anchor, 'probeStage572(5);', true)
  }
  add('  Apartment apartment;if(FAILED(apartment.hr))return CLIENT_UNAVAILABLE;', '  ProbeScope572 probeScope572(r.root);\n')
  add('  int32_t status=boundary(r);if(status!=OK)return status;', '\n  if(activeProbe572)activeProbe572->client=client.Get();\n  probeStage572(1);\n')
  // Explicit fixed-width export. It cannot observe a worker still running; acquire pairs
  // with the scope destructor after its original COM locals/Apartment were destroyed.
  const exportBody = String.raw`
extern "C" __declspec(dllexport) int32_t WINAPI CUiProbeRead572(int32_t* output,int32_t capacity) noexcept {
  if(!output||capacity!=35||probeState572.load(std::memory_order_acquire)!=2)return 0;
  std::memcpy(output,probe572.words,sizeof(probe572.words));
  return 35;
}
`
  inserts.push({ at: text.length, body: exportBody })
  assert.equal(inserts.length, 17)
  // There are 17 insertions: explicit stable IDs prevent silent duplicate/missing strips.
  let output = text
  for (const [index, insertion] of inserts.map((value, index) => [index, value]).sort((a,b) => b[1].at-a[1].at)) {
    output = output.slice(0,insertion.at) + `/*${tag}_${index}_BEGIN*/` + insertion.body.replace(/\n/g,eol) + `/*${tag}_${index}_END*/` + output.slice(insertion.at)
  }
  const result = Buffer.from(output, 'utf8')
  assert.ok(stripNativeProbe572(result).equals(source), 'UIA572_PROBE_WHOLE_INVERSE')
  return result
}
export function projectNativeProbe572(words) {
  const bad = { schema: 1, valid: false, complete: false, overflow: false, rows: [] }
  if (!Array.isArray(words) || words.length !== 35 || !words.every(Number.isInteger) || words.some(x => x < -2147483648 || x > 2147483647)) return bad
  const [version,count,overflow,width,completed] = words
  if (version !== 1 || count < 0 || count > 5 || ![0,1].includes(overflow) || width !== 6 || completed !== 1) return bad
  if (overflow) return { ...bad, overflow: true }
  const rows=[]
  for(let i=0;i<count;i++) {
    const [phase,foreground,entryForeground,rootForeground,getterSucceeded,readback] = words.slice(5+i*6,11+i*6)
    if(![1,2,3,4,5].includes(phase)||![0,1,2].includes(foreground)||![0,1].includes(entryForeground)||![0,1].includes(rootForeground)||![0,1].includes(getterSucceeded)||![0,1,2].includes(readback))return bad
    if((foreground!==2&&(entryForeground||rootForeground))||(!getterSucceeded&&readback!==0))return bad
    rows.push({phase,foreground,entryForeground:!!entryForeground,rootForeground:!!rootForeground,getterSucceeded:!!getterSucceeded,readback})
  }
  if(words.slice(5+count*6).some(value=>value!==0))return bad
  // Each fixed stage is sampled once. For repeated scroll, stages 4/5 describe its first method.
  const phases=rows.map(row=>row.phase)
  if(phases.some((phase,i)=>i===0?phase!==1:i===1?phase!==2:phase!==i+1))return bad
  return {schema:1,valid:true,complete:phases.length>=5&&phases.at(-1)===5,overflow:!!overflow,rows}
}

// Diagnostic copy only: marshal the fixed memory export after Act has returned.
export function stripNativeProbeScript572(source) {
  let text=decode(source)
  for(let i=0;i<3;i++){
    const begin=`<#UIA572_NATIVE_SCRIPT_${i}_BEGIN#>`,end=`<#UIA572_NATIVE_SCRIPT_${i}_END#>`
    // DECL uses C# comments because this insertion is inside Add-Type source.
    const a=i===0?`/*UIA572_NATIVE_SCRIPT_${i}_BEGIN*/`:begin
    const b=i===0?`/*UIA572_NATIVE_SCRIPT_${i}_END*/`:end
    const first=one(text,a),last=one(text,b)
    assert.ok(last>first)
    text=text.slice(0,first)+text.slice(last+b.length)
  }
  assert.ok(!text.includes('UIA572_NATIVE_SCRIPT_'))
  return Buffer.from(text,'utf8')
}
export function generateNativeProbeScript572(source) {
  const text=decode(source)
  assert.ok(!text.includes('UIA572_NATIVE_SCRIPT_'))
  const eol=text.includes('\r\n')?'\r\n':'\n'
  const end='int depth, int nodes, [MarshalAs(UnmanagedType.LPWStr)] string stop, int stopLength);'
  const caught='  } catch { Fail "UIA_TERMINAL" "UIA_PATTERN_UNAVAILABLE" 6 }\n}' .replace(/\n/g,eol)
  const result='  ok = $true; mode = $used; name = $hit.name; controlType = $hit.controlType'
  const declaration=String.raw`
    [DefaultDllImportSearchPaths(DllImportSearchPath.System32)]
    [DllImport(@"$literal", EntryPoint="CUiProbeRead572", ExactSpelling=true, CallingConvention=CallingConvention.Winapi)]
    public static extern int ReadProbe([Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex=1)] int[] words, int capacity);
`
  const finallyBody=String.raw` finally {
    try {
      [int[]]$probeWords572 = [int[]]::new(35)
      if ([CU.NoFocus]::ReadProbe($probeWords572, 35) -eq 35) { $script:probeWords572 = $probeWords572 }
    } catch { $script:probeWords572 = $null }
  }`
  const inserts=[
    {at:one(text,end)+end.length,body:`/*UIA572_NATIVE_SCRIPT_0_BEGIN*/${declaration.replace(/\n/g,eol)}/*UIA572_NATIVE_SCRIPT_0_END*/`},
    {at:one(text,caught)+caught.length-1-eol.length,body:`<#UIA572_NATIVE_SCRIPT_1_BEGIN#>${finallyBody.replace(/\n/g,eol)}<#UIA572_NATIVE_SCRIPT_1_END#>`},
    {at:one(text,result),body:`<#UIA572_NATIVE_SCRIPT_2_BEGIN#>  probeWords572 = $script:probeWords572${eol}<#UIA572_NATIVE_SCRIPT_2_END#>`},
  ]
  let output=text
  for(const insertion of inserts.sort((a,b)=>b.at-a.at))output=output.slice(0,insertion.at)+insertion.body+output.slice(insertion.at)
  const generated=Buffer.from(output,'utf8')
  assert.ok(stripNativeProbeScript572(generated).equals(source),'UIA572_PROBE_PS_WHOLE_INVERSE')
  return generated
}
export function nativeProbeArgs572(args,dll) {
  assert.ok(Array.isArray(args)&&args.every(value=>typeof value==='string'))
  const indexes=args.flatMap((value,index)=>value==='-NoFocusLibrary'?[index]:[])
  assert.equal(indexes.length,1,'UIA572_PROBE_LIBRARY_ARG')
  assert.ok(indexes[0]+1<args.length&&typeof dll==='string'&&dll.length>0&&!dll.includes('\0'))
  const output=[...args];output[indexes[0]+1]=dll;return output
}
