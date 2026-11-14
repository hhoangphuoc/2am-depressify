package com.twoam.companion.core.model

import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.io.File
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * Writes the data contract (enumerations, Signal keys, document field names, defaults) to
 * firebase/functions/test/fixtures/contract.json. The functions' vitest suite compares
 * src/types.ts and the dashboard's contract.js against this file, so the hand-written mirrors
 * cannot drift silently. Commit the file whenever it changes.
 */
class ContractExportTest {

    @Test
    fun exportContractForTypeScriptMirror() {
        val path = System.getProperty("contract.export") ?: return
        val pretty = Json { prettyPrint = true }
        val contract = buildJsonObject {
            put("signals", JsonArray(Signal.entries.map {
                buildJsonObject { put("key", it.key); put("direction", it.direction.name) }
            }))
            put("enums", buildJsonObject {
                put("SignalDirection", names(SignalDirection.entries))
                put("FlagLevel", names(FlagLevel.entries))
                put("FlagKind", names(FlagKind.entries))
                put("SuggestionKind", names(SuggestionKind.entries))
                put("SuggestionStatus", names(SuggestionStatus.entries))
                put("HealthSource", names(HealthSource.entries))
                put("SharingConsent", names(SharingConsent.entries))
                put("ConsentPurpose", names(ConsentPurpose.entries))
                put("QuestionnaireKind", names(QuestionnaireKind.entries))
            })
            put("collections", buildJsonObject {
                put("patients", Collections.PATIENTS)
                put("patientSubcollections", JsonArray(Collections.PATIENT_SUBCOLLECTIONS.map(::JsonPrimitive)))
                put("mail", Collections.MAIL)
            })
            put("documents", buildJsonObject {
                put("PatientDoc", fields(PatientDoc.serializer()))
                put("DailyDoc", fields(DailyDoc.serializer()))
                put("Consent", fields(Consent.serializer()))
                put("VoiceCue", fields(VoiceCue.serializer()))
                put("CheckIn", fields(CheckIn.serializer()))
                put("Summary", fields(Summary.serializer()))
                put("Suggestion", fields(Suggestion.serializer()))
                put("Flag", fields(Flag.serializer()))
                put("Visit", fields(Visit.serializer()))
                put("Digest", fields(Digest.serializer()))
                put("MailMessage", fields(MailMessage.serializer()))
                put("MailDoc", fields(MailDoc.serializer()))
            })
            put("defaults", buildJsonObject {
                put(
                    "newPatient",
                    FirestoreJson.json.encodeToJsonElement(
                        PatientDoc.serializer(),
                        PatientDoc(displayName = "Live patient", clinicianEmail = "clinician@example.com"),
                    ),
                )
            })
        }
        val file = File(path)
        file.parentFile.mkdirs()
        file.writeText(pretty.encodeToString(JsonElement.serializer(), contract) + "\n")
        assertTrue(file.length() > 0)
    }

    private fun names(entries: List<Enum<*>>): JsonArray = JsonArray(entries.map { JsonPrimitive(it.name) })

    private fun fields(serializer: KSerializer<*>): JsonArray =
        JsonArray((0 until serializer.descriptor.elementsCount).map { JsonPrimitive(serializer.descriptor.getElementName(it)) })
}
