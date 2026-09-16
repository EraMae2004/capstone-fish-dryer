import { onValue, ref as dbRef, type Database, type Unsubscribe } from "firebase/database";
import { parsePresenceMs } from "@/lib/parse-presence-ms";

/** ESP writes ~2s; HTTPS/keypad can gap. Older than this is not a live board. */
export const LIVE_HEARTBEAT_MS = 180_000;

function isServerTimestampPlaceholder(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && ".sv" in (value as object));
}

export function firebaseUpdatedAtMs(updatedAt: unknown): number | null {
  if (isServerTimestampPlaceholder(updatedAt)) return null;
  return parsePresenceMs(updatedAt);
}

/** True when Firebase last delivered a live `hardware_status` write. */
export function isFirebaseHeartbeatLive(
  updatedAt: unknown,
  nowMs: number = Date.now(),
  lastReceiveMs?: number | null
): boolean {
  if (lastReceiveMs != null && Number.isFinite(lastReceiveMs)) {
    const recvAge = nowMs - lastReceiveMs;
    if (recvAge >= -5_000 && recvAge <= LIVE_HEARTBEAT_MS) return true;
  }
  if (isServerTimestampPlaceholder(updatedAt)) return true;
  const t = firebaseUpdatedAtMs(updatedAt);
  if (t == null || !Number.isFinite(t)) return false;
  const age = nowMs - t;
  // Phone/ESP clocks can differ; Firebase server time can sit slightly ahead.
  return age >= -600_000 && age <= LIVE_HEARTBEAT_MS;
}

/** Live listener. Delivers every snapshot. Path empty → onDead. */
export function subscribeLiveHardwareStatus(
  db: Database,
  machineId: number,
  onLive: (hw: Record<string, unknown>) => void,
  onDead?: () => void
): Unsubscribe {
  return onValue(dbRef(db, `machines/${machineId}/hardware_status`), (snap) => {
    const val = snap.val();
    if (!val || typeof val !== "object") {
      onDead?.();
      return;
    }
    onLive(val as Record<string, unknown>);
  });
}
