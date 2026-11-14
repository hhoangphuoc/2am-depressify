// The one region for every function: europe-north1 (Finland), the same location as the Firestore
// database. The dashboard's copy is FUNCTIONS_REGION in hosting/js/functions.js; test/region.test.ts
// keeps the two in step.
export const REGION = "europe-north1";

// Cloud Scheduler has no europe-north1 location, so the one scheduled function (the Monday Digest)
// runs in europe-west1 (Belgium), still in the EU. It reads the same Firestore database in Finland.
export const SCHEDULER_REGION = "europe-west1";
