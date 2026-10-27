import Foundation
import WidgetKit

// Runs inside Electron's main process so WidgetCenter identifies the containing app.
@_cdecl("JZWidgetContainerPath")
public func widgetContainerPath() -> UnsafeMutablePointer<CChar>? {
  guard let group = Bundle.main.object(forInfoDictionaryKey: "JZWidgetAppGroup") as? String,
    let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
  else { return nil }
  return strdup(url.path)
}

@_cdecl("JZReloadWidgetTimelines")
public func reloadWidgetTimelines() {
  DispatchQueue.main.async { WidgetCenter.shared.reloadAllTimelines() }
}
