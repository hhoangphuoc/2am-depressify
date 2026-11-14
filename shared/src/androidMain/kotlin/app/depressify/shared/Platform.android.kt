package app.depressify.shared

import android.animation.ValueAnimator
import java.time.LocalTime

actual fun localHour(): Int = LocalTime.now().hour

// Android exposes Remove animations through the animator scale; zero means the person turned motion off.
actual fun isReduceMotionEnabled(): Boolean = !ValueAnimator.areAnimatorsEnabled()

actual val healthSource: String = "Health Connect"
