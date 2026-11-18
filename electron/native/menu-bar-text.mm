#import <AppKit/AppKit.h>
#import <objc/runtime.h>
#include <node_api.h>
#import "menu-bar-text-attributes.h"

using SetTitle = void (*)(id, SEL, NSAttributedString*);
static SetTitle originalSetTitle = nullptr;

static void SetOutlinedTitle(NSStatusBarButton* button,
                             SEL selector,
                             NSAttributedString* title) {
  originalSetTitle(button, selector, MenuBarTitleWithStroke(title));
}

static void RestoreTitleSetter(void*) {
  Class buttonClass = NSStatusBarButton.class;
  SEL selector = @selector(setAttributedTitle:);
  Method method = class_getInstanceMethod(buttonClass, selector);
  if (method_getImplementation(method) == reinterpret_cast<IMP>(SetOutlinedTitle)) {
    class_replaceMethod(buttonClass, selector, reinterpret_cast<IMP>(originalSetTitle),
                        method_getTypeEncoding(method));
  }
  originalSetTitle = nullptr;
}

static napi_value Initialize(napi_env env, napi_value exports) {
  if (![NSThread isMainThread]) {
    napi_throw_error(env, nullptr, "Menu bar text styling must run on the main thread");
    return nullptr;
  }
  if (!originalSetTitle) {
    Class buttonClass = NSStatusBarButton.class;
    SEL selector = @selector(setAttributedTitle:);
    Method method = class_getInstanceMethod(buttonClass, selector);
    originalSetTitle = reinterpret_cast<SetTitle>(method_getImplementation(method));
    IMP replacement = reinterpret_cast<IMP>(SetOutlinedTitle);
    // Add an override if the setter is inherited. Never replace NSButton's
    // implementation, which would also change unrelated application controls.
    if (!class_addMethod(buttonClass, selector, replacement, method_getTypeEncoding(method))) {
      class_replaceMethod(buttonClass, selector, replacement, method_getTypeEncoding(method));
    }
    napi_add_env_cleanup_hook(env, RestoreTitleSetter, nullptr);
  }
  return exports;
}

NAPI_MODULE(menu_bar_text, Initialize)
