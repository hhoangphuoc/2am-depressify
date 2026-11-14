package app.depressify.core.learning

import app.depressify.core.model.Suggestion
import app.depressify.core.model.SuggestionKind

/** One kind of Suggestion with its mean Outcome score (for ordering only, never shown) and how many were scored. */
data class KindScore(val kind: SuggestionKind, val mean: Double, val n: Int)

/** What the Brief gets: the best kinds, at most three, and a kind to try for something new, or null. */
data class Guidance(val preferred: List<KindScore>, val tryNew: SuggestionKind?)

/**
 * Learning what helps (spec #5): ranks this Patient's kinds of Suggestion from their stored Outcome
 * scores, for the phone's Brief builder. [random] is injected so tests are deterministic; it returns
 * a value in [0, 1), like `Random.nextDouble()`.
 *
 * The only copy of the ranking: the functions write the scores, the phone ranks them. The shared
 * fixture fixtures/outcomes/outcome-cases.json pins it.
 */
class SuggestionRanker(private val random: () -> Double) {

    /**
     * Kinds by mean Outcome score, then by count, both descending; ties in [SuggestionKind] order.
     * Only scored Suggestions count: unanswered, declined and "prefer not to say" have no score.
     */
    fun rank(history: List<Suggestion>): List<KindScore> = history
        .mapNotNull { s -> s.outcomeScore?.takeIf { it.isFinite() }?.let { s.kind to it } }
        .groupBy({ it.first }, { it.second })
        .map { (kind, scores) -> KindScore(kind, scores.sum() / scores.size, scores.size) }
        .sortedWith(compareByDescending<KindScore> { it.mean }.thenByDescending { it.n }.thenBy { it.kind.ordinal })

    /**
     * The top [PREFERRED_KINDS] kinds and, when [random] is below [TRY_NEW_RATE], one kind to try:
     * the first kind in [SuggestionKind] order with no score yet, or else the least-scored kind
     * outside the top three. [random] is called exactly once.
     */
    fun guidance(history: List<Suggestion>): Guidance {
        val ranked = rank(history)
        val preferred = ranked.take(PREFERRED_KINDS)
        if (random() >= TRY_NEW_RATE) return Guidance(preferred, null)
        val untried = SuggestionKind.entries.firstOrNull { kind -> ranked.none { it.kind == kind } }
        val tryNew = untried ?: ranked
            .filter { it !in preferred }
            .minWithOrNull(compareBy<KindScore>({ it.n }, { it.kind.ordinal }))
            ?.kind
        return Guidance(preferred, tryNew)
    }

    companion object {
        /** How many kinds go into the Brief. */
        const val PREFERRED_KINDS: Int = 3
        /** About one Check-in in five tries something new. */
        const val TRY_NEW_RATE: Double = 0.2
    }
}
