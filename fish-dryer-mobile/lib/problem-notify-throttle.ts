/** Same problem may fire again only after this gap; each fire creates a new list row. */
export const PROBLEM_NOTIFY_INTERVAL_MS = 180_000;

const problemNotifyLastMsByKey: Record<string, number> = {};

export function tryAcquireProblemNotifySlot(key: string, mcId: number): boolean {
  const throttleKey = `${key}:${mcId}`;
  const now = Date.now();
  const last = problemNotifyLastMsByKey[throttleKey] ?? 0;
  if (now - last < PROBLEM_NOTIFY_INTERVAL_MS) return false;
  problemNotifyLastMsByKey[throttleKey] = now;
  return true;
}

/** After "Read all", delay the next repeat alert by a full interval. */
export function bumpAllProblemNotifyThrottles(): void {
  const now = Date.now();
  for (const k of Object.keys(problemNotifyLastMsByKey)) {
    problemNotifyLastMsByKey[k] = now;
  }
}

export function clearProblemNotifyThrottleForMachine(mcId: number): void {
  const suffix = `:${mcId}`;
  for (const k of Object.keys(problemNotifyLastMsByKey)) {
    if (k.endsWith(suffix)) delete problemNotifyLastMsByKey[k];
  }
}

export function clearProblemNotifyThrottleForSensor(
  key: string,
  mcId: number,
  kinds: Array<"critical" | "warning"> = ["critical", "warning"]
): void {
  for (const kind of kinds) {
    delete problemNotifyLastMsByKey[`hw:${key}:${kind}:${mcId}`];
  }
}
