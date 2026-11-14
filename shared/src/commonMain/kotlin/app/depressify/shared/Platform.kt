package app.depressify.shared

/** Local hour of day on this phone, 0 to 23. */
expect fun localHour(): Int

/** True when the person has asked the system to reduce motion. */
expect fun isReduceMotionEnabled(): Boolean

/** Name of the phone's health store shown beside health Signals. */
expect val healthSource: String
