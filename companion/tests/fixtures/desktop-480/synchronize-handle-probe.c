/* API feasibility only: own-process handles, no inherited parent/WebView proof. */
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <winternl.h>
#include <stdio.h>
#include <stdint.h>
#include <string.h>

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

int main(void) {
  /* With bootstrap input this is an inert addon receiver; never authenticate or emit values. */
  HANDLE input = GetStdHandle(STD_INPUT_HANDLE);
  if (input && input != INVALID_HANDLE_VALUE && GetFileType(input) == FILE_TYPE_PIPE) {
    char bytes[4097]; DWORD got = 0; size_t count = 0;
    while (ReadFile(input, bytes, (DWORD)sizeof(bytes), &got, NULL) && got) {
      count += got; if (count > 4096) return 71;
    }
    CloseHandle(input);
    if (count) {
      int denied = GetEnvironmentVariableW(L"CMSPARK_DESKTOP_INERT_SECRET", NULL, 0) ||
        GetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", NULL, 0);
      int required = GetEnvironmentVariableW(L"SystemRoot", NULL, 0) &&
        GetEnvironmentVariableW(L"PATH", NULL, 0) && GetEnvironmentVariableW(L"TEMP", NULL, 0);
      SecureZeroMemory(bytes, sizeof(bytes)); return denied || !required ? 72 : 0;
    }
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
