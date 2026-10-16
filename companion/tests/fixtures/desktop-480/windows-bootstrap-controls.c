/* Unshipped finite syscall seams over the ACTUAL bootstrap header/launcher.
 * Console controls are not a real named-pipe or Windows handle-table proof. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winternl.h>
#include <bcrypt.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#ifdef DESKTOP_BOOTSTRAP_REFUSAL_ADDON
#include <node_api.h>
static HANDLE captured_process=NULL,protected_pipe=NULL;
static unsigned created_count,peer_queries,peer_injections,target_duplicates,write_bytes;
static BOOL WINAPI control_create(LPCWSTR app,LPWSTR command,LPSECURITY_ATTRIBUTES process,LPSECURITY_ATTRIBUTES thread,BOOL inherit,DWORD flags,LPVOID environment,LPCWSTR cwd,LPSTARTUPINFOW startup,LPPROCESS_INFORMATION pi){
  BOOL ok=CreateProcessW(app,command,process,thread,inherit,flags,environment,cwd,startup,pi);
  if(ok){created_count++;if(!captured_process)(void)DuplicateHandle(GetCurrentProcess(),pi->hProcess,GetCurrentProcess(),&captured_process,SYNCHRONIZE,FALSE,0);}return ok;
}
static HANDLE WINAPI control_pipe(LPCWSTR name,DWORD access,DWORD mode,DWORD count,DWORD output,DWORD input,DWORD timeout,LPSECURITY_ATTRIBUTES security){
  HANDLE result=CreateNamedPipeW(name,access,mode,count,output,input,timeout,security);if(result!=INVALID_HANDLE_VALUE)protected_pipe=result;return result;
}
static BOOL WINAPI control_peer(HANDLE pipe,PULONG pid){
  BOOL ok=GetNamedPipeClientProcessId(pipe,pid);peer_queries++;
  if(ok){*pid^=0x80000000u;peer_injections++;}return ok;
}
static BOOL WINAPI control_duplicate(HANDLE source_process,HANDLE source,HANDLE target_process,LPHANDLE target,DWORD access,BOOL inherit,DWORD options){
  if(target_process!=GetCurrentProcess())target_duplicates++;
  return DuplicateHandle(source_process,source,target_process,target,access,inherit,options);
}
static BOOL WINAPI control_write(HANDLE file,LPCVOID bytes,DWORD count,LPDWORD wrote,LPOVERLAPPED overlapped){
  if(file==protected_pipe)write_bytes+=count;return WriteFile(file,bytes,count,wrote,overlapped);
}
#define CreateProcessW control_create
#define CreateNamedPipeW control_pipe
#define GetNamedPipeClientProcessId control_peer
#define DuplicateHandle control_duplicate
#define WriteFile control_write
#undef NAPI_MODULE
#define NAPI_MODULE(module_name,register_function)
#include "../../../src/desktop/native/launcher.c"
#undef CreateProcessW
#undef CreateNamedPipeW
#undef GetNamedPipeClientProcessId
#undef DuplicateHandle
#undef WriteFile
static void control_cleanup(void* ignored){(void)ignored;if(captured_process){CloseHandle(captured_process);captured_process=NULL;}}
static napi_value inspect_refusal(napi_env env,napi_callback_info info){
  (void)info;napi_value result,value;napi_create_object(env,&result);
  int captured=captured_process!=NULL,settled=captured&&WaitForSingleObject(captured_process,0)==WAIT_OBJECT_0;
  napi_get_boolean(env,captured,&value);napi_set_named_property(env,result,"actualChildCaptured",value);
  napi_get_boolean(env,settled,&value);napi_set_named_property(env,result,"actualChildSettled",value);
  const char* names[]={"createdCount","peerQueryCalls","injectedPeerMismatches","targetParentDuplicates","bootstrapWriteBytes"};
  unsigned counts[]={created_count,peer_queries,peer_injections,target_duplicates,write_bytes};
  for(unsigned i=0;i<5;i++){napi_create_uint32(env,counts[i],&value);napi_set_named_property(env,result,names[i],value);}
  control_cleanup(NULL);return result;
}
NAPI_MODULE_INIT(){napi_value result=init(env,exports),fn;napi_add_env_cleanup_hook(env,control_cleanup,NULL);napi_create_function(env,"inspectRefusal",NAPI_AUTO_LENGTH,inspect_refusal,NULL,&fn);napi_set_named_property(env,result,"inspectRefusal",fn);return result;}

#else
#define H(n) ((HANDLE)(uintptr_t)(n))
typedef struct ReadStep{BOOL ok;DWORD count,error;const unsigned char* data;}ReadStep;
typedef struct Control{
  ULONGLONG now;DWORD error;int alive,inherit,creation_bad,server_bad,client_bad,mode_bad,query_bad,die_after_query,target_type_bad;
  unsigned connect_at,connect_count,dup_local,dup_target,writes,reads,closes,query_opens,bad_calls,creation_calls;
  int late_final_creation,late_final_wait;unsigned final_waits;
  int connect_steps[8];ReadStep read_steps[16];unsigned read_at,read_count;
  DWORD read_default,write_limit;unsigned write_zero;int late_write,write_overshoot;
  unsigned char output[8192];DWORD output_size;ACCESS_MASK target_rights;
}Control;
static Control g;
static unsigned checks,failures,first_failure;
static void reset(void){memset(&g,0,sizeof(g));g.now=100;g.alive=1;g.read_default=ERROR_BROKEN_PIPE;g.write_limit=UINT32_MAX;g.target_rights=SYNCHRONIZE;}
#define CHECK(v) do{checks++;if(!(v)){failures++;if(!first_failure)first_failure=checks;}}while(0)
static int all_zero(const char* bytes,size_t length){for(size_t i=0;i<length;i++)if(bytes[i])return 0;return 1;}
static DWORD WINAPI ctl_wait(HANDLE handle,DWORD ms){if(handle!=H(20)&&handle!=H(21)&&handle!=H(12))g.bad_calls++;g.now+=ms;if(g.late_final_wait&&g.creation_calls==2&&ms==0&&++g.final_waits==2)g.now=110;return g.alive?WAIT_TIMEOUT:WAIT_OBJECT_0;}
static ULONGLONG WINAPI ctl_tick(void){return g.now;}
static DWORD WINAPI ctl_error(void){return g.error;}
static BOOL WINAPI ctl_handle(HANDLE handle,LPDWORD flags){if(!handle||handle==INVALID_HANDLE_VALUE)return FALSE;*flags=g.inherit?HANDLE_FLAG_INHERIT:0;return TRUE;}
static BOOL WINAPI ctl_write(HANDLE pipe,LPCVOID data,DWORD count,LPDWORD wrote,LPOVERLAPPED overlapped){
  (void)pipe;g.writes++;if(overlapped){g.bad_calls++;return FALSE;}
  if(g.write_overshoot){*wrote=count+1;return TRUE;}
  *wrote=g.write_zero?(g.write_zero--,0):count<g.write_limit?count:g.write_limit;
  if(*wrote>sizeof(g.output)-g.output_size){g.bad_calls++;return FALSE;}
  memcpy(g.output+g.output_size,data,*wrote);g.output_size+=*wrote;if(g.late_write)g.now=30000;return TRUE;
}
static BOOL WINAPI ctl_read(HANDLE pipe,LPVOID bytes,DWORD count,LPDWORD got,LPOVERLAPPED overlapped){
  (void)pipe;g.reads++;if(overlapped){g.bad_calls++;return FALSE;}
  if(g.read_at>=g.read_count){*got=0;g.error=g.read_default;return FALSE;}
  ReadStep step=g.read_steps[g.read_at++];*got=step.count;g.error=step.error;
  if(step.ok&&step.count<=count&&step.count)memcpy(bytes,step.data,step.count);return step.ok;
}
static BOOL WINAPI ctl_times(HANDLE process,LPFILETIME created,LPFILETIME exited,LPFILETIME kernel,LPFILETIME user){
  (void)process;g.creation_calls++;if(g.late_final_creation&&g.creation_calls==2)g.now=110;memset(created,0,sizeof(*created));memset(exited,0,sizeof(*exited));memset(kernel,0,sizeof(*kernel));memset(user,0,sizeof(*user));created->dwLowDateTime=g.creation_bad?101:100;return TRUE;
}
static HANDLE WINAPI ctl_current(void){return H(50);}
static DWORD WINAPI ctl_pid(void){return 11;}
static NTSTATUS WINAPI ctl_rng(BCRYPT_ALG_HANDLE algorithm,PUCHAR output,ULONG size,ULONG flags){(void)algorithm;(void)flags;memset(output,1,size);return 0;}
static HANDLE WINAPI ctl_pipe(LPCWSTR name,DWORD access,DWORD mode,DWORD count,DWORD out,DWORD in,DWORD timeout,LPSECURITY_ATTRIBUTES security){
  (void)name;(void)out;(void)in;(void)timeout;
  if(access!=(PIPE_ACCESS_DUPLEX|FILE_FLAG_FIRST_PIPE_INSTANCE)||!(mode&PIPE_NOWAIT)||!(mode&PIPE_REJECT_REMOTE_CLIENTS)||count!=1||!security||security->bInheritHandle)g.bad_calls++;return H(10);
}
static BOOL WINAPI ctl_dup(HANDLE source_process,HANDLE source,HANDLE target_process,LPHANDLE target,DWORD access,BOOL inherit,DWORD options){
  if(source_process!=H(50)||access!=SYNCHRONIZE||inherit||options){g.bad_calls++;return FALSE;}
  if(source==H(50)&&target_process==H(50)){g.dup_local++;*target=H(11);return TRUE;}
  if(source==H(11)&&target_process==H(20)){g.dup_target++;*target=H(12);return TRUE;}
  g.bad_calls++;return FALSE;
}
static BOOL WINAPI ctl_close(HANDLE handle){if(!handle||handle==INVALID_HANDLE_VALUE)g.bad_calls++;g.closes++;return TRUE;}
static BOOL WINAPI ctl_connect(HANDLE pipe,LPOVERLAPPED overlapped){
  (void)pipe;if(overlapped)g.bad_calls++;
  int value=g.connect_at<g.connect_count?g.connect_steps[g.connect_at++]:ERROR_PIPE_LISTENING;
  if(value==1)return TRUE;g.error=(DWORD)value;return FALSE;
}
static BOOL WINAPI ctl_client_pid(HANDLE pipe,PULONG pid){(void)pipe;if(g.query_bad)return FALSE;*pid=g.client_bad?23:22;if(g.die_after_query)g.alive=0;return TRUE;}
static HANDLE WINAPI ctl_file(LPCWSTR name,DWORD access,DWORD share,LPSECURITY_ATTRIBUTES security,DWORD disposition,DWORD flags,HANDLE template_file){
  (void)name;(void)share;(void)template_file;if(access!=(GENERIC_READ|GENERIC_WRITE)||!security||security->bInheritHandle||disposition!=OPEN_EXISTING||(flags&FILE_FLAG_OVERLAPPED))g.bad_calls++;return H(30);
}
static BOOL WINAPI ctl_mode(HANDLE pipe,LPDWORD mode,LPDWORD count,LPDWORD timeout){(void)pipe;if(!mode||*mode!=(PIPE_READMODE_BYTE|PIPE_NOWAIT)||count||timeout)g.bad_calls++;return !g.mode_bad;}
static BOOL WINAPI ctl_server_pid(HANDLE pipe,PULONG pid){(void)pipe;if(g.query_bad)return FALSE;*pid=g.server_bad?12:11;return TRUE;}
static HANDLE WINAPI ctl_open(DWORD rights,BOOL inherit,DWORD pid){g.query_opens++;if(rights!=(PROCESS_QUERY_LIMITED_INFORMATION|SYNCHRONIZE)||inherit||pid!=11)g.bad_calls++;return H(21);}
static NTSTATUS NTAPI ctl_query(HANDLE handle,OBJECT_INFORMATION_CLASS kind,PVOID buffer,ULONG size,PULONG returned){
  if(handle!=H(12)){g.bad_calls++;return -1;}
  if((int)kind==0){struct Basic{ULONG attributes;ACCESS_MASK access;ULONG handles,pointers,reserved[10];};if(size<sizeof(struct Basic))return -1;memset(buffer,0,size);((struct Basic*)buffer)->access=g.target_rights;*returned=(ULONG)sizeof(struct Basic);return 0;}
  if((int)kind==2){if(size<sizeof(UNICODE_STRING)+7*sizeof(wchar_t))return -1;UNICODE_STRING* name=(UNICODE_STRING*)buffer;name->Buffer=(wchar_t*)((unsigned char*)buffer+sizeof(*name));name->Length=(USHORT)((g.target_type_bad?5:7)*sizeof(wchar_t));name->MaximumLength=name->Length;memcpy(name->Buffer,g.target_type_bad?L"Event":L"Process",name->Length);*returned=(ULONG)(sizeof(*name)+name->Length);return 0;}
  g.bad_calls++;return -1;
}
static HMODULE WINAPI ctl_module(LPCWSTR name){(void)name;return (HMODULE)H(40);}
static FARPROC WINAPI ctl_proc(HMODULE module,LPCSTR name){(void)module;if(strcmp(name,"NtQueryObject"))g.bad_calls++;return (FARPROC)ctl_query;}
#define WaitForSingleObject ctl_wait
#define GetTickCount64 ctl_tick
#define GetLastError ctl_error
#define GetHandleInformation ctl_handle
#define WriteFile ctl_write
#define ReadFile ctl_read
#define GetProcessTimes ctl_times
#define GetCurrentProcess ctl_current
#define GetCurrentProcessId ctl_pid
#define BCryptGenRandom ctl_rng
#define CreateNamedPipeW ctl_pipe
#define DuplicateHandle ctl_dup
#define CloseHandle ctl_close
#define ConnectNamedPipe ctl_connect
#define GetNamedPipeClientProcessId ctl_client_pid
#define CreateFileW ctl_file
#define SetNamedPipeHandleState ctl_mode
#define GetNamedPipeServerProcessId ctl_server_pid
#define OpenProcess ctl_open
#define GetModuleHandleW ctl_module
#define GetProcAddress ctl_proc
#define CMSPARK_BOOTSTRAP_PARENT
#define CMSPARK_BOOTSTRAP_CHILD
#include "../../../src/desktop/native/windows-bootstrap.h"
static void step(BOOL ok,DWORD count,DWORD error,const unsigned char* bytes){g.read_steps[g.read_count++]=(ReadStep){ok,count,error,bytes};}
static CmsparkBootstrapServer server(void){CmsparkBootstrapServer state;memset(&state,0,sizeof(state));state.pipe=H(10);state.parent=H(11);state.deadline=110;return state;}
static CmsparkBootstrapClient client(void){CmsparkBootstrapClient state;memset(&state,0,sizeof(state));state.pipe=H(30);state.issuer=H(21);state.creation=100;state.deadline=110;return state;}
int main(void){
  unsigned char bytes[8]={0},target_bytes[]={1,2,3,4},ack=1,wrong=2,header[]={3,0,0,0};HANDLE target=NULL;
  reset();CmsparkBootstrapServer opened;CHECK(d480_server_open(&opened));CHECK(opened.deadline==20100&&g.dup_local==1&&g.bad_calls==0);wchar_t command[512];CHECK(d480_server_command(&opened,L"owned.exe",command,512));CHECK(!d480_server_command(&opened,L"bad\"exe",command,512));d480_server_close(&opened);CHECK(!opened.pipe&&!opened.parent&&g.closes==2);
  reset();CmsparkBootstrapServer state=server();g.connect_steps[0]=1;g.connect_steps[1]=ERROR_PIPE_LISTENING;g.connect_steps[2]=ERROR_PIPE_CONNECTED;g.connect_count=3;CHECK(d480_server_bind(&state,H(20),22,&target));CHECK(target==H(12)&&g.dup_target==1&&g.now==102&&state.deadline==110&&g.bad_calls==0);
  reset();state=server();g.connect_steps[0]=ERROR_PIPE_CONNECTED;g.connect_count=1;g.client_bad=1;CHECK(!d480_server_bind(&state,H(20),22,&target));CHECK(g.dup_target==0&&g.writes==0);
  reset();state=server();g.connect_steps[0]=ERROR_PIPE_CONNECTED;g.connect_count=1;g.query_bad=1;CHECK(!d480_server_bind(&state,H(20),22,&target));CHECK(g.dup_target==0&&g.writes==0);
  reset();state=server();g.connect_steps[0]=ERROR_PIPE_CONNECTED;g.connect_count=1;g.die_after_query=1;CHECK(!d480_server_bind(&state,H(20),22,&target));CHECK(g.dup_target==0&&g.writes==0);
  reset();state=server();g.connect_steps[0]=ERROR_NO_DATA;g.connect_count=1;CHECK(!d480_server_bind(&state,H(20),22,&target));CHECK(g.connect_at==1&&g.dup_target==0);
  reset();g.write_limit=1;g.write_zero=2;CHECK(d480_write(H(10),H(20),110,target_bytes,4));CHECK(g.output_size==4&&!memcmp(g.output,target_bytes,4)&&g.now==102&&g.bad_calls==0);
  reset();g.write_overshoot=1;CHECK(!d480_write(H(10),H(20),110,target_bytes,4));
  reset();g.write_zero=20;CHECK(!d480_write(H(10),H(20),103,target_bytes,4));CHECK(g.now==103&&g.output_size==0);
  reset();g.late_write=1;CHECK(!d480_write(H(10),H(20),110,target_bytes,4));
  reset();step(FALSE,0,ERROR_NO_DATA,NULL);step(TRUE,2,0,target_bytes);step(TRUE,2,0,target_bytes+2);CHECK(d480_read(H(30),H(21),110,bytes,4));CHECK(!memcmp(bytes,target_bytes,4)&&g.now==101);
  reset();step(TRUE,0,0,NULL);CHECK(!d480_read(H(30),H(21),110,bytes,1));
  reset();step(TRUE,2,0,target_bytes);CHECK(!d480_read(H(30),H(21),110,bytes,1));
  reset();g.read_default=ERROR_NO_DATA;CHECK(!d480_read(H(30),H(21),103,bytes,1));CHECK(g.now==103);
  reset();step(TRUE,1,0,&ack);state=server();CHECK(d480_server_send(&state,H(20),22,"abc",3));CHECK(g.output_size==7&&g.output[0]==3&&!memcmp(g.output+4,"abc",3)&&g.closes==2&&!state.pipe&&!state.parent);
  reset();step(TRUE,1,0,&wrong);state=server();CHECK(!d480_server_send(&state,H(20),22,"abc",3));CHECK(g.closes==2);
  reset();g.read_default=ERROR_NO_DATA;state=server();CHECK(!d480_server_send(&state,H(20),22,"abc",3));CHECK(g.now==110&&g.closes==2);
  reset();state=server();g.client_bad=1;CHECK(!d480_server_send(&state,H(20),22,"abc",3));CHECK(g.writes==0&&g.closes==2);
  reset();CmsparkBootstrapClient child=client();char body[CMSPARK_BOOT_MAX+1];DWORD length=0;step(TRUE,2,0,header);step(TRUE,2,0,header+2);step(TRUE,1,0,(const unsigned char*)"a");step(TRUE,2,0,(const unsigned char*)"bc");CHECK(d480_client_body(&child,body,&length));CHECK(length==3&&!strcmp(body,"abc"));
  reset();child=client();unsigned char too_big[]={1,16,0,0};step(TRUE,4,0,too_big);CHECK(!d480_client_body(&child,body,&length));CHECK(length==0&&all_zero(body,sizeof(body)));
  reset();child=client();unsigned char zero_length[4]={0};step(TRUE,4,0,zero_length);CHECK(!d480_client_body(&child,body,&length));
  reset();child=client();step(TRUE,2,0,header);CHECK(!d480_client_body(&child,body,&length));CHECK(length==0);
  reset();child=client();step(TRUE,4,0,header);step(TRUE,1,0,(const unsigned char*)"a");CHECK(!d480_client_body(&child,body,&length));CHECK(length==0&&all_zero(body,sizeof(body)));
  reset();wchar_t* argv[]={L"owned.exe",CMSPARK_BOOT_FLAG,L"01010101010101010101010101010101",L"11",L"100",L"150"};CHECK(d480_client_open(6,argv,&child));CHECK(g.query_opens==1&&g.bad_calls==0);d480_client_close(&child);CHECK(g.closes==2&&!child.pipe&&!child.issuer);
  reset();g.creation_bad=1;CHECK(!d480_client_open(6,argv,&child));CHECK(g.closes==2&&g.writes==0);
  reset();g.server_bad=1;CHECK(!d480_client_open(6,argv,&child));CHECK(g.query_opens==0&&g.closes==1);
  reset();g.query_bad=1;CHECK(!d480_client_open(6,argv,&child));CHECK(g.query_opens==0&&g.closes==1);
  reset();g.mode_bad=1;CHECK(!d480_client_open(6,argv,&child));CHECK(g.query_opens==0&&g.reads==0&&g.writes==0);
  reset();CHECK(!d480_client_open(5,argv,&child));CHECK(g.query_opens==0&&g.reads==0);
  reset();g.now=150;CHECK(!d480_client_open(6,argv,&child));CHECK(g.query_opens==0&&g.reads==0);
  reset();ULONGLONG decimal=0;CHECK(!d480_decimal(L"01",&decimal));CHECK(!d480_decimal(L"18446744073709551616",&decimal));CHECK(d480_decimal(L"18446744073709551615",&decimal)&&decimal==UINT64_MAX);
  reset();child=client();step(FALSE,0,ERROR_NO_DATA,NULL);step(FALSE,0,ERROR_BROKEN_PIPE,NULL);CHECK(d480_client_finish(&child,H(12)));CHECK(g.output_size==1&&g.output[0]==1&&g.closes==0);d480_client_close(&child);CHECK(g.closes==2&&g.bad_calls==0);
  reset();child=client();step(TRUE,1,0,&wrong);CHECK(!d480_client_finish(&child,H(12)));CHECK(g.output_size==1);
  reset();child=client();step(TRUE,0,0,NULL);CHECK(!d480_client_finish(&child,H(12)));
  reset();child=client();g.read_default=ERROR_NO_DATA;CHECK(!d480_client_finish(&child,H(12)));CHECK(g.now==110);
  reset();child=client();g.target_rights=SYNCHRONIZE|PROCESS_QUERY_LIMITED_INFORMATION;CHECK(!d480_client_finish(&child,H(12)));CHECK(g.writes==0);
  reset();child=client();g.target_type_bad=1;CHECK(!d480_client_finish(&child,H(12)));CHECK(g.writes==0);
  reset();child=client();g.inherit=1;CHECK(!d480_client_finish(&child,H(12)));CHECK(g.writes==0);
  reset();child=client();g.creation_bad=1;CHECK(!d480_client_finish(&child,H(12)));CHECK(g.writes==0);
  reset();child=client();g.late_final_creation=1;step(FALSE,0,ERROR_BROKEN_PIPE,NULL);CHECK(!d480_client_finish(&child,H(12)));CHECK(g.creation_calls==2&&g.now==110&&child.deadline==110&&g.output_size==1);
  reset();child=client();g.late_final_wait=1;step(FALSE,0,ERROR_BROKEN_PIPE,NULL);CHECK(!d480_client_finish(&child,H(12)));CHECK(g.creation_calls==2&&g.final_waits==2&&g.now==110&&child.deadline==110&&g.output_size==1);
  reset();g.alive=0;CHECK(!d480_read(H(30),H(21),110,bytes,1));CHECK(g.reads==0);
  printf("{\"scope\":\"CONTROLLED_ACTUAL_C_HEADER\",\"checks\":%u,\"failures\":%u,\"firstFailure\":%u,\"realPipeTransport\":false,\"pendingOperations\":0}\n",checks,failures,first_failure);return failures?1:0;
}
#endif
