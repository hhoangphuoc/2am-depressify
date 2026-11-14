package app.depressify.core.daily

import app.depressify.core.model.DailyDoc
import app.depressify.core.model.PatientDoc
import app.depressify.core.model.SharingConsent
import app.depressify.core.model.Signal
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus

/** Plain inputs for the daily pipeline tests. */
internal object DailyTestData {
    const val TODAY = "2026-11-14"
    const val NOW = 1_763_110_000_000L

    /** The date [daysAgo] days before [TODAY]. */
    fun dateAgo(daysAgo: Int): String = LocalDate.parse(TODAY).minus(daysAgo, DateTimeUnit.DAY).toString()

    /** A usual night's sleep around 420 minutes (median 420, sample SD about 15, spread floor 21). */
    private val usualSleep = listOf(400.0, 420.0, 440.0, 410.0, 430.0, 420.0, 415.0, 425.0)

    /** A usual day's steps around 6000 (spread floor 300). */
    private val usualSteps = listOf(5800.0, 6000.0, 6200.0, 5900.0, 6100.0, 6000.0, 5950.0, 6050.0)

    /**
     * [count] previous daily records ending yesterday, oldest first, with usual sleep and steps. The
     * [override] picks values for chosen days, by how many days ago they are.
     */
    fun previousDays(
        count: Int = 20,
        shared: Boolean = true,
        override: (daysAgo: Int, values: MutableMap<Signal, Double?>) -> Unit = { _, _ -> },
    ): List<DailyDoc> = (count downTo 1).map { ago ->
        val values = mutableMapOf<Signal, Double?>(
            Signal.SLEEP_MINUTES to usualSleep[ago % usualSleep.size],
            Signal.STEPS to usualSteps[ago % usualSteps.size],
        )
        override(ago, values)
        DailyDoc.of(dateAgo(ago), values, emptyMap(), null, shared)
    }

    fun patient(
        sharing: SharingConsent = SharingConsent.granted,
        level: app.depressify.core.model.FlagLevel = app.depressify.core.model.FlagLevel.green,
        reasons: List<String> = emptyList(),
        lastSeen: Long? = null,
    ) = PatientDoc(
        displayName = "Live patient",
        clinicianEmail = "clinician@example.com",
        flagLevel = level,
        flagReasons = reasons,
        sharingConsent = sharing,
        lastSeenAtMillis = lastSeen,
    )
}
