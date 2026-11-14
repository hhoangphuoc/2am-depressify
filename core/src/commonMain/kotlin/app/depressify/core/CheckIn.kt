package app.depressify.core

/** One 1 to 5 self-report. Null means skipped, which stays unanswered and is never filled in. */
data class Ratings(val mood: Int? = null, val energy: Int? = null, val sleepQuality: Int? = null) {
    init {
        listOf(mood, energy, sleepQuality).forEach { require(it == null || it in 1..5) { "Ratings are 1 to 5" } }
    }
}

enum class SuggestionKind(val title: String, val detail: String) {
    Walk("A little time outside", "Tomorrow around 11:00 · ten minutes, at your pace."),
    Window("A moment by the window", "One minute, whenever it suits you."),
    Music("A little music", "One calm album or song you know well."),
    Read("Read two quiet pages", "With warm tea, at your own pace."),
    Game("A cozy puzzle or game", "Fifteen unhurried minutes to rest busy thoughts."),
    Call("A call to someone close", "You choose who, and you place the call."),
}

/** The Patient's answer about the previous Suggestion, asked inside the next Check-in. */
sealed interface Outcome {
    data class Tried(val feeling: Int?) : Outcome
    data object NotThisTime : Outcome
    data object PreferNotToSay : Outcome
}

data class Summary(
    val id: String,
    val date: String,
    val title: String,
    val text: String,
    val ratings: Ratings,
    val suggestion: SuggestionKind?,
    val previousOutcome: Outcome?,
    val voiceObservation: String?,
)

/** Check-in length: about 3 minutes is the target, a quiet wrap-up near 7, a hard cap near 8. */
object CheckInTiming {
    const val TARGET_SECONDS = 180
    const val WRAP_UP_SECONDS = 420
    const val CAP_SECONDS = 480
    fun shouldWrapUp(elapsedSeconds: Int) = elapsedSeconds >= WRAP_UP_SECONDS
}
