/* Test-only native teardown observer: no GUI, fixed file beside this owned binary. */
#if defined(DESKTOP_FIXTURE_MAC_PARENT_PROBE)
#include <sys/file.h>
#include <sys/stat.h>
#include <fcntl.h>
#include <unistd.h>
#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include <errno.h>
int main(void){
 char raw[PATH_MAX],binary[PATH_MAX];uint32_t size=sizeof(raw);if(_NSGetExecutablePath(raw,&size)||!realpath(raw,binary))return 210;
 char *slash=strrchr(binary,'/');if(!slash)return 211;slash[1]=0;if(strlen(binary)+strlen("parent-exit.receipt")>=sizeof(binary))return 212;strcat(binary,"parent-exit.receipt");
 int fd=open(binary,O_RDWR|O_NOFOLLOW);if(fd<0)return 213;struct stat before,after;
 if(fstat(fd,&before)||!S_ISREG(before.st_mode)||before.st_nlink!=1||before.st_size!=0)return 214;
 if(flock(fd,LOCK_EX|LOCK_NB)==0)return 215;if(errno!=EWOULDBLOCK)return 216;
 puts("D480_PARENT_LOCK_WAITING");fflush(stdout);
 if(flock(fd,LOCK_EX))return 217;
 char byte=0;ssize_t got=read(fd,&byte,1);int valid=!fstat(fd,&after)&&after.st_dev==before.st_dev&&after.st_ino==before.st_ino&&after.st_nlink==1&&after.st_size==1&&got==1&&byte=='1';close(fd);
 if(!valid)return 218;puts("D480_PARENT_NATIVE_EXIT_OBSERVED");return 0;
}
#else
/* Unshipped Windows-only #480 fixture. Known owned handles only; no scans or secret reads. */
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#define FIXTURE_BUDGET 20000

#if defined(DESKTOP_FIXTURE_PARENT_LOCK_PROBE)
int wmain(void){
 wchar_t file[32768];DWORD count=GetModuleFileNameW(NULL,file,32768);if(!count||count==32768)return 210;wchar_t *slash=wcsrchr(file,L'\\');if(!slash)slash=wcsrchr(file,L'/');if(!slash)return 211;slash[1]=0;if(wcscat_s(file,32768,L"parent-exit.receipt"))return 212;
 HANDLE fd=CreateFileW(file,GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,NULL,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,NULL);if(fd==INVALID_HANDLE_VALUE)return 213;
 BY_HANDLE_FILE_INFORMATION before,after;OVERLAPPED lock;memset(&lock,0,sizeof(lock));
 if(!GetFileInformationByHandle(fd,&before)||(before.dwFileAttributes&(FILE_ATTRIBUTE_DIRECTORY|FILE_ATTRIBUTE_REPARSE_POINT))||before.nNumberOfLinks!=1||before.nFileSizeHigh||before.nFileSizeLow)return 214;
 if(LockFileEx(fd,LOCKFILE_EXCLUSIVE_LOCK|LOCKFILE_FAIL_IMMEDIATELY,0,1,0,&lock))return 215;if(GetLastError()!=ERROR_LOCK_VIOLATION)return 216;
 puts("D480_PARENT_LOCK_WAITING");fflush(stdout);
 if(!LockFileEx(fd,LOCKFILE_EXCLUSIVE_LOCK,0,1,0,&lock))return 217;
 char byte=0;DWORD got=0;BOOL valid=ReadFile(fd,&byte,1,&got,NULL)&&got==1&&byte=='1'&&GetFileInformationByHandle(fd,&after)&&after.dwVolumeSerialNumber==before.dwVolumeSerialNumber&&after.nFileIndexHigh==before.nFileIndexHigh&&after.nFileIndexLow==before.nFileIndexLow&&after.nNumberOfLinks==1&&!after.nFileSizeHigh&&after.nFileSizeLow==1;CloseHandle(fd);
 if(!valid)return 218;puts("D480_PARENT_NATIVE_EXIT_OBSERVED");return 0;
}
#else
#ifndef DESKTOP_FIXTURE_ADDON
static int fixture_read_known(HANDLE known[3]) {
  wchar_t name[32768]; DWORD n=GetModuleFileNameW(NULL,name,32768);
  if(!n||n>32750)return 0;
  if(wcscat_s(name,32768,L".handles"))return 0;
  HANDLE file=CreateFileW(name,GENERIC_READ,FILE_SHARE_READ,NULL,OPEN_EXISTING,FILE_FLAG_OPEN_REPARSE_POINT,NULL);
  if(file==INVALID_HANDLE_VALUE)return 0;
  BY_HANDLE_FILE_INFORMATION info;char bytes[256];DWORD got=0;
  int valid=GetFileInformationByHandle(file,&info)&&!(info.dwFileAttributes&(FILE_ATTRIBUTE_REPARSE_POINT|FILE_ATTRIBUTE_DIRECTORY))&&info.nNumberOfLinks==1&&info.nFileSizeHigh==0&&info.nFileSizeLow>0&&info.nFileSizeLow<sizeof(bytes);
  if(valid)valid=ReadFile(file,bytes,info.nFileSizeLow,&got,NULL)&&got==info.nFileSizeLow;
  BY_HANDLE_FILE_INFORMATION after;
  if(valid)valid=GetFileInformationByHandle(file,&after)&&after.dwVolumeSerialNumber==info.dwVolumeSerialNumber&&after.nFileIndexHigh==info.nFileIndexHigh&&after.nFileIndexLow==info.nFileIndexLow&&after.nNumberOfLinks==1&&after.nFileSizeHigh==info.nFileSizeHigh&&after.nFileSizeLow==info.nFileSizeLow;
  CloseHandle(file);if(!valid)return 0;bytes[got]=0;
  unsigned long long a,b,c;
  if(sscanf_s(bytes,"D480_OWNED_HANDLES_V1\n%llu\n%llu\n%llu\n",&a,&b,&c)!=3)return 0;
  char canonical[256];int length=snprintf(canonical,sizeof(canonical),"D480_OWNED_HANDLES_V1\n%llu\n%llu\n%llu\n",a,b,c);if(length!=(int)got||memcmp(bytes,canonical,got))return 0;
  if(a>(uintptr_t)-1||b>(uintptr_t)-1||c>(uintptr_t)-1)return 0;
  known[0]=(HANDLE)(uintptr_t)a;known[1]=(HANDLE)(uintptr_t)b;known[2]=(HANDLE)(uintptr_t)c;return 1;
}
static unsigned fixture_mask(const HANDLE known[3]) {
  unsigned mask=0;for(unsigned i=0;i<3;i++){DWORD flags=0;if(GetHandleInformation(known[i],&flags))mask|=1u<<i;}return mask;
}
#endif
#ifdef DESKTOP_FIXTURE_ADDON
#include <node_api.h>
static HANDLE fixture_known[3];
static DWORD fixture_sibling=255,fixture_control=255;
static int fixture_sidecar_ok=0;
static ULONGLONG fixture_started;
static wchar_t *host_environment(void);
/* Called before defining the interposition macro: these are real Win32 APIs. */
static DWORD fixture_checker(const wchar_t *binary,const wchar_t *role) {
  wchar_t command[32768];STARTUPINFOW startup;PROCESS_INFORMATION pi;
  memset(&startup,0,sizeof(startup));memset(&pi,0,sizeof(pi));startup.cb=sizeof(startup);
  if(wcschr(binary,L'"')||swprintf_s(command,32768,L"\"%ls\" %ls",binary,role)<0)return 254;
  wchar_t *environment=host_environment();if(!environment)return 253;
  BOOL started=CreateProcessW(binary,command,NULL,NULL,TRUE,CREATE_UNICODE_ENVIRONMENT,environment,NULL,&startup,&pi);free(environment);
  if(!started)return 252;CloseHandle(pi.hThread);
  ULONGLONG elapsed=GetTickCount64()-fixture_started;DWORD remaining=elapsed<FIXTURE_BUDGET?(DWORD)(FIXTURE_BUDGET-elapsed):0;
  DWORD result=255;if(WaitForSingleObject(pi.hProcess,remaining)==WAIT_OBJECT_0)GetExitCodeProcess(pi.hProcess,&result);
  else{TerminateProcess(pi.hProcess,251);WaitForSingleObject(pi.hProcess,INFINITE);result=251;}
  CloseHandle(pi.hProcess);return result;
}
static int fixture_sidecar(const wchar_t *binary) {
  wchar_t name[32768];if(wcslen(binary)>32750||wcscpy_s(name,32768,binary)||wcscat_s(name,32768,L".handles"))return 0;
  HANDLE file=CreateFileW(name,GENERIC_WRITE,0,NULL,CREATE_NEW,FILE_ATTRIBUTE_NORMAL|FILE_FLAG_OPEN_REPARSE_POINT,NULL);if(file==INVALID_HANDLE_VALUE)return 0;
  char bytes[256];int n=snprintf(bytes,sizeof(bytes),"D480_OWNED_HANDLES_V1\n%llu\n%llu\n%llu\n",(unsigned long long)(uintptr_t)fixture_known[0],(unsigned long long)(uintptr_t)fixture_known[1],(unsigned long long)(uintptr_t)fixture_known[2]);
  DWORD wrote=0;BOOL ok=n>0&&n<(int)sizeof(bytes)&&WriteFile(file,bytes,(DWORD)n,&wrote,NULL)&&wrote==(DWORD)n&&FlushFileBuffers(file);CloseHandle(file);return ok;
}
static BOOL WINAPI fixture_attribute(LPPROC_THREAD_ATTRIBUTE_LIST list,DWORD flags,DWORD_PTR attribute,PVOID value,SIZE_T bytes,PVOID previous,PSIZE_T returned) {
  if(attribute==PROC_THREAD_ATTRIBUTE_HANDLE_LIST&&bytes==2*sizeof(HANDLE)){HANDLE *handles=(HANDLE*)value;fixture_known[0]=handles[0];fixture_known[1]=handles[1];}
  return UpdateProcThreadAttribute(list,flags,attribute,value,bytes,previous,returned);
}
static BOOL WINAPI fixture_create(LPCWSTR app,LPWSTR command,LPSECURITY_ATTRIBUTES process,LPSECURITY_ATTRIBUTES thread,BOOL inherit,DWORD flags,LPVOID environment,LPCWSTR cwd,LPSTARTUPINFOW startup,LPPROCESS_INFORMATION pi) {
  /* Exact original inheritance window: rd/parent still inheritable; intended call unchanged. */
  fixture_sidecar_ok=fixture_sidecar(app);
  if(fixture_sidecar_ok){fixture_control=fixture_checker(app,L"--sentinel");fixture_sibling=fixture_checker(app,L"--sibling");}
  return CreateProcessW(app,command,process,thread,inherit,flags,environment,cwd,startup,pi);
}
#define UpdateProcThreadAttribute fixture_attribute
#define CreateProcessW fixture_create
#undef NAPI_MODULE
#define NAPI_MODULE(module_name, register_function)
#include "../../../src/desktop/native/launcher.c"
#undef UpdateProcThreadAttribute
#undef CreateProcessW
static napi_value fixture_inspect(napi_env env,napi_callback_info info) {
  (void)info;napi_value object,value;napi_create_object(env,&object);
  napi_get_boolean(env,fixture_sidecar_ok,&value);napi_set_named_property(env,object,"sidecar_valid",value);
  napi_create_uint32(env,fixture_control,&value);napi_set_named_property(env,object,"control_mask",value);
  napi_create_uint32(env,fixture_sibling,&value);napi_set_named_property(env,object,"sibling_mask",value);
  return object;
}
static void fixture_cleanup(void *ignored) {(void)ignored;if(fixture_known[2]){CloseHandle(fixture_known[2]);fixture_known[2]=NULL;}}
NAPI_MODULE_INIT() {
  SECURITY_ATTRIBUTES sa={sizeof(sa),NULL,TRUE};fixture_known[2]=CreateEventW(&sa,TRUE,FALSE,NULL);fixture_started=GetTickCount64();
  if(!fixture_known[2]){napi_throw_error(env,"OWNED_SENTINEL_REQUIRED","Owned sentinel unavailable");return NULL;}
  napi_add_env_cleanup_hook(env,fixture_cleanup,NULL);
  napi_value out=init(env,exports),fn;napi_create_function(env,"inspectOwned",NAPI_AUTO_LENGTH,fixture_inspect,NULL,&fn);napi_set_named_property(env,out,"inspectOwned",fn);return out;
}
#else
int wmain(int argc,wchar_t **argv) {
  HANDLE known[3];if(!fixture_read_known(known))return 240;
  if(argc==2&&!wcscmp(argv[1],L"--sentinel"))return (int)(fixture_mask(known)&4u);
  if(argc==2&&(!wcscmp(argv[1],L"--sibling")||!wcscmp(argv[1],L"--descendant")))return (int)fixture_mask(known);
  if(argc!=1)return 241;
  HANDLE input=GetStdHandle(STD_INPUT_HANDLE);char bytes[4097];DWORD total=0;
  for(;;){DWORD got=0;if(!ReadFile(input,bytes+total,(DWORD)sizeof(bytes)-total,&got,NULL)){if(GetLastError()==ERROR_BROKEN_PIPE)break;return 242;}if(!got)break;total+=got;if(total>4096)return 243;}
  bytes[total]=0;
  int shape=total>0&&strstr(bytes,"\"capability_id\":")&&strstr(bytes,"\"parent_handle\":")&&strstr(bytes,"\"secret\":");
  SecureZeroMemory(bytes,sizeof(bytes));CloseHandle(input);SetStdHandle(STD_INPUT_HANDLE,NULL);
  DWORD parent_flags=0;int parent_present=GetHandleInformation(known[1],&parent_flags)!=0;
  if(!SetHandleInformation(known[1],HANDLE_FLAG_INHERIT,0))return 245;
  if(!shape||!parent_present)return 246;
  return (fixture_mask(known)&4u)?247:0;
}
#endif

#endif /* Windows parent probe role */
#endif /* Mac parent probe role */
