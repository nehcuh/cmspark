// Unshipped MCP-only, one native worker, one fixed-file sample. No WS delivery.
#include <cstddef>
class D476Snapshot825 {
 public:
 static constexpr uint32_t magic=0x82577301u,words=32,bytes=words*4;
 enum Flag:uint32_t { EnvApi=1,EnvLeave=2,ControllerApi=4,WrapperLeave=8,ControllerEntry=16,OuterDispatch=32,Armed=64,EnvEntry=128,ControllerLeave=256,SendReturned=512 };
 struct Shared { std::atomic<uint32_t> version;std::atomic<uint32_t> value[10];Shared() noexcept:version(0),value{}{} };
 static_assert(std::atomic<uint32_t>::is_always_lock_free,"MCP snapshot UI hooks must be lock-free");
 static_assert(offsetof(Shared,value)==4 && sizeof(std::atomic<uint32_t>)==4,"Natural uint32 snapshot layout required");
 inline static Shared state;
 inline static std::atomic<bool> started{false};
 inline static thread_local uint32_t kind=0,site=0,edge=0;
 template<class F> static void publish(F change) noexcept {state.version.fetch_add(1);change();state.version.fetch_add(1);}
 static void flags(uint32_t bit) noexcept {publish([&](){state.value[0].fetch_or(bit);});}
 static void api(uint32_t point,uint32_t code) noexcept {
  if(point!=5&&point!=7)return;
  publish([&](){state.value[point==5?1:2].store(code);state.value[0].fetch_or(point==5?EnvApi:ControllerApi|Armed);});
 }
 static void wrapper(uint32_t point) noexcept {if(point==5)flags(WrapperLeave);}
 struct CallbackScope {
  uint32_t point;
  CallbackScope(uint32_t p,HRESULT code,bool present):point(p){
   publish([&](){state.value[0].fetch_or(p==8?ControllerEntry:EnvEntry);if(p==8){state.value[3].store(static_cast<uint32_t>(code));state.value[4].store(present?1:0);}});
  }
  ~CallbackScope(){flags(point==8?ControllerLeave:EnvLeave);}
 };
 static void sendStage(uint32_t stage,uint32_t code=0) noexcept {
  if(!kind)return;
  publish([&](){state.value[5].store(kind);state.value[6].store(site);state.value[7].store(edge);state.value[8].store(stage);state.value[9].store(code);if(stage==1)state.value[0].fetch_and(~SendReturned);if(stage==5)state.value[0].fetch_or(SendReturned);});
 }
 struct Observation {
  uint32_t oldKind,oldSite,oldEdge;
  Observation(uint32_t k,uint32_t s,uint32_t e=0):oldKind(kind),oldSite(site),oldEdge(edge){kind=k;site=s;edge=e;sendStage(1);}
  ~Observation(){sendStage(6,state.value[9].load());kind=oldKind;site=oldSite;edge=oldEdge;}
 };
 // Called only after the real outer run-loop DispatchMessageW returns.
 static void outerDispatch() noexcept {auto f=state.value[0].load();if((f&Armed)&&!(f&OuterDispatch))flags(OuterDispatch);}
 // Exactly one stable read. An updating UI is UNKNOWN, never spun on.
 static bool capture(uint32_t* out) noexcept {
  auto before=state.version.load();if(before&1)return false;
  for(unsigned i=0;i<10;i++)out[12+i]=state.value[i].load();
  auto after=state.version.load();if(before!=after||(after&1))return false;
  out[11]=after;return true;
 }
 static uint64_t now() noexcept {return static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());}
 static uint64_t number(uint32_t const* data,unsigned at) noexcept {return uint64_t(data[at])|(uint64_t(data[at+1])<<32);}
 static void number(uint32_t* data,unsigned at,uint64_t value) noexcept {data[at]=static_cast<uint32_t>(value);data[at+1]=static_cast<uint32_t>(value>>32);}
 static bool regular(BY_HANDLE_FILE_INFORMATION const& i) noexcept {return i.nNumberOfLinks==1&&!(i.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))&&!i.nFileSizeHigh&&i.nFileSizeLow==bytes;}
 static bool same(BY_HANDLE_FILE_INFORMATION const& a,BY_HANDLE_FILE_INFORMATION const& b) noexcept {return regular(a)&&regular(b)&&a.dwVolumeSerialNumber==b.dwVolumeSerialNumber&&a.nFileIndexHigh==b.nFileIndexHigh&&a.nFileIndexLow==b.nFileIndexLow;}
 static void worker() noexcept {
  HANDLE file=INVALID_HANDLE_VALUE;
  try{
   wchar_t module[32768];DWORD count=GetModuleFileNameW(nullptr,module,32768);if(!count||count>=32768)return;
   std::wstring path(module,count);auto slash=path.find_last_of(L"\\/");if(slash==std::wstring::npos)return;path.resize(slash+1);path+=L"mcp-startup-825.bin";
   file=CreateFileW(path.c_str(),GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,nullptr,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,nullptr);
   if(file==INVALID_HANDLE_VALUE)return;
   BY_HANDLE_FILE_INFORMATION before{},after{};uint32_t data[words]{};DWORD got=0;
   bool valid=GetFileInformationByHandle(file,&before)&&regular(before)&&ReadFile(file,data,bytes,&got,nullptr)&&got==bytes&&GetFileInformationByHandle(file,&after)&&same(before,after);
   if(valid)valid=data[0]==magic&&data[1]==1&&data[2]==bytes&&data[3]!=0;
   for(unsigned i=8;valid&&i<words;i++)valid=data[i]==0;
   auto target=number(data,4),deadline=number(data,6),clock=now();
   valid=valid&&target>clock&&deadline>target&&deadline-target==1500&&deadline-clock<=20000;
   if(valid){
    // No UI wait, retry, polling, timer callback or additional cleanup budget.
    std::this_thread::sleep_for(std::chrono::milliseconds(target-clock));
    auto sampled=now();valid=sampled>=target&&sampled-target<=250&&sampled<deadline&&capture(data);
    if(valid){
     data[8]=1;number(data,9,sampled);number(data,22,now());data[31]=0;
     LARGE_INTEGER offset{};DWORD wrote=0;
     valid=GetFileInformationByHandle(file,&after)&&same(before,after)&&SetFilePointerEx(file,offset,nullptr,FILE_BEGIN)&&WriteFile(file,data,bytes,&wrote,nullptr)&&wrote==bytes&&FlushFileBuffers(file);
     // Commit only after the complete payload, and only inside the old budget.
     if(valid&&now()<deadline){offset.QuadPart=bytes-4;uint32_t commit=magic^data[3];wrote=0;if(SetFilePointerEx(file,offset,nullptr,FILE_BEGIN))WriteFile(file,&commit,4,&wrote,nullptr);}
    }
   }
  }catch(...){/* Observations never change the original native result. */}
  if(file!=INVALID_HANDLE_VALUE)CloseHandle(file);
 }
 static void start() noexcept {if(started.exchange(true))return;try{std::thread(worker).detach();}catch(...){}}
};
