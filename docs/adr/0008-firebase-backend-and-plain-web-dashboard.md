# Firebase is the backend, and the dashboard is plain web

We first planned a Ktor server with Postgres and a Compose for web dashboard ([ADR 0004](0004-one-kotlin-codebase-for-app-dashboard-and-backend.md)). A second design ([PR #2](https://github.com/hhoangphuoc/2am-depressify/pull/2)) used Firebase and showed ours was too large for a 48-hour build. We merged them: the Patient app stays Kotlin Multiplatform for Android and iOS, the backend is Firebase (Firestore, Auth, Cloud Functions, Cloud Messaging, Hosting), and the Clinician dashboard is plain HTML and JavaScript on Firebase Hosting. Firebase gives sign-in, push, email alerts, scheduled jobs and live dashboard updates without a server of our own.

## Consequences

- Firebase has no official Kotlin Multiplatform SDK. Shared code uses the third-party [GitLive firebase-kotlin-sdk](https://github.com/GitLiveApp/firebase-kotlin-sdk) (stable 2.8.0) for Firestore, Auth, Functions and Messaging.
- The dashboard is not Compose for web because the stable GitLive release has no Wasm target, and the Firebase JavaScript SDK gives live updates directly.
- Cloud Functions are TypeScript, so the Firestore document shapes are defined twice: in Kotlin `core` and in TypeScript. Decision logic (Baseline, flag rules, Nudge rules, learning) lives once, in pure Kotlin `core`.
- Moving off Firestore later means rewriting the data layer and the dashboard queries.
