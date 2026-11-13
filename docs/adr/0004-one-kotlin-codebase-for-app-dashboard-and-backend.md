# One Kotlin codebase for the patient app, clinician dashboard and backend

The Patient app (Android and iOS), the Clinician dashboard (web) and the backend live in one Kotlin Multiplatform project and share models. The dashboard uses Compose Multiplatform for web even though it is Beta and Jetpack rates web targets as untested, because it is a few read-only screens and one stack suits the team ([research](../research/kmp-mobile-integration.md)). If Wasm blocks us, the dashboard moves to a separate web frontend against the same backend API.

## Consequences

- No Room on the dashboard; it has no web target.
- Platform features (audio, health, push, maps) sit behind common interfaces with Android and iOS implementations. iOS audio and background behaviour were not verified in the research.
