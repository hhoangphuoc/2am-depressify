@file:Suppress("EnumEntryName") // Skip reasons are lower-case words, like the functions' skip codes.

package app.depressify.core.daily

import app.depressify.core.model.Flag
import app.depressify.core.model.FlagKind
import app.depressify.core.model.FlagLevel
import app.depressify.core.model.PatientDoc
import app.depressify.core.model.sharingStamp

/** A flag document with its id, as stored under `patients/{id}/flags/{flagId}` or about to be. */
data class StoredFlag(val id: String, val flag: Flag)

/** The Patient record's new `flagLevel` and `flagReasons`. */
data class AttentionUpdate(val flagLevel: FlagLevel, val flagReasons: List<String>)

/** Why a draft is not written. Safe to log: it carries no data. */
enum class SkipReason {
    /** An uncleared flag of the same kind and stamp is open (the "not raised again" rule). */
    already_open,

    /** This kind was already raised today with the same stamp, or on the same evidence. */
    already_raised,
}

data class SkippedDraft(val draft: FlagDraft, val why: SkipReason)

/** What one run writes about flags. [attention] is null when the Patient record must not change. */
data class FlagWritePlan(
    val newFlags: List<StoredFlag>,
    val attention: AttentionUpdate?,
    val skipped: List<SkippedDraft>,
)

/**
 * The three Attention-flag write rules (spec #5), as every writer follows them. Mirrors the
 * functions' `raisedAttention` and `hasOpenFlag` (`firebase/functions/src/silence.ts`, moved to
 * `flags.ts` by #20) and the security rules' `flagRaisedOnly`:
 *
 * 1. A kind that already has an uncleared flag with the same stamp is not raised again. A flag
 *    stamped `sharedWithClinician: false` never stops a shared one, and the reverse.
 * 2. Nothing but the Clinician lowers a level: the phone only keeps or raises `flagLevel`, and
 *    keeps every existing reason (the rules check `hasAll`).
 * 3. The Patient's level is the highest uncleared flag stamped `true`: only shared flags change the
 *    record, so an unshared flag never puts its reason where the Clinician can read it.
 */
object FlagWriteRules {

    /**
     * The flag id for a kind raised on a date: `<kind>-<date>`, the seed's format, so a retried or
     * repeated run the same day computes the same id and can never write a second flag. A flag
     * stamped false gets `-unshared`, so it never takes the id a shared flag would need later that
     * day (a create on a taken id is refused by the rules).
     */
    fun flagId(kind: FlagKind, date: String, shared: Boolean): String =
        if (shared) "${kind.name}-$date" else "${kind.name}-$date-unshared"

    /** Whether an uncleared flag of [kind] with the stamp [shared] is stored. */
    fun hasOpenFlag(flags: List<StoredFlag>, kind: FlagKind, shared: Boolean): Boolean =
        flags.any { it.flag.kind == kind && it.flag.clearedAtMillis == null && it.flag.sharedWithClinician == shared }

    /**
     * The record's level and reasons after raising one shared flag, as the functions'
     * `raisedAttention`: the level only goes up; a flag at or above the current level is the newest
     * of the highest level, so its reason goes first, otherwise after all existing reasons. The same
     * reason is never listed twice. Existing reasons are all kept.
     */
    fun raisedAttention(currentLevel: FlagLevel, currentReasons: List<String>, level: FlagLevel, reason: String): AttentionUpdate {
        // FlagLevel is declared green, amber, red, so the enum's order is the level's rank.
        val newLevel = maxOf(level, currentLevel)
        val kept = currentReasons.filter { it != reason }
        val reasons = if (level >= currentLevel) listOf(reason) + kept else kept + reason
        return AttentionUpdate(newLevel, reasons)
    }

    /**
     * Which of [drafts] to create today, and the Patient record's new level and reasons.
     *
     * @param flags the Patient's stored flags: at least every uncleared one, plus any raised today
     *   or since the evidence of a draft (the app can simply pass them all).
     * @param patient the Patient record as read in the same transaction.
     * @param date today's date key; [nowMillis] becomes each new flag's `raisedAtMillis`.
     */
    fun plan(drafts: List<FlagDraft>, flags: List<StoredFlag>, patient: PatientDoc, date: String, nowMillis: Long): FlagWritePlan {
        val shared = patient.sharingStamp()
        val newFlags = mutableListOf<StoredFlag>()
        val skipped = mutableListOf<SkippedDraft>()
        for (draft in drafts.distinctBy { it.kind }) {
            val id = flagId(draft.kind, date, shared)
            val sameKind = flags.filter { it.flag.kind == draft.kind && it.flag.sharedWithClinician == shared }
            when {
                hasOpenFlag(flags, draft.kind, shared) -> skipped += SkippedDraft(draft, SkipReason.already_open)
                flags.any { it.id == id } -> skipped += SkippedDraft(draft, SkipReason.already_raised)
                draft.evidenceAtMillis != null && sameKind.any { it.flag.raisedAtMillis >= draft.evidenceAtMillis } ->
                    skipped += SkippedDraft(draft, SkipReason.already_raised)
                else -> newFlags += StoredFlag(
                    id,
                    Flag(
                        level = draft.level,
                        kind = draft.kind,
                        reason = draft.reason,
                        raisedAtMillis = nowMillis,
                        clearedAtMillis = null,
                        sharedWithClinician = shared,
                    ),
                )
            }
        }
        // Lowest level first, so the red reasons end up first and each level's newest leads it.
        val counted = newFlags.filter { it.flag.sharedWithClinician }.sortedBy { it.flag.level }
        val attention = if (counted.isEmpty()) {
            null
        } else {
            counted.fold(AttentionUpdate(patient.flagLevel, patient.flagReasons)) { acc, stored ->
                raisedAttention(acc.flagLevel, acc.flagReasons, stored.flag.level, stored.flag.reason)
            }
        }
        return FlagWritePlan(newFlags, attention, skipped)
    }

    /** The Patient's last sign of life after a run at [nowMillis]: it only moves forward. */
    fun signOfLife(lastSeenAtMillis: Long?, nowMillis: Long): Long =
        if (lastSeenAtMillis != null && lastSeenAtMillis > nowMillis) lastSeenAtMillis else nowMillis
}
