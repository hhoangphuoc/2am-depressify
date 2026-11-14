package app.depressify.core.learning

import app.depressify.core.model.Suggestion
import app.depressify.core.model.SuggestionKind
import app.depressify.core.model.SuggestionStatus
import java.io.File
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

/**
 * Runs the shared Outcome fixture (fixtures/outcomes/outcome-cases.json) through [Outcomes] and
 * [SuggestionRanker]. The functions' tests (firebase/functions/test/outcomes.test.ts) and the seed's
 * run the same file, so the phone ranks by the scores Finish Check-in writes.
 */
class OutcomeFixtureTest {

    private val fixture: JsonObject = Json.parseToJsonElement(
        File(System.getProperty("outcome.fixtures") ?: "../fixtures/outcomes", "outcome-cases.json").readText(),
    ).jsonObject
    private val tolerance = fixture["rule"]!!.jsonObject["tolerance"]!!.jsonPrimitive.doubleOrNull!!

    private fun cases(name: String): List<JsonObject> = fixture[name]!!.jsonArray.map { it.jsonObject }.also { assertTrue(it.isNotEmpty(), name) }
    private fun JsonObject.name() = this["name"]!!.jsonPrimitive.content
    private fun JsonElement?.doubleOrNull(): Double? = if (this == null || this is JsonNull) null else jsonPrimitive.doubleOrNull
    private fun JsonElement?.stringOrNull(): String? = if (this == null || this is JsonNull) null else jsonPrimitive.content

    private fun assertClose(expected: Double?, actual: Double?, name: String) {
        if (expected == null) return assertEquals(null, actual, name)
        assertTrue(actual != null && abs(actual - expected) <= tolerance, "$name: expected $expected, got $actual")
    }

    private fun suggestion(o: JsonObject, index: Int) = Suggestion(
        id = o["id"].stringOrNull() ?: "s$index",
        kind = SuggestionKind.valueOf(o["kind"]!!.jsonPrimitive.content),
        details = "",
        suggestedAtMillis = o["suggestedAtMillis"]?.jsonPrimitive?.longOrNull ?: 1L,
        status = o["status"].stringOrNull()?.let(SuggestionStatus::valueOf) ?: SuggestionStatus.accepted,
        tried = o["tried"]?.takeIf { it !is JsonNull }?.jsonPrimitive?.booleanOrNull,
        outcomeScore = o["outcomeScore"].doubleOrNull(),
        outcomeCheckInId = o["outcomeCheckInId"].stringOrNull(),
        sharedWithClinician = true,
    )

    private fun history(c: JsonObject) = c["history"]!!.jsonArray.mapIndexed { i, e -> suggestion(e.jsonObject, i) }

    @Test
    fun scores() {
        for (c in cases("scores")) {
            val tried = c["tried"]!!.takeIf { it !is JsonNull }?.jsonPrimitive?.booleanOrNull
            val felt = c["felt"]!!.takeIf { it !is JsonNull }?.jsonPrimitive?.intOrNull
            assertClose(c["expected"].doubleOrNull(), Outcomes.score(tried, felt, c["objectiveChange"].doubleOrNull()), c.name())
        }
    }

    @Test
    fun rankings() {
        for (c in cases("rankings")) {
            val ranked = SuggestionRanker { 0.5 }.rank(history(c))
            val expected = c["expected"]!!.jsonArray.map { it.jsonObject }
            assertEquals(
                expected.map { it["kind"]!!.jsonPrimitive.content to it["n"]!!.jsonPrimitive.intOrNull },
                ranked.map { it.kind.name to it.n },
                c.name(),
            )
            ranked.zip(expected).forEach { (r, e) -> assertClose(e["mean"].doubleOrNull(), r.mean, c.name()) }
        }
    }

    @Test
    fun guidance() {
        for (c in cases("guidance")) {
            val random = c["random"].doubleOrNull()!!
            val result = SuggestionRanker { random }.guidance(history(c))
            val expected = c["expected"]!!.jsonObject
            assertEquals(expected["preferred"]!!.jsonArray.map { it.jsonPrimitive.content }, result.preferred.map { it.kind.name }, c.name())
            assertEquals(expected["tryNew"].stringOrNull(), result.tryNew?.name, c.name())
        }
    }

    @Test
    fun targets() {
        for (c in cases("targets")) {
            val checkIn = c["checkIn"]!!.jsonObject
            val found = Outcomes.openSuggestion(
                history = (c["suggestions"] as JsonArray).mapIndexed { i, e -> suggestion(e.jsonObject, i) },
                beforeMillis = checkIn["startedAtMillis"]!!.jsonPrimitive.longOrNull!!,
                checkInId = checkIn["id"]!!.jsonPrimitive.content,
                excluding = c["excludeIds"]!!.jsonArray.map { it.jsonPrimitive.content }.toSet(),
            )
            assertEquals(c["expected"].stringOrNull(), found?.id, c.name())
        }
    }
}
