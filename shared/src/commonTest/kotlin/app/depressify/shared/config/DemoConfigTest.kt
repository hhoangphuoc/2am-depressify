package app.depressify.shared.config

import app.depressify.shared.di.configModule
import org.koin.dsl.koinApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertSame

class DemoConfigTest {
    @Test
    fun theClinicianEmailIsTrimmedAndLowerCasedAsTheSignInTokenCarriesIt() {
        assertEquals("dr.real@example.org", DemoConfig("  Dr.Real@Example.ORG ").clinicianEmail)
    }

    @Test
    fun theEmulatorPlaceholderIsAnExampleAddress() {
        assertEquals("clinician@example.com", DemoConfig(DemoConfig.EMULATOR_CLINICIAN_EMAIL).clinicianEmail)
    }

    @Test
    fun thePlatformsConfigurationIsWhatKoinProvides() {
        val config = DemoConfig("configured@example.com")
        val koin = koinApplication { modules(configModule(config)) }.koin
        assertSame(config, koin.get<DemoConfig>())
    }
}
