#import "../menu-bar-text-attributes.h"
#include <cassert>
#include <cmath>

// Attribute-only unit test: no application, status item, window or drawing.
int main() {
  @autoreleasepool {
    NSMutableAttributedString* original =
        [[NSMutableAttributedString alloc] initWithString:@"名称 +1.00% -2.00%"
                                              attributes:@{NSKernAttributeName : @1.5}];
    NSRange positive = [original.string rangeOfString:@"+1.00%"];
    NSRange negative = [original.string rangeOfString:@"-2.00%"];
    [original addAttribute:NSForegroundColorAttributeName value:NSColor.redColor range:positive];
    [original addAttribute:NSForegroundColorAttributeName value:NSColor.greenColor range:negative];
    NSAttributedString* outlined = MenuBarTitleWithStroke(original);
    assert([outlined.string isEqualToString:original.string]);
    assert([original attribute:NSStrokeWidthAttributeName atIndex:0 effectiveRange:nullptr] == nil);
    for (NSUInteger index = 0; index < outlined.length; ++index) {
      NSDictionary* attributes = [outlined attributesAtIndex:index effectiveRange:nullptr];
      double width = [attributes[NSStrokeWidthAttributeName] doubleValue];
      assert(width < 0 && std::abs(width * 13.0 / 100.0 + 0.5) < 0.0001);
      assert([attributes[NSStrokeColorAttributeName] isEqual:NSColor.controlTextColor]);
      assert([attributes[NSKernAttributeName] doubleValue] == 1.5);
      id before = [original attribute:NSForegroundColorAttributeName atIndex:index effectiveRange:nullptr];
      id after = attributes[NSForegroundColorAttributeName];
      assert(before == after || [before isEqual:after]);
    }
    assert([outlined attribute:NSForegroundColorAttributeName atIndex:0 effectiveRange:nullptr] == nil);
    assert([[outlined attribute:NSForegroundColorAttributeName atIndex:positive.location effectiveRange:nullptr]
        isEqual:NSColor.redColor]);
    assert([[outlined attribute:NSForegroundColorAttributeName atIndex:negative.location effectiveRange:nullptr]
        isEqual:NSColor.greenColor]);
    assert(MenuBarTitleWithStroke([[NSAttributedString alloc] initWithString:@""]).length == 0);
  }
  return 0;
}
