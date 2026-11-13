# Health Signals are read on the phone and uploaded

Heart rate, HRV, sleep and steps come from Health Connect on Android and HealthKit on iOS. Both are on-device stores, so the app reads them and uploads to the backend. We skipped cloud sources (Google Health API, Oura) because they need a specific wearable and extra OAuth approval ([research](../research/calendar-and-health-apis.md)).

## Consequences

- Fresh health Signals arrive only when the app runs; the backend cannot pull them.
- HRV is RMSSD on Android and SDNN on iOS, and neither store has a sleep score. Values are only comparable within one Patient, never across Patients.
- The demo uses seeded data alongside real reads.
