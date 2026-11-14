package com.twoam.companion.data

import com.twoam.companion.core.model.PatientDoc

/** The Patient record at `patients/{patientId}`. */
interface PatientStore {
    /** True when the Patient record exists. Throws when it cannot be read. */
    suspend fun exists(patientId: String): Boolean

    /** Writes a new Patient record. Throws when the write fails. */
    suspend fun create(patientId: String, patient: PatientDoc)
}
