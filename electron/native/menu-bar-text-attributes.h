#import <AppKit/AppKit.h>

static inline NSAttributedString* MenuBarTitleWithStroke(NSAttributedString* title) {
  NSMutableAttributedString* outlined = [title mutableCopy];
  if (outlined.length > 0) {
    // A negative width preserves the existing fill. At 13pt this is a 0.5pt
    // stroke, matching the template-name stroke in the hidden renderer.
    [outlined addAttributes:@{
      NSStrokeWidthAttributeName : @(-100.0 * 0.5 / 13.0),
      // Keep the color dynamic, just like ordinary neutral control text.
      NSStrokeColorAttributeName : NSColor.controlTextColor
    }
                       range:NSMakeRange(0, outlined.length)];
  }
  return outlined;
}
