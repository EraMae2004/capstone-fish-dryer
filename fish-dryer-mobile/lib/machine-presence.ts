import { useRef } from "react";
import { parsePresenceMs } from "@/lib/parse-presence-ms";

/** Laravel `last_seen` — API-only mode when Firebase is not configured. */
export const API_LAST_SEEN_MS = 3 * 60 * 1000;

/** ESP nominally pushes ~every 2s, but Wi-Fi/Firebase writes can bunch up. */
export const RTDB_GO_ONLINE_MS = 10_000;

/** Raw offline threshold; UI uses the larger stable threshold below. */
export const RTDB_GO_OFFLINE_MS = 10_000;

/** While Online, tolerate several missed heartbeats to avoid Wi-Fi jitter flicker. */
export const RTDB_STAY_ONLINE_MS = 25_000;

/** First snapshot only — ignore clearly stale rows when opening the app. */
export const RTDB_INITIAL_STALE_MS = 30_000;

/** Offline card flips only after this many presence ticks (not every React render). */
export const RTDB_OFFLINE_CONFIRM_TICKS = 2;

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

/** 12 hex chars, uppercase — matches ESP `gDeviceMacSafe` and Laravel assignments. */
export function normalizeHardwareMacKey(mac: unknown): string | null {
  const raw = String(mac ?? "").replace(/[^0-9a-f]/gi, "").toUpperCase();
  return raw.length >= 8 ? raw : null;
}

export function hardwareStatusBelongsToMachine(
  machineId: number,
  hwRec: Record<string, unknown>,
  machineMac?: string | null
): boolean {
  const mcId = Number(hwRec.microcontroller_id);
  if (Number.isFinite(mcId) && mcId > 0 && mcId !== machineId) {
    return false;
  }
  const expectedMac = normalizeHardwareMacKey(machineMac);
  const payloadMac = normalizeHardwareMacKey(hwRec.mac);
  if (expectedMac && payloadMac && expectedMac !== payloadMac) {
    return false;
  }
  return true;
}

export function isRtdbPayloadFresh(
  payloadMs: number | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (payloadMs == null || !Number.isFinite(payloadMs)) return false;
  return nowMs - payloadMs <= RTDB_GO_ONLINE_MS;
}

/**
 * Per-machine RTDB delivery — call from `machines/{id}/hardware_status` onValue only.
 *
 * - First snapshot: reject if payload is clearly stale (offline on app open).
 * - Every later snapshot: always bump receiveMs (Firebase only re-fires on writes — clock
 *   skew between ESP ISO `updated_at` and the phone must not block live heartbeats).
 */
export function recordMachineRtdbDelivery(
  prevReceiveById: Record<number, number>,
  prevPayloadById: Record<number, number>,
  machineId: number,
  updatedAtRaw: unknown,
  seenCallbackById: Record<number, boolean>,
  nowMs: number = Date.now()
): {
  receiveById: Record<number, number>;
  payloadById: Record<number, number>;
  accepted: boolean;
} {
  const hadAccepted = seenCallbackById[machineId] ?? false;
  const payloadMs = parsePresenceMs(updatedAtRaw);

  if (!hadAccepted) {
    if (payloadMs == null || nowMs - payloadMs > RTDB_INITIAL_STALE_MS) {
      return {
        receiveById: prevReceiveById,
        payloadById: prevPayloadById,
        accepted: false,
      };
    }
  }

  seenCallbackById[machineId] = true;

  const receiveById = { ...prevReceiveById, [machineId]: nowMs };
  const payloadById = {
    ...prevPayloadById,
    [machineId]:
      payloadMs != null
        ? Math.max(prevPayloadById[machineId] ?? 0, payloadMs)
        : prevPayloadById[machineId] ?? nowMs,
  };
  return { receiveById, payloadById, accepted: true };
}

/** @deprecated Parent `machines/` scan — prefer {@link recordMachineRtdbDelivery} per machine path. */
export function bumpMachineRtdbPresence(
  prevReceiveById: Record<number, number>,
  prevPayloadById: Record<number, number>,
  machineId: number,
  updatedAtRaw: unknown,
  nowMs: number = Date.now()
): { receiveById: Record<number, number>; payloadById: Record<number, number> } {
  const payloadMs = parsePresenceMs(updatedAtRaw);
  if (payloadMs == null) {
    return { receiveById: prevReceiveById, payloadById: prevPayloadById };
  }

  const prevPayload = prevPayloadById[machineId] ?? 0;
  const receiveById = { ...prevReceiveById };
  const payloadById = { ...prevPayloadById, [machineId]: Math.max(prevPayload, payloadMs) };

  if (payloadMs > prevPayload && isRtdbPayloadFresh(payloadMs, nowMs)) {
    receiveById[machineId] = nowMs;
  }

  return { receiveById, payloadById };
}

/** Raw age check — prefer {@link isRtdbMicrocontrollerLiveStable} for UI. */
export function isRtdbMicrocontrollerLive(
  lastReceiveMs: number | null | undefined,
  nowMs: number = Date.now()
): boolean {
  if (lastReceiveMs == null || !Number.isFinite(lastReceiveMs)) return false;
  return nowMs - lastReceiveMs <= RTDB_GO_OFFLINE_MS;
}

/**
 * Hysteresis: harder to go Online, easier to stay Online (stops card flicker).
 * - Currently offline → need fresh heartbeat within RTDB_GO_ONLINE_MS.
 * - Currently online → stay online until RTDB_STAY_ONLINE_MS without fresh delivery.
 */
export function isRtdbMicrocontrollerLiveStable(
  lastReceiveMs: number | null | undefined,
  wasOnline: boolean,
  nowMs: number = Date.now()
): boolean {
  if (lastReceiveMs == null || !Number.isFinite(lastReceiveMs)) {
    return false;
  }
  const age = nowMs - lastReceiveMs;
  if (wasOnline) {
    return age <= RTDB_STAY_ONLINE_MS;
  }
  return age <= RTDB_GO_ONLINE_MS;
}

/** Recompute stable online flags — call from a timer and on RTDB receive updates only. */
export function computeStableOnlineByMachineId(
  receiveById: Record<number, number>,
  prevStable: Record<number, boolean>,
  machineIds: number[],
  nowMs: number = Date.now(),
  offlineStreakById: Record<number, number> = {},
  advanceOfflineDebounce: boolean = true
): Record<number, boolean> {
  const next: Record<number, boolean> = { ...prevStable };
  for (const id of machineIds) {
    const wasOnline = prevStable[id] ?? false;
    const wouldBeOnline = isRtdbMicrocontrollerLiveStable(
      receiveById[id],
      wasOnline,
      nowMs
    );
    if (wouldBeOnline) {
      offlineStreakById[id] = 0;
      next[id] = true;
      continue;
    }
    if (wasOnline) {
      if (!advanceOfflineDebounce) {
        next[id] = true;
        continue;
      }
      const streak = (offlineStreakById[id] ?? 0) + 1;
      offlineStreakById[id] = streak;
      next[id] = streak < RTDB_OFFLINE_CONFIRM_TICKS;
      continue;
    }
    offlineStreakById[id] = 0;
    next[id] = false;
  }
  return next;
}

export function useStableMachineOnline(
  lastReceiveMs: number | null | undefined,
  presenceTick: number,
  machineId?: number | null
): boolean {
  const onlineRef = useRef(false);
  const lastReceiveRef = useRef<number | null>(null);
  const offlineStreakRef = useRef(0);
  const lastTickRef = useRef(-1);
  const boundMachineRef = useRef<number | null | undefined>(undefined);
  const now = Date.now();

  if (machineId !== undefined && boundMachineRef.current !== machineId) {
    boundMachineRef.current = machineId;
    lastReceiveRef.current = null;
    onlineRef.current = false;
    offlineStreakRef.current = 0;
    lastTickRef.current = -1;
    return onlineRef.current;
  }

  if (lastReceiveMs != null && Number.isFinite(lastReceiveMs)) {
    lastReceiveRef.current = lastReceiveMs;
  }

  const wouldBeOnline = isRtdbMicrocontrollerLiveStable(
    lastReceiveRef.current,
    onlineRef.current,
    now
  );

  if (wouldBeOnline) {
    offlineStreakRef.current = 0;
    onlineRef.current = true;
    return onlineRef.current;
  }

  const tickAdvanced = presenceTick !== lastTickRef.current;
  if (tickAdvanced) {
    lastTickRef.current = presenceTick;
    if (onlineRef.current) {
      offlineStreakRef.current += 1;
      onlineRef.current = offlineStreakRef.current < RTDB_OFFLINE_CONFIRM_TICKS;
    } else {
      offlineStreakRef.current = 0;
      onlineRef.current = false;
    }
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
    return opts.stableOnline ?? isRtdbMicrocontrollerLiveStable(opts.rtdbLastReceiveMs, false);
  }
  return isMachineLive(opts.machine);
}
