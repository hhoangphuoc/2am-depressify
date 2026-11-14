package app.depressify.android

import android.Manifest
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import app.depressify.shared.DepressifyApp
import app.depressify.shared.data.firebase.firebasePatientBackend

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        // shortcut: asks for the microphone at launch; move the request to the Check-in intro, where the
        // screen already explains it and offers typing, before real Patients use the app.
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {}.launch(Manifest.permission.RECORD_AUDIO)
        val backend = if (BuildConfig.DEBUG && BuildConfig.DEMO_PATIENT_ID.isNotBlank()) {
            val preferences = getSharedPreferences("demo", MODE_PRIVATE)
            val selected = intent.getStringExtra(DEMO_PATIENT_EXTRA)?.takeIf { it in DEMO_PATIENTS }
                ?: preferences.getString(DEMO_PATIENT_EXTRA, BuildConfig.DEMO_PATIENT_ID)
            preferences.edit().putString(DEMO_PATIENT_EXTRA, selected).apply()
            firebasePatientBackend(BuildConfig.CLINICIAN_EMAIL, selected)
        } else (application as DepressifyApplication).backend
        setContent {
            // The app picks its own night theme by local time, so the system bar icons follow it.
            DepressifyApp(backend = backend, onNightChange = { night ->
                val style = if (night) SystemBarStyle.dark(Color.TRANSPARENT)
                else SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
                enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
            })
        }
    }
}
