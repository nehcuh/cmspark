/* Test-only controlled inheritable descriptor. Never linked into product addon. */
#include <node_api.h>
#include <fcntl.h>
#include <unistd.h>
static napi_value create(napi_env env, napi_callback_info info) {
  (void)info;int fd=open("/dev/null",O_RDONLY);if(fd<0 || fcntl(fd,F_SETFD,0)<0){if(fd>=0)close(fd);napi_throw_error(env,NULL,"Owned sentinel setup failed");return NULL;}
  napi_value value;napi_create_int32(env,fd,&value);return value;
}
static napi_value init(napi_env env,napi_value exports){napi_value fn;napi_create_function(env,"create",NAPI_AUTO_LENGTH,create,NULL,&fn);napi_set_named_property(env,exports,"create",fn);return exports;}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
