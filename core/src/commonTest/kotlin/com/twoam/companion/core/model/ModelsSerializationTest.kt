package com.twoam.companion.core.model

import kotlinx.datetime.LocalDate
import kotlinx.serialization.KSerializer
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ModelsSerializationTest {

    // --- Nulls are written explicitly, never dropped ---

    @Test
    fun dailyDocKeepsNulls() {
        val m = FirestoreJson.encode(
            DailyDoc.serializer(),
            DailyDoc(
                "2026-11-13",
                mapOf("sleepMinutes" to 420.0, "steps" to null),
                mapOf("sleepMinutes" to -1.2),
                -0.4,
            ),
        )
        assertEquals(setOf("date", "values", "vsBaseline", "composite", "demoOverride"), m.keys)
        assertTrue((m["values"] as Map<*, *>).containsKey("steps"))
    }

    @Test
    fun missingSignalStaysInDailyRecordAsNull() {
        val doc = DailyDoc.of(
            date = "2026-11-13",
            values = mapOf(Signal.SLEEP_MINUTES to 420.0),
            vsBaseline = emptyMap(),
            composite = null,
        )
        val m = FirestoreJson.encode(DailyDoc.serializer(), doc)
        val values = m["values"] as Map<*, *>
        val vsBaseline = m["vsBaseline"] as Map<*, *>

        assertEquals(Signal.entries.map { it.key }.toSet(), values.keys)
        assertEquals(Signal.entries.map { it.key }.toSet(), vsBaseline.keys)
        assertEquals(420.0, values["sleepMinutes"])
        assertTrue(values.containsKey("steps"))
        assertNull(values["steps"])
        assertTrue(m.containsKey("composite"))
        assertNull(m["composite"])
    }

    @Test
    fun newPatientRecordWritesUnsetFieldsAsNull() {
        val m = FirestoreJson.encode(
            PatientDoc.serializer(),
            PatientDoc(displayName = "Live patient", clinicianEmail = "clinician@example.com"),
        )
        for (key in listOf("tmsEndDate", "lastSeenAtMillis", "lastCheckInAtMillis", "sharingChangedAtMillis")) {
            assertTrue(m.containsKey(key), "$key must be written")
            assertNull(m[key], "$key must be null")
        }
        assertEquals("green", m["flagLevel"])
        assertEquals("device", m["healthSource"])
        assertEquals("undecided", m["sharingConsent"])
        assertEquals(false, m["synthetic"])
        assertEquals(21L, m["quietHoursStart"])
        assertEquals(9L, m["quietHoursEnd"])
    }

    @Test
    fun unansweredRatingsAndOutcomesAreNull() {
        val checkIn = FirestoreJson.encode(CheckIn.serializer(), CheckIn(id = "c1", startedAtMillis = 1L))
        for (key in listOf("endedAtMillis", "mood", "energy", "sleepQuality")) {
            assertTrue(checkIn.containsKey(key)); assertNull(checkIn[key])
        }
        val suggestion = FirestoreJson.encode(
            Suggestion.serializer(),
            Suggestion(id = "s1", kind = SuggestionKind.walk, details = "A short walk", suggestedAtMillis = 1L),
        )
        for (key in listOf("tried", "felt", "objectiveChange", "outcomeScore")) {
            assertTrue(suggestion.containsKey(key)); assertNull(suggestion[key])
        }
        assertEquals("proposed", suggestion["status"])
    }

    // --- Enumerations are lower-case words ---

    @Test
    fun flagEnumsSerializeLowercase() {
        val m = FirestoreJson.encode(Flag.serializer(), Flag(FlagLevel.red, FlagKind.sleep_collapse, "r", 1L))
        assertEquals("red", m["level"])
        assertEquals("sleep_collapse", m["kind"])
    }

    @Test
    fun everyEnumerationSerialisesAsLowerCaseWords() {
        val lowerCaseWord = Regex("^[a-z][a-z0-9]*(_[a-z0-9]+)*$")
        val encoded = buildList {
            addAll(encodeAll(FlagLevel.serializer(), FlagLevel.entries))
            addAll(encodeAll(FlagKind.serializer(), FlagKind.entries))
            addAll(encodeAll(SuggestionKind.serializer(), SuggestionKind.entries))
            addAll(encodeAll(SuggestionStatus.serializer(), SuggestionStatus.entries))
            addAll(encodeAll(HealthSource.serializer(), HealthSource.entries))
            addAll(encodeAll(SignalDirection.serializer(), SignalDirection.entries))
            addAll(encodeAll(SharingConsent.serializer(), SharingConsent.entries))
            addAll(encodeAll(ConsentPurpose.serializer(), ConsentPurpose.entries))
            addAll(encodeAll(QuestionnaireKind.serializer(), QuestionnaireKind.entries))
        }
        for (word in encoded) assertTrue(lowerCaseWord.matches(word), "'$word' is not a lower-case word")
    }

    @Test
    fun enumerationsMatchTheSpec() {
        assertEquals(listOf("green", "amber", "red"), FlagLevel.entries.map { it.name })
        assertEquals(
            listOf("drift", "low_mood", "poor_sleep", "decline", "unassessed", "sleep_collapse", "inactive", "silent", "crisis"),
            FlagKind.entries.map { it.name },
        )
        assertEquals(
            listOf("walk", "nature", "music", "social_call", "breathing", "class_activity", "daylight"),
            SuggestionKind.entries.map { it.name },
        )
        assertEquals(listOf("proposed", "accepted", "declined"), SuggestionStatus.entries.map { it.name })
        assertEquals(listOf("device", "synthetic"), HealthSource.entries.map { it.name })
        assertEquals(listOf("phq2", "phq9"), QuestionnaireKind.entries.map { it.name })
    }

    // --- Signals ---

    @Test
    fun signalKeysAreUnique() =
        assertEquals(Signal.entries.size, Signal.entries.map { it.key }.toSet().size)

    @Test
    fun signalsAndDirectionsMatchTheSpec() {
        val expected = mapOf(
            "sleepMinutes" to SignalDirection.higher_is_better,
            "steps" to SignalDirection.higher_is_better,
            "meanHeartRate" to SignalDirection.none,
            "restingHeartRate" to SignalDirection.lower_is_better,
            "hrv" to SignalDirection.higher_is_better,
            "timeAtHomeMinutes" to SignalDirection.lower_is_better,
            "movementRadiusKm" to SignalDirection.higher_is_better,
            "calendarBusyMinutes" to SignalDirection.none,
            "lateNightScreenMinutes" to SignalDirection.lower_is_better,
        )
        assertEquals(expected, Signal.entries.associate { it.key to it.direction })
        assertEquals(
            Signal.entries.filter { it.direction != SignalDirection.none }.toSet(),
            Signal.inComposite.toSet(),
        )
    }

    @Test
    fun signalIsStoredAsItsKey() {
        assertEquals(JsonPrimitive("sleepMinutes"), FirestoreJson.json.encodeToJsonElement(Signal.serializer(), Signal.SLEEP_MINUTES))
        assertEquals(Signal.HRV, FirestoreJson.json.decodeFromJsonElement(Signal.serializer(), JsonPrimitive("hrv")))
        assertEquals(Signal.STEPS, Signal.fromKey("steps"))
        assertNull(Signal.fromKey("unknown"))
    }

    // --- Timestamps and dates ---

    @Test
    fun everyIntegerTimestampFieldEndsInAtMillis() {
        val allowedIntegers = setOf(
            "quietHoursStart", "quietHoursEnd", "mood", "energy", "sleepQuality", "felt", "intensity", "score",
            "summaryCount",
        )
        for (descriptor in documentDescriptors()) {
            for (i in 0 until descriptor.elementsCount) {
                val name = descriptor.getElementName(i)
                val kind = descriptor.getElementDescriptor(i).kind
                if (kind == PrimitiveKind.LONG) {
                    assertTrue(name.endsWith("AtMillis"), "${descriptor.serialName}.$name is a Long but not *AtMillis")
                }
                if (kind == PrimitiveKind.INT) {
                    assertTrue(name in allowedIntegers, "${descriptor.serialName}.$name: timestamps must be Long *AtMillis")
                }
            }
        }
    }

    @Test
    fun datesAreYearMonthDayStrings() {
        assertEquals("2026-11-03", DateKeys.of(LocalDate(2026, 11, 3)))
        assertTrue(DateKeys.isDateKey("2026-11-13"))
        assertTrue(!DateKeys.isDateKey("2026-11-3"))
        assertTrue(!DateKeys.isDateKey("13.11.2026"))
    }

    // --- Collections ---

    @Test
    fun collectionsMatchTheSpec() {
        assertEquals("patients", Collections.PATIENTS)
        assertEquals(
            listOf("daily", "consents", "checkIns", "summaries", "suggestions", "flags", "visits", "digests"),
            Collections.PATIENT_SUBCOLLECTIONS,
        )
        assertEquals("mail", Collections.MAIL)
    }

    @Test
    fun encodeThenDecodeRoundTrips() {
        val patient = PatientDoc(
            displayName = "Live patient",
            clinicianEmail = "clinician@example.com",
            flagLevel = FlagLevel.amber,
            flagReasons = listOf("Mood rated 2 or lower in the last three Check-ins"),
            lastSeenAtMillis = 1_763_000_000_000L,
        )
        assertEquals(patient, FirestoreJson.decode(PatientDoc.serializer(), FirestoreJson.encode(PatientDoc.serializer(), patient)))

        val summary = Summary(
            checkInId = "c1", createdAtMillis = 2L, mood = 3, energy = null, sleepQuality = 4,
            sleepLine = "Slept a little less than usual", themes = listOf("work"), voiceCues = listOf(VoiceCue("flat tone", 2, "short answers")),
            suggestion = "A 10-minute walk", previousOutcome = null, quotes = emptyList(),
        )
        assertEquals(summary, FirestoreJson.decode(Summary.serializer(), FirestoreJson.encode(Summary.serializer(), summary)))
    }

    @Test
    fun digestStatesTheDatesCoveredAndHowManySummaries() {
        val digest = Digest(
            isoWeek = "2026-W46", weekStart = "2026-11-09", weekEnd = "2026-11-15", summaryCount = 5,
            text = "A steady week.", generatedAtMillis = 1_763_000_000_000L,
        )
        val m = FirestoreJson.encode(Digest.serializer(), digest)
        assertEquals(setOf("isoWeek", "weekStart", "weekEnd", "summaryCount", "text", "generatedAtMillis"), m.keys)
        assertTrue(DateKeys.isDateKey(digest.weekStart) && DateKeys.isDateKey(digest.weekEnd))
        assertEquals(digest, FirestoreJson.decode(Digest.serializer(), m))
    }

    private fun <T> encodeAll(serializer: KSerializer<T>, values: List<T>): List<String> =
        values.map { FirestoreJson.json.encodeToJsonElement(serializer, it).jsonPrimitive.content }

    private fun documentDescriptors(): List<SerialDescriptor> = listOf(
        PatientDoc.serializer().descriptor,
        DailyDoc.serializer().descriptor,
        Consent.serializer().descriptor,
        CheckIn.serializer().descriptor,
        VoiceCue.serializer().descriptor,
        Summary.serializer().descriptor,
        Suggestion.serializer().descriptor,
        Flag.serializer().descriptor,
        Visit.serializer().descriptor,
        Digest.serializer().descriptor,
        MailDoc.serializer().descriptor,
    )
}
