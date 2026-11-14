/** Pure status for the `health` function, so it can be tested without the Functions runtime. */
export function healthStatus(nowMillis: number): { ok: true; atMillis: number } {
  return { ok: true, atMillis: nowMillis };
}
