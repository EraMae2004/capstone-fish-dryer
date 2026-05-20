import { useRef } from "react";
import { parsePresenceMs } from "@/lib/parse-presence-ms";

/** Laravel `last_seen` — API-only mode when Firebase is not configured. */
export const API_LAST_SEEN_MS = 3 * 60 * 1000;

/**
 * ESP pushes ~every 2s. Presence uses when the phone *received* RTDB data,
 * not `updated_at` inside the JSON (Laravel + ESP both write — that field flickers).
 */
export const RTDB_GO_ONLINE_MS = 18_000;

/** Stay Online until this long with zero RTDB deliveries (matches Laravel RTDB grace). */
export const RTDB_GO_OFFLINE_MS = 90_000;

/** @deprecated Use API_LAST_SEEN_MS. */
export const LIVE_LAST_SEEN_MS = API_LAST_SEEN_MS;

/** @deprecated */
export const RTDB_HEARTBEAT_STALE_MS = RTDB_GO_ONLINE_MS;

/** @deprecated */
export const RTDB_OFFLINE_GRACE_MS = RTDB_GO_OFFLINE_MS;

export type MachinePresenceRow = {
  status?: unknown;
  last_seen?: string | number | null;
};

export type RtdbSnapshotPresence = {
  receiveMs: number | null;
  payloadMs: number | null;
  acceptDelivery: boolean;
};

export function isApiStatusOnline(status: unknown): boolean {
  if (status === true || status === 1) return true;
  if (status === false || status === 0) return false;
  const raw = String(status ?? "")
    .trim()
    .toLowerCase();
  return raw === "online" || raw === "true" || raw === "1";
}

export function isMachineLive(machine: MachinePresenceRow | null | undefined): boolean {
  if (!machine) return false;
  if (!isApiStatusOnline(machine.status)) return false;
  const lastSeenMs = parsePresenceMs(machine.last_seen);
  if (lastSeenMs === null) return false;
  return Date.now() - lastSeenMs <= API_LAST_SEEN_MS;
}

/**
 * Any RTDB `hardware_status` delivery counts as a live heartbeat.
 * Do not reject by `updated_at` — it fights between Laravel mirror and ESP writes.
 */
export function ingestRtdbHardwareSnapshot(
  updatedAtRaw: unknown,
  nowMs: number = Date.now()
): RtdbSnapshotPresence {
  return {
    receiveMs: nowMs,
    payloadMs: parsePresenceMs(updatedAtRaw),
    acceptDelivery: true,
  };
}

export function isRtdbMicrocontrollerLive(
  lastReceiveMs: number | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (lastReceiveMs == null || !Number.isFinite(lastReceiveMs)) return false;
  return nowMs - lastReceiveMs <= RTDB_GO_OFFLINE_MS;
}

/**
 * Monotonic last-good delivery + long offline grace so brief null/unmount does not flash Offline.
 */
export function useStableMachineOnline(
  lastReceiveMs: number | null | undefined,
  presenceTick: number,
  machineId?: number | null
): boolean {
  const onlineRef = useRef(false);
  const lastGoodRef = useRef<number | null>(null);
  const boundMachineRef = useRef<number | null | undefined>(undefined);
  void presenceTick;
  const now = Date.now();

  if (machineId !== undefined && boundMachineRef.current !== machineId) {
    boundMachineRef.current = machineId;
    lastGoodRef.current = null;
    onlineRef.current = false;
  }

  if (lastReceiveMs != null && Number.isFinite(lastReceiveMs)) {
    lastGoodRef.current = Math.max(lastGoodRef.current ?? 0, lastReceiveMs);
  }

  const last = lastGoodRef.current;
  if (last != null && now - last <= RTDB_GO_OFFLINE_MS) {
    onlineRef.current = true;
  } else if (last == null || now - last > RTDB_GO_OFFLINE_MS) {
    onlineRef.current = false;
  }

  return onlineRef.current;
}

export function isMachineOnlineForUi(opts: {
  firebaseConfigured: boolean;
  rtdbLastReceiveMs: number | null | undefined;
  machine?: MachinePresenceRow | null;
  stableOnline?: boolean;
}): boolean {
  if (opts.firebaseConfigured) {
    return opts.stableOnline ?? isRtdbMicrocontrollerLive(opts.rtdbLastReceiveMs);
  }
  return isMachineLive(opts.machine);
}
