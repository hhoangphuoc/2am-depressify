// The one region for every function: europe-north1 (Finland), the same location as the Firestore
// database. The dashboard's copy is FUNCTIONS_REGION in hosting/js/functions.js; test/region.test.ts
// keeps the two in step.
export const REGION = "europe-north1";

// The scheduled weeklyDigest alone runs in europe-west1, where it is deployed: its Cloud Scheduler
// job could not be created in europe-north1. Only Google's scheduler can call it.
export const SCHEDULED_REGION = "europe-west1";
