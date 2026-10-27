#include <node_api.h>
#include <stdlib.h>

extern char *JZWidgetContainerPath(void);
extern void JZReloadWidgetTimelines(void);

static napi_value container_path(napi_env env, napi_callback_info info) {
  (void)info;
  char *path = JZWidgetContainerPath();
  if (path == NULL) {
    napi_throw_error(env, NULL, "无法访问小组件共享容器，请检查应用签名及 App Groups 权限");
    return NULL;
  }
  napi_value result;
  napi_create_string_utf8(env, path, NAPI_AUTO_LENGTH, &result);
  free(path);
  return result;
}

static napi_value reload_timelines(napi_env env, napi_callback_info info) {
  (void)info;
  JZReloadWidgetTimelines();
  napi_value result;
  napi_get_undefined(env, &result);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value path_function, reload_function;
  napi_create_function(env, "containerPath", NAPI_AUTO_LENGTH, container_path, NULL, &path_function);
  napi_create_function(env, "reloadTimelines", NAPI_AUTO_LENGTH, reload_timelines, NULL, &reload_function);
  napi_set_named_property(env, exports, "containerPath", path_function);
  napi_set_named_property(env, exports, "reloadTimelines", reload_function);
  return exports;
}
