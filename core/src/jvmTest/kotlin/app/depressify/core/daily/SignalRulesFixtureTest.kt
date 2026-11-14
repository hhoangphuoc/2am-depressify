package app.depressify.core.daily

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The Signal rules' thresholds and reasons as the shared fixture `fixtures/flags/signal-rules.json`
 * states them. The seed's `flags.js` is checked against the same file, so seeded and live flags
 * cannot drift apart.
 */
class SignalRulesFixtureTest {

    private val fixture: JsonObject = Json.parseToJsonElement(
        File(System.getProperty("signal.rules.fixture") ?: "../fixtures/flags/signal-rules.json").readText(),
    ).jsonObject

    private fun threshold(name: String): Double = fixture["thresholds"]!!.jsonObject[name]!!.jsonPrimitive.double

    private fun reason(name: String): String = fixture["reasons"]!!.jsonObject[name]!!.jsonPrimitive.content

    @Test
    fun theThresholdsAreTheFixtures() {
        assertEquals(threshold("sleepCollapseMinutes"), DailyThresholds.SLEEP_COLLAPSE_MINUTES)
        assertEquals(threshold("sleepCollapseOriented"), DailyThresholds.SLEEP_COLLAPSE_ORIENTED)
        assertEquals(threshold("poorSleepOriented"), DailyThresholds.POOR_SLEEP_ORIENTED)
        assertEquals(threshold("poorSleepNights"), DailyThresholds.POOR_SLEEP_NIGHTS.toDouble())
        assertEquals(threshold("lowMoodAtMost"), DailyThresholds.LOW_MOOD_AT_MOST.toDouble())
        assertEquals(threshold("lowMoodCheckIns"), DailyThresholds.LOW_MOOD_CHECK_INS.toDouble())
        assertEquals(threshold("driftComposite"), DailyThresholds.DRIFT_COMPOSITE)
        assertEquals(threshold("driftDays"), DailyThresholds.DRIFT_DAYS.toDouble())
        assertEquals(threshold("driftMinSignals"), DailyThresholds.DRIFT_MIN_SIGNALS.toDouble())
    }

    @Test
    fun theReasonsAreTheFixtures() {
        assertEquals(reason("sleepUnder3Hours"), FlagReasons.sleepUnder(DailyThresholds.SLEEP_COLLAPSE_MINUTES))
        assertEquals(reason("sleepFarBelowUsual"), FlagReasons.SLEEP_FAR_BELOW_USUAL)
        assertEquals(reason("inactive"), FlagReasons.INACTIVE)
        assertEquals(reason("poorSleep"), FlagReasons.POOR_SLEEP)
        assertEquals(reason("lowMood"), FlagReasons.LOW_MOOD)
        assertEquals(reason("drift"), FlagReasons.DRIFT)
    }
}
