/* API feasibility only: own-process handles, no inherited parent/WebView proof. */
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winternl.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#define CMSPARK_BOOTSTRAP_CHILD
#include "../../../src/desktop/native/windows-bootstrap.h"

typedef NTSTATUS (NTAPI *query_object_fn)(HANDLE, OBJECT_INFORMATION_CLASS,
                                         PVOID, ULONG, PULONG);
typedef struct { ULONG attributes; ACCESS_MASK access; ULONG handles;
                 ULONG pointers; ULONG reserved[10]; } probe_basic;
typedef union { void *alignment; unsigned char bytes[4096]; } type_storage;

/* No GetProcessId/OpenProcess: neither additional QUERY rights nor PID lookup. */
static int accepts(query_object_fn query, HANDLE handle) {
  probe_basic basic;
  type_storage storage;
  ULONG returned = 0;
  UNICODE_STRING *name;
  uintptr_t first, last, start;
  static const WCHAR process_name[] = L"Process";
  if (!query || !handle || handle == INVALID_HANDLE_VALUE) return 0;
  memset(&basic, 0, sizeof(basic));
  if (query(handle, (OBJECT_INFORMATION_CLASS)0, &basic,
            (ULONG)sizeof(basic), &returned) < 0 ||
      returned < sizeof(basic) || basic.access != SYNCHRONIZE) return 0;
  memset(&storage, 0, sizeof(storage));
  returned = 0;
  if (query(handle, (OBJECT_INFORMATION_CLASS)2, &storage,
            (ULONG)sizeof(storage), &returned) < 0 ||
      returned < sizeof(UNICODE_STRING) || returned > sizeof(storage)) return 0;
  name = (UNICODE_STRING *)storage.bytes;
  first = (uintptr_t)storage.bytes;
  last = first + returned;
  start = (uintptr_t)name->Buffer;
  if (name->Length != sizeof(process_name) - sizeof(WCHAR) ||
      name->MaximumLength < name->Length || start < first || start > last ||
      name->Length > last - start ||
      memcmp(name->Buffer, process_name, name->Length) != 0) return 0;
  return WaitForSingleObject(handle, 0) == WAIT_TIMEOUT;
}

int wmain(int argc,wchar_t **argv) {
  /* This inert receiver shares actual metadata/framing/ACK/EOF, never a daemon session. */
  if(argc!=1){
    CmsparkBootstrapClient bootstrap;if(!d480_client_open(argc,argv,&bootstrap))return 71;
    char bytes[CMSPARK_BOOT_MAX+1];DWORD count=0;HANDLE parent=NULL;int result=71;
    if(!d480_client_body(&bootstrap,bytes,&count))goto receiver_done;
    const char* field=strstr(bytes,"\"parent_handle\":\"");if(!field)goto receiver_done;field+=strlen("\"parent_handle\":\"");
    if(*field<'1'||*field>'9')goto receiver_done;uint64_t number=0;
    while(*field>='0'&&*field<='9'){unsigned digit=(unsigned)(*field++-'0');if(number>(UINT64_MAX-digit)/10)goto receiver_done;number=number*10+digit;}
    if(strcmp(field,"\"}\n")||number>(uintptr_t)-1)goto receiver_done;parent=(HANDLE)(uintptr_t)number;
    char expected[CMSPARK_BOOT_MAX+1];int length=snprintf(expected,sizeof(expected),"{\"capability_id\":\"11111111111111111111111111111111\",\"secret\":\"2222222222222222222222222222222222222222222222222222222222222222\",\"url\":\"ws://127.0.0.1:1/desktop\",\"protocol_version\":1,\"issued_method_set_version\":1,\"parent_handle\":\"%llu\"}\n",(unsigned long long)number);
    if(length<=0||(DWORD)length!=count||memcmp(bytes,expected,count)||!d480_sync_parent(parent))goto receiver_done;
    int denied=GetEnvironmentVariableW(L"CMSPARK_DESKTOP_INERT_SECRET",NULL,0)||GetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",NULL,0);
    int required=GetEnvironmentVariableW(L"SystemRoot",NULL,0)&&GetEnvironmentVariableW(L"PATH",NULL,0)&&GetEnvironmentVariableW(L"TEMP",NULL,0);
    if(denied||!required){result=72;goto receiver_done;}
    if(d480_client_finish(&bootstrap,parent))result=0;
receiver_done:
    SecureZeroMemory(bytes,sizeof(bytes));d480_client_close(&bootstrap);if(parent)CloseHandle(parent);return result;
  }
  HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  query_object_fn query = ntdll ? (query_object_fn)GetProcAddress(ntdll, "NtQueryObject") : NULL;
  HANDLE current = GetCurrentProcess();
  HANDLE sync = NULL, extra = NULL, event = NULL, event_sync = NULL, closed;
  int minimal, extra_rejected, event_rejected, closed_rejected;
  int invalid_rejected, missing_query_rejected, no_query_right;
  if (!query ||
      !DuplicateHandle(current, current, current, &sync, SYNCHRONIZE, FALSE, 0) ||
      !DuplicateHandle(current, current, current, &extra,
                       SYNCHRONIZE | PROCESS_QUERY_LIMITED_INFORMATION, FALSE, 0)) goto setup_failure;
  event = CreateEventW(NULL, TRUE, FALSE, NULL);
  if (!event || !DuplicateHandle(current, event, current, &event_sync,
                                 SYNCHRONIZE, FALSE, 0)) goto setup_failure;
  minimal = accepts(query, sync);
  extra_rejected = !accepts(query, extra);
  event_rejected = !accepts(query, event_sync);
  invalid_rejected = !accepts(query, NULL) && !accepts(query, INVALID_HANDLE_VALUE);
  missing_query_rejected = !accepts(NULL, sync);
  SetLastError(ERROR_SUCCESS);
  no_query_right = GetProcessId(sync) == 0 && GetLastError() == ERROR_ACCESS_DENIED;
  /* No allocations/opening handles between close and the negative query. */
  closed = event_sync;
  CloseHandle(event_sync);
  event_sync = NULL;
  closed_rejected = !accepts(query, closed);
  CloseHandle(event); CloseHandle(extra); CloseHandle(sync);
  printf("{\"native\":true,\"scope\":\"own-process-api-only\",\"minimal_accepts\":%s,"
         "\"extra_rights_rejected\":%s,\"event_rejected\":%s,\"closed_rejected\":%s,"
         "\"invalid_rejected\":%s,\"missing_query_rejected\":%s,\"query_right_absent\":%s}\n",
         minimal ? "true" : "false", extra_rejected ? "true" : "false",
         event_rejected ? "true" : "false", closed_rejected ? "true" : "false",
         invalid_rejected ? "true" : "false", missing_query_rejected ? "true" : "false",
         no_query_right ? "true" : "false");
  return !(minimal && extra_rejected && event_rejected && closed_rejected &&
           invalid_rejected && missing_query_rejected && no_query_right);
setup_failure:
  if (event_sync) CloseHandle(event_sync);
  if (event) CloseHandle(event);
  if (extra) CloseHandle(extra);
  if (sync) CloseHandle(sync);
  puts("{\"native\":true,\"setup\":\"FAILED\"}");
  return 2;
}
#else
#include <stdio.h>
int main(void) { puts("{\"native\":false,\"status\":\"NOT_WINDOWS_NOT_RUN\"}"); return 77; }
#endif
