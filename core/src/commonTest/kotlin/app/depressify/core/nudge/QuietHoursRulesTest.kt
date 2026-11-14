package app.depressify.core.nudge

import app.depressify.core.LocalMinutes
import app.depressify.core.QuietHours
import app.depressify.core.model.DateKeys
import app.depressify.core.model.PatientDoc
import kotlinx.datetime.TimeZone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class QuietHoursRulesTest {

    private fun hm(hour: Int, minute: Int = 0) = LocalMinutes(hour * 60 + minute)

    @Test
    fun theDefaultIsNinePmToNineAm() {
        assertEquals(QuietHours(hm(21), hm(9)), QuietHoursRules.Default)
        // The same as the contract's defaults on the Patient record.
        val patient = PatientDoc(displayName = "Alex", clinicianEmail = "clinician@example.com")
        assertEquals(QuietHoursRules.Default, QuietHoursRules.fromContract(patient.quietHoursStart, patient.quietHoursEnd))
    }

    @Test
    fun overnightAndDaytimeRangesAreAccepted() {
        assertEquals(QuietHoursCheck.Valid(QuietHours(hm(22), hm(7))), QuietHoursRules.validate(hm(22), hm(7)))
        assertEquals(QuietHoursCheck.Valid(QuietHours(hm(13), hm(15))), QuietHoursRules.validate(hm(13), hm(15)))
        assertEquals(QuietHoursCheck.Valid(QuietHours(hm(0), hm(23))), QuietHoursRules.validate(hm(0), hm(23)))
        assertTrue(QuietHoursRules.crossesMidnight(QuietHours(hm(22), hm(7))))
        assertFalse(QuietHoursRules.crossesMidnight(QuietHours(hm(13), hm(15))))
    }

    @Test
    fun identicalEndpointsAreRejected() {
        assertEquals(QuietHoursCheck.Invalid(QuietHoursProblem.SameStartAndEnd), QuietHoursRules.validate(hm(21), hm(21)))
        assertEquals(QuietHoursCheck.Invalid(QuietHoursProblem.SameStartAndEnd), QuietHoursRules.validate(hm(21, 30), hm(21, 30)))
    }

    @Test
    fun timesOffTheHourAreRejectedBecauseTheRecordStoresHours() {
        assertEquals(QuietHoursCheck.Invalid(QuietHoursProblem.NotOnTheHour), QuietHoursRules.validate(hm(21, 30), hm(9)))
        assertEquals(QuietHoursCheck.Invalid(QuietHoursProblem.NotOnTheHour), QuietHoursRules.validate(hm(21), hm(8, 30)))
    }

    @Test
    fun mapsToAndFromTheContractHours() {
        assertEquals(ContractQuietHours(21, 9), QuietHoursRules.toContract(QuietHoursRules.Default))
        assertEquals(QuietHours(hm(22), hm(6)), QuietHoursRules.fromContract(22, 6))
        for (start in 0..23) for (end in 0..23) if (start != end) {
            val q = QuietHoursRules.fromContract(start, end)
            assertEquals(ContractQuietHours(start, end), QuietHoursRules.toContract(q))
        }
        // A time off the hour, or identical endpoints, has no contract form.
        assertNull(QuietHoursRules.toContract(QuietHours(hm(21, 30), hm(9))))
        assertNull(QuietHoursRules.toContract(QuietHours(hm(9), hm(9))))
    }

    @Test
    fun aBrokenStoredRecordFallsBackToTheDefault() {
        assertEquals(QuietHoursRules.Default, QuietHoursRules.fromContract(22, 22))
        assertEquals(QuietHoursRules.Default, QuietHoursRules.fromContract(24, 9))
        assertEquals(QuietHoursRules.Default, QuietHoursRules.fromContract(21, -1))
    }

    @Test
    fun theDisplayShowsTheTimeZone() {
        val zone = TimeZone.of(DateKeys.DEMO_TIME_ZONE)
        assertEquals("21:00–09:00 (Europe/Helsinki)", QuietHoursRules.display(QuietHoursRules.Default, zone))
        assertEquals("13:00–15:00 (Europe/Helsinki)", QuietHoursRules.display(QuietHours(hm(13), hm(15)), zone))
    }
}
