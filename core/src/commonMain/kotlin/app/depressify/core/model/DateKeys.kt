package app.depressify.core.model

import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Clock

/** Dates in the contract are `yyyy-MM-dd` strings in the device time zone. */
object DateKeys {
    /** The demo's time zone. The phone uses its own; this is for tests, the seed and docs. */
    const val DEMO_TIME_ZONE: String = "Europe/Helsinki"

    private val pattern = Regex("""^\d{4}-\d{2}-\d{2}$""")

    fun of(date: LocalDate): String = date.toString()

    fun today(clock: Clock, zone: TimeZone): String =
        of(clock.now().toLocalDateTime(zone).date)

    fun isDateKey(value: String): Boolean =
        pattern.matches(value) && runCatching { LocalDate.parse(value) }.isSuccess
}
