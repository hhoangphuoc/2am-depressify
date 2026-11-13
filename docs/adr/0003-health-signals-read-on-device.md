# Health Signals are read on the phone and uploaded

Heart rate, HRV, sleep and steps come from Health Connect on Android and HealthKit on iOS. Both are on-device stores, so the app reads them and uploads to the backend. We skipped cloud sources (Google Health API, Oura) because they need a specific wearable and extra OAuth approval ([research](../research/calendar-and-health-apis.md)).

## Consequences

- Fresh health Signals arrive only when the app runs; the backend cannot pull them.
- HRV is RMSSD on Android and SDNN on iOS, and neither store has a sleep score. Every Signal is therefore compared only with the same Patient's Baseline (their median over the previous 14 days), never across Patients.
- A Patient's health Signals come from one source, synthetic or device, never both.
- Demo Patients have synthetic health Signals stored directly in the database, so the Companion, Summaries and dashboard can be built and shown even when Health Connect or HealthKit is unavailable or not authorised. Synthetic and device Signals use the same stored shape.
- Heart rate, sleep and steps go through the HealthKMP library (one maintainer); HRV is our own code per platform because the library lacks it.
