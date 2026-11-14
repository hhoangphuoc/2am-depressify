package app.depressify.core.daily

import app.depressify.core.model.Signal
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Runs every case of the shared Baseline fixture (`fixtures/baseline/baseline-cases.json`) through
 * [SignalBaseline]. The seed and the dashboard run the same file through `baseline.js`, so the
 * Kotlin and JavaScript rules cannot drift apart.
 */
class BaselineFixtureTest {

    private val file: File = File(System.getProperty("baseline.fixture") ?: "../fixtures/baseline/baseline-cases.json")
    private val fixture: JsonObject = Json.parseToJsonElement(file.readText()).jsonObject
    private val tolerance: Double = fixture["rule"]!!.jsonObject["tolerance"]!!.jsonPrimitive.double

    private fun number(element: JsonElement?): Double? =
        if (element == null || element is JsonNull) null else element.jsonPrimitive.double

    private fun reading(element: JsonElement): SignalBaseline.Reading {
        val o = element.jsonObject
        return SignalBaseline.Reading(o["date"]!!.jsonPrimitive.content, number(o["value"]))
    }

    private fun check(name: String, expected: Double?, actual: Double?) {
        if (expected == null) {
            assertNull(actual, name)
        } else {
            assertNotNull(actual, name)
            assertEquals(expected, actual, tolerance, name)
        }
    }

    @Test
    fun theRuleMatchesTheFixture() {
        val rule = fixture["rule"]!!.jsonObject
        assertEquals(SignalBaseline.WINDOW_DAYS, rule["windowDays"]!!.jsonPrimitive.content.toInt())
        assertEquals(SignalBaseline.MIN_VALID_DAYS, rule["minValidDays"]!!.jsonPrimitive.content.toInt())
    }

    @Test
    fun everyComparisonCase() {
        val cases = fixture["comparisons"]!!.jsonArray
        assertTrue(cases.isNotEmpty())
        for (case in cases) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val history = c["history"]!!.jsonArray.map(::reading)
            check(name, number(c["expected"]), SignalBaseline.compare(history, reading(c["today"]!!)))
        }
        println("Baseline fixture: ${cases.size} comparison cases pass")
    }

    @Test
    fun everyOrientedCase() {
        val cases = fixture["oriented"]!!.jsonArray
        assertTrue(cases.isNotEmpty())
        for (case in cases) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val signal = Signal.fromKey(c["signal"]!!.jsonPrimitive.content)!!
            check(name, number(c["expected"]), SignalBaseline.oriented(signal, number(c["comparison"])))
        }
        println("Baseline fixture: ${cases.size} oriented cases pass")
    }

    @Test
    fun everyCompositeCase() {
        val cases = fixture["composites"]!!.jsonArray
        assertTrue(cases.isNotEmpty())
        for (case in cases) {
            val c = case.jsonObject
            val name = c["name"]!!.jsonPrimitive.content
            val vs = c["vsBaseline"]!!.jsonObject.entries.associate { (key, value) -> Signal.fromKey(key)!! to number(value) }
            check(name, number(c["expected"]), SignalBaseline.composite(vs))
        }
        println("Baseline fixture: ${cases.size} composite cases pass")
    }
}
