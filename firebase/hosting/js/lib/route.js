// Hash routes for the dashboard. No Firebase imports, so `node --test` can run them.
//   ""  or "#/"            the Patient list
//   "#/patient/{id}"       one Patient's page

/**
 * @param {string} hash `window.location.hash`
 * @returns {{ name: "list" } | { name: "patient", patientId: string }}
 */
export function parseRoute(hash) {
  const match = /^#\/patient\/([^/]+)\/?$/.exec(String(hash ?? ""));
  if (match) {
    try {
      const patientId = decodeURIComponent(match[1]);
      if (patientId.trim() !== "" && !patientId.includes("/")) return { name: "patient", patientId };
    } catch {
      // A malformed escape falls through to the list.
    }
  }
  return { name: "list" };
}

/**
 * @param {string} patientId
 * @returns {string}
 */
export function patientHref(patientId) {
  return `#/patient/${encodeURIComponent(patientId)}`;
}
