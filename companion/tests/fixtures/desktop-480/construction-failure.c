/* Test build only: fault one constructor operation, observe only our direct child. */
#include <node_api.h>
#include <pthread.h>
#include <spawn.h>
#include <sys/wait.h>
#include <errno.h>
#include <string.h>
static pid_t fixture_owned_pid = -1;
static int fixture_spawn(pid_t *pid, const char *path, const posix_spawn_file_actions_t *actions,
                         const posix_spawnattr_t *attributes, char *const argv[], char *const envp[]) {
  int result = posix_spawn(pid, path, actions, attributes, argv, envp);
  if (!result) fixture_owned_pid = *pid;
  return result;
}
#define posix_spawn fixture_spawn
#ifdef DESKTOP_FIXTURE_FAIL_NOTIFY
#define napi_create_threadsafe_function(env, fn, resource, name, maximum, threads, data, finalize, context, call, out) \
  ((void)(env), (void)(fn), (void)(resource), (void)(name), (void)(maximum), (void)(threads), \
   (void)(data), (void)(finalize), (void)(context), (void)(call), (void)(out), napi_generic_failure)
#endif
#ifdef DESKTOP_FIXTURE_FAIL_WORKER
#define pthread_create(thread, attr, start, data) ((void)(thread), (void)(attr), (void)(start), (void)(data), EAGAIN)
#endif
#undef NAPI_MODULE
#define NAPI_MODULE(module_name, register_function)
#include "../../../src/desktop/native/launcher.c"
#undef posix_spawn
#undef pthread_create
#undef napi_create_threadsafe_function
static napi_value inspect_owned(napi_env env, napi_callback_info info) {
  (void)info;
  napi_value object, value;
  napi_create_object(env, &object);
  siginfo_t observed; memset(&observed, 0, sizeof(observed));
  errno = 0;
  int result = fixture_owned_pid > 0
    ? waitid(P_PID, (id_t)fixture_owned_pid, &observed, WEXITED | WNOHANG | WNOWAIT) : -1;
  int error = errno;
  napi_create_int32(env, fixture_owned_pid, &value); napi_set_named_property(env, object, "owned_pid", value);
  napi_get_boolean(env, result == -1 && error == ECHILD, &value); napi_set_named_property(env, object, "reaped", value);
  napi_get_boolean(env, result == 0 && observed.si_pid == fixture_owned_pid, &value); napi_set_named_property(env, object, "exited_unreaped", value);
  napi_create_int32(env, result, &value); napi_set_named_property(env, object, "waitid_result", value);
  napi_create_int32(env, error, &value); napi_set_named_property(env, object, "waitid_errno", value);
  return object;
}
NAPI_MODULE_INIT() {
  napi_value out = init(env, exports), fn;
  napi_create_function(env, "inspectOwned", NAPI_AUTO_LENGTH, inspect_owned, NULL, &fn);
  napi_set_named_property(env, out, "inspectOwned", fn);
  return out;
}
