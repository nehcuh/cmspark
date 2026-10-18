/* Unshipped parser-negative carrier. Only six fixed inert bodies; no session or helper process. */
#include <node_api.h>
#undef NAPI_MODULE
#define NAPI_MODULE(module_name, register_function)
#include "../../../src/desktop/native/launcher.c"

static napi_value malformed(napi_env env,napi_callback_info info) {
  size_t argc=2;napi_value args[2];napi_get_cb_info(env,info,&argc,args,NULL,NULL);
  char* binary=NULL;wchar_t* exe=NULL;wchar_t* environment=NULL;
  CmsparkBootstrapServer channel;memset(&channel,0,sizeof(channel));PROCESS_INFORMATION pi;memset(&pi,0,sizeof(pi));
  STARTUPINFOW startup;memset(&startup,0,sizeof(startup));startup.cb=sizeof(startup);
  int32_t variant=-1;DWORD exit_code=255;int bound=0,accepted=0,settled=0;char body[CMSPARK_BOOT_MAX+1];memset(body,0,sizeof(body));
  ULONGLONG case_started=GetTickCount64();if(case_started>UINT64_MAX-5000u)goto bad;
  if(argc!=2||napi_get_value_int32(env,args[1],&variant)!=napi_ok||variant<0||variant>5)goto bad;
  binary=string_arg(env,args[0],BOOT_MAX);if(!binary||!d480_server_open(&channel))goto bad;
  /* Preserve each old parser spawnSync5000 sub-budget and the enclosing three-case20s test. */
  if(channel.deadline>case_started+5000u)channel.deadline=case_started+5000u;
  int size=MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,binary,-1,NULL,0);exe=size?malloc((size_t)size*sizeof(wchar_t)):NULL;
  wchar_t command[4608];if(!exe||!MultiByteToWideChar(CP_UTF8,MB_ERR_INVALID_CHARS,binary,-1,exe,size)||!d480_server_command(&channel,exe,command,sizeof(command)/sizeof(command[0])))goto bad;
  environment=host_environment();if(!environment||!CreateProcessW(exe,command,NULL,NULL,FALSE,CREATE_UNICODE_ENVIRONMENT,environment,NULL,&startup,&pi))goto bad;
  CloseHandle(pi.hThread);pi.hThread=NULL;HANDLE target=NULL;
  if(!d480_server_bind(&channel,pi.hProcess,pi.dwProcessId,&target))goto done;
  bound=1;
  const char* version=variant==0?"true":variant==1?"1,\"protocol_version\":1":variant==2?"1,\"\\u0070rotocol_version\":1":"1";
  const char* url_json=variant==3?"1":variant==4?"\"ws://foreign.invalid:1/desktop\"":variant==5?"\"ws://127.0.0.1:0/desktop\"":"\"ws://127.0.0.1:1/desktop\"";
  int length=snprintf(body,sizeof(body),"{\"capability_id\":\"11111111111111111111111111111111\",\"secret\":\"2222222222222222222222222222222222222222222222222222222222222222\",\"url\":%s,\"protocol_version\":%s,\"issued_method_set_version\":6,\"parent_handle\":\"%llu\"}\n",url_json,version,(unsigned long long)(uintptr_t)target);
  if(length<=0||(DWORD)length>CMSPARK_BOOT_MAX)goto done;
  accepted=d480_server_send(&channel,pi.hProcess,pi.dwProcessId,body,(DWORD)length);
done:;
  ULONGLONG now=GetTickCount64();DWORD remaining=now<channel.deadline?(DWORD)(channel.deadline-now):0;
  if(pi.hProcess&&WaitForSingleObject(pi.hProcess,remaining)==WAIT_OBJECT_0){settled=GetExitCodeProcess(pi.hProcess,&exit_code)!=0;}
  if(pi.hProcess&&!settled){TerminateProcess(pi.hProcess,251);WaitForSingleObject(pi.hProcess,INFINITE);}
  if(pi.hProcess)CloseHandle(pi.hProcess);pi.hProcess=NULL;
  d480_server_close(&channel);SecureZeroMemory(body,sizeof(body));free(environment);free(exe);free(binary);
  napi_value out,value;napi_create_object(env,&out);
  napi_create_uint32(env,exit_code,&value);napi_set_named_property(env,out,"exitCode",value);
  napi_get_boolean(env,bound,&value);napi_set_named_property(env,out,"boundExactChild",value);
  napi_get_boolean(env,accepted,&value);napi_set_named_property(env,out,"acknowledged",value);
  napi_get_boolean(env,settled,&value);napi_set_named_property(env,out,"actualChildSettled",value);return out;
bad:
  if(pi.hThread)CloseHandle(pi.hThread);if(pi.hProcess){TerminateProcess(pi.hProcess,251);WaitForSingleObject(pi.hProcess,INFINITE);CloseHandle(pi.hProcess);}
  d480_server_close(&channel);SecureZeroMemory(body,sizeof(body));free(environment);free(exe);free(binary);
  napi_throw_error(env,"OWNED_MALFORMED_BOOTSTRAP_SETUP","Owned parser-negative carrier setup failed");return NULL;
}
NAPI_MODULE_INIT(){napi_value out=init(env,exports),fn;napi_create_function(env,"malformed",NAPI_AUTO_LENGTH,malformed,NULL,&fn);napi_set_named_property(env,out,"malformed",fn);return out;}
