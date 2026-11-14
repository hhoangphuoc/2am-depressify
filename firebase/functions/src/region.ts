// The one region for every function: europe-north1 (Finland), the same location as the Firestore
// database. The dashboard's copy is FUNCTIONS_REGION in hosting/js/functions.js; test/region.test.ts
// keeps the two in step.
export const REGION = "europe-north1";

// Cloud Scheduler has no europe-north1 location, so the scheduled functions (the Monday Digest and
// the hourly silence check) run in europe-west1 (Belgium), still in the EU. They read the same
// Firestore database in Finland. The seed's silence test names this region for the check's Cloud
// Scheduler job (SILENCE_CHECK_REGION in seed/src/silence-test.js); test/region.test.ts keeps the
// two in step.
export const SCHEDULER_REGION = "europe-west1";
