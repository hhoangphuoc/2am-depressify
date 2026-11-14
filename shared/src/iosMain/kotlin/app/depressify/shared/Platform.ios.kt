package app.depressify.shared

import platform.Foundation.NSCalendar
import platform.Foundation.NSCalendarUnitHour
import platform.Foundation.NSDate
import platform.UIKit.UIAccessibilityIsReduceMotionEnabled

actual fun localHour(): Int = NSCalendar.currentCalendar.component(NSCalendarUnitHour, fromDate = NSDate()).toInt()

actual fun isReduceMotionEnabled(): Boolean = UIAccessibilityIsReduceMotionEnabled()

actual val healthSource: String = "Apple Health"
