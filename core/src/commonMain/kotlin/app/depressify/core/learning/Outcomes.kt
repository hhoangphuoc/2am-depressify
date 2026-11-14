package app.depressify.core.learning

import app.depressify.core.model.Suggestion
import app.depressify.core.model.SuggestionStatus

/**
 * Outcomes of Suggestions (#21; spec #5, "Learning what helps" and "Suggestion lifecycle").
 *
 * Finish Check-in (firebase/functions/src/outcomes.ts) writes the Outcome: the phone only reads it,
 * to know which Suggestion the next Check-in asks about ([openSuggestion]) and to rank kinds for the
 * Brief ([SuggestionRanker]). [score] is here so the phone can explain or test a stored score; the
 * shared fixture fixtures/outcomes/outcome-cases.json pins both copies, and the seed's, to one rule.
 */
object Outcomes {
    /** "Not this time": a small negative value, whatever the sensors say. */
    const val NOT_TRIED_SCORE: Double = -0.1
    /** Weight of the feeling, centred on 3 and scaled to plus or minus 1. */
    const val FEELING_WEIGHT: Double = 0.7
    /** Weight of the day's steps against Baseline, itself clamped to plus or minus 1 first. */
    const val STEPS_WEIGHT: Double = 0.3

    /**
     * Null until the Patient answers ([tried] null, including "prefer not to say"); [NOT_TRIED_SCORE]
     * for "not this time"; otherwise `0.7 x (felt - 3) / 2 + 0.3 x objectiveChange.coerceIn(-1, 1)`,
     * clamped to plus or minus 1. A feeling not given (or outside 1 to 5) and a missing step change
     * each contribute nothing.
     */
    fun score(tried: Boolean?, felt: Int?, objectiveChange: Double?): Double? = when (tried) {
        null -> null
        false -> NOT_TRIED_SCORE
        true -> {
            val feeling = if (felt != null && felt in 1..5) (felt - 3) / 2.0 else 0.0
            val steps = objectiveChange?.takeIf { it.isFinite() }?.coerceIn(-1.0, 1.0) ?: 0.0
            (FEELING_WEIGHT * feeling + STEPS_WEIGHT * steps).coerceIn(-1.0, 1.0)
        }
    }

    /** Whether a Suggestion already has an Outcome: recorded by a Check-in, or (older documents) a stored answer or score. */
    fun hasOutcome(s: Suggestion): Boolean = s.outcomeCheckInId != null || s.tried != null || s.outcomeScore != null

    /**
     * The Suggestion a Check-in asks about: the most recent accepted Suggestion made before
     * [beforeMillis], not in [excluding], with no Outcome yet, or whose Outcome [checkInId] recorded
     * (a retried finish). A proposed or declined Suggestion never gets an Outcome. Null: there is
     * nothing to ask, and the Brief's Outcome question and the Outcome step are skipped.
     *
     * Send its id as Finish Check-in's `lastSuggestionId`: the function finds the same one and
     * writes the Outcome only when the two agree.
     */
    fun openSuggestion(
        history: List<Suggestion>,
        beforeMillis: Long,
        checkInId: String? = null,
        excluding: Set<String> = emptySet(),
    ): Suggestion? = history
        .filter {
            it.status == SuggestionStatus.accepted &&
                it.suggestedAtMillis < beforeMillis &&
                it.id !in excluding &&
                ((checkInId != null && it.outcomeCheckInId == checkInId) || !hasOutcome(it))
        }
        .maxWithOrNull(compareBy<Suggestion>({ it.suggestedAtMillis }, { it.id }))
}
