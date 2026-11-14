package com.twoam.companion.startup

/** Vetted wording for startup. A raw exception message is never shown. */
object StartupCopy {
    const val STARTING: String = "Getting things ready…"
    const val FAILED: String = "We couldn't get started. Check your connection and try again."
    const val RETRY: String = "Try again"

    fun failedMessage(@Suppress("UNUSED_PARAMETER") cause: Throwable): String = FAILED
}
