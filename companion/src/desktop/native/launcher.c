/* #480 daemon-only C Node-API launcher; no secret-forwarding process or wrapper. */
#include <node_api.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <stdint.h>
#include <wchar.h>
#ifdef _WIN32
#include <windows.h>
#include <process.h>
#define CMSPARK_BOOTSTRAP_PARENT
#include "windows-bootstrap.h"
#else
#include <pthread.h>
#include <spawn.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <sys/wait.h>
#include <errno.h>
#endif
#define BOOT_MAX 4096

typedef struct Child {
  napi_env env;
  napi_threadsafe_function notify;
  volatile long refs;
  int alive;
  int cleaning;
#ifdef _WIN32
  CRITICAL_SECTION lock;
  HANDLE process;
#else
  pthread_mutex_t lock;
  pid_t pid;
#endif
} Child;
static void lock_child(Child *c) {
#ifdef _WIN32
  EnterCriticalSection(&c->lock);
#else
  pthread_mutex_lock(&c->lock);
#endif
}
static void unlock_child(Child *c) {
#ifdef _WIN32
  LeaveCriticalSection(&c->lock);
#else
  pthread_mutex_unlock(&c->lock);
#endif
}
static void terminate_child(Child *c) {
  lock_child(c);
  if (c->alive) {
#ifdef _WIN32
    TerminateProcess(c->process, 1); /* owned process HANDLE, never a supplied PID */
#else
    kill(c->pid, SIGTERM); /* waiter does not reap until holding this same lock */
#endif
  }
  unlock_child(c);
}
/* Construction failed before a waiter exists: retain ownership until reaped/closed. */
static void reap_unwatched(Child *c) {
  lock_child(c);
  if (c->alive) {
#ifdef _WIN32
    TerminateProcess(c->process, 1);
    WaitForSingleObject(c->process, INFINITE);
    CloseHandle(c->process); c->process = NULL;
#else
    kill(c->pid, SIGKILL);
    while (waitpid(c->pid, NULL, 0) < 0 && errno == EINTR) {}
#endif
    c->alive = 0;
  }
  unlock_child(c);
}
static void cleanup(void *data) { Child *c = data; c->cleaning = 1; terminate_child(c); }
static void release(Child *c, napi_env env) {
#ifdef _WIN32
  long remaining = InterlockedDecrement(&c->refs);
#else
  long remaining = __sync_sub_and_fetch(&c->refs, 1);
#endif
  if (!remaining) {
    if (env && !c->cleaning) napi_remove_env_cleanup_hook(env, cleanup, c);
#ifdef _WIN32
    DeleteCriticalSection(&c->lock);
#else
    pthread_mutex_destroy(&c->lock);
#endif
    free(c);
  }
}
static void finalize_object(napi_env env, void *data, void *hint) { (void)hint; terminate_child(data); release(data, env); }
static void finalize_notify(napi_env env, void *data, void *hint) { (void)hint; release(data, env); }
static void js_exit(napi_env env, napi_value callback, void *context, void *data) {
  (void)context;
  if (!env || !callback) return;
  napi_value global, code, ignored;
  napi_get_undefined(env, &global);
  napi_create_int32(env, (int)(intptr_t)data, &code);
  napi_call_function(env, global, callback, 1, &code, &ignored);
}
#ifdef _WIN32
static wchar_t *host_environment(void) {
  /* OS paths only: no provider, WebView2 overrides, proxy or user PATH inheritance. */
  wchar_t *windows = malloc(32768 * sizeof(wchar_t)), *temporary = malloc(32768 * sizeof(wchar_t));
  if (!windows || !temporary) { free(windows); free(temporary); return NULL; }
  UINT wn = GetWindowsDirectoryW(windows, 32768); DWORD tn = GetTempPathW(32768, temporary);
  if (!wn || wn >= 32768 || !tn || tn >= 32768) { free(windows); free(temporary); return NULL; }
  size_t capacity = (size_t)wn * 3 + (size_t)tn * 2 + 64;
  wchar_t *result = calloc(capacity, sizeof(wchar_t)); size_t used = 0;
  if (result) {
    int n = swprintf(result, capacity, L"PATH=%ls\\System32;%ls", windows, windows);
    if (n < 0) { free(result); result = NULL; } else {
      used = (size_t)n + 1;
      n = swprintf(result + used, capacity - used, L"SystemRoot=%ls", windows);
      if (n < 0) { free(result); result = NULL; } else {
        used += (size_t)n + 1;
        n = swprintf(result + used, capacity - used, L"TEMP=%ls", temporary);
        if (n < 0) { free(result); result = NULL; } else {
          used += (size_t)n + 1;
          n = swprintf(result + used, capacity - used, L"TMP=%ls", temporary);
          if (n < 0) { free(result); result = NULL; }
        }
      }
    }
  }
  free(windows); free(temporary); return result;
}
static unsigned __stdcall waiter(void *data) {
  Child *c = data; DWORD code = 1;
  WaitForSingleObject(c->process, INFINITE);
  lock_child(c); GetExitCodeProcess(c->process, &code); c->alive = 0; CloseHandle(c->process); c->process = NULL; unlock_child(c);
  if (!c->cleaning) napi_call_threadsafe_function(c->notify, (void *)(intptr_t)code, napi_tsfn_nonblocking);
  napi_release_threadsafe_function(c->notify, napi_tsfn_release);
  return 0;
}
#else
static void *waiter(void *data) {
  Child *c = data; siginfo_t info; int result, status = 1;
  /* WNOWAIT retains the owned zombie/PID until the lock serializes reap vs kill. */
  do { result = waitid(P_PID, (id_t)c->pid, &info, WEXITED | WNOWAIT); } while (result < 0 && errno == EINTR);
  lock_child(c);
  if (result == 0) { while (waitpid(c->pid, &status, 0) < 0 && errno == EINTR) {} }
  c->alive = 0; unlock_child(c);
  int code = result < 0 ? 1 : WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
  if (!c->cleaning) napi_call_threadsafe_function(c->notify, (void *)(intptr_t)code, napi_tsfn_nonblocking);
  napi_release_threadsafe_function(c->notify, napi_tsfn_release);
  return NULL;
}
#endif
static napi_value terminate(napi_env env, napi_callback_info info) {
  void *data; napi_get_cb_info(env, info, NULL, NULL, NULL, &data); terminate_child(data);
  napi_value out; napi_get_undefined(env, &out); return out;
}
static char *string_arg(napi_env env, napi_value value, size_t max) {
  napi_valuetype type; size_t len;
  if (napi_typeof(env, value, &type) != napi_ok || type != napi_string || napi_get_value_string_utf8(env, value, NULL, 0, &len) != napi_ok || len > max) return NULL;
  char *out = malloc(len + 1); if (!out) return NULL;
  napi_get_value_string_utf8(env, value, out, len + 1, &len);
  if (strlen(out) != len) { free(out); return NULL; } return out;
}
static int hex(const char *s, size_t n) { if (!s || strlen(s) != n) return 0; for (size_t i = 0; i < n; i++) if (!((s[i] >= '0' && s[i] <= '9') || (s[i] >= 'a' && s[i] <= 'f'))) return 0; return 1; }
static int endpoint(const char *s) {
  const char *prefix = "ws://127.0.0.1:"; if (!s || strncmp(s, prefix, strlen(prefix))) return 0;
  const char *p = s + strlen(prefix); unsigned port = 0; int count = 0;
  while (*p >= '0' && *p <= '9') { if (++count > 5) return 0; port = port * 10 + (unsigned)(*p++ - '0'); }
  return count && port && port <= 65535 && !strcmp(p, "/desktop");
}
static napi_value launch(napi_env env, napi_callback_info info) {
  size_t argc = 5; napi_value args[5]; napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  char *binary = NULL, *cap = NULL, *secret = NULL, *url = NULL; Child *c = NULL; char boot[BOOT_MAX + 1]; int length = -1;
  napi_valuetype callback_type;
  if (argc != 5) goto error;
  binary = string_arg(env, args[0], BOOT_MAX); cap = string_arg(env, args[1], 32); secret = string_arg(env, args[2], 64); url = string_arg(env, args[3], BOOT_MAX);
  if (!binary || !hex(cap, 32) || !hex(secret, 64) || !endpoint(url) || napi_typeof(env, args[4], &callback_type) != napi_ok || callback_type != napi_function) goto error;
  c = calloc(1, sizeof(*c)); if (!c) goto error; c->env = env; c->refs = 2;
#ifdef _WIN32
  InitializeCriticalSection(&c->lock);
  CmsparkBootstrapServer channel; memset(&channel, 0, sizeof(channel));
  PROCESS_INFORMATION pi; STARTUPINFOW startup; memset(&pi, 0, sizeof(pi)); memset(&startup, 0, sizeof(startup)); startup.cb = sizeof(startup);
  if (!d480_server_open(&channel)) goto win_error;
  int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, binary, -1, NULL, 0); wchar_t *exe = n ? malloc((size_t)n * sizeof(wchar_t)) : NULL;
  wchar_t command[4608];
  if (!exe || !MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, binary, -1, exe, n) || !d480_server_command(&channel, exe, command, sizeof(command) / sizeof(command[0]))) { free(exe); goto win_error; }
  wchar_t *environment = host_environment();
  if (!environment) { free(exe); goto win_error; }
  BOOL created = CreateProcessW(exe, command, NULL, NULL, FALSE, CREATE_UNICODE_ENVIRONMENT, environment, NULL, &startup, &pi); free(environment); free(exe);
  if (!created) goto win_error;
  CloseHandle(pi.hThread); c->process = pi.hProcess; c->alive = 1;
  HANDLE target_parent = NULL;
  if (!d480_server_bind(&channel, c->process, pi.dwProcessId, &target_parent)) goto win_error;
  length = snprintf(boot, sizeof(boot), "{\"capability_id\":\"%s\",\"secret\":\"%s\",\"url\":\"%s\",\"protocol_version\":1,\"issued_method_set_version\":5,\"parent_handle\":\"%llu\"}\n", cap, secret, url, (unsigned long long)(uintptr_t)target_parent);
  if (length < 0 || length > BOOT_MAX || !d480_server_send(&channel, c->process, pi.dwProcessId, boot, (DWORD)length)) goto win_error;
#else
  pthread_mutex_init(&c->lock, NULL);
  int initial[2]; if (pipe(initial)) goto error;
  /* Daemons may legitimately have closed stdio. File actions must not collide with it. */
  int pipes[2] = { fcntl(initial[0], F_DUPFD_CLOEXEC, 3), -1 };
  if (pipes[0] >= 0) pipes[1] = fcntl(initial[1], F_DUPFD_CLOEXEC, 3);
  close(initial[0]); close(initial[1]);
  if (pipes[0] < 0 || pipes[1] < 0) { if (pipes[0] >= 0) close(pipes[0]); if (pipes[1] >= 0) close(pipes[1]); goto error; }
  length = snprintf(boot, sizeof(boot), "{\"capability_id\":\"%s\",\"secret\":\"%s\",\"url\":\"%s\",\"protocol_version\":1,\"issued_method_set_version\":5}\n", cap, secret, url);
  if (length < 0 || length > BOOT_MAX) { close(pipes[0]); close(pipes[1]); goto error; }
  posix_spawn_file_actions_t actions;
  if (posix_spawn_file_actions_init(&actions)) { close(pipes[0]); close(pipes[1]); goto error; }
  int configured = posix_spawn_file_actions_adddup2(&actions, pipes[0], STDIN_FILENO);
  if (!configured) configured = posix_spawn_file_actions_addopen(&actions, STDOUT_FILENO, "/dev/null", O_WRONLY, 0);
  if (!configured) configured = posix_spawn_file_actions_addopen(&actions, STDERR_FILENO, "/dev/null", O_WRONLY, 0);
  if (!configured) configured = posix_spawn_file_actions_addclose(&actions, pipes[0]);
  if (!configured) configured = posix_spawn_file_actions_addclose(&actions, pipes[1]);
  char *argv[] = { binary, NULL }; char *envp[] = { "PATH=/usr/bin:/bin", "LANG=en_US.UTF-8", NULL };
  posix_spawnattr_t attrs;
  if (configured || posix_spawnattr_init(&attrs)) { posix_spawn_file_actions_destroy(&actions); close(pipes[0]); close(pipes[1]); goto error; }
#ifdef __APPLE__
  configured = posix_spawnattr_setflags(&attrs, POSIX_SPAWN_CLOEXEC_DEFAULT);
#endif
  int spawned = configured ? configured : posix_spawn(&c->pid, binary, &actions, &attrs, argv, envp);
  posix_spawnattr_destroy(&attrs);
  posix_spawn_file_actions_destroy(&actions); close(pipes[0]);
  if (spawned) { close(pipes[1]); goto error; }
  c->alive = 1;
  size_t sent = 0;
  while (sent < (size_t)length) { ssize_t n = write(pipes[1], boot + sent, (size_t)length - sent); if (n < 0 && errno == EINTR) continue; if (n <= 0) break; sent += (size_t)n; }
  close(pipes[1]);
  if (sent != (size_t)length) { kill(c->pid, SIGKILL); waitpid(c->pid, NULL, 0); c->alive = 0; goto error; }
#endif
  memset(boot, 0, sizeof(boot)); memset(secret, 0, strlen(secret)); free(secret); secret = NULL; free(binary); binary = NULL; free(cap); cap = NULL; free(url); url = NULL;
  napi_value name, object, fn;
  napi_create_string_utf8(env, "desktop-owned-host-exit", NAPI_AUTO_LENGTH, &name);
  if (napi_create_threadsafe_function(env, args[4], NULL, name, 0, 1, c, finalize_notify, c, js_exit, &c->notify) != napi_ok) { reap_unwatched(c); goto error; }
  napi_create_object(env, &object); napi_create_function(env, "terminate", NAPI_AUTO_LENGTH, terminate, c, &fn); napi_set_named_property(env, object, "terminate", fn);
  napi_add_env_cleanup_hook(env, cleanup, c); napi_add_finalizer(env, object, c, finalize_object, NULL, NULL);
#ifdef _WIN32
  uintptr_t thread = _beginthreadex(NULL, 0, waiter, c, 0, NULL);
  if (!thread) { reap_unwatched(c); napi_call_threadsafe_function(c->notify, (void *)(intptr_t)1, napi_tsfn_nonblocking); napi_release_threadsafe_function(c->notify, napi_tsfn_release); return object; } CloseHandle((HANDLE)thread);
#else
  pthread_t thread; if (pthread_create(&thread, NULL, waiter, c)) { reap_unwatched(c); napi_call_threadsafe_function(c->notify, (void *)(intptr_t)1, napi_tsfn_nonblocking); napi_release_threadsafe_function(c->notify, napi_tsfn_release); return object; } pthread_detach(thread);
#endif
  return object;
#ifdef _WIN32
win_error:
  d480_server_close(&channel);
  if (c->alive) reap_unwatched(c);
#endif
error:
  memset(boot, 0, sizeof(boot)); if (secret) { memset(secret, 0, strlen(secret)); free(secret); } free(binary); free(cap); free(url);
  if (c) {
#ifdef _WIN32
    DeleteCriticalSection(&c->lock);
#else
    pthread_mutex_destroy(&c->lock);
#endif
    free(c);
  }
  napi_throw_error(env, "DESKTOP_LAUNCH_FAILED", "Native desktop launch failed"); return NULL;
}
static napi_value init(napi_env env, napi_value exports) { napi_value fn; napi_create_function(env, "launch", NAPI_AUTO_LENGTH, launch, NULL, &fn); napi_set_named_property(env, exports, "launch", fn); return exports; }
NAPI_MODULE(NODE_GYP_MODULE_NAME, init)
