// #572: SDK-typed, request-local UIA client. No focus restoration or input fallback.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <objbase.h>
#include <oleauto.h>
#include <UIAutomation.h>
#include <wrl/client.h>
#include <cstdint>
#include <string>
#include <vector>
#include <deque>
#include <thread>
#include <utility>

using Microsoft::WRL::ComPtr;
namespace {
enum Result : int32_t { OK=0, UNSUPPORTED=1, STOPPED=2, WINDOW_GONE=3,
  ELEMENT_GONE=4, MISMATCH=5, METHOD_FAILED=6, CLIENT_UNAVAILABLE=7 };
struct Request {
  HWND root; DWORD rootPid, selectedPid; int32_t mode, direction, count, depth, nodes, controlType;
  std::vector<int32_t> runtime; std::wstring automationId, value, stop;
};
struct Apartment {
  HRESULT hr=CoInitializeEx(nullptr,COINIT_MULTITHREADED);
  ~Apartment(){ if(SUCCEEDED(hr))CoUninitialize(); }
};
struct Array { SAFEARRAY* p=nullptr; ~Array(){if(p)SafeArrayDestroy(p);} };
struct Text { BSTR p=nullptr; ~Text(){if(p)SysFreeString(p);} };
int32_t boundary(Request const& r){
  if(!r.stop.empty()){
    DWORD attributes=GetFileAttributesW(r.stop.c_str());
    if(attributes!=INVALID_FILE_ATTRIBUTES)return STOPPED;
    DWORD error=GetLastError();
    if(error!=ERROR_FILE_NOT_FOUND && error!=ERROR_PATH_NOT_FOUND)return STOPPED;
  }
  DWORD pid=0;
  if(!IsWindow(r.root)||!GetWindowThreadProcessId(r.root,&pid))return WINDOW_GONE;
  return pid==r.rootPid?OK:MISMATCH;
}
bool runtimeEquals(IUIAutomationElement* el,std::vector<int32_t> const& expected){
  Array id;
  if(FAILED(el->GetRuntimeId(&id.p))||!id.p||SafeArrayGetDim(id.p)!=1)return false;
  VARTYPE type=VT_EMPTY;LONG low=0,high=-1;
  if(FAILED(SafeArrayGetVartype(id.p,&type))||type!=VT_I4 ||
     FAILED(SafeArrayGetLBound(id.p,1,&low))||FAILED(SafeArrayGetUBound(id.p,1,&high)) ||
     static_cast<int64_t>(high)-low+1!=static_cast<int64_t>(expected.size()))return false;
  LONG* data=nullptr;
  if(FAILED(SafeArrayAccessData(id.p,reinterpret_cast<void**>(&data))))return false;
  bool equal=data!=nullptr;
  for(size_t i=0;equal&&i<expected.size();++i)equal=data[i]==expected[i];
  if(FAILED(SafeArrayUnaccessData(id.p)))return false;
  return equal;
}
int32_t identity(Request const& r,IUIAutomationElement* root,IUIAutomationElement* el){
  int pid=0;CONTROLTYPEID type=0;Text aid;BOOL off=TRUE;RECT box{},window{};
  if(FAILED(el->get_CurrentProcessId(&pid))||FAILED(el->get_CurrentControlType(&type))||
     FAILED(el->get_CurrentAutomationId(&aid.p)))return ELEMENT_GONE;
  if(static_cast<DWORD>(pid)!=r.selectedPid||type!=r.controlType||
     std::wstring(aid.p?aid.p:L"",aid.p?SysStringLen(aid.p):0)!=r.automationId)return MISMATCH;
  if(!runtimeEquals(el,r.runtime))return MISMATCH;
  if(FAILED(el->get_CurrentIsOffscreen(&off))||off ||
     FAILED(el->get_CurrentBoundingRectangle(&box))||box.right<=box.left||box.bottom<=box.top)return ELEMENT_GONE;
  double area=(double(box.right)-box.left)*(double(box.bottom)-box.top);
  if(FAILED(root->get_CurrentBoundingRectangle(&window)))return ELEMENT_GONE;
  double windowArea=(double(window.right)-window.left)*(double(window.bottom)-window.top);
  if(area>150000.0||(windowArea>0.0&&area/windowArea>0.3))return ELEMENT_GONE;
  return boundary(r);
}
template<class T> int32_t pattern(IUIAutomationElement* el,PATTERNID id,ComPtr<T>& out){
  HRESULT hr=el->GetCurrentPatternAs(id,__uuidof(T),reinterpret_cast<void**>(out.GetAddressOf()));
  if(hr==UIA_E_NOTSUPPORTED || (SUCCEEDED(hr)&&!out))return UNSUPPORTED;
  return FAILED(hr)?METHOD_FAILED:OK;
}
int32_t perform(Request const& r,IUIAutomationElement* root,IUIAutomationElement* el){
  // Obtain each pattern from the element resolved by this same no-focus client.
  int32_t status=OK;HRESULT hr=E_FAIL;
  auto ready=[&](){return identity(r,root,el);};
  if(r.mode==1){ComPtr<IUIAutomationInvokePattern> p;status=pattern(el,UIA_InvokePatternId,p);
    if(status!=OK)return status;if((status=ready())!=OK)return status;hr=p->Invoke();}
  else if(r.mode==2){ComPtr<IUIAutomationValuePattern> p;status=pattern(el,UIA_ValuePatternId,p);
    if(status!=OK)return status;
    Text value;value.p=SysAllocStringLen(r.value.data(),static_cast<UINT>(r.value.size()));
    if(!value.p)return METHOD_FAILED;
    if((status=ready())!=OK)return status;hr=p->SetValue(value.p);}
  else if(r.mode==3){ComPtr<IUIAutomationSelectionItemPattern> p;status=pattern(el,UIA_SelectionItemPatternId,p);
    if(status!=OK)return status;if((status=ready())!=OK)return status;hr=p->Select();}
  else if(r.mode==4){ComPtr<IUIAutomationTogglePattern> p;status=pattern(el,UIA_TogglePatternId,p);
    if(status!=OK)return status;if((status=ready())!=OK)return status;hr=p->Toggle();}
  else if(r.mode==5){ComPtr<IUIAutomationScrollPattern> p;status=pattern(el,UIA_ScrollPatternId,p);
    if(status!=OK)return status;
    ScrollAmount h=ScrollAmount_NoAmount,v=ScrollAmount_NoAmount;
    if(r.direction==1)v=ScrollAmount_SmallDecrement;
    else if(r.direction==2)v=ScrollAmount_SmallIncrement;
    else if(r.direction==3)h=ScrollAmount_SmallDecrement;
    else h=ScrollAmount_SmallIncrement;
    for(int i=0;i<r.count;++i){if((status=ready())!=OK)return status;hr=p->Scroll(h,v);if(FAILED(hr))return METHOD_FAILED;}}
  return SUCCEEDED(hr)?OK:METHOD_FAILED;
}
int32_t execute(Request const& r){
  Apartment apartment;if(FAILED(apartment.hr))return CLIENT_UNAVAILABLE;
  // Declared after Apartment so every COM object dies before CoUninitialize.
  ComPtr<IUIAutomation2> client;
  if(FAILED(CoCreateInstance(__uuidof(CUIAutomation8),nullptr,CLSCTX_INPROC_SERVER,
      IID_PPV_ARGS(client.GetAddressOf())))||!client)return CLIENT_UNAVAILABLE;
  BOOL autoFocus=TRUE;
  if(FAILED(client->put_AutoSetFocus(FALSE))||FAILED(client->get_AutoSetFocus(&autoFocus))||autoFocus)return CLIENT_UNAVAILABLE;
  int32_t status=boundary(r);if(status!=OK)return status;
  ComPtr<IUIAutomationElement> root;
  if(FAILED(client->ElementFromHandle(r.root,&root))||!root)return WINDOW_GONE;
  ComPtr<IUIAutomationTreeWalker> walker;
  if(FAILED(client->get_ControlViewWalker(&walker))||!walker)return CLIENT_UNAVAILABLE;
  struct Frame {ComPtr<IUIAutomationElement> el;int depth;};
  std::deque<Frame> stack;stack.push_back({root,0});int visited=0;
  while(!stack.empty()){
    Frame current=std::move(stack.back());stack.pop_back();
    if(current.depth>=r.depth)continue;
    if(++visited>r.nodes)break;
    if(visited%128==0 && (status=boundary(r))!=OK)return status;
    if(runtimeEquals(current.el.Get(),r.runtime))return perform(r,root.Get(),current.el.Get());
    // Frames at MaxDepth are never counted by the retained managed DFS.
    // Do not let those ineligible frames evict an older eligible branch.
    if(current.depth+1>=r.depth)continue;
    ComPtr<IUIAutomationElement> child;
    HRESULT hr=walker->GetFirstChildElement(current.el.Get(),&child);
    if(FAILED(hr))return ELEMENT_GONE;
    while(child){
      // Keep the newest pending frames, which the original LIFO walk visits first.
      // Older excess frames cannot be reached within the unchanged visit budget.
      if(stack.size()>=static_cast<size_t>(r.nodes))stack.pop_front();
      stack.push_back({child,current.depth+1});
      ComPtr<IUIAutomationElement> next;
      if(FAILED(walker->GetNextSiblingElement(child.Get(),&next)))return ELEMENT_GONE;
      child=std::move(next);
    }
  }
  return ELEMENT_GONE;
}
bool validString(wchar_t const* p,int32_t n){return n>=0&&(n==0||p!=nullptr);}
}

// All scalar widths and ownership are explicit; no COM/RCW pointer crosses this ABI.
extern "C" __declspec(dllexport) int32_t WINAPI CUiAction(
  HWND root,uint32_t rootPid,uint32_t selectedPid,int32_t mode,
  int32_t const* runtime,int32_t runtimeCount,int32_t controlType,
  wchar_t const* automationId,int32_t automationLength,
  wchar_t const* value,int32_t valueLength,int32_t direction,int32_t count,
  int32_t depth,int32_t nodes,wchar_t const* stop,int32_t stopLength) noexcept {
  try{
    if(!root||!rootPid||!selectedPid||!runtime||runtimeCount<1||runtimeCount>64||
       mode<1||mode>5||direction<1||direction>4||(mode==5&&(count<1||count>50))||depth<1||depth>64||nodes<1||nodes>50000||
       !validString(automationId,automationLength)||!validString(value,valueLength)||!validString(stop,stopLength))return MISMATCH;
    Request r{root,rootPid,selectedPid,mode,direction,count,depth,nodes,controlType,
      std::vector<int32_t>(runtime,runtime+runtimeCount),
      std::wstring(automationId?automationId:L"",automationLength),
      std::wstring(value?value:L"",valueLength),std::wstring(stop?stop:L"",stopLength)};
    if(r.automationId.find(L'\0')!=std::wstring::npos||r.value.find(L'\0')!=std::wstring::npos||r.stop.find(L'\0')!=std::wstring::npos)return MISMATCH;
    int32_t result=METHOD_FAILED;
    // Not DllMain. The existing runPs deadline owns this process and all its threads.
    std::thread worker([&](){try{result=execute(r);}catch(...){result=METHOD_FAILED;}});
    worker.join();return result;
  }catch(...){return METHOD_FAILED;}
}
