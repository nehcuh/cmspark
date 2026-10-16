/* #480 Windows-only one-shot local bootstrap. No inherited protected handle or helper process.
 * Synchronous PIPE_NOWAIT: no pending OVERLAPPED operation or cancellation lifetime. */
#ifndef CMSPARK_WINDOWS_BOOTSTRAP_H
#define CMSPARK_WINDOWS_BOOTSTRAP_H
#ifndef _WIN32
#error Windows bootstrap is Windows-only
#endif
#include <windows.h>
#include <stdint.h>
#include <stddef.h>
#include <wchar.h>
#include <string.h>
#define CMSPARK_BOOT_MAX 4096u
#define CMSPARK_BOOT_BUDGET 20000u
#define CMSPARK_BOOT_FLAG L"--cmspark-bootstrap-v1"
static int d480_live(HANDLE process) {
  return process && process != INVALID_HANDLE_VALUE && WaitForSingleObject(process, 0) == WAIT_TIMEOUT;
}
static int d480_now(HANDLE process, ULONGLONG deadline) {
  return GetTickCount64() < deadline && d480_live(process) && GetTickCount64() < deadline;
}
static int d480_pause(HANDLE process, ULONGLONG deadline) {
  ULONGLONG now = GetTickCount64();
  if (now >= deadline || WaitForSingleObject(process, 1) != WAIT_TIMEOUT) return 0;
  return GetTickCount64() < deadline;
}
static int d480_noninherit(HANDLE handle) {
  DWORD flags = 0;
  return handle && handle != INVALID_HANDLE_VALUE && GetHandleInformation(handle, &flags) && !(flags & HANDLE_FLAG_INHERIT);
}
static int d480_write(HANDLE pipe, HANDLE peer, ULONGLONG deadline, const unsigned char *bytes, DWORD length) {
  DWORD offset = 0;
  while (offset < length) {
    DWORD wrote = 0;
    if (!d480_now(peer, deadline) || !WriteFile(pipe, bytes + offset, length - offset, &wrote, NULL) || wrote > length - offset || !d480_now(peer, deadline)) return 0;
    offset += wrote;
    if (!wrote && !d480_pause(peer, deadline)) return 0;
  }
  return 1;
}
static int d480_read(HANDLE pipe, HANDLE peer, ULONGLONG deadline, unsigned char *bytes, DWORD length) {
  DWORD offset = 0;
  while (offset < length) {
    DWORD got = 0;
    if (!d480_now(peer, deadline)) return 0;
    if (!ReadFile(pipe, bytes + offset, length - offset, &got, NULL)) {
      if (GetLastError() != ERROR_NO_DATA || !d480_pause(peer, deadline)) return 0;
      continue;
    }
    if (!got || got > length - offset || !d480_now(peer, deadline)) return 0;
    offset += got;
  }
  return 1;
}
static ULONGLONG d480_filetime(FILETIME value) {
  return ((ULONGLONG)value.dwHighDateTime << 32) | value.dwLowDateTime;
}
#ifdef CMSPARK_BOOTSTRAP_PARENT
#include <bcrypt.h>
#pragma comment(lib, "bcrypt.lib")
typedef struct CmsparkBootstrapServer {
  HANDLE pipe, parent;
  wchar_t suffix[33];
  DWORD issuer_pid;
  ULONGLONG creation, deadline;
} CmsparkBootstrapServer;
static void d480_server_close(CmsparkBootstrapServer *state) {
  if (state->pipe && state->pipe != INVALID_HANDLE_VALUE) CloseHandle(state->pipe);
  if (state->parent) CloseHandle(state->parent);
  state->pipe = NULL; state->parent = NULL;
}
static int d480_server_open(CmsparkBootstrapServer *state) {
  memset(state, 0, sizeof(*state));
  ULONGLONG now = GetTickCount64(); if (now > UINT64_MAX - CMSPARK_BOOT_BUDGET) return 0;
  state->deadline = now + CMSPARK_BOOT_BUDGET;
  unsigned char random[16];
  if (BCryptGenRandom(NULL, random, sizeof(random), BCRYPT_USE_SYSTEM_PREFERRED_RNG) < 0) return 0;
  static const wchar_t digits[] = L"0123456789abcdef";
  for (unsigned i = 0; i < sizeof(random); ++i) { state->suffix[i * 2] = digits[random[i] >> 4]; state->suffix[i * 2 + 1] = digits[random[i] & 15]; }
  SecureZeroMemory(random, sizeof(random));
  state->issuer_pid = GetCurrentProcessId();
  FILETIME created, exited, kernel, user;
  if (!GetProcessTimes(GetCurrentProcess(), &created, &exited, &kernel, &user)) return 0;
  state->creation = d480_filetime(created);
  wchar_t name[96];
  if (swprintf_s(name, sizeof(name) / sizeof(name[0]), L"\\\\.\\pipe\\cmspark-desktop-%ls", state->suffix) < 0) return 0;
  SECURITY_ATTRIBUTES sa = { sizeof(sa), NULL, FALSE };
  state->pipe = CreateNamedPipeW(name, PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE,
    PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_NOWAIT | PIPE_REJECT_REMOTE_CLIENTS,
    1, CMSPARK_BOOT_MAX + 4, 1, CMSPARK_BOOT_BUDGET, &sa);
  if (state->pipe == INVALID_HANDLE_VALUE || !d480_noninherit(state->pipe) ||
      !DuplicateHandle(GetCurrentProcess(), GetCurrentProcess(), GetCurrentProcess(), &state->parent, SYNCHRONIZE, FALSE, 0) ||
      !d480_noninherit(state->parent) || GetTickCount64() >= state->deadline) { d480_server_close(state); return 0; }
  return 1;
}
static int d480_server_command(const CmsparkBootstrapServer *state, const wchar_t *binary, wchar_t *command, size_t capacity) {
  if (!binary || !*binary || wcschr(binary, L'"')) return 0;
  int count = swprintf_s(command, capacity, L"\"%ls\" %ls %ls %lu %llu %llu", binary, CMSPARK_BOOT_FLAG,
    state->suffix, (unsigned long)state->issuer_pid, (unsigned long long)state->creation, (unsigned long long)state->deadline);
  return count > 0 && (size_t)count < capacity;
}
static int d480_server_peer(const CmsparkBootstrapServer *state, HANDLE process, DWORD pid) {
  ULONG actual = 0;
  return d480_now(process, state->deadline) && GetNamedPipeClientProcessId(state->pipe, &actual) && actual == pid && d480_now(process, state->deadline);
}
static int d480_server_bind(CmsparkBootstrapServer *state, HANDLE process, DWORD pid, HANDLE *target_parent) {
  *target_parent = NULL;
  for (;;) {
    if (!d480_now(process, state->deadline)) return 0;
    if (ConnectNamedPipe(state->pipe, NULL)) { if (!d480_pause(process, state->deadline)) return 0; continue; }
    DWORD error = GetLastError();
    if (error == ERROR_PIPE_CONNECTED) break;
    if (error != ERROR_PIPE_LISTENING || !d480_pause(process, state->deadline)) return 0;
  }
  if (!d480_server_peer(state, process, pid)) return 0;
  return DuplicateHandle(GetCurrentProcess(), state->parent, process, target_parent, SYNCHRONIZE, FALSE, 0) && *target_parent && d480_server_peer(state, process, pid);
}
static int d480_server_send(CmsparkBootstrapServer *state, HANDLE process, DWORD pid, const char *body, DWORD length) {
  unsigned char frame[CMSPARK_BOOT_MAX + 4], ack = 0; int valid = 0;
  if (!length || length > CMSPARK_BOOT_MAX || !d480_server_peer(state, process, pid)) goto done;
  frame[0] = (unsigned char)length; frame[1] = (unsigned char)(length >> 8);
  frame[2] = (unsigned char)(length >> 16); frame[3] = (unsigned char)(length >> 24);
  memcpy(frame + 4, body, length);
  valid = d480_write(state->pipe, process, state->deadline, frame, length + 4) &&
    d480_read(state->pipe, process, state->deadline, &ack, 1) && ack == 1 && d480_server_peer(state, process, pid);
done:
  SecureZeroMemory(frame, sizeof(frame));
  d480_server_close(state); /* Fixed ACK proves body consumption before closing; no flush. */
  return valid;
}
#endif
#ifdef CMSPARK_BOOTSTRAP_CHILD
#include <winternl.h>
static int d480_eof(HANDLE pipe, HANDLE peer, ULONGLONG deadline) {
  for (;;) {
    unsigned char byte = 0; DWORD got = 0;
    if (!d480_now(peer, deadline)) return 0;
    if (ReadFile(pipe, &byte, 1, &got, NULL)) return 0; /* Extra data or TRUE/zero is never EOF. */
    DWORD error = GetLastError();
    if (error == ERROR_BROKEN_PIPE) return d480_now(peer, deadline);
    if (error != ERROR_NO_DATA || !d480_pause(peer, deadline)) return 0;
  }
}
static int d480_creation(HANDLE process, ULONGLONG expected) {
  FILETIME created, exited, kernel, user;
  return GetProcessTimes(process, &created, &exited, &kernel, &user) && d480_filetime(created) == expected && d480_live(process);
}

typedef struct CmsparkBootstrapClient {
  HANDLE pipe, issuer;
  ULONGLONG creation, deadline;
} CmsparkBootstrapClient;
static void d480_client_close(CmsparkBootstrapClient *state) {
  if (state->pipe && state->pipe != INVALID_HANDLE_VALUE) CloseHandle(state->pipe);
  if (state->issuer) CloseHandle(state->issuer);
  state->pipe = NULL; state->issuer = NULL;
}
static int d480_decimal(const wchar_t *text, ULONGLONG *value) {
  if (!text || !*text || text[0] == L'0') return 0;
  ULONGLONG result = 0;
  for (const wchar_t *p = text; *p; ++p) {
    if (*p < L'0' || *p > L'9') return 0;
    unsigned digit = (unsigned)(*p - L'0');
    if (result > (UINT64_MAX - digit) / 10) return 0;
    result = result * 10 + digit;
  }
  *value = result; return 1;
}
static int d480_client_open(int argc, wchar_t **argv, CmsparkBootstrapClient *state) {
  memset(state, 0, sizeof(*state));
  if (argc != 6 || wcscmp(argv[1], CMSPARK_BOOT_FLAG) || wcslen(argv[2]) != 32) return 0;
  for (unsigned i = 0; i < 32; ++i) if (!((argv[2][i] >= L'0' && argv[2][i] <= L'9') || (argv[2][i] >= L'a' && argv[2][i] <= L'f'))) return 0;
  ULONGLONG pid = 0;
  if (!d480_decimal(argv[3], &pid) || pid > UINT32_MAX || !d480_decimal(argv[4], &state->creation) || !d480_decimal(argv[5], &state->deadline)) return 0;
  ULONGLONG now = GetTickCount64();
  if (now >= state->deadline || state->deadline - now > CMSPARK_BOOT_BUDGET) return 0;
  wchar_t name[96];
  if (swprintf_s(name, sizeof(name) / sizeof(name[0]), L"\\\\.\\pipe\\cmspark-desktop-%ls", argv[2]) < 0) return 0;
  SECURITY_ATTRIBUTES sa = { sizeof(sa), NULL, FALSE };
  state->pipe = CreateFileW(name, GENERIC_READ | GENERIC_WRITE, 0, &sa, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
  DWORD mode = PIPE_READMODE_BYTE | PIPE_NOWAIT; ULONG actual_pid = 0;
  if (state->pipe == INVALID_HANDLE_VALUE || !d480_noninherit(state->pipe) || !SetNamedPipeHandleState(state->pipe, &mode, NULL, NULL) ||
      !GetNamedPipeServerProcessId(state->pipe, &actual_pid) || actual_pid != (DWORD)pid) goto bad;
  state->issuer = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE, FALSE, actual_pid);
  if (!d480_noninherit(state->issuer) || !d480_creation(state->issuer, state->creation) || !d480_now(state->issuer, state->deadline)) goto bad;
  return 1;
bad:
  d480_client_close(state); return 0;
}
static int d480_client_body(CmsparkBootstrapClient *state, char body[CMSPARK_BOOT_MAX + 1], DWORD *length) {
  unsigned char header[4]; *length = 0;
  if (!d480_read(state->pipe, state->issuer, state->deadline, header, 4)) goto bad;
  *length = (DWORD)header[0] | ((DWORD)header[1] << 8) | ((DWORD)header[2] << 16) | ((DWORD)header[3] << 24);
  if (!*length || *length > CMSPARK_BOOT_MAX || !d480_read(state->pipe, state->issuer, state->deadline, (unsigned char *)body, *length)) goto bad;
  body[*length] = 0; return 1;
bad:
  SecureZeroMemory(body, CMSPARK_BOOT_MAX + 1); *length = 0; return 0;
}
/* Only a target-context Process handle with EXACT SYNCHRONIZE rights is a watcher. */
static int d480_sync_parent(HANDLE handle) {
  typedef NTSTATUS (NTAPI *Query)(HANDLE, OBJECT_INFORMATION_CLASS, PVOID, ULONG, PULONG);
  Query query = (Query)GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "NtQueryObject");
  struct Basic { ULONG attributes; ACCESS_MASK access; ULONG handles, pointers, reserved[10]; } basic;
  union Storage { void *alignment; unsigned char bytes[4096]; } storage;
  ULONG returned = 0; memset(&basic, 0, sizeof(basic)); memset(&storage, 0, sizeof(storage));
  if (!query || !d480_noninherit(handle) || query(handle, (OBJECT_INFORMATION_CLASS)0, &basic, sizeof(basic), &returned) < 0 || returned < sizeof(basic) || basic.access != SYNCHRONIZE) return 0;
  if (query(handle, (OBJECT_INFORMATION_CLASS)2, &storage, sizeof(storage), &returned) < 0 || returned < sizeof(UNICODE_STRING) || returned > sizeof(storage)) return 0;
  UNICODE_STRING *name = (UNICODE_STRING *)storage.bytes;
  uintptr_t first = (uintptr_t)storage.bytes, last = first + returned, start = (uintptr_t)name->Buffer;
  if (name->Length != 7 * sizeof(wchar_t) || name->MaximumLength < name->Length || start < first || start > last || name->Length > last - start || memcmp(name->Buffer, L"Process", name->Length)) return 0;
  return d480_live(handle);
}
static int d480_client_finish(CmsparkBootstrapClient *state, HANDLE target_parent) {
  unsigned char ack = 1;
  int valid = d480_creation(state->issuer, state->creation) && d480_sync_parent(target_parent) &&
    d480_write(state->pipe, state->issuer, state->deadline, &ack, 1) &&
    d480_eof(state->pipe, state->issuer, state->deadline) && d480_creation(state->issuer, state->creation) &&
    d480_now(state->issuer, state->deadline);
  return valid; /* Caller owns and closes pipe+temporary query handle before any UI. */
}
#endif
#endif
