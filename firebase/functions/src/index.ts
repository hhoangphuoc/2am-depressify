import { setGlobalOptions } from "firebase-functions/v2";
import { onRequest } from "firebase-functions/v2/https";
import { healthStatus } from "./health";

// All functions run in one EU region. Provisional until the Firestore region is fixed at project
// creation and recorded with the spike results.
export const REGION = "europe-west1";
setGlobalOptions({ region: REGION });

/** Trivial liveness check for the walking skeleton. Logs nothing. */
export const health = onRequest((_request, response) => {
  response.json(healthStatus(Date.now()));
});
