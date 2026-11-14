package app.depressify.core.daily

import app.depressify.core.model.DailyDoc
import app.depressify.core.model.Signal

/**
 * Builds today's `daily/{date}` record: every Signal key written, null where there is no value
 * (a night without the watch is null, never zero), each one's comparison with Baseline (sign as
 * measured, as the contract stores it), and the composite (oriented).
 */
object DailyRecordBuilder {

    /**
     * Every Signal's value for today: the reading when the Patient consented to that Signal and it is
     * a finite number, otherwise null. A real zero (no steps) stays zero; a missing reading is null.
     */
    fun values(readings: Map<Signal, Double?>, consented: Set<Signal>): Map<Signal, Double?> =
        Signal.entries.associateWith { signal ->
            readings[signal]?.takeIf { signal in consented && it.isFinite() }
        }

    /**
     * Today's record from its [values] and the previous days' values (any order; only the 14
     * calendar dates before [date] are used). [sharedWithClinician] is the stamp: the existing
     * record's when today's record is being rewritten, otherwise `PatientDoc.sharingStamp()`.
     */
    fun build(
        date: String,
        values: Map<Signal, Double?>,
        previousDays: List<DayValues>,
        sharedWithClinician: Boolean,
        demoOverride: Boolean = false,
    ): DailyDoc {
        val today = DayValues(date, Signal.entries.associateWith { values[it]?.takeIf(Double::isFinite) })
        val vsBaseline = SignalBaseline.comparisons(previousDays.filter { it.date != date }, today)
        return DailyDoc.of(
            date = date,
            values = today.values,
            vsBaseline = vsBaseline,
            composite = SignalBaseline.composite(vsBaseline),
            sharedWithClinician = sharedWithClinician,
            demoOverride = demoOverride,
        )
    }
}
