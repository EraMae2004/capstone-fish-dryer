import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { View, TouchableOpacity, Text, StyleSheet, ActivityIndicator, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { onValue, ref as dbRef, set as dbSet, update as dbUpdate, type DataSnapshot } from "firebase/database";
import OverviewStatus from "./overview-status";
import OverviewParameters from "./overview-parameters";
import OverviewHeader from "./overview-header";
import DoorOpenModal from "./door-open-modal";
import DryingCompleteModal from "./drying-complete-modal";
import MoistureCheckModal from "./moisture-check-modal";
import MachineDropdown from "./machine-dropdown";
import { useSelectedMachine } from "@/lib/selected-machine";
import { API_BASE_URL } from "@/config/api";
import { firebaseDb } from "@/config/firebase";
import {
  appendHardwareNotification,
  CRITICAL_SENSOR_KEYS,
} from "@/lib/hardware-notifications-store";
import {
  digitsToMinutes,
  formatDigitsAsHMS,
  formatMinutesAsHMS,
  formatSecondsAsHMS,
  minutesToDigits,
} from "@/lib/duration-format";
import { resolveMoisturePercent } from "@/lib/duration-format";
import { lastMoistureFromDraft, type MoistureBatchDraft } from "@/lib/moisture-checks";
import {
  clearMoistureDraft,
  flattenMoistureDraftForStop,
  loadMoistureDraft,
  saveMoistureDraft,
} from "@/lib/moisture-session-draft";
import { formatRecommendationParams } from "@/lib/format-recommendation";
import { readRealDoorIsOpen } from "@/lib/door-sensor-display";
import { parsePresenceMs } from "@/lib/parse-presence-ms";
import {
  isMachineOnlineForUi,
  RTDB_INITIAL_STALE_MS,
  useStableMachineOnline,
} from "@/lib/machine-presence";
import {
  canonicalHardwareSensorKey,
  coerceHardwareStatus,
  hardwareRowsFromComponentsMap,
  componentsMapFromRtdbPayload,
  lookupComponentStatus,
  parseHardwareStatusFromRtdb,
} from "@/lib/hardware-status-rtdb";

/** Poll Laravel for session + machine metadata (not used for online/offline when Firebase is on). */
const OVERVIEW_API_POLL_MS = 15_000;
/** Single relay fan — fixed speed; not user-configurable. */
const SESSION_FAN_SPEED = 1;

function sessionDurationSeconds(session: { set_duration_minutes?: unknown } | null | undefined): number {
  const m = Number(session?.set_duration_minutes);
  return Number.isFinite(m) && m > 0 ? Math.floor(m * 60) : 0;
}

function remainingSecToDurationDigits(totalSeconds: number): string {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(h)}${pad(m)}${pad(s)}`;
}

function durationDigitsToSeconds(digits: string): number | null {
  const clean = String(digits ?? "").replace(/\D/g, "").slice(-6);
  if (!clean) return null;
  const padded = clean.padStart(6, "0");
  const h = parseInt(padded.slice(0, 2), 10);
  const m = parseInt(padded.slice(2, 4), 10);
  const s = parseInt(padded.slice(4, 6), 10);
  if (m > 59 || s > 59) return null;
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? total : null;
}

function toPositiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** Recompute RTDB staleness every second so offline appears soon after the ESP stops. */
const PRESENCE_UI_TICK_MS = 500;
import {
  tryAcquireProblemNotifySlot,
  clearProblemNotifyThrottleForMachine,
  clearProblemNotifyThrottleForSensor,
} from "@/lib/problem-notify-throttle";

function normalizeHardwareKey(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .trim();
}

/** Map raw firmware status to alert severity. */
function sensorAlertTypeFromStatus(raw: string): "critical" | "warning" | null {
  const st = coerceHardwareStatus(raw);
  if (st === "warning") return "warning";
  if (st === "not_working") return "critical";
  return null;
}

function isGoodSensorStatus(raw: string): boolean {
  return coerceHardwareStatus(raw) === "working";
}

/** Two messages per sensor: one for unstable readings (warning), one for undetected/disconnected (critical). */
const SENSOR_ALERT_META: Record<
  string,
  {
    warning: { title: string; desc: string };
    critical: { title: string; desc: string };
  }
> = {
  esp32: {
    warning: {
      title: "ESP32 reading unstable",
      desc: "Controller telemetry is fluctuating (Wi‑Fi or heap). Connectivity may drop intermittently.",
    },
    critical: {
      title: "ESP32 not detected",
      desc: "The controller is not responding. Check power and Wi‑Fi.",
    },
  },
  dht22: {
    warning: {
      title: "DHT22 reading unstable",
      desc: "Temperature/humidity readings are jittering beyond expected range.",
    },
    critical: {
      title: "DHT22 not detected",
      desc: "The temperature/humidity sensor is not responding. Check wiring on GPIO4.",
    },
  },
  moisture_sensor: {
    warning: {
      title: "Moisture reading unstable",
      desc: "Moisture probe values are fluctuating. Check probe contact and cable.",
    },
    critical: {
      title: "Moisture sensor not detected",
      desc: "The moisture sensor is not responding. Check YL-69 A0 on GPIO35, 3.3V, and GND.",
    },
  },
  door_sensor: {
    warning: {
      title: "Door sensor reading unstable",
      desc: "Reed switch signal is bouncing. Verify the door magnet alignment and wiring.",
    },
    critical: {
      title: "Reed switch not detected",
      desc: "The reed switch (MC38) is not responding. Check wiring on GPIO16.",
    },
  },
};

type UserOverviewProps = {
  unreadNotificationCount?: number;
  onOpenNotifications?: () => void;
  onNotificationsChanged?: (opts?: { optimisticUnread?: number }) => void | Promise<void>;
};

export default function UserOverview({
  unreadNotificationCount = 0,
  onOpenNotifications,
  onNotificationsChanged,
}: UserOverviewProps) {
  // ✅ DEFAULT = PARAMETERS
  const [activeTab, setActiveTab] = useState<"status" | "control">("control");

  const {
    machines: userMachines,
    selectedId: selectedMachineId,
    selectMachine,
    loading: machinesLoading,
  } = useSelectedMachine();

  const [machine, setMachine] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  /** Instant button/tab state while API catches up — cleared in postSessionControl finally. */
  const [uiSessionStatusOverride, setUiSessionStatusOverride] = useState<
    "running" | "paused" | "stopped" | null
  >(null);
  const [hardwareStatuses, setHardwareStatuses] = useState<any[]>([]);
  const [liveReadings, setLiveReadings] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const overviewRequestSeqRef = useRef(0);

  const selectedMachineMeta = useMemo(
    () => userMachines.find((m) => m.id === selectedMachineId) ?? null,
    [userMachines, selectedMachineId]
  );
  const activeMachineId = toPositiveId(selectedMachineId) ?? toPositiveId(machine?.id);
  const activeMachineForPresence =
    toPositiveId(machine?.id) === activeMachineId
      ? machine
      : selectedMachineMeta;

  /** Wall clock when Firebase last delivered `hardware_status` for this machine. */
  const [overviewRtdbLastReceiveMs, setOverviewRtdbLastReceiveMs] = useState<number | null>(null);
  /** Parsed `updated_at` from the last snapshot (secondary signal). */
  const [overviewRtdbPayloadAtMs, setOverviewRtdbPayloadAtMs] = useState<number | null>(null);
  /** Ref: polling must not clobber RTDB-driven hardware rows (interval closure stays fresh). */
  const overviewHardwareFromRtdbRef = useRef(false);

  /** RTDB never fires when the ESP stops; tick so `updated_at` age crosses offline without user action. */
  const [presenceTick, setPresenceTick] = useState(0);
  useEffect(() => {
    if (!firebaseDb) return;
    const id = setInterval(() => setPresenceTick((n) => n + 1), PRESENCE_UI_TICK_MS);
    return () => clearInterval(id);
  }, [firebaseDb]);

  const overviewStableOnline = useStableMachineOnline(
    overviewRtdbLastReceiveMs,
    presenceTick,
    activeMachineId
  );

  // PARAMETERS STATE
  const [fishType, setFishType] = useState("");
  const [totalFish, setTotalFish] = useState("");
  const [temperature, setTemperature] = useState("");
  const [duration, setDuration] = useState("");
  const [recommendation, setRecommendation] = useState<any>(null);
  const [needsExtension, setNeedsExtension] = useState(false);
  /** User chose Continue on open-door modal — show Closed while running. */
  const [doorBypassClosed, setDoorBypassClosed] = useState(false);
  const [doorModalVisible, setDoorModalVisible] = useState(false);
  const [doorModalVariant, setDoorModalVariant] = useState<"start" | "resume">("start");
  const [moistureModalOpen, setMoistureModalOpen] = useState(false);
  const [dryingCompleteModalVisible, setDryingCompleteModalVisible] = useState(false);
  const dryingCompleteFromTimerRef = useRef(false);
  const doorModalResolveRef = useRef<((proceed: boolean) => void) | null>(null);
  const [moistureDraftBatches, setMoistureDraftBatches] = useState<MoistureBatchDraft[]>([]);
  const moistureDraftBatchesRef = useRef<MoistureBatchDraft[]>([]);

  useEffect(() => {
    moistureDraftBatchesRef.current = moistureDraftBatches;
  }, [moistureDraftBatches]);

  const updateMoistureDraftBatches = useCallback(
    (next: MoistureBatchDraft[]) => {
      setMoistureDraftBatches(next);
      const sessionId = Number(session?.id);
      if (Number.isFinite(sessionId) && sessionId > 0) {
        void saveMoistureDraft(sessionId, next);
      }
    },
    [session?.id]
  );

  useEffect(() => {
    const sessionId = Number(session?.id);
    if (!Number.isFinite(sessionId) || sessionId <= 0) {
      setMoistureDraftBatches([]);
      return;
    }
    let cancelled = false;
    void loadMoistureDraft(sessionId).then((draft) => {
      if (!cancelled) setMoistureDraftBatches(draft);
    });
    return () => {
      cancelled = true;
    };
  }, [session?.id]);

  useEffect(() => {
    if (machinesLoading) return;
    const nextMachineId = toPositiveId(selectedMachineId);

    overviewRequestSeqRef.current += 1;
    setSession(null);
    setMoistureDraftBatches([]);
    setHardwareStatuses([]);
    setLiveReadings(null);
    setRecommendation(null);
    setNeedsExtension(false);
    setDoorBypassClosed(false);
    setOverviewRtdbLastReceiveMs(null);
    setOverviewRtdbPayloadAtMs(null);
    overviewHardwareFromRtdbRef.current = false;
    countdownEndMsRef.current = null;
    pausedRemainingSecRef.current = null;
    setPausedRemainingSec(null);
    timerSessionIdRef.current = null;
    formBoundSessionIdRef.current = null;
    activeDryingMsRef.current = 0;
    runningSinceMsRef.current = null;
    pausedRemainingAtPauseRef.current = null;
    timerZeroPauseRef.current = false;

    if (nextMachineId == null) {
      setMachine(null);
      setLoading(false);
      return;
    }

    setMachine((prev: any) =>
      toPositiveId(prev?.id) === nextMachineId
        ? prev
        : selectedMachineMeta ?? { id: nextMachineId, name: `Machine #${nextMachineId}` }
    );
    void fetchOverview(nextMachineId);
  }, [selectedMachineId, machinesLoading]);

  /** Bind session fields to the form once per session id (never overwrite on pause/resume/poll). */
  const applyActiveSessionToForm = (s: any | null | undefined) => {
    if (!s) return;
    const st = String(s.status ?? "").trim().toLowerCase();
    if (st !== "running" && st !== "paused") return;
    const sid = Number(s.id);
    if (!Number.isFinite(sid) || sid <= 0) return;
    if (formBoundSessionIdRef.current === sid) return;
    formBoundSessionIdRef.current = sid;
    if (s.fish_type != null && String(s.fish_type).trim() !== "") {
      setFishType(String(s.fish_type));
    }
    if (s.total_fish != null) setTotalFish(String(s.total_fish));
    if (s.target_temperature != null) setTemperature(String(s.target_temperature));
    if (st === "running" && s.set_duration_minutes != null) {
      setDuration(minutesToDigits(Number(s.set_duration_minutes)));
    }
  };

  /**
   * Single effect: reset RTDB flags *before* subscribe so another effect cannot run after
   * onValue and clear overviewHardwareFromRtdbRef (that made polling wipe live rows).
   */
  useEffect(() => {
    if (!firebaseDb) {
      setOverviewRtdbLastReceiveMs(null);
      setOverviewRtdbPayloadAtMs(null);
      overviewHardwareFromRtdbRef.current = false;
      return;
    }

    if (!activeMachineId) {
      setOverviewRtdbLastReceiveMs(null);
      setOverviewRtdbPayloadAtMs(null);
      overviewHardwareFromRtdbRef.current = false;
      return;
    }

    const boundMachineId = activeMachineId;
    const r = dbRef(firebaseDb, `machines/${boundMachineId}/hardware_status`);
    let hadAccepted = false;
    const unsub = onValue(
      r,
      (snap: DataSnapshot) => {
        const val = snap.val();
        if (!val || typeof val !== "object") {
          return;
        }

        const now = Date.now();
        const payloadMs = parsePresenceMs(
          (val as Record<string, unknown>).updated_at
        );
        if (
          !hadAccepted &&
          (payloadMs == null || now - payloadMs > RTDB_INITIAL_STALE_MS)
        ) {
          return;
        }
        hadAccepted = true;

        const payloadMachineId = toPositiveId(
          (val as Record<string, unknown>).microcontroller_id
        );
        if (payloadMachineId != null && payloadMachineId !== boundMachineId) {
          return;
        }

        if (payloadMs != null) {
          setOverviewRtdbPayloadAtMs(payloadMs);
        }
        setOverviewRtdbLastReceiveMs(now);

        const parsed = parseHardwareStatusFromRtdb(val as Record<string, unknown>);
        setHardwareStatuses(parsed.components);
        overviewHardwareFromRtdbRef.current = true;

        if (parsed.readings && typeof parsed.readings === "object") {
          setLiveReadings(parsed.readings);
        }
      },
      (err: unknown) => {
        console.log("Overview hardware_status RTDB:", err);
      }
    );

    return () => {
      unsub();
      overviewHardwareFromRtdbRef.current = false;
    };
  }, [activeMachineId]);

  // RTDB pushes hardware/readings; Laravel overview poll is for session metadata only.

  /** Countdown = wall clock when drying ends. Pause stores seconds left; Resume sets a new end time. */
  const countdownEndMsRef = useRef<number | null>(null);
  const pausedRemainingSecRef = useRef<number | null>(null);
  const [pausedRemainingSec, setPausedRemainingSec] = useState<number | null>(null);
  const timerSessionIdRef = useRef<number | null>(null);
  const formBoundSessionIdRef = useRef<number | null>(null);
  const pausedRemainingAtPauseRef = useRef<number | null>(null);
  /** Actual drying time while status is running (pause does not count). */
  const activeDryingMsRef = useRef(0);
  const runningSinceMsRef = useRef<number | null>(null);
  const timerZeroPauseRef = useRef(false);
  const accumulateActiveDrying = () => {
    if (runningSinceMsRef.current != null) {
      activeDryingMsRef.current += Date.now() - runningSinceMsRef.current;
      runningSinceMsRef.current = null;
    }
  };

  const startActiveDryingClock = () => {
    if (runningSinceMsRef.current == null) {
      runningSinceMsRef.current = Date.now();
    }
  };

  const getUsedDryingMs = (): number => {
    let ms = activeDryingMsRef.current;
    if (runningSinceMsRef.current != null) {
      ms += Date.now() - runningSinceMsRef.current;
    }
    return Math.max(0, ms);
  };

  const getUsedDryingSeconds = (): number =>
    Math.max(0, Math.floor(getUsedDryingMs() / 1000));

  const getUsedDryingMinutes = (): number =>
    Math.floor(getUsedDryingSeconds() / 60);

  /** Seconds left on the countdown when pausing (never return 0 unless timer truly finished). */
  const captureRemainingSecondsForPause = useCallback(
    (activeSession: { set_duration_minutes?: unknown; started_at?: unknown } | null) => {
      if (countdownEndMsRef.current != null) {
        return Math.max(
          0,
          Math.floor((countdownEndMsRef.current - Date.now()) / 1000)
        );
      }
      const fromDigits = durationDigitsToSeconds(String(duration).trim());
      if (fromDigits != null && fromDigits > 0) return fromDigits;
      const totalSec = sessionDurationSeconds(activeSession);
      if (totalSec > 0) {
        const started = parsePresenceMs(activeSession?.started_at);
        if (started != null) {
          return Math.max(0, Math.floor((started + totalSec * 1000 - Date.now()) / 1000));
        }
        const elapsed = getUsedDryingSeconds();
        return Math.max(0, totalSec - elapsed);
      }
      return 0;
    },
    [duration]
  );

  const applyPausedRemaining = useCallback((remSec: number) => {
    const rem = Math.max(0, Math.floor(remSec));
    pausedRemainingSecRef.current = rem;
    pausedRemainingAtPauseRef.current = rem;
    setPausedRemainingSec(rem);
    setDuration(remainingSecToDurationDigits(rem));
  }, []);

  /** Snapshot countdown, freeze display, stop elapsed clock — must run before optimistic pause UI. */
  const freezeCountdownAtPause = useCallback(
    (activeSession: { set_duration_minutes?: unknown; started_at?: unknown } | null) => {
      const rem = captureRemainingSecondsForPause(activeSession);
      pauseRemainingSnapshotRef.current = rem;
      countdownEndMsRef.current = null;
      applyPausedRemaining(rem);
      accumulateActiveDrying();
      return rem;
    },
    [captureRemainingSecondsForPause, applyPausedRemaining]
  );

  const notifyProblemOnInterval = (
    key: string,
    type: "warning" | "critical",
    title: string,
    desc: string,
    componentKey = "session"
  ) => {
    const mcId = toPositiveId(activeMachineId);
    if (mcId == null) return;
    const throttleKey = `${key}:${mcId}`;
    const now = Date.now();
    if (!tryAcquireProblemNotifySlot(key, mcId)) return;
    void appendHardwareNotification({
      id: `${throttleKey}:${now}`,
      type,
      title,
      desc,
      machineId: mcId,
      componentKey,
      createdAt: new Date().toISOString(),
    }).then(() => onNotificationsChanged?.());
  };

  const [refreshing, setRefreshing] = useState(false);

  const sessionControlBusyRef = useRef(false);
  const sessionSyncLockRef = useRef(false);
  const pauseRemainingSnapshotRef = useRef<number | null>(null);
  const machineIdRef = useRef<number | null>(null);

  useEffect(() => {
    machineIdRef.current = activeMachineId;
  }, [activeMachineId]);

  const overviewApiUrl = useCallback((machineId?: number | null) => {
    const id =
      toPositiveId(machineId) ??
      machineIdRef.current ??
      activeMachineId;
    if (id != null && Number.isFinite(id) && id > 0) {
      return `${API_BASE_URL}/mobile/overview?machine_id=${id}`;
    }
    return `${API_BASE_URL}/mobile/overview`;
  }, [activeMachineId]);

  type FirmwareSessionStatus = "running" | "paused" | "stopped";

  /** Single writer for `machines/{id}/session` — keeps ESP LEDs, fan, and buzzer in sync. */
  const writeMachineSessionToRtdb = useCallback(
    async (
      microcontrollerId: number,
      status: FirmwareSessionStatus,
      opts?: {
        fan_speed?: number;
        target_temperature?: number;
        moisture_check_armed?: boolean;
        fish_type?: string;
        total_fish?: number;
        set_duration_minutes?: number;
      }
    ) => {
      if (!firebaseDb || microcontrollerId <= 0) return;
      const running = status === "running";
      const paused = status === "paused";
      const moistureCheckArmed = opts?.moisture_check_armed ?? paused;
      const fs = SESSION_FAN_SPEED;
      const ttRaw =
        opts?.target_temperature ??
        Number.parseFloat(String(temperature || "0").trim());
      const tt =
        Number.isFinite(ttRaw) && ttRaw > 1 ? ttRaw : 60;
      const seq = Date.now();
      const fish =
        (opts?.fish_type ?? fishType ?? "").trim() || undefined;
      const totalFishRaw =
        opts?.total_fish ??
        Number.parseInt(String(totalFish ?? "").trim(), 10);
      const totalFishVal = Number.isFinite(totalFishRaw)
        ? totalFishRaw
        : undefined;
      const durRaw =
        opts?.set_duration_minutes ??
        digitsToMinutes(String(duration ?? "").trim());
      const durVal =
        durRaw != null && Number.isFinite(durRaw) && durRaw > 0
          ? durRaw
          : undefined;
      try {
        const payload: Record<string, unknown> = {
          status,
          fault_buzzer_armed: running,
          moisture_check_armed: moistureCheckArmed,
          fan_speed: fs,
          target_temperature: running || paused ? tt : 0,
          updated_at: new Date().toISOString(),
        };
        if (fish) payload.fish_type = fish;
        if (totalFishVal != null) payload.total_fish = totalFishVal;
        if (durVal != null) payload.set_duration_minutes = durVal;

        const commandPayload: Record<string, unknown> = {
          action: status === "running" ? "start" : status === "paused" ? "pause" : "stop",
          fan_speed: fs,
          target_temperature: running || paused ? tt : 0,
          seq,
          updated_at: new Date().toISOString(),
        };
        if (fish) commandPayload.fish_type = fish;
        if (totalFishVal != null) commandPayload.total_fish = totalFishVal;
        if (durVal != null) commandPayload.set_duration_minutes = durVal;

        if (status === "stopped") {
          payload.command = "stop";
          payload.session_active = false;
        } else if (running) {
          payload.command = "start";
          payload.session_active = true;
        } else if (paused) {
          payload.command = "pause";
          payload.session_active = false;
        }
        // Command first so ESP sees start/stop before session status changes.
        await dbSet(
          dbRef(firebaseDb, `machines/${microcontrollerId}/command`),
          commandPayload
        );
        await dbSet(dbRef(firebaseDb, `machines/${microcontrollerId}/session`), payload);
      } catch (e) {
        console.log("session RTDB write:", e);
      }
    },
    [temperature, fishType, totalFish, duration]
  );

  /** Live target-temp tweaks while running. */
  const pushSessionParamsToRtdb = useCallback(
    async (microcontrollerId: number, targetTemperature?: number) => {
      if (!firebaseDb || microcontrollerId <= 0) return;
      const ttRaw =
        targetTemperature ??
        Number.parseFloat(String(temperature || "0").trim());
      const tt = Number.isFinite(ttRaw) && ttRaw > 1 ? ttRaw : 60;
      const seq = Date.now();
      try {
        await dbUpdate(dbRef(firebaseDb, `machines/${microcontrollerId}/session`), {
          fan_speed: SESSION_FAN_SPEED,
          target_temperature: tt,
          updated_at: new Date().toISOString(),
        });
        await dbUpdate(dbRef(firebaseDb, `machines/${microcontrollerId}/command`), {
          action: "start",
          fan_speed: SESSION_FAN_SPEED,
          target_temperature: tt,
          seq,
          updated_at: new Date().toISOString(),
        });
      } catch (e) {
        console.log("session params RTDB patch:", e);
      }
    },
    [temperature]
  );

  /** Fire-and-forget RTDB sync — uses ref so it works before React state settles. */
  const fireHardwareSessionSync = (
    status: FirmwareSessionStatus,
    opts?: {
      target_temperature?: number;
      moisture_check_armed?: boolean;
    }
  ) => {
    const mcId = toPositiveId(machineIdRef.current ?? activeMachineId);
    if (mcId == null) return;
    void writeMachineSessionToRtdb(mcId, status, opts);
  };

  const pauseTargetTemperature = (override?: string) => {
    const tt = Number.parseFloat(String(override ?? temperature ?? "0").trim());
    return Number.isFinite(tt) ? tt : undefined;
  };

  /** While running only — push target temperature to the board. */
  useEffect(() => {
    if (!firebaseDb) return;
    const mcId = toPositiveId(activeMachineId);
    if (mcId == null) return;
    if (sessionSyncLockRef.current || sessionControlBusyRef.current) return;
    if (String(session?.status ?? "").trim().toLowerCase() !== "running") return;
    if (
      countdownEndMsRef.current === null &&
      (pausedRemainingSecRef.current != null || pauseRemainingSnapshotRef.current != null)
    ) {
      return;
    }
    const tt = Number.parseFloat(String(temperature || "0").trim());
    void pushSessionParamsToRtdb(mcId, Number.isFinite(tt) ? tt : undefined);
  }, [firebaseDb, activeMachineId, session?.status, temperature, pushSessionParamsToRtdb]);

  const applyOverviewPayload = useCallback(
    (data: any) => {
      setMachine(data.machine);
      if (data.session) {
        if (!sessionSyncLockRef.current) {
          setSession(data.session);
          applyActiveSessionToForm(data.session);
        }
      } else if (!sessionSyncLockRef.current) {
        setSession(null);
        const mcId = Number(data.machine?.id);
        if (firebaseDb && Number.isFinite(mcId) && mcId > 0) {
          void writeMachineSessionToRtdb(mcId, "stopped");
        }
      }
      if (!firebaseDb) {
        const map = componentsMapFromRtdbPayload({
          components: Object.fromEntries(
            (data.hardware_statuses ?? [])
              .map((row: { component_name?: string; status?: string }) => {
                const name = String(row?.component_name ?? "").trim();
                if (!name) return null;
                return [name, row?.status ?? "not_working"] as const;
              })
              .filter(
                (entry: readonly [string, string] | null): entry is readonly [string, string] =>
                  entry != null
              )
          ),
        });
        setHardwareStatuses(hardwareRowsFromComponentsMap(map));
      }
    },
    [firebaseDb]
  );

  const fetchOverviewPresenceOnly = useCallback(async () => {
    const requestSeq = ++overviewRequestSeqRef.current;
    const requestedMachineId = machineIdRef.current ?? activeMachineId;
    try {
      const res = await fetch(overviewApiUrl(requestedMachineId), {
        headers: { Accept: "application/json" },
      });
      const data = await res.json();
      if (requestSeq !== overviewRequestSeqRef.current) return;
      const responseMachineId = toPositiveId(data?.machine?.id);
      if (
        requestedMachineId != null &&
        responseMachineId != null &&
        responseMachineId !== requestedMachineId
      ) {
        return;
      }
      applyOverviewPayload(data);
    } catch {
      // next tick retries
    }
  }, [activeMachineId, applyOverviewPayload, overviewApiUrl]);

  useEffect(() => {
    if (loading) return;
    const id = setInterval(() => {
      void fetchOverviewPresenceOnly();
    }, OVERVIEW_API_POLL_MS);
    return () => clearInterval(id);
  }, [loading, fetchOverviewPresenceOnly]);

  const appendSessionMetaToBody = (body: Record<string, unknown>) => {
    const ft = fishType.trim();
    const tf = Number.parseInt(String(totalFish).trim(), 10);
    const tt = Number.parseFloat(String(temperature).trim());
    if (ft) body.fish_type = ft;
    if (Number.isFinite(tf) && tf >= 0) body.total_fish = tf;
    if (Number.isFinite(tt)) body.target_temperature = tt;
    body.fan_speed = SESSION_FAN_SPEED;
  };

  const resolveResumeCountdownSeconds = (durationOverride?: string): number | null => {
    const fromInput = durationDigitsToSeconds(String(durationOverride ?? duration).trim());
    const rem = pausedRemainingSecRef.current ?? pausedRemainingSec;
    if (fromInput != null) return fromInput;
    if (rem != null && rem > 0) return rem;
    return null;
  };

  type SessionControlOverrides = {
    temperature?: string;
    durationDigits?: string;
  };

  const fetchRecommendation = useCallback(
    async (sessionOverride?: any) => {
      try {
        const activeSession = sessionOverride ?? session;
        const st = String(activeSession?.status ?? "").trim().toLowerCase();
        const sessionRunning = st === "running" || st === "paused";
        const elapsed = sessionRunning
          ? getUsedDryingMinutes()
          : Number(activeSession?.drying_time_minutes ?? 0);

        const fishForRec =
          fishType.trim() || String(activeSession?.fish_type ?? "").trim();

        if (!fishForRec) {
          setRecommendation({ description: "No recommendation available." });
          setNeedsExtension(false);
          return;
        }

        const params = new URLSearchParams();
        const mcId = toPositiveId(activeMachineId);
        if (mcId != null) {
          params.append("microcontroller_id", String(mcId));
        }
        params.append("fish_type", fishForRec);

        const lr = liveReadings && typeof liveReadings === "object" ? liveReadings : null;
        const tempVal =
          lr?.temperature ?? lr?.temp ?? temperature ?? activeSession?.target_temperature;
        const humVal = lr?.humidity ?? lr?.hum;
        const draftMoist = lastMoistureFromDraft(moistureDraftBatches);
        const liveMoist = lr?.moisture_percent ?? lr?.moisture;
        const moistVal = draftMoist ?? liveMoist;

        if (tempVal != null && String(tempVal).trim() !== "") {
          params.append("temperature", String(tempVal));
        }
        if (humVal != null && String(humVal).trim() !== "") {
          params.append("humidity", String(humVal));
        }
        if (moistVal != null && String(moistVal).trim() !== "") {
          params.append("moisture", String(moistVal));
        }
        params.append("elapsed_minutes", String(elapsed));

        const url = `${API_BASE_URL}/mobile/recommendation?${params.toString()}`;
        const recRes = await fetch(url, { headers: { Accept: "application/json" } });
        const recData = await recRes.json();
        if (recData?.success) {
          setRecommendation(recData.recommendation);
          setNeedsExtension(Boolean(recData.needs_extension));
        } else {
          setRecommendation({
            description: recData?.message ?? "No recommendation available.",
          });
          setNeedsExtension(false);
        }
      } catch (err) {
        console.log(err);
        setRecommendation({ description: "Could not load recommendation." });
        setNeedsExtension(false);
      }
    },
    [session, activeMachineId, fishType, temperature, liveReadings, moistureDraftBatches]
  );

  const fetchOverview = useCallback(async (machineIdOverride?: number | null) => {
    const requestSeq = ++overviewRequestSeqRef.current;
    const requestedMachineId =
      toPositiveId(machineIdOverride) ?? machineIdRef.current ?? activeMachineId;
    try {
      if (!loading) setRefreshing(true);
      const res = await fetch(overviewApiUrl(requestedMachineId), {
        headers: { Accept: "application/json" },
      });

      const data = await res.json();

      if (requestSeq !== overviewRequestSeqRef.current) return;
      const responseMachineId = toPositiveId(data?.machine?.id);
      if (
        requestedMachineId != null &&
        responseMachineId != null &&
        responseMachineId !== requestedMachineId
      ) {
        return;
      }

      applyOverviewPayload(data);
      void fetchRecommendation(data.session);
    } catch (err) {
      console.log(err);
    } finally {
      if (requestSeq === overviewRequestSeqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [activeMachineId, loading, applyOverviewPayload, overviewApiUrl, fetchRecommendation]);

  useEffect(() => {
    if (!firebaseDb || !activeMachineId) return;

    const boundMachineId = activeMachineId;
    const r = dbRef(firebaseDb, `machines/${boundMachineId}/session`);
    let lastSeenStatus = "";

    const unsub = onValue(
      r,
      (snap: DataSnapshot) => {
        const val = snap.val();
        if (!val || typeof val !== "object") return;

        const payload = val as Record<string, unknown>;
        const status = String(payload.status ?? "").trim().toLowerCase();
        if (status !== "running" && status !== "paused" && status !== "stopped") {
          return;
        }

        setUiSessionStatusOverride(status as "running" | "paused" | "stopped");

        setSession((prev: any) => {
          if (!prev && status === "stopped") return prev;
          return {
            ...(prev ?? {}),
            status,
            fish_type:
              String(payload.fish_type ?? "").trim() || prev?.fish_type,
            total_fish:
              Number.isFinite(Number(payload.total_fish)) && Number(payload.total_fish) >= 0
                ? Number(payload.total_fish)
                : prev?.total_fish,
            target_temperature:
              Number.isFinite(Number(payload.target_temperature)) &&
              Number(payload.target_temperature) > 0
                ? Number(payload.target_temperature)
                : prev?.target_temperature,
            set_duration_minutes:
              Number.isFinite(Number(payload.set_duration_minutes)) &&
              Number(payload.set_duration_minutes) > 0
                ? Number(payload.set_duration_minutes)
                : prev?.set_duration_minutes,
          };
        });

        if (status === "paused") {
          freezeCountdownAtPause(session);
        } else if (status === "running") {
          const rem =
            pausedRemainingSecRef.current ??
            pausedRemainingAtPauseRef.current ??
            pausedRemainingSec;
          if (rem != null && rem > 0 && countdownEndMsRef.current === null) {
            countdownEndMsRef.current = Date.now() + rem * 1000;
          }
        } else {
          countdownEndMsRef.current = null;
          pausedRemainingSecRef.current = null;
          pausedRemainingAtPauseRef.current = null;
          setPausedRemainingSec(null);
        }

        if (status !== lastSeenStatus) {
          lastSeenStatus = status;
          void fetchOverview(boundMachineId);
        }
      },
      (err: unknown) => {
        console.log("Overview session RTDB:", err);
      }
    );

    return () => unsub();
  }, [activeMachineId, fetchOverview, firebaseDb, pausedRemainingSec, session]);

  const postSessionControl = async (
    action: "start" | "pause" | "stop",
    overrides?: SessionControlOverrides
  ) => {
    if (sessionSyncLockRef.current) return;
    sessionSyncLockRef.current = true;
    sessionControlBusyRef.current = true;
    const sessionStatusBeforeControl = String(session?.status ?? "")
      .trim()
      .toLowerCase();
    const microcontrollerIdEarly = toPositiveId(machineIdRef.current ?? activeMachineId);

    // Hardware first — same idea as Start (Firebase before slow API work).
    if (microcontrollerIdEarly != null) {
      if (action === "stop") {
        void writeMachineSessionToRtdb(microcontrollerIdEarly, "stopped");
      } else if (action === "pause" && sessionStatusBeforeControl !== "paused") {
        void writeMachineSessionToRtdb(microcontrollerIdEarly, "paused", {
          target_temperature: pauseTargetTemperature(overrides?.temperature),
        });
      }
    }

    try {
      const raw = await AsyncStorage.getItem("user");
      if (!raw) {
        Alert.alert("Not logged in", "Please login again.");
        return;
      }

      const user = JSON.parse(raw);
      const userId = Number(user?.id);
      const microcontrollerId = toPositiveId(activeMachineId);

      if (!Number.isFinite(userId) || userId <= 0) {
        Alert.alert("Missing user", "Could not read user id from storage.");
        return;
      }

      if (microcontrollerId == null) {
        Alert.alert("No machine", "Overview has no selected microcontroller yet.");
        return;
      }

      const body: Record<string, unknown> = {
        user_id: userId,
        microcontroller_id: microcontrollerId,
        action,
      };

      const tempVal = overrides?.temperature ?? temperature;
      const durVal = overrides?.durationDigits ?? duration;

      if (action === "start") {
        const ft = fishType.trim();
        const tf = Number.parseInt(String(totalFish).trim(), 10);
        const tt = Number.parseFloat(String(tempVal).trim());
        const dm = digitsToMinutes(String(durVal).trim());

        if (!ft) {
          Alert.alert("Missing field", "Fish type is required to start.");
          return;
        }
        if (!Number.isFinite(tf) || tf < 0) {
          Alert.alert("Missing field", "Number of fish is required to start.");
          return;
        }
        if (!Number.isFinite(tt)) {
          Alert.alert("Missing field", "Target temperature is required to start.");
          return;
        }
        if (dm == null) {
          Alert.alert(
            "Invalid duration",
            "Enter the drying time as digits in HH:MM:SS order (e.g. type 13000 for 01:30:00)."
          );
          return;
        }

        body.fish_type = ft;
        body.total_fish = tf;
        body.target_temperature = tt;
        body.fan_speed = SESSION_FAN_SPEED;
        body.set_duration_minutes = dm;
        body.drying_time_minutes = 0;
        activeDryingMsRef.current = 0;
        runningSinceMsRef.current = null;
        setUiSessionStatusOverride("running");
      }

      if (action === "pause" && session) {
        const cur = sessionStatusBeforeControl;
        const pauseTt = Number.parseFloat(String(tempVal).trim());
        const pauseTtVal = Number.isFinite(pauseTt) ? pauseTt : 0;
        if (cur === "paused") {
          const newRemSec = resolveResumeCountdownSeconds(overrides?.durationDigits);
          if (newRemSec == null || newRemSec <= 0) {
            Alert.alert(
              "Invalid duration",
              "Enter the remaining drying time (e.g. 030000 for 3 hours left)."
            );
            return;
          }
          countdownEndMsRef.current = Date.now() + newRemSec * 1000;
          pausedRemainingSecRef.current = null;
          setPausedRemainingSec(null);
          pausedRemainingAtPauseRef.current = null;
          pauseRemainingSnapshotRef.current = null;
          startActiveDryingClock();
          body.drying_time_seconds = getUsedDryingSeconds();
          body.drying_time_minutes = getUsedDryingMinutes();
          const resumeDm = digitsToMinutes(String(durVal).trim());
          if (resumeDm != null) body.set_duration_minutes = resumeDm;
          appendSessionMetaToBody(body);
          const resumeTt = Number.parseFloat(String(tempVal).trim());
          if (Number.isFinite(resumeTt)) body.target_temperature = resumeTt;
          body.fan_speed = SESSION_FAN_SPEED;
          await writeMachineSessionToRtdb(microcontrollerId, "running", {
            fan_speed: SESSION_FAN_SPEED,
            target_temperature: pauseTtVal,
          });
        } else if (cur === "running") {
          if (pauseRemainingSnapshotRef.current == null) {
            freezeCountdownAtPause(session);
          }
          body.drying_time_seconds = getUsedDryingSeconds();
          body.drying_time_minutes = getUsedDryingMinutes();
          appendSessionMetaToBody(body);
        }
      }

      if (action === "stop") {
        const stopSt = String(session?.status ?? "").trim().toLowerCase();
        if (stopSt === "running") {
          accumulateActiveDrying();
        }
        appendSessionMetaToBody(body);
        body.drying_time_seconds = getUsedDryingSeconds();

        const draftChecks = flattenMoistureDraftForStop(moistureDraftBatchesRef.current);
        if (draftChecks.length > 0) {
          body.moisture_checks = draftChecks;
          const lastCheck = draftChecks[draftChecks.length - 1];
          body.moisture = lastCheck.moisture;
        } else {
          const lr = liveReadings;
          if (lr && typeof lr === "object") {
            if (lr.temperature != null && Number.isFinite(Number(lr.temperature))) {
              body.temperature = Number(lr.temperature);
            }
            if (lr.humidity != null && Number.isFinite(Number(lr.humidity))) {
              body.humidity = Number(lr.humidity);
            }
            const moist = resolveMoisturePercent(lr as Record<string, unknown>);
            if (moist != null) {
              body.moisture = moist;
            }
          }
        }
      }

      if (action === "start") {
        const dm = digitsToMinutes(String(durVal).trim());
        if (dm != null) {
          countdownEndMsRef.current = Date.now() + Math.floor(dm * 60) * 1000;
        }
        pausedRemainingSecRef.current = null;
        setPausedRemainingSec(null);
        pausedRemainingAtPauseRef.current = null;
        activeDryingMsRef.current = 0;
        runningSinceMsRef.current = null;
        startActiveDryingClock();
      }

      if (action === "start") {
        const startTt = Number.parseFloat(String(tempVal).trim());
        await writeMachineSessionToRtdb(microcontrollerId, "running", {
          fan_speed: SESSION_FAN_SPEED,
          target_temperature: Number.isFinite(startTt) ? startTt : 0,
        });
      }

      const res = await fetch(`${API_BASE_URL}/mobile/drying-session/control`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        if (action === "pause" && sessionStatusBeforeControl === "running") {
          const snap =
            pauseRemainingSnapshotRef.current ??
            pausedRemainingSecRef.current ??
            pausedRemainingAtPauseRef.current;
          if (snap != null && snap > 0) {
            countdownEndMsRef.current = Date.now() + snap * 1000;
            pausedRemainingSecRef.current = null;
            setPausedRemainingSec(null);
            pausedRemainingAtPauseRef.current = null;
          }
        }
        pauseRemainingSnapshotRef.current = null;
        setUiSessionStatusOverride(null);
        sessionSyncLockRef.current = false;
        sessionControlBusyRef.current = false;
        await fetchOverview();
        Alert.alert("Control failed", String(data?.message ?? "Request failed."));
        return;
      }

      if (action === "stop") {
        const stoppedSessionId = Number(session?.id);
        setSession(null);
        setMoistureDraftBatches([]);
        if (Number.isFinite(stoppedSessionId) && stoppedSessionId > 0) {
          void clearMoistureDraft(stoppedSessionId);
        }
        countdownEndMsRef.current = null;
        pausedRemainingSecRef.current = null;
        setPausedRemainingSec(null);
        timerSessionIdRef.current = null;
        formBoundSessionIdRef.current = null;
        activeDryingMsRef.current = 0;
        runningSinceMsRef.current = null;
        pausedRemainingAtPauseRef.current = null;
        clearProblemNotifyThrottleForMachine(microcontrollerId);
        await writeMachineSessionToRtdb(microcontrollerId, "stopped");
      } else if (data?.session) {
        const st = String(data.session.status ?? "").trim().toLowerCase();
        if (
          action === "pause" &&
          st === "running" &&
          sessionStatusBeforeControl === "paused"
        ) {
          pausedRemainingSecRef.current = null;
          setPausedRemainingSec(null);
          pausedRemainingAtPauseRef.current = null;
          pauseRemainingSnapshotRef.current = null;
          startActiveDryingClock();
        } else if (
          action === "pause" &&
          st === "paused" &&
          sessionStatusBeforeControl === "running"
        ) {
          countdownEndMsRef.current = null;
          const snap = pauseRemainingSnapshotRef.current;
          if (snap != null && snap >= 0) {
            applyPausedRemaining(snap);
          }
          pauseRemainingSnapshotRef.current = null;
        }
        if (action === "pause" && st === "paused") {
          pauseRemainingSnapshotRef.current = null;
        }
        if (action === "start") {
          formBoundSessionIdRef.current = Number(data.session.id) || null;
          setMoistureDraftBatches([]);
          const newSessionId = Number(data.session.id);
          if (Number.isFinite(newSessionId) && newSessionId > 0) {
            void clearMoistureDraft(newSessionId);
          }
          const dur = sessionDurationSeconds(data.session);
          if (dur > 0) countdownEndMsRef.current = Date.now() + dur * 1000;
          pausedRemainingSecRef.current = null;
          setPausedRemainingSec(null);
          activeDryingMsRef.current = 0;
          startActiveDryingClock();
        }
        setSession(data.session);
        const fwStatus: FirmwareSessionStatus =
          st === "running" ? "running" : st === "paused" ? "paused" : "stopped";
        const tt = Number.parseFloat(String(data.session.target_temperature ?? temperature ?? "0"));
        await writeMachineSessionToRtdb(microcontrollerId, fwStatus, {
          fan_speed: SESSION_FAN_SPEED,
          target_temperature: tt,
        });
      }

      await fetchOverview();

      // Info notification for the bell — system event log.
      const sessionInfoMeta = (() => {
        if (action === "start") {
          const ft = fishType.trim() || "fish";
          const durDisplay = formatDigitsAsHMS(duration);
          return {
            title: "Drying session started",
            desc: `Started drying ${ft} for ${durDisplay} at ${temperature || "?"}°C.`,
          };
        }
        if (action === "pause") {
          return {
            title: "Drying session paused",
            desc: "The current drying session has been paused.",
          };
        }
        return {
          title: "Drying session stopped",
          desc: "The drying session was stopped and saved to History.",
        };
      })();
      void appendHardwareNotification({
        id: `session:${microcontrollerId}:${action}:${Date.now()}`,
        type: "info",
        title: sessionInfoMeta.title,
        desc: sessionInfoMeta.desc,
        machineId: microcontrollerId,
        componentKey: "session",
        createdAt: new Date().toISOString(),
      }).then(() => onNotificationsChanged?.());

    } catch (e) {
      console.log(e);
      pauseRemainingSnapshotRef.current = null;
      sessionSyncLockRef.current = false;
      sessionControlBusyRef.current = false;
      await fetchOverview();
      Alert.alert("Control failed", "Network error while contacting the API.");
    } finally {
      setUiSessionStatusOverride(null);
      sessionSyncLockRef.current = false;
      sessionControlBusyRef.current = false;
    }
  };

  const closeDoorModal = (proceed: boolean) => {
    setDoorModalVisible(false);
    const resolve = doorModalResolveRef.current;
    doorModalResolveRef.current = null;
    resolve?.(proceed);
  };

  const confirmOpenDoorForDrying = (variant: "start" | "resume"): Promise<boolean> =>
    new Promise((resolve) => {
      doorModalResolveRef.current = resolve;
      setDoorModalVariant(variant);
      setDoorModalVisible(true);
    });

  const startMachine = async () => {
    if (readRealDoorIsOpen(liveReadings?.door, { streamLive: machineOnline })) {
      const proceed = await confirmOpenDoorForDrying("start");
      if (!proceed) return;
      setDoorBypassClosed(true);
    } else {
      setDoorBypassClosed(false);
    }
    void postSessionControl("start");
  };

  const pauseMachine = async () => {
    const cur = String(session?.status ?? "").trim().toLowerCase();
    if (cur === "running") {
      fireHardwareSessionSync("paused", { target_temperature: pauseTargetTemperature() });
      freezeCountdownAtPause(session);
      setUiSessionStatusOverride("paused");
      setDoorBypassClosed(false);
    } else if (cur === "paused") {
      if (readRealDoorIsOpen(liveReadings?.door, { streamLive: machineOnline })) {
        const proceed = await confirmOpenDoorForDrying("resume");
        if (!proceed) return;
        setDoorBypassClosed(true);
      } else {
        setDoorBypassClosed(false);
      }
      const rem =
        pausedRemainingSecRef.current ??
        pausedRemainingAtPauseRef.current ??
        pausedRemainingSec;
      if (rem != null && rem > 0) {
        countdownEndMsRef.current = Date.now() + rem * 1000;
      }
      setUiSessionStatusOverride("running");
    }
    void postSessionControl("pause");
  };

  const stopMachine = () => {
    fireHardwareSessionSync("stopped");
    setUiSessionStatusOverride("stopped");
    setDoorBypassClosed(false);
    void postSessionControl("stop");
  };
  const executeApplyRecommendation = async () => {
    if (!recommendation) return;

    const st = String(session?.status ?? "").trim().toLowerCase();
    const atZero = remainingSeconds === 0;
    const continueDrying =
      (st === "running" || st === "paused") && (needsExtension || atZero);

    const tt = String(recommendation.temperature ?? "");
    const extMin = needsExtension
      ? Number(recommendation.extension_minutes ?? 0)
      : Number(recommendation.duration_minutes ?? 0);

    setTemperature(tt);

    if (continueDrying) {
      if (!Number.isFinite(extMin) || extMin < 1) {
        Alert.alert("Invalid recommendation", "Extension time is not valid.");
        return;
      }
      const durDigits = minutesToDigits(extMin);
      setDuration(durDigits);
      if (st === "running") {
        await postSessionControl("pause");
      }
      await postSessionControl("pause", {
        temperature: tt,
        durationDigits: durDigits,
      });
      setNeedsExtension(false);
      timerZeroPauseRef.current = true;
      return;
    }

    if (Number.isFinite(extMin) && extMin >= 1) {
      setDuration(minutesToDigits(extMin));
    }
  };

  const applyRecommendation = () => {
    if (!recommendation) return;

    const st = String(session?.status ?? "").trim().toLowerCase();
    const atZero = remainingSeconds === 0;
    const continueDrying =
      (st === "running" || st === "paused") && (needsExtension || atZero);
    if (recommendation.temperature == null) {
      Alert.alert("No recommendation", "No recommendation available.");
      return;
    }

    const paramsText = formatRecommendationParams(recommendation, continueDrying);
    const detail = continueDrying
      ? `Apply these settings and resume drying?\n\n${paramsText}`
      : `Apply these settings to the control panel?\n\n${paramsText}`;

    if (continueDrying) {
      Alert.alert("Continue drying?", detail, [
        { text: "No", style: "cancel" },
        { text: "Yes, continue", onPress: () => void executeApplyRecommendation() },
      ]);
      return;
    }

    Alert.alert("Apply recommendation?", detail, [
      { text: "Cancel", style: "cancel" },
      { text: "Apply", onPress: () => void executeApplyRecommendation() },
    ]);
  };

  const machineOnline = isMachineOnlineForUi({
    firebaseConfigured: Boolean(firebaseDb),
    rtdbLastReceiveMs: overviewRtdbLastReceiveMs,
    machine: activeMachineForPresence,
    stableOnline: overviewStableOnline,
  });

  const overviewHardwareStreamFresh = machineOnline;

  const apiSessionStatus = String(session?.status ?? "").trim().toLowerCase();
  const uiSessionStatus = uiSessionStatusOverride ?? apiSessionStatus;
  const moistureSensorStatus = lookupComponentStatus(hardwareStatuses, "moisture_sensor");
  const hasActiveSession = uiSessionStatus === "running" || uiSessionStatus === "paused";
  const hasApiActiveSession = apiSessionStatus === "running" || apiSessionStatus === "paused";
  const isSessionRunning = uiSessionStatus === "running";
  const parametersLocked = isSessionRunning;

  useEffect(() => {
    if (!firebaseDb || !hasActiveSession) {
      setLiveReadings(null);
    }
  }, [firebaseDb, hasActiveSession]);

  /**
   * One line for both tabs: Online when connected and no active drying session;
   * Idle when paused; Running when running; Offline when not live.
   */
  const displayMachineStatus = (() => {
    if (!activeMachineId) return "—";
    if (!machineOnline) return "Offline";
    if (uiSessionStatus === "paused") return "Idle";
    if (uiSessionStatus === "running") return "Running";
    return "Online";
  })();

  const [tickNow, setTickNow] = useState<number>(Date.now());

  useEffect(() => {
    if (!hasApiActiveSession && !session?.id) return;
    const id = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hasApiActiveSession, session?.id, uiSessionStatusOverride]);

  useEffect(() => {
    if (!session?.id) {
      if (!hasApiActiveSession && uiSessionStatusOverride !== "running") {
        countdownEndMsRef.current = null;
        pausedRemainingSecRef.current = null;
        setPausedRemainingSec(null);
        timerSessionIdRef.current = null;
      }
      return;
    }
    if (timerSessionIdRef.current !== session.id) {
      timerSessionIdRef.current = session.id;
      countdownEndMsRef.current = null;
      pausedRemainingSecRef.current = null;
      setPausedRemainingSec(null);
      const savedSec = Number(session.drying_time_minutes ?? 0);
      activeDryingMsRef.current =
        Number.isFinite(savedSec) && savedSec > 0 ? savedSec * 1000 : 0;
      runningSinceMsRef.current = null;
    }
    const countdownFrozen =
      countdownEndMsRef.current === null &&
      (pausedRemainingSecRef.current != null ||
        pausedRemainingAtPauseRef.current != null ||
        pauseRemainingSnapshotRef.current != null);
    if (apiSessionStatus === "running") {
      startActiveDryingClock();
    } else if (apiSessionStatus === "paused") {
      accumulateActiveDrying();
    } else {
      runningSinceMsRef.current = null;
    }
    if (apiSessionStatus === "running" && countdownEndMsRef.current === null && !countdownFrozen) {
      const pausedRem =
        pausedRemainingSecRef.current ?? pausedRemainingAtPauseRef.current;
      if (pausedRem != null && pausedRem > 0) {
        countdownEndMsRef.current = Date.now() + pausedRem * 1000;
      } else {
        const dur = sessionDurationSeconds(session);
        if (dur > 0) {
          const started = parsePresenceMs(session.started_at);
          countdownEndMsRef.current = started
            ? started + dur * 1000
            : Date.now() + dur * 1000;
        }
      }
    }
  }, [
    hasApiActiveSession,
    session?.id,
    apiSessionStatus,
    session?.started_at,
    session?.set_duration_minutes,
    uiSessionStatusOverride,
  ]);

  const remainingSeconds: number | null = (() => {
    if (!hasActiveSession && !hasApiActiveSession) return null;
    const frozenRem =
      pausedRemainingSec ??
      pausedRemainingSecRef.current ??
      pausedRemainingAtPauseRef.current;
    const countdownFrozen =
      frozenRem != null && countdownEndMsRef.current === null;
    if (countdownFrozen || apiSessionStatus === "paused") {
      if (frozenRem != null) return frozenRem;
      const fromDigits = durationDigitsToSeconds(String(duration).trim());
      if (fromDigits != null) return fromDigits;
      return null;
    }
    if (sessionDurationSeconds(session) <= 0 && countdownEndMsRef.current === null) return null;
    if (countdownEndMsRef.current != null) {
      return Math.max(0, Math.floor((countdownEndMsRef.current - tickNow) / 1000));
    }
    return sessionDurationSeconds(session) > 0 ? sessionDurationSeconds(session) : null;
  })();

  const timerLabel = remainingSeconds !== null ? formatSecondsAsHMS(remainingSeconds) : "--";
  const waitingForExtension =
    hasActiveSession && (needsExtension || remainingSeconds === 0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void fetchRecommendation();
    }, 350);
    return () => clearTimeout(timeout);
  }, [fishType, temperature, duration, fetchRecommendation]);

  useEffect(() => {
    if (!hasActiveSession) return;
    void fetchRecommendation();
  }, [remainingSeconds, hasActiveSession, session?.status, fetchRecommendation]);

  useEffect(() => {
    if (apiSessionStatus !== "paused") return;
    const rem = pausedRemainingSecRef.current ?? pausedRemainingSec;
    if (rem != null && rem > 0) {
      setDuration(remainingSecToDurationDigits(rem));
    }
  }, [apiSessionStatus, pausedRemainingSec]);

  useEffect(() => {
    if (apiSessionStatus !== "running") {
      if (apiSessionStatus !== "paused") {
        timerZeroPauseRef.current = false;
        setDryingCompleteModalVisible(false);
      }
      return;
    }
    if (
      remainingSeconds === 0 &&
      !sessionControlBusyRef.current &&
      !timerZeroPauseRef.current
    ) {
      timerZeroPauseRef.current = true;
      dryingCompleteFromTimerRef.current = true;
      void postSessionControl("pause");
    }
  }, [remainingSeconds, apiSessionStatus]);

  useEffect(() => {
    if (apiSessionStatus !== "paused" || !dryingCompleteFromTimerRef.current) return;
    dryingCompleteFromTimerRef.current = false;
    setDryingCompleteModalVisible(true);
  }, [apiSessionStatus]);

  useEffect(() => {
    const mcId = toPositiveId(activeMachineId);
    if (mcId == null) return;

    const machineOnlineForAlerts = isMachineOnlineForUi({
      firebaseConfigured: Boolean(firebaseDb),
      rtdbLastReceiveMs: overviewRtdbLastReceiveMs,
      machine: activeMachineForPresence,
      stableOnline: overviewStableOnline,
    });

    if (!machineOnlineForAlerts) {
      clearProblemNotifyThrottleForMachine(mcId);
      return;
    }

    const statusByKey = new Map<string, string>();
    for (const row of hardwareStatuses ?? []) {
      const key = canonicalHardwareSensorKey(String(row.component_name ?? ""));
      if (key) statusByKey.set(key, coerceHardwareStatus(row.status));
    }

    const alertSensorKeys = new Set<string>([...CRITICAL_SENSOR_KEYS, "esp32"]);

    for (const key of alertSensorKeys) {
      if (key === "moisture_sensor") {
        continue;
      }

      const st = statusByKey.get(key) ?? "not_working";
      let alertType = sensorAlertTypeFromStatus(st);

      if (
        key === "dht22" &&
        !alertType &&
        isGoodSensorStatus(st) &&
        machineOnlineForAlerts &&
        liveReadings &&
        typeof liveReadings === "object"
      ) {
        const hasTemp = Number.isFinite(Number(liveReadings?.temperature ?? liveReadings?.temp));
        const hasHum = Number.isFinite(Number(liveReadings?.humidity ?? liveReadings?.hum));
        if (!hasTemp && !hasHum) {
          alertType = "critical";
        }
      }

      if (
        key === "door_sensor" &&
        !alertType &&
        isGoodSensorStatus(st) &&
        machineOnlineForAlerts &&
        liveReadings &&
        typeof liveReadings === "object"
      ) {
        const door = String(liveReadings?.door ?? "").trim().toLowerCase();
        if (door !== "open" && door !== "closed") {
          alertType = "critical";
        }
      }

      if (alertType === "critical") {
        const meta = SENSOR_ALERT_META[key]?.critical;
        if (meta) {
          notifyProblemOnInterval(
            `hw:${key}:critical`,
            "critical",
            meta.title,
            meta.desc,
            key
          );
        }
      } else if (alertType === "warning") {
        const meta = SENSOR_ALERT_META[key]?.warning;
        if (meta) {
          notifyProblemOnInterval(
            `hw:${key}:warning`,
            "warning",
            meta.title,
            meta.desc,
            key
          );
        }
      } else if (isGoodSensorStatus(st)) {
        clearProblemNotifyThrottleForSensor(key, mcId);
      }
    }

    if (apiSessionStatus !== "running") return;

    const target = Number.parseFloat(String(temperature).trim());
    const current = Number(liveReadings?.temperature);
    if (!Number.isFinite(target) || !Number.isFinite(current)) return;

    const dryingMin = getUsedDryingMinutes();

    if (dryingMin >= 10 && current < target - 0.5) {
      notifyProblemOnInterval(
        "temp-below-target",
        "warning",
        "Target temperature not reached",
        `Drying has run ${dryingMin} min but temperature is ${current.toFixed(1)}°C (target ${target}°C).`,
        "drying_temp"
      );
    }
    if (current > target + 0.5) {
      notifyProblemOnInterval(
        "temp-above-target",
        "warning",
        "Temperature exceeded target",
        `Current temperature ${current.toFixed(1)}°C is above the target ${target}°C.`,
        "drying_temp"
      );
    }
  }, [
    apiSessionStatus,
    hardwareStatuses,
    liveReadings,
    temperature,
    session?.started_at,
    tickNow,
    activeMachineId,
    activeMachineForPresence,
    overviewRtdbLastReceiveMs,
    overviewStableOnline,
    firebaseDb,
    presenceTick,
  ]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, paddingBottom: 70 }}>

      <OverviewHeader
        unreadCount={unreadNotificationCount}
        onPressNotifications={() => onOpenNotifications?.()}
        machineStatusLabel={displayMachineStatus}
        machineOnline={machineOnline}
        timerLabel={timerLabel}
        machineSelector={
          <MachineDropdown
            machines={userMachines}
            selectedId={selectedMachineId}
            loading={machinesLoading}
            onSelect={selectMachine}
            onMachineChange={(machineId) => {
              void fetchOverview(machineId);
            }}
          />
        }
      />

      <View style={{ flex: 1 }}>
        {activeTab === "status" ? (
          <OverviewStatus
            session={session}
            hardware_statuses={hardwareStatuses}
            hardwareStreamFresh={overviewHardwareStreamFresh}
            liveReadings={liveReadings}
            hasActiveSession={hasActiveSession}
            remainingTimeLabel={timerLabel}
            sessionStatus={uiSessionStatus}
            doorForceClosed={isSessionRunning && doorBypassClosed}
            moistureDraftBatches={moistureDraftBatches}
            onMoistureDraftChange={updateMoistureDraftBatches}
            onOpenMoistureModal={() => setMoistureModalOpen(true)}
          />
        ) : (
          <OverviewParameters
            fishType={fishType}
            setFishType={setFishType}
            totalFish={totalFish}
            setTotalFish={setTotalFish}
            temperature={temperature}
            setTemperature={setTemperature}
            duration={duration}
            setDuration={setDuration}
            startMachine={startMachine}
            pauseMachine={pauseMachine}
            stopMachine={stopMachine}
            recommendation={recommendation}
            applyRecommendation={applyRecommendation}
            parametersLocked={parametersLocked}
            sessionStatus={uiSessionStatus}
            hasActiveSession={hasActiveSession}
            needsExtension={needsExtension}
            waitingForExtension={waitingForExtension}
            machineOnline={machineOnline}
          />
        )}
      </View>

      {/* ✅ KEEP BUTTONS */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={[styles.navBtn, activeTab === "status" && styles.active]}
          onPress={() => {
            setActiveTab("status");
            void fetchOverview();
          }}
        >
          <Text style={styles.navText}>Status</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, activeTab === "control" && styles.active]}
          onPress={() => setActiveTab("control")}
        >
          <Text style={styles.navText}>Control Panel</Text>
        </TouchableOpacity>
      </View>

      <DoorOpenModal
        visible={doorModalVisible}
        variant={doorModalVariant}
        onCancel={() => closeDoorModal(false)}
        onContinue={() => closeDoorModal(true)}
      />

      <DryingCompleteModal
        visible={dryingCompleteModalVisible}
        onCheckMoisture={() => {
          setDryingCompleteModalVisible(false);
          setActiveTab("status");
          setMoistureModalOpen(true);
        }}
        onDryAgain={() => {
          setDryingCompleteModalVisible(false);
          setActiveTab("control");
        }}
        onStop={() => {
          setDryingCompleteModalVisible(false);
          stopMachine();
        }}
      />

      <MoistureCheckModal
        visible={moistureModalOpen}
        onClose={() => setMoistureModalOpen(false)}
        batches={moistureDraftBatches}
        onBatchesChange={updateMoistureDraftBatches}
        liveReadings={
          liveReadings && typeof liveReadings === "object"
            ? (liveReadings as Record<string, unknown>)
            : null
        }
        moistureSensorStatus={moistureSensorStatus}
        onNotifyNoReading={() => {
          const mcId = toPositiveId(activeMachineId);
          if (mcId == null) return;
          void appendHardwareNotification({
            id: `moisture-check:no-reading:${mcId}:${Date.now()}`,
            type: "warning",
            title: "Moisture sensor not working",
            desc: "The probe is on standby while checking the fish. Place it on the fish until it shows Working, then try again.",
            machineId: mcId,
            componentKey: "moisture_sensor",
            createdAt: new Date().toISOString(),
          }).then(() => onNotificationsChanged?.());
        }}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center"
  },

  bottomNav: {
    flexDirection: "row",
    backgroundColor: "#3a5166",
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },

  navBtn: {
    flex: 1,
    padding: 18,
    alignItems: "center"
  },

  active: {
    backgroundColor: "#2f4456"
  },

  navText: {
    color: "#fff",
    fontWeight: "600"
  }
});