@file:Suppress("EnumEntryName") // Enumeration entries are the lower-case words stored in Firestore.

package com.twoam.companion.core.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.PrimitiveKind
import kotlinx.serialization.descriptors.PrimitiveSerialDescriptor
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder

// The Firestore data contract. Defined once here and mirrored by hand in
// firebase/functions/src/types.ts and firebase/hosting/js/lib/contract.js.
// Every collection and field is listed in docs/firestore-schema.md.
//
// Rules that hold for every document:
// - Timestamps are epoch milliseconds in fields ending `AtMillis`.
// - Dates are `yyyy-MM-dd` strings in the device time zone (Europe/Helsinki in the demo); see DateKeys.
// - Enumerations are stored as lower-case words (the entry names below).
// - A missing value is null, never zero, and nulls are written explicitly (see FirestoreJson).

// ---------------------------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------------------------

/** Whether a higher value of a Signal is better, worse, or neither. */
@Serializable
enum class SignalDirection { higher_is_better, lower_is_better, none }

/**
 * One kind of measurement about a Patient's day. Stored by its [key], which is also the field name
 * in a daily record's `values` and `vsBaseline` maps and the document id in `consents`.
 * Signals with no direction are stored and charted but stay out of the composite.
 */
@Serializable(with = SignalSerializer::class)
enum class Signal(val key: String, val direction: SignalDirection) {
    SLEEP_MINUTES("sleepMinutes", SignalDirection.higher_is_better),
    STEPS("steps", SignalDirection.higher_is_better),
    MEAN_HEART_RATE("meanHeartRate", SignalDirection.none),
    RESTING_HEART_RATE("restingHeartRate", SignalDirection.lower_is_better),
    HRV("hrv", SignalDirection.higher_is_better),
    TIME_AT_HOME_MINUTES("timeAtHomeMinutes", SignalDirection.lower_is_better),
    MOVEMENT_RADIUS_KM("movementRadiusKm", SignalDirection.higher_is_better),
    CALENDAR_BUSY_MINUTES("calendarBusyMinutes", SignalDirection.none),
    LATE_NIGHT_SCREEN_MINUTES("lateNightScreenMinutes", SignalDirection.lower_is_better),
    ;

    companion object {
        /** The Signals that take part in the composite (those with a direction). */
        val inComposite: List<Signal> = entries.filter { it.direction != SignalDirection.none }

        fun fromKey(key: String): Signal? = entries.firstOrNull { it.key == key }
    }
}

internal object SignalSerializer : KSerializer<Signal> {
    override val descriptor: SerialDescriptor =
        PrimitiveSerialDescriptor("com.twoam.companion.core.model.Signal", PrimitiveKind.STRING)

    override fun serialize(encoder: Encoder, value: Signal) = encoder.encodeString(value.key)

    override fun deserialize(decoder: Decoder): Signal {
        val key = decoder.decodeString()
        return Signal.fromKey(key) ?: throw SerializationException("Unknown Signal key '$key'")
    }
}

/** Attention flag level. Shown to the Clinician only, always with written reasons. */
@Serializable
enum class FlagLevel { green, amber, red }

/** What raised an Attention flag. */
@Serializable
enum class FlagKind { drift, low_mood, poor_sleep, decline, unassessed, sleep_collapse, inactive, silent, crisis }

@Serializable
enum class SuggestionKind { walk, nature, music, social_call, breathing, class_activity, daylight }

/** Where a Suggestion stands. Whether it was tried is a separate field, so "declined" never means "not tried". */
@Serializable
enum class SuggestionStatus { proposed, accepted, declined }

/** Where a Patient's health Signals come from. Exactly one source per Patient. */
@Serializable
enum class HealthSource { device, synthetic }

/** The Patient's sharing Consent for the Clinician's view. */
@Serializable
enum class SharingConsent { undecided, granted, declined }

/**
 * Consents that are not about a single Signal. A Consent document id is either a [Signal.key] or
 * one of these words.
 */
@Serializable
enum class ConsentPurpose { sharing, ratings, voice_cues }

/** A Questionnaire the Clinician records at a Visit. The Companion never asks these questions. */
@Serializable
enum class QuestionnaireKind { phq2, phq9 }

// ---------------------------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------------------------

/** `patients/{patientId}`. The Patient id is the Patient's auth uid. */
@Serializable
data class PatientDoc(
    val displayName: String,
    val clinicianEmail: String,
    val intakeHighlights: String = "",
    /** Date (yyyy-MM-dd) the TMS course ended, set by the Clinician. */
    val tmsEndDate: String? = null,
    val flagLevel: FlagLevel = FlagLevel.green,
    val flagReasons: List<String> = emptyList(),
    /** Quiet hours start, hour of day 0..23 (default 21:00). The window may cross midnight. */
    val quietHoursStart: Int = 21,
    /** Quiet hours end, hour of day 0..23 (default 09:00). */
    val quietHoursEnd: Int = 9,
    /** Last sign of life from the phone. */
    val lastSeenAtMillis: Long? = null,
    val lastCheckInAtMillis: Long? = null,
    val healthSource: HealthSource = HealthSource.device,
    /** True for Demo Patients. All their values are invented. */
    val synthetic: Boolean = false,
    val sharingConsent: SharingConsent = SharingConsent.undecided,
    val sharingChangedAtMillis: Long? = null,
)

/**
 * `patients/{id}/daily/{date}`. [values] and [vsBaseline] are keyed by [Signal.key] and hold every
 * Signal, with null where there is no value (a night without the watch is null, never zero).
 * [vsBaseline] is the comparison with the Patient's own Baseline, in units of their spread.
 */
@Serializable
data class DailyDoc(
    val date: String,
    val values: Map<String, Double?>,
    val vsBaseline: Map<String, Double?>,
    val composite: Double?,
    /** True when a demo control wrote this record; overrides only ever touch these. */
    val demoOverride: Boolean = false,
) {
    companion object {
        /** Builds a daily record holding every Signal key, null where [values] or [vsBaseline] has none. */
        fun of(
            date: String,
            values: Map<Signal, Double?>,
            vsBaseline: Map<Signal, Double?>,
            composite: Double?,
            demoOverride: Boolean = false,
        ): DailyDoc = DailyDoc(
            date = date,
            values = Signal.entries.associate { it.key to values[it] },
            vsBaseline = Signal.entries.associate { it.key to vsBaseline[it] },
            composite = composite,
            demoOverride = demoOverride,
        )
    }
}

/** `patients/{id}/consents/{subject}`, where subject is a [Signal.key] or a [ConsentPurpose] word. */
@Serializable
data class Consent(
    val subject: String,
    val granted: Boolean,
    val changedAtMillis: Long,
)

/** Something the Companion noticed in how the Patient sounds. An observation, never a diagnosis. */
@Serializable
data class VoiceCue(
    val label: String,
    /** 1 to 5. */
    val intensity: Int,
    val heard: String,
)

/** `patients/{id}/checkIns/{checkInId}`. Ratings are 1 to 5, or null when not given. */
@Serializable
data class CheckIn(
    val id: String,
    val startedAtMillis: Long,
    val endedAtMillis: Long? = null,
    val mood: Int? = null,
    val energy: Int? = null,
    val sleepQuality: Int? = null,
    val voiceCues: List<VoiceCue> = emptyList(),
    val crisis: Boolean = false,
)

/**
 * `patients/{id}/summaries/{checkInId}`. Keyed by the Check-in id, so a retried finish overwrites
 * and never duplicates. The Patient reads exactly what the Clinician reads.
 */
@Serializable
data class Summary(
    val checkInId: String,
    val createdAtMillis: Long,
    val mood: Int?,
    val energy: Int?,
    val sleepQuality: Int?,
    val sleepLine: String,
    val themes: List<String>,
    val voiceCues: List<VoiceCue>,
    /** The Suggestion made in this Check-in, as one line, or null when none was made. */
    val suggestion: String?,
    /** What the Patient said about the previous Suggestion, or null when unknown. */
    val previousOutcome: String?,
    /** At most three short quotes that explain a flag. */
    val quotes: List<String>,
)

/** `patients/{id}/suggestions/{suggestionId}`. */
@Serializable
data class Suggestion(
    val id: String,
    val kind: SuggestionKind,
    val details: String,
    val suggestedAtMillis: Long,
    val status: SuggestionStatus = SuggestionStatus.proposed,
    val booked: Boolean = false,
    /** Null until the Patient answers; false means "not this time". */
    val tried: Boolean? = null,
    /** How it felt, 1 to 5, or null. */
    val felt: Int? = null,
    /** That day's oriented steps comparison with Baseline, or null. */
    val objectiveChange: Double? = null,
    val outcomeScore: Double? = null,
)

/** `patients/{id}/flags/{flagId}`. The reason is a plain sentence and never contains a score. */
@Serializable
data class Flag(
    val level: FlagLevel,
    val kind: FlagKind,
    val reason: String,
    val raisedAtMillis: Long,
    /** Set only by the Clinician after following up. History is kept. */
    val clearedAtMillis: Long? = null,
)

/** `patients/{id}/visits/{visitId}`. Written by the Clinician. */
@Serializable
data class Visit(
    val date: String,
    val questionnaire: QuestionnaireKind? = null,
    /** PHQ-2: 0 to 6; PHQ-9: 0 to 27. Never feeds the Attention flag. */
    val score: Int? = null,
)

/** `patients/{id}/digests/{isoWeek}`, for example `2026-W46`. */
@Serializable
data class Digest(
    val isoWeek: String,
    val text: String,
    val generatedAtMillis: Long,
)

/** Message body for the Trigger Email extension. */
@Serializable
data class MailMessage(
    val subject: String,
    val text: String,
)

/** Top-level `mail/{autoId}`. Written by Cloud Functions only; read by the Trigger Email extension. */
@Serializable
data class MailDoc(
    val to: String,
    val message: MailMessage,
)
