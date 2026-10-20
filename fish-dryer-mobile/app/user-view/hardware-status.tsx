import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  Alert,
  Modal,
  Pressable,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { FontAwesome as Icon, MaterialCommunityIcons } from "@expo/vector-icons";
import { getApiBaseUrl } from "@/config/api";
import HardwareStatusModal from "./hardware-status-modal";
import { onValue, ref as dbRef, get as dbGet } from "firebase/database";
import { firebaseDb } from "@/config/firebase";
import {
  isFirebaseHeartbeatLive,
  LIVE_HEARTBEAT_MS,
  subscribeLiveHardwareStatus,
} from "@/lib/live-hardware-rtdb";
import { parsePresenceMs } from "@/lib/parse-presence-ms";
import {
  formatMoisturePercent,
  resolveMoisturePercent,
} from "@/lib/duration-format";
import { ensureEspAssignment } from "@/lib/ensure-esp-assignment";
import {
  computeStableOnlineByMachineId,
  isMachineLive,
  isMachineOnlineForUi,
  liveHardwareIsForMachine,
  normalizeHardwareMacKey,
  recordMachineRtdbDelivery,
} from "@/lib/machine-presence";
import { moistureSensorDisplayColor, moistureSensorDisplayLabel } from "@/lib/hardware-status-rtdb";
import {
  clearHardwareTestCommand,
  hardwareTestKeyForLabel,
  publishHardwareTestCommand,
} from "@/lib/hardware-test-command";
import { userTypography } from "@/lib/user-typography";
import { useFirebaseAuthReady } from "@/lib/use-firebase-auth-ready";
import {
  formatDoorSensorDisplay,
  doorSensorDisplayColorHardware,
  doorSensorDisplayTitle,
  isDoorSensorUiLabel,
} from "@/lib/door-sensor-display";
import MachineDropdown from "./machine-dropdown";
import {
  clearSelectedMachineId,
  getSelectedMachineId,
  setSelectedMachineId,
  useSelectedMachine,
} from "@/lib/selected-machine";

type MachineOnlineStatus = "online" | "offline";

function machineStatusFromApi(v: unknown): MachineOnlineStatus {
  if (v === true || v === 1) return "online";
  if (v === false || v === 0) return "offline";
  const raw = String(v ?? "")
    .trim()
    .toLowerCase();
  if (["online", "true", "1", "yes", "up", "connected"].includes(raw)) {
    return "online";
  }
  return "offline";
}

type Machine = {
  id: number;
  name: string;
  device_id?: string;
  mac?: string | null;
  display_name?: string | null;
  status?: MachineOnlineStatus;
  /** ISO 8601 from Laravel — used to explain offline vs "detected" row. */
  last_seen?: string | null;
};

const MACHINE_PRESENCE_POLL_MS = 15_000;
const PRESENCE_UI_TICK_MS = 2000;

function effectiveComponentStatus(rawStatus: string, streamFresh: boolean): string {
  if (!streamFresh) return "not_working";
  return String(rawStatus ?? "not_working").trim() || "not_working";
}

type ComponentStatus = {
  component_name: string;
  status: string;
};

/** Laravel / JSON sometimes decodes lists as objects; RN needs a real array for .find/.map. */
function asJsonArray<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") {
    const t = v.trim();
    if (!t) return [];
    try {
      const parsed = JSON.parse(t);
      return asJsonArray<T>(parsed);
    } catch {
      return [];
    }
  }
  if (v != null && typeof v === "object") return Object.values(v) as T[];
  return [];
}

/** API / proxies sometimes vary casing; keep UI consistent with backend intent. */
function normalizeMachineRow(m: Machine): Required<Pick<Machine, "status">> & Machine {
  const id = Number(m.id);
  const macRaw = String((m as { mac?: unknown }).mac ?? "").trim();
  return {
    ...m,
    id: Number.isFinite(id) ? id : m.id,
    mac: macRaw || null,
    status: machineStatusFromApi(m.status),
    last_seen: m.last_seen ?? null,
  };
}

function machineMacForRow(m: Machine | null | undefined): string | null {
  if (!m) return null;
  const mac = normalizeHardwareMacKey(m.mac);
  return mac && mac.length >= 12 ? mac.slice(0, 12) : null;
}

function macWithColonsFromKey(macKey: string): string {
  return macKey.match(/.{1,2}/g)?.join(":") ?? macKey;
}

/** 12-hex MAC, or null. Device names like "Fish Dryer ABCD" are not MACs. */
function macIdentity(value: unknown): string | null {
  const key = normalizeHardwareMacKey(value);
  if (!key || key.length < 12) return null;
  return key.slice(0, 12);
}

/** Unresolved `{".sv":"timestamp"}` is not a heartbeat. */
function beaconUpdatedMs(updatedAt: unknown): number | null {
  if (updatedAt && typeof updatedAt === "object" && ".sv" in (updatedAt as object)) {
    return null;
  }
  return parsePresenceMs(updatedAt);
}

/**
 * Live only when the beacon time is inside the Online-card window, or this
 * scan watched the discovery row change. A leftover row does not count.
 */
function beaconIsLive(
  updatedMs: number | null,
  movedAtMs: number | null,
  nowMs: number
): boolean {
  if (updatedMs != null) {
    const age = nowMs - updatedMs;
    // Server time can sit a few minutes off the phone. A hours-old row still fails.
    if (age >= -600_000 && age <= LIVE_HEARTBEAT_MS) return true;
  }
  if (movedAtMs != null) {
    const movedAge = nowMs - movedAtMs;
    if (movedAge >= 0 && movedAge <= LIVE_HEARTBEAT_MS) return true;
  }
  return false;
}

/** Any field the board rewrites. Seq, clock, RSSI, or IP — a dead row stays still. */
function discoveryFingerprint(obj: Record<string, unknown>): string {
  const seq = obj.seq ?? "";
  const updated = obj.epoch_ms ?? obj.updated_at ?? "";
  const updatedText =
    updated && typeof updated === "object" ? "sv" : String(updated);
  return `${seq}|${updatedText}|${obj.rssi ?? ""}|${obj.ip ?? ""}|${obj.mac ?? ""}`;
}

function discoveryBeaconMs(obj: Record<string, unknown>): number | null {
  // Firebase server time is the only clock Add Machine trusts.
  // The board's own epoch can be hours ahead and was hiding new MACs.
  const server = beaconUpdatedMs(obj.updated_at);
  if (server != null) return server;
  const epoch = beaconUpdatedMs(obj.epoch_ms);
  if (epoch == null) return null;
  const age = Date.now() - epoch;
  if (age < -120_000 || age > LIVE_HEARTBEAT_MS) return null;
  return epoch;
}

/** Sync machine row with Firebase presence (not Laravel `last_seen`, which lags up to 3 min). */
function machineRowWithLivePresence(
  m: Machine,
  receiveMs: number | undefined,
  payloadMs: number | undefined,
  live: boolean
): Machine {
  return {
    ...m,
    status: live ? "online" : "offline",
    last_seen: payloadMs != null ? new Date(payloadMs).toISOString() : m.last_seen ?? null,
  };
}

// Only sensors that produce real, observable readings. Outputs (LEDs, heaters, fans,
// buzzer) have no feedback line and would just always show "working" — so they are
// intentionally excluded from the detection list.
const DEFAULT_COMPONENTS = [
  "ESP32",
  "DHT22 (Temp & Humidity)",
  "Moisture Sensor",
  "Door Sensor (MC38)",
  "LCD 16x2",
  "Keypad 4x4",
  "Heater",
  "Fan",
  "LED Green",
  "LED Yellow",
  "LED Red",
  "Buzzer",
];

/** Outputs have no feedback wire. The user answers Yes or No while the part is on. */
const OUTPUT_CONFIRM_KEYS = new Set([
  "heater",
  "fan",
  "led_green",
  "led_yellow",
  "led_red",
  "buzzer",
]);

/** MaterialCommunityIcons glyph names (Expo) — per hardware row. */
const HARDWARE_ICON_BY_LABEL: Record<
  string,
  React.ComponentProps<typeof MaterialCommunityIcons>["name"]
> = {
  ESP32: "chip",
  Buzzer: "bell",
  "Door Sensor (MC38)": "door-closed",
  "Fan 1": "fan",
  "Fan 2": "fan",
  "Fan 3": "fan",
  "Heater 1": "radiator",
  "Heater 2": "radiator",
  Heater: "radiator",
  Fan: "fan",
  "LED Green": "lightbulb-on-outline",
  "LED Yellow": "lightbulb-on-outline",
  "LED Red": "lightbulb-on-outline",
  "Moisture Sensor": "scale-balance",
  "DHT22 (Temp & Humidity)": "thermometer",
  "LCD 16x2": "monitor",
  "Keypad 4x4": "dialpad",
  "LED 1": "lightbulb-on-outline",
  "LED 2": "lightbulb-on-outline",
  "LED 3": "lightbulb-on-outline",
};

/** Sensor / HMI diagnostic payload built from latest RTDB heartbeat. Used by Test buttons. */
type SensorDiagnostic = {
  key:
    | "esp32"
    | "dht22"
    | "moisture_sensor"
    | "door_sensor"
    | "lcd"
    | "keypad"
    | "heater"
    | "fan"
    | "led_green"
    | "led_yellow"
    | "led_red"
    | "buzzer";
  label: string;
  ok: boolean;
  /** Short headline shown in alert/title row. */
  headline: string;
  /** Multi-line body shown under headline. */
  details: string;
};

type KeypadTestProgress = {
  keysPressed: number;
  keysTotal: number;
  keys: string;
  ok: boolean;
};

/** RTDB readings shape published by the firmware. Optional fields may be absent if a sensor failed. */
type LiveReadings = {
  temperature?: number;
  humidity?: number;
  moisture_raw?: number;
  moisture_percent?: number;
  moisture_dry_adc?: number;
  moisture_wet_adc?: number;
  moisture_span?: number;
  moisture_calibrated?: boolean;
  door?: string;
};

type MachineHardwareSnapshot = {
  components: ComponentStatus[];
  readings: LiveReadings | null;
  receiveMs: number | null;
  payloadMs: number | null;
};

const HW_STATUS_SKIP_KEYS = new Set([
  "components",
  "updated_at",
  "microcontroller_id",
  "device_id",
  "readings",
  "name",
  "mac",
  "session_status",
]);

function parseHardwareStatusFromRtdb(val: Record<string, unknown>): {
  components: ComponentStatus[];
  readings: LiveReadings | null;
  payloadMs: number | null;
} {
  const payloadMs = parsePresenceMs(val.updated_at);
  const readingsRaw = val.readings;
  const readings =
    readingsRaw && typeof readingsRaw === "object" ? (readingsRaw as LiveReadings) : null;
  const componentsMap =
    val.components && typeof val.components === "object" ? val.components : val;
  const components =
    componentsMap && typeof componentsMap === "object"
      ? Object.entries(componentsMap as Record<string, unknown>)
          .filter(([k]) => !HW_STATUS_SKIP_KEYS.has(k))
          .map(([component_name, status]) => ({
            component_name,
            status: String(status ?? "unknown"),
          }))
      : [];
  return { components, readings, payloadMs };
}

export default function HardwareStatus({ active = true }: { active?: boolean }) {
  const firebaseAuthReady = useFirebaseAuthReady();
  const activeRef = useRef(active);
  activeRef.current = active;
  const { selectedId: storeSelectedId, refresh: refreshStoreMachines } = useSelectedMachine();
  const machinesLoadedRef = useRef(false);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  /** Per-machine RTDB hardware — keyed by Laravel/Firebase machine id. */
  const [machineHwById, setMachineHwById] = useState<Record<number, MachineHardwareSnapshot>>({});
  const machineHwByIdRef = useRef<Record<number, MachineHardwareSnapshot>>({});

  const [loading, setLoading] = useState(true);
  const [testingAll, setTestingAll] = useState(false);
  const [testingComponent, setTestingComponent] = useState<string | null>(null);
  const testPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Machine the open test is driving, so Done/X still stops it if selection changes. */
  const testMachineIdRef = useRef<number | null>(null);
  /** User closed the diagnostic modal — do not reopen until the next test starts. */
  const testDismissedRef = useRef(false);
  /** Yes/No answers for fan, heater, LEDs, and buzzer. Survives Done. */
  const [outputVerdicts, setOutputVerdicts] = useState<Record<string, boolean>>({});
  const outputVerdictRef = useRef<Record<string, boolean>>({});
  /** Guards async refreshModal from a previous or cancelled test run. */
  const activeTestRunRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (testPollRef.current) clearInterval(testPollRef.current);
    };
  }, []);

  const [diagModalOpen, setDiagModalOpen] = useState(false);
  const [diagModalTitle, setDiagModalTitle] = useState("Diagnostic Results");
  const [diagModalResults, setDiagModalResults] = useState<SensorDiagnostic[]>([]);
  const [diagModalAgeSec, setDiagModalAgeSec] = useState<number | null>(null);
  const [diagTestInProgress, setDiagTestInProgress] = useState(false);
  const [diagIsTestAll, setDiagIsTestAll] = useState(false);
  const [moistureTestAllResult, setMoistureTestAllResult] = useState<boolean | null>(null);
  const [keypadTestProgress, setKeypadTestProgress] = useState<KeypadTestProgress | null>(null);
  const keypadTestProgressRef = useRef<KeypadTestProgress | null>(null);
  const [diagIncludesKeypad, setDiagIncludesKeypad] = useState(false);
  const [diagIncludesLcd, setDiagIncludesLcd] = useState(false);

  useEffect(() => {
    keypadTestProgressRef.current = keypadTestProgress;
  }, [keypadTestProgress]);

  /** Live keypad press progress from firmware `test_ack` + heartbeat readings. */
  useEffect(() => {
    if (!firebaseDb || !firebaseAuthReady || !diagModalOpen || !diagIncludesKeypad) return;
    const mid = selectedMachineIdRef.current;
    if (mid == null) return;

    const applyProgress = (rec: Record<string, unknown>) => {
      const pressed = Number(rec.keys_pressed ?? rec.keysPressed ?? rec.keypad_keys_pressed ?? 0);
      const total = Number(rec.keys_total ?? rec.keysTotal ?? rec.keypad_keys_total ?? 16);
      if (!Number.isFinite(pressed)) return;
      setKeypadTestProgress({
        keysPressed: Math.max(0, Math.min(pressed, total || 16)),
        keysTotal: total > 0 ? total : 16,
        keys: String(rec.keys ?? ""),
        ok: rec.ok === true || pressed >= (total || 16),
      });
    };

    const unsubAck = onValue(dbRef(firebaseDb, `machines/${mid}/test_ack`), (snap) => {
      const val = snap.val();
      if (!val || typeof val !== "object") return;
      const rec = val as Record<string, unknown>;
      const component = String(rec.component ?? "").toLowerCase();
      if (component && component !== "keypad" && component !== "all") {
        if (rec.keys_pressed == null && rec.keysPressed == null) return;
      }
      applyProgress(rec);
    });

    const unsubHw = onValue(dbRef(firebaseDb, `machines/${mid}/hardware_status/readings`), (snap) => {
      const val = snap.val();
      if (!val || typeof val !== "object") return;
      const rec = val as Record<string, unknown>;
      if (rec.keypad_keys_pressed == null && rec.ui_self_test !== true) return;
      applyProgress(rec);
    });

    return () => {
      unsubAck();
      unsubHw();
    };
  }, [firebaseDb, firebaseAuthReady, diagModalOpen, diagIncludesKeypad]);

  const [modalVisible, setModalVisible] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const discoveryCacheRef = useRef<{
    val: Record<string, unknown> | null;
    ready: boolean;
    prevFp: Record<string, string>;
    movedAt: Record<string, number>;
  }>({ val: null, ready: false, prevFp: {}, movedAt: {} });
  const discoveryWaitersRef = useRef<Array<() => void>>([]);

  /** Last Firebase delivery per machine id (`machines/{id}/hardware_status`). */
  const [machineRtdbReceiveMs, setMachineRtdbReceiveMs] = useState<Record<number, number>>({});
  const [machineRtdbPayloadMs, setMachineRtdbPayloadMs] = useState<Record<number, number>>({});
  const [presenceTick, setPresenceTick] = useState(0);
  const [stableOnlineById, setStableOnlineById] = useState<Record<number, boolean>>({});
  const machineRtdbReceiveRef = useRef<Record<number, number>>({});
  const machineRtdbPayloadRef = useRef<Record<number, number>>({});
  const machineRtdbSeenCallbackRef = useRef<Record<number, boolean>>({});
  const machinesRef = useRef<Machine[]>([]);
  const componentsLoadGenRef = useRef(0);
  const userPickedMachineRef = useRef(false);
  const stableOnlineByIdRef = useRef<Record<number, boolean>>({});
  const stableOfflineStreakRef = useRef<Record<number, number>>({});

  /** Avoid stale `selectedMachine` inside interval / async refresh (was resetting wrong row). */
  const selectedMachineIdRef = useRef<number | null>(null);

  const selectMachine = (m: Machine) => {
    userPickedMachineRef.current = true;
    setSelectedMachine(m);
    selectedMachineIdRef.current = m.id;
    void setSelectedMachineId(m.id);
  };

  useEffect(() => {
    if (storeSelectedId == null) return;
    if (selectedMachineIdRef.current === storeSelectedId) return;
    const m =
      machinesRef.current.find((row) => row.id === storeSelectedId) ??
      machines.find((row) => row.id === storeSelectedId);
    if (!m) return;
    setSelectedMachine(m);
    selectedMachineIdRef.current = m.id;
    void loadComponents(m.id);
  }, [storeSelectedId, machines]);
  useEffect(() => {
    selectedMachineIdRef.current = selectedMachine?.id ?? null;
  }, [selectedMachine?.id]);

  const machineIdsKey = useMemo(
    () => machines.map((m) => m.id).join(","),
    [machines]
  );

  useEffect(() => {
    machinesRef.current = machines;
  }, [machines]);

  // Keep listening while Hardware is open, not only after Add Machine.
  // A one-shot read was missing new boards, and a timestamp that never
  // parsed (unresolved server time) was dropped before it could move.
  useEffect(() => {
    if (!active || !firebaseDb) {
      discoveryCacheRef.current = {
        val: null,
        ready: false,
        prevFp: {},
        movedAt: {},
      };
      return;
    }
    const db = firebaseDb;
    const unsub = onValue(
      dbRef(db, "discovery"),
      (snap) => {
        const raw = snap.val();
        const prev = discoveryCacheRef.current;
        const prevFp = { ...prev.prevFp };
        const movedAt = { ...prev.movedAt };
        const now = Date.now();
        const primed = prev.ready;
        if (raw && typeof raw === "object") {
          for (const [key, node] of Object.entries(raw as Record<string, unknown>)) {
            const obj =
              node && typeof node === "object" ? (node as Record<string, unknown>) : null;
            if (!obj) continue;
            const fp = discoveryFingerprint(obj);
            const before = prevFp[key];
            const beaconMs = discoveryBeaconMs(obj);
            const beaconAge = beaconMs == null ? null : now - beaconMs;
            const beaconFresh =
              beaconAge != null && beaconAge >= -300_000 && beaconAge <= LIVE_HEARTBEAT_MS;
            // A row already in the first snapshot is live when its clock is fresh.
            // A MAC that appears later, or any beacon that changes, is powered on now.
            if (beaconFresh || (primed && (before == null || before !== fp))) {
              movedAt[key] = now;
            }
            prevFp[key] = fp;
          }
        }
        discoveryCacheRef.current = {
          val: raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null,
          ready: true,
          prevFp,
          movedAt,
        };
        const waiters = discoveryWaitersRef.current.splice(0);
        waiters.forEach((fn) => fn());
      },
      (err) => {
        console.log("discovery listener failed:", err);
        discoveryCacheRef.current = { ...discoveryCacheRef.current, ready: true };
        const waiters = discoveryWaitersRef.current.splice(0);
        waiters.forEach((fn) => fn());
      }
    );
    return () => {
      unsub();
    };
  }, [active, firebaseDb]);

  const selectedHw =
    selectedMachine != null ? machineHwById[selectedMachine.id] : undefined;
  const components = selectedHw?.components ?? [];
  const liveReadings = selectedHw?.readings ?? null;
  const hardwareRtdbPayloadAtMs =
    selectedMachine != null ? machineRtdbPayloadMs[selectedMachine.id] ?? null : null;

  useEffect(() => {
    if (!active || machinesLoadedRef.current) return;
    machinesLoadedRef.current = true;
    void loadMachines();
  }, [active]);

  /** RTDB does not push when the ESP stops; re-render periodically so "recent" expires → offline. */
  useEffect(() => {
    if (!firebaseDb || !active) return;
    const id = setInterval(() => setPresenceTick((n) => n + 1), PRESENCE_UI_TICK_MS);
    return () => clearInterval(id);
  }, [firebaseDb, active]);

  const recomputeStableOnline = useCallback((advanceOfflineDebounce: boolean) => {
    const ids = machinesRef.current.map((m) => m.id);
    if (ids.length === 0) return;
    const next = computeStableOnlineByMachineId(
      machineRtdbReceiveRef.current,
      stableOnlineByIdRef.current,
      ids,
      Date.now(),
      stableOfflineStreakRef.current,
      advanceOfflineDebounce
    );
    stableOnlineByIdRef.current = next;
    setStableOnlineById(next);
  }, []);

  /** Heartbeat delivery — go Online immediately; do not debounce-off on unrelated renders. */
  useEffect(() => {
    if (!firebaseDb || !machineIdsKey) return;
    recomputeStableOnline(false);
  }, [firebaseDb, machineIdsKey, machineRtdbReceiveMs, recomputeStableOnline]);

  /** Timer tick — only path that may advance offline debounce. */
  useEffect(() => {
    if (!firebaseDb || !machineIdsKey) return;
    recomputeStableOnline(true);
  }, [firebaseDb, machineIdsKey, presenceTick, recomputeStableOnline]);

  const hardwareStableOnline =
    selectedMachine != null ? (stableOnlineById[selectedMachine.id] ?? false) : false;

  const applyLiveHw = useCallback((id: number, hwRec: Record<string, unknown>) => {
    if (!liveHardwareIsForMachine(id, hwRec, machinesRef.current)) {
      return;
    }
    const now = Date.now();
    const parsed = parseHardwareStatusFromRtdb(hwRec);
    const payloadMs = parsed.payloadMs ?? parsePresenceMs(hwRec.updated_at);
    const delivered = recordMachineRtdbDelivery(
      machineRtdbReceiveRef.current,
      machineRtdbPayloadRef.current,
      id,
      hwRec.updated_at ?? payloadMs,
      machineRtdbSeenCallbackRef.current,
      now
    );
    machineRtdbReceiveRef.current = delivered.receiveById;
    machineRtdbPayloadRef.current = delivered.payloadById;
    machineHwByIdRef.current = {
      ...machineHwByIdRef.current,
      [id]: {
        components: parsed.components,
        readings: parsed.readings,
        receiveMs: delivered.accepted ? now : machineHwByIdRef.current[id]?.receiveMs ?? null,
        payloadMs,
      },
    };
    if (!activeRef.current) return;
    if (delivered.accepted) {
      setMachineRtdbReceiveMs({ ...delivered.receiveById });
    }
    if (payloadMs != null) {
      setMachineRtdbPayloadMs({ ...machineRtdbPayloadRef.current });
    }
    setMachineHwById({ ...machineHwByIdRef.current });
  }, []);

  const markHardwareDead = useCallback((id: number) => {
    const nextPayload = { ...machineRtdbPayloadRef.current };
    delete nextPayload[id];
    machineRtdbPayloadRef.current = nextPayload;
    setMachineRtdbPayloadMs(nextPayload);
  }, []);

  useEffect(() => {
    if (!firebaseDb || !firebaseAuthReady) return;
    const db = firebaseDb;
    const ids = machineIdsKey
      ? machineIdsKey
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((id) => Number.isFinite(id))
      : [];

    const unsubs = ids.map((id) =>
      subscribeLiveHardwareStatus(
        db,
        id,
        (hw) => applyLiveHw(id, hw),
        () => markHardwareDead(id)
      )
    );

    return () => {
      unsubs.forEach((u) => u());
    };
  }, [firebaseDb, firebaseAuthReady, machineIdsKey, applyLiveHw, markHardwareDead]);

  useEffect(() => {
    if (!active) return;
    setMachineHwById({ ...machineHwByIdRef.current });
    setMachineRtdbReceiveMs({ ...machineRtdbReceiveRef.current });
    setMachineRtdbPayloadMs({ ...machineRtdbPayloadRef.current });
    const interval = setInterval(() => {
      void refreshMachinesPresence();
    }, MACHINE_PRESENCE_POLL_MS);

    return () => clearInterval(interval);
  }, [active]);

  const normalizeKey = (value: string) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .trim();

  const displayToKeys: Record<string, string[]> = {
    ESP32: ["esp32", "esp32_controller"],
    Buzzer: ["buzzer"],
    "Door Sensor (MC38)": ["door_sensor", "door", "mc38", "reed_switch", "reed", "magnetic_switch"],
    "Heater": ["heater", "heater_1", "heater1"],
    "Fan": ["fan", "fan_1", "fan1"],
    "LED Green": ["led_green", "led_1", "led1"],
    "LED Yellow": ["led_yellow", "led_2", "led2"],
    "LED Red": ["led_red", "led_3", "led3"],
    "Fan 1": ["fan_1", "fan1", "heater_fan_1"],
    "Fan 2": ["fan_2", "fan2", "heater_fan_2"],
    "Fan 3": ["fan_3", "fan3", "ventilation_fan", "fan"],
    "Moisture Sensor": [
      "moisture_sensor",
      "moisture",
      "yl69",
      "yl_69",
      "soil_moisture",
    ],
    "DHT22 (Temp & Humidity)": ["dht22", "temp_humidity_sensor", "dht"],
    "LCD 16x2": ["lcd", "lcd_16x2", "lcd16x2", "display", "i2c_lcd"],
    "Keypad 4x4": ["keypad", "key_pad", "matrix_keypad", "keypad_4x4"],
    "LED 1": ["led_1", "led_drying", "led1"],
    "LED 2": ["led_2", "led_pause", "led2"],
    "LED 3": ["led_3", "led_stop", "led3"],
  };

  const apiRequest = async (endpoint: string, options: RequestInit = {}) => {
    const res = await fetch(`${getApiBaseUrl()}${endpoint}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Invalid API response for ${endpoint}`);
    }
    if (!res.ok) throw new Error(data.message || "API Error");

    return data;
  };

  const loadMachines = async (): Promise<Machine[]> => {
    setApiError(null);
    let list: Machine[] = [];
    let usedFallback = false;

    try {
      const res = await apiRequest("/machines");
      list = asJsonArray<Machine>(res.data).map(normalizeMachineRow);
    } catch (e) {
      console.log("/machines failed:", e);
      usedFallback = true;
      if (list.length === 0) {
        setApiError(
          e instanceof Error ? e.message : "Cannot load machines from the API."
        );
      }
    }

    setMachines(list);
    const storedId = await getSelectedMachineId();
    const sid =
      selectedMachineIdRef.current ??
      (!userPickedMachineRef.current ? storedId : null);
    const next =
      list.find((m: Machine) => Number(m.id) === Number(sid)) ??
      (userPickedMachineRef.current ? null : list[0] ?? null);
    if (next) {
      if (next.id !== sid) {
        selectMachine(next);
      } else {
        setSelectedMachine(next);
        selectedMachineIdRef.current = next.id;
      }
    } else if (!userPickedMachineRef.current) {
      setSelectedMachine(null);
      selectedMachineIdRef.current = null;
    }

    if (next && !usedFallback && !firebaseDb) {
      try {
        await loadComponents(next.id);
      } catch (err) {
        console.log("loadComponents failed:", err);
      }
    }

    setLoading(false);
    return list;
  };

  const loadComponents = async (machineId: number) => {
    if (firebaseDb) return;
    const gen = ++componentsLoadGenRef.current;
    try {
      const res = await apiRequest(`/machines/${machineId}/components`);
      if (gen !== componentsLoadGenRef.current) return;
      const rows = asJsonArray<ComponentStatus>(res.data);
      const now = Date.now();
      setMachineHwById((prev) => {
        const next = {
          ...prev,
          [machineId]: {
            components: rows,
            readings: null,
            receiveMs: now,
            payloadMs: now,
          },
        };
        machineHwByIdRef.current = next;
        return next;
      });
    } catch (e) {
      if (gen !== componentsLoadGenRef.current) return;
      setMachineHwById((prev) => {
        const next = {
          ...prev,
          [machineId]: {
            components: [],
            readings: null,
            receiveMs: null,
            payloadMs: null,
          },
        };
        machineHwByIdRef.current = next;
        return next;
      });
      setApiError(
        e instanceof Error
          ? `Components (#${machineId}): ${e.message}`
          : `Components (#${machineId}): request failed.`
      );
    }
  };

  const selectedMachineOnline = firebaseDb
    ? isFirebaseHeartbeatLive(
        hardwareRtdbPayloadAtMs,
        Date.now(),
        selectedMachine != null ? machineRtdbReceiveMs[selectedMachine.id] ?? null : null
      )
    : isMachineLive(selectedMachine);

  const hardwareStreamFresh = selectedMachineOnline;

  const machineCardAppearsLive = (m: Machine) => {
    if (!firebaseDb) return isMachineLive(m);
    return isFirebaseHeartbeatLive(
      machineRtdbPayloadMs[m.id] ?? machineHwById[m.id]?.payloadMs,
      Date.now(),
      machineRtdbReceiveMs[m.id] ?? machineHwById[m.id]?.receiveMs ?? null
    );
  };

  const getComponentStatus = (name: string) => {
    if (
      name === "Heater" ||
      name === "Fan" ||
      name === "LED Green" ||
      name === "LED Yellow" ||
      name === "LED Red" ||
      name === "Buzzer"
    ) {
      const mid = selectedMachine?.id;
      const scoped = mid != null ? outputVerdicts[`${mid}:${name}`] : undefined;
      if (typeof scoped === "boolean") {
        return scoped ? "working" : "not_working";
      }
      return "untested";
    }
    const keyName = normalizeKey(name);
    const aliases = displayToKeys[name] ?? [keyName];
    const found = components.find((c) => {
      if (!c?.component_name) return false;
      const key = normalizeKey(String(c.component_name));
      return aliases.some((alias) => key === normalizeKey(alias));
    });
    const raw = found?.status ?? "not_working";
    return effectiveComponentStatus(String(raw ?? "not_working"), hardwareStreamFresh);
  };

  /** Remote tests use the API; allow when API says live OR RTDB shows a fresh heartbeat (ESP may still accept commands). */
  const isMcuReachable = selectedMachineOnline;
  const isTestControlsDisabled = !selectedMachine || !isMcuReachable;

  const normalizeStatusWord = (status: string) =>
    String(status ?? "")
      .trim()
      .toLowerCase();

  const getStatusColor = (status: string) => {
    const s = normalizeStatusWord(status);
    if (s === "untested") return "#94a3b8";
    if (["working", "ok", "online", "pass", "passed"].includes(s)) return "#22c55e";
    if (s === "standby" || s === "idle") return "#95a5a6";
    if (["not_working", "error", "offline", "fail", "failed"].includes(s)) return "#ef4444";
    if (s === "warning") return "#f59e0b";
    return "#9ca3af";
  };

  const statusLabel = (name: string) => {
    if (isDoorSensorUiLabel(name)) {
      return doorSensorDisplayTitle(
        formatDoorSensorDisplay(liveReadings?.door, {
          streamLive: hardwareStreamFresh,
          componentStatus: getComponentStatus(name),
        })
      );
    }
    if (name === "Moisture Sensor") {
      return moistureSensorDisplayLabel(getComponentStatus(name));
    }
    if (name === "DHT22 (Temp & Humidity)") {
      const dhtStatus = getComponentStatus(name);
      if (hardwareStreamFresh && normalizeStatusWord(dhtStatus) === "working") {
        const t = liveReadings?.temperature;
        const h = liveReadings?.humidity;
        const hasReading =
          typeof t === "number" &&
          Number.isFinite(t) &&
          typeof h === "number" &&
          Number.isFinite(h);
        if (!hasReading) return "Not Working";
      }
    }
    const s = normalizeStatusWord(getComponentStatus(name));
    if (s === "untested" || s === "unknown") return "Not tested";
    if (["working", "ok", "online", "pass", "passed"].includes(s)) return "Working";
    if (s === "standby" || s === "idle") return "Standby";
    if (["not_working", "error", "offline", "fail", "failed"].includes(s)) return "Not Working";
    if (s === "warning") return "Warning";
    return "Unknown";
  };

  const statusColorForComponent = (name: string, status: string) => {
    if (name === "Moisture Sensor") {
      return moistureSensorDisplayColor(getComponentStatus(name));
    }
    if (name === "DHT22 (Temp & Humidity)") {
      const dhtStatus = getComponentStatus(name);
      if (hardwareStreamFresh && normalizeStatusWord(dhtStatus) === "working") {
        const t = liveReadings?.temperature;
        const h = liveReadings?.humidity;
        const hasReading =
          typeof t === "number" &&
          Number.isFinite(t) &&
          typeof h === "number" &&
          Number.isFinite(h);
        if (!hasReading) return "#ef4444";
      }
    }
    if (isDoorSensorUiLabel(name)) {
      return doorSensorDisplayColorHardware(
        formatDoorSensorDisplay(liveReadings?.door, {
          streamLive: hardwareStreamFresh,
          componentStatus: getComponentStatus(name),
        })
      );
    }
    return getStatusColor(status);
  };

  /**
   * Pull the freshest RTDB heartbeat snapshot so the diagnostic uses *now* values, not whatever
   * we cached from the last onValue tick. Falls back to current state if RTDB isn't configured
   * or the read fails. Returns null if no data is available at all.
   */
  const fetchLatestSnapshot = async (
    machineId: number
  ): Promise<{
    components: Record<string, string>;
    readings: LiveReadings;
    updatedAtMs: number | null;
  } | null> => {
    const cached = machineHwByIdRef.current[machineId];
    let componentsMap: Record<string, string> = {};
    (cached?.components ?? []).forEach((c) => {
      if (c?.component_name) componentsMap[normalizeKey(c.component_name)] = String(c.status ?? "");
    });
    let readings: LiveReadings = cached?.readings ?? {};
    let updatedAtMs: number | null =
      cached?.payloadMs ?? cached?.receiveMs ?? machineRtdbPayloadMs[machineId] ?? null;

    if (firebaseDb) {
      try {
        const snap = await dbGet(dbRef(firebaseDb, `machines/${machineId}/hardware_status`));
        const val = snap.val();
        if (val && typeof val === "object") {
          const parsed = parseHardwareStatusFromRtdb(val as Record<string, unknown>);
          updatedAtMs = parsed.payloadMs;
          componentsMap = {};
          parsed.components.forEach((c) => {
            if (c?.component_name) {
              componentsMap[normalizeKey(c.component_name)] = String(c.status ?? "");
            }
          });
          if (parsed.readings) readings = parsed.readings;
        }
      } catch (e) {
        console.log("Diagnostic dbGet failed, using cached state:", e);
      }
    }

    if (Object.keys(componentsMap).length === 0 && !updatedAtMs) return null;
    return { components: componentsMap, readings, updatedAtMs };
  };

  /**
   * Translate one sensor's snapshot into a human-readable diagnostic. Each branch encodes the
   * exact business rules the user asked for (e.g. moisture must report calibration health).
   */
  const buildDiagnostic = (
    key: SensorDiagnostic["key"],
    snapshot: {
      components: Record<string, string>;
      readings: LiveReadings;
      updatedAtMs: number | null;
    }
  ): SensorDiagnostic => {
    const status = String(snapshot.components[key] ?? "").toLowerCase();
    const connected = status === "working" || status === "ok";
    const r = snapshot.readings;

    if (key === "esp32") {
      return {
        key,
        label: "ESP32",
        ok: connected,
        headline: connected ? "Working" : "Not Working",
        details: connected
          ? "The board is online and publishing its own status."
          : "The board is not publishing a live status. Check power and Wi-Fi.",
      };
    }

    if (key === "dht22") {
      if (!connected) {
        return {
          key,
          label: "DHT22 (Temp & Humidity)",
          ok: false,
          headline: "Not connected",
          details: "Sensor is not responding on GPIO4. Check the data wire, 3.3V supply, and 10k pull-up if used.",
        };
      }
      const t = typeof r.temperature === "number" ? r.temperature : null;
      const h = typeof r.humidity === "number" ? r.humidity : null;
      if (t == null || h == null) {
        return {
          key,
          label: "DHT22 (Temp & Humidity)",
          ok: false,
          headline: "Connected but no readings",
          details: "Sensor responded but readings are missing. Wait for the next heartbeat (~3s) and try again.",
        };
      }
      return {
        key,
        label: "DHT22 (Temp & Humidity)",
        ok: true,
        headline: "Connected",
        details: `Temperature: ${t}°C\nHumidity: ${h}%`,
      };
    }

    if (key === "moisture_sensor") {
      const pct = resolveMoisturePercent(r as Record<string, unknown>);
      const shown = formatMoisturePercent(pct);
      const statusWord = moistureSensorDisplayLabel(connected ? "working" : "not_working");
      if (!connected) {
        return {
          key,
          label: "Moisture Sensor",
          ok: false,
          headline: statusWord,
          details: "Probe is not responding on GPIO35. Check probe leads and ADC supply.",
        };
      }

      return {
        key,
        label: "Moisture Sensor",
        ok: true,
        headline: statusWord,
        details:
          shown != null
            ? `Moisture: ${shown}`
            : "Probe is connected. No percent yet.",
      };
    }

    // door_sensor
    if (key === "door_sensor") {
      if (!connected) {
        return {
          key,
          label: "Door Sensor (MC38)",
          ok: false,
          headline: "Not Working",
          details: "Sensor is not responding on GPIO34. Check the 10k pull-up to 3.3V, wiring, and the door magnet.",
        };
      }
      const doorState = formatDoorSensorDisplay(r.door, {
        streamLive: true,
        componentStatus: "working",
      });
      if (doorState === "not_working") {
        return {
          key,
          label: "Door Sensor (MC38)",
          ok: false,
          headline: "Not Working",
          details: "No valid door reading from the board.",
        };
      }
      return {
        key,
        label: "Door Sensor (MC38)",
        ok: true,
        headline: doorState,
        details: "",
      };
    }

    if (OUTPUT_CONFIRM_KEYS.has(key)) {
      const verdict = outputVerdictRef.current[key];
      const prompt =
        key === "fan"
          ? "Is the fan spinning?"
          : key === "heater"
            ? "Is the heater on?"
            : key === "led_green"
              ? "Is the green LED on?"
              : key === "led_yellow"
                ? "Is the yellow LED on?"
                : key === "led_red"
                  ? "Is the red LED on?"
                  : "Do you hear the buzzer?";
      const label =
        key === "fan"
          ? "Fan"
          : key === "heater"
            ? "Heater"
            : key === "led_green"
              ? "LED Green"
              : key === "led_yellow"
                ? "LED Yellow"
                : key === "led_red"
                  ? "LED Red"
                  : "Buzzer";
      return {
        key,
        label,
        ok: verdict === true,
        headline: verdict === true ? "Working" : verdict === false ? "Not working" : prompt,
        details:
          verdict == null
            ? "It stays on until you tap Done or X. Tap Yes if it works, or No if it does not."
            : verdict
              ? "Marked working."
              : "Marked not working.",
      };
    }

    if (key === "lcd") {
      return {
        key,
        label: "LCD 16x2",
        ok: connected,
        headline: connected ? "Check the display" : "Not responding",
        details: connected
          ? 'The board should show "LCD IS WORKING!" until you tap Done or X.'
          : "LCD did not report as working. Check I2C wiring (SDA/SCL) and power.",
      };
    }

    // keypad
    return {
      key: "keypad",
      label: "Keypad 4x4",
      ok: connected,
      headline: "PLEASE CLICK ALL THE BUTTONS",
      details:
        "Press every key on the physical keypad randomly. The modal updates as each key is detected.",
    };
  };

  /** Map UI label → diagnostic key. */
  const diagnosticKeyForLabel = (name: string): SensorDiagnostic["key"] | null => {
    if (name === "ESP32") return "esp32";
    if (name === "DHT22 (Temp & Humidity)") return "dht22";
    if (name === "Moisture Sensor") return "moisture_sensor";
    if (name === "Door Sensor (MC38)") return "door_sensor";
    if (name === "LCD 16x2") return "lcd";
    if (name === "Keypad 4x4") return "keypad";
    if (name === "Heater") return "heater";
    if (name === "Fan") return "fan";
    if (name === "LED Green") return "led_green";
    if (name === "LED Yellow") return "led_yellow";
    if (name === "LED Red") return "led_red";
    if (name === "Buzzer") return "buzzer";
    return null;
  };

  const showOfflineAlert = () => {
    Alert.alert(
      "Cannot run diagnostic",
      !selectedMachine
        ? "Select a machine first."
        : "Machine is offline."
    );
  };

  const openDiagnosticModal = (
    title: string,
    results: SensorDiagnostic[],
    updatedAtMs: number | null
  ) => {
    setDiagModalTitle(title);
    setDiagModalResults(results);
    setDiagModalAgeSec(updatedAtMs ? Math.round((Date.now() - updatedAtMs) / 1000) : null);
    setDiagModalOpen(true);
  };

  const stopTestPolling = () => {
    if (testPollRef.current) {
      clearInterval(testPollRef.current);
      testPollRef.current = null;
    }
  };

  const closeDiagnosticModal = useCallback(() => {
    testDismissedRef.current = true;
    activeTestRunRef.current = null;
    setDiagModalOpen(false);
    stopTestPolling();
    setTestingAll(false);
    setTestingComponent(null);
    setDiagTestInProgress(false);
    setDiagIsTestAll(false);
    setMoistureTestAllResult(null);
    setKeypadTestProgress(null);
    setDiagIncludesKeypad(false);
    setDiagIncludesLcd(false);
    const mid = testMachineIdRef.current ?? selectedMachineIdRef.current;
    testMachineIdRef.current = null;
    if (mid != null && firebaseDb) {
      void clearHardwareTestCommand(firebaseDb, mid).catch((err) => {
        console.log("stop hardware test:", err);
      });
    }
  }, []);

  const answerOutput = (key: string, yes: boolean) => {
    const label =
      key === "fan"
        ? "Fan"
        : key === "heater"
          ? "Heater"
          : key === "led_green"
            ? "LED Green"
            : key === "led_yellow"
              ? "LED Yellow"
              : key === "led_red"
                ? "LED Red"
                : key === "buzzer"
                  ? "Buzzer"
                  : key;
    outputVerdictRef.current = { ...outputVerdictRef.current, [key]: yes };
    const mid = testMachineIdRef.current ?? selectedMachineIdRef.current;
    setOutputVerdicts((prev) => ({
      ...prev,
      [label]: yes,
      [key]: yes,
      ...(mid != null ? { [`${mid}:${label}`]: yes, [`${mid}:${key}`]: yes } : {}),
    }));
  };

  const runLiveSensorTest = async (
    machineId: number,
    keys: SensorDiagnostic["key"][],
    title: string,
    onStart: () => void,
    onEnd: () => void,
    opts?: { waitForKeypad?: boolean }
  ) => {
    if (!firebaseDb) {
      Alert.alert(
        "Firebase required",
        "Hardware tests need Firebase so the ESP32 can run LEDs and the buzzer."
      );
      return;
    }

    const runId = Date.now();
    activeTestRunRef.current = runId;
    testDismissedRef.current = false;
    setDiagIsTestAll(keys.length > 1);
    setDiagTestInProgress(true);
    if (keys.length > 1) {
      setMoistureTestAllResult(null);
    }
    onStart();
    const waitForKeypad = opts?.waitForKeypad === true;

    const applyDiagnosticData = (
      results: SensorDiagnostic[],
      updatedAtMs: number | null
    ) => {
      if (activeTestRunRef.current !== runId || testDismissedRef.current) return;
      setDiagModalTitle(title);
      setDiagModalResults(results);
      setDiagModalAgeSec(
        updatedAtMs != null ? Math.round((Date.now() - updatedAtMs) / 1000) : null
      );
    };

    const snapshotFromCache = () => {
      const cached = machineHwByIdRef.current[machineId];
      if (!cached || ((cached.components ?? []).length === 0 && !cached.readings)) {
        return null;
      }
      const componentsMap: Record<string, string> = {};
      (cached.components ?? []).forEach((c) => {
        if (c?.component_name) {
          componentsMap[normalizeKey(c.component_name)] = String(c.status ?? "");
        }
      });
      return {
        components: componentsMap,
        readings: (cached.readings ?? {}) as LiveReadings,
        updatedAtMs: cached.payloadMs ?? cached.receiveMs ?? null,
      };
    };

    const refreshModal = async (openAfterUpdate: boolean) => {
      if (activeTestRunRef.current !== runId || testDismissedRef.current) return;
      const snapshot = snapshotFromCache() ?? (await fetchLatestSnapshot(machineId));
      if (activeTestRunRef.current !== runId || testDismissedRef.current) return;
      const results = snapshot
        ? keys.map((k) => buildDiagnostic(k, snapshot))
        : keys.map((k) => ({
            key: k,
            label:
              k === "esp32"
                ? "ESP32"
                : k === "dht22"
                  ? "DHT22"
                  : k === "moisture_sensor"
                    ? "Moisture Sensor"
                    : k === "lcd"
                      ? "LCD 16x2"
                      : k === "keypad"
                        ? "Keypad 4x4"
                        : k === "heater"
                      ? "Heater"
                      : k === "fan"
                        ? "Fan"
                        : "Door Sensor",
            ok: false,
            headline: "Waiting for data…",
            details: "Listening for a fresh hardware heartbeat from the board.",
          }));
      applyDiagnosticData(results, snapshot?.updatedAtMs ?? null);
      if (openAfterUpdate && !testDismissedRef.current) {
        setDiagModalOpen(true);
      }
    };

    const finishTest = async () => {
      if (activeTestRunRef.current !== runId) return;
      stopTestPolling();
      if (firebaseDb) {
        void clearHardwareTestCommand(firebaseDb, machineId).catch(() => {});
      }
      if (!testDismissedRef.current) {
        await refreshModal(true);
        if (keys.includes("moisture_sensor") && keys.length > 1) {
          const snapshot = await fetchLatestSnapshot(machineId);
          if (snapshot) {
            setMoistureTestAllResult(buildDiagnostic("moisture_sensor", snapshot).ok);
          }
        }
      }
      activeTestRunRef.current = null;
      setDiagTestInProgress(false);
      onEnd();
    };

    try {
      setDiagModalOpen(true);
      await refreshModal(true);
      stopTestPolling();
      testPollRef.current = setInterval(() => {
        const snap = snapshotFromCache();
        if (!snap || activeTestRunRef.current !== runId || testDismissedRef.current) return;
        applyDiagnosticData(
          keys.map((k) => buildDiagnostic(k, snap)),
          snap.updatedAtMs
        );
        void waitForKeypad;
      }, 300);
    } catch (e) {
      console.log(e);
      await finishTest();
      Alert.alert("Test failed", e instanceof Error ? e.message : "Request failed.");
    }
  };

  const handleTestAll = async () => {
    if (isTestControlsDisabled) {
      showOfflineAlert();
      return;
    }
    const machineId = selectedMachine!.id;
    testMachineIdRef.current = machineId;
    try {
      await publishHardwareTestCommand(firebaseDb!, machineId, {
        mode: "all",
      });
    } catch (e) {
      console.log(e);
      Alert.alert("Test failed", "Could not send test command to the board.");
      return;
    }

    setDiagIncludesLcd(true);
    setDiagIncludesKeypad(true);
    setKeypadTestProgress({ keysPressed: 0, keysTotal: 16, keys: "", ok: false });

    const keys: SensorDiagnostic["key"][] = [
      "esp32",
      "dht22",
      "moisture_sensor",
      "door_sensor",
      "heater",
      "fan",
      "led_green",
      "led_yellow",
      "led_red",
      "buzzer",
      "lcd",
      "keypad",
    ];
    await runLiveSensorTest(
      machineId,
      keys,
      "Test All — stays on until Done",
      () => setTestingAll(true),
      () => setTestingAll(false),
      { waitForKeypad: true }
    );
  };

  const handleTestComponent = async (name: string) => {
    if (isTestControlsDisabled) {
      showOfflineAlert();
      return;
    }
    const key = diagnosticKeyForLabel(name);
    if (!key) {
      Alert.alert("Unsupported", `No diagnostic available for "${name}".`);
      return;
    }
    const componentKey = hardwareTestKeyForLabel(name);
    if (!componentKey) {
      Alert.alert("Unsupported", `Cannot test "${name}" from this screen.`);
      return;
    }

    const machineId = selectedMachine!.id;
    testMachineIdRef.current = machineId;
    const waitForKeypad = key === "keypad";
    try {
      await publishHardwareTestCommand(firebaseDb!, machineId, {
        mode: "component",
        component: componentKey,
      });
    } catch (e) {
      console.log(e);
      Alert.alert("Test failed", "Could not send test command to the board.");
      return;
    }

    // Individual test modal: ONLY that component — never mix LCD + keypad banners.
    if (key === "lcd") {
      setDiagIncludesLcd(true);
      setDiagIncludesKeypad(false);
      setKeypadTestProgress(null);
    } else if (key === "keypad") {
      setDiagIncludesLcd(false);
      setDiagIncludesKeypad(true);
      setKeypadTestProgress({ keysPressed: 0, keysTotal: 16, keys: "", ok: false });
    } else {
      setDiagIncludesLcd(false);
      setDiagIncludesKeypad(false);
      setKeypadTestProgress(null);
    }

    const title =
      key === "lcd"
        ? "Testing LCD"
        : key === "keypad"
          ? "Testing Keypad — press every button"
          : `Testing ${name}`;

    await runLiveSensorTest(
      machineId,
      [key],
      title,
      () => setTestingComponent(name),
      () => setTestingComponent(null),
      { waitForKeypad }
    );
  };

  /**
   * Detect powered microcontrollers.
   * New boards come from a live `discovery/{MAC}` beacon.
   * Saved boards that are actually heartbeating stay in the list with
   * alreadyExists set, and cannot be saved again.
   * A stale row, a shared name, or an old numeric id is not a detection.
   */
  const handleDetectMicrocontrollers = async () => {
    type DetectedRow = {
      id: string;
      name: string;
      device_id?: string;
      /** Hardware MAC of the physical board (from RTDB discovery/{MAC}). */
      mac?: string;
      last_seen: string | null;
      status: MachineOnlineStatus;
      alreadyExists: boolean;
    };

    const known = machinesRef.current;
    const savedMacs = new Set<string>();
    const savedIds = new Set<string>();
    for (const m of known) {
      if (Number(m.id) > 0) savedIds.add(String(m.id));
      const mac = macIdentity(m.mac) ?? macIdentity(m.device_id);
      if (mac) savedMacs.add(mac);
    }

    const savedByMac = (macKey: string | null): Machine | undefined => {
      if (!macKey) return undefined;
      return known.find((m) => (macIdentity(m.mac) ?? macIdentity(m.device_id)) === macKey);
    };

    // Same physical board only. A new MAC is a new microcontroller even when
    // the chip still remembers an old numeric id.
    const savedMachineForBoard = (
      macKey: string | null,
      deviceId?: string
    ): Machine | undefined => {
      const byMac = savedByMac(macKey);
      if (byMac) return byMac;
      const dev = String(deviceId ?? "").trim().toLowerCase();
      if (!dev || macIdentity(dev)) return undefined;
      return known.find((m) => {
        const savedMac = macIdentity(m.mac) ?? macIdentity(m.device_id);
        if (macKey && savedMac && savedMac !== macKey) return false;
        return String(m.device_id ?? "").trim().toLowerCase() === dev;
      });
    };

    const merged = new Map<string, DetectedRow>();
    const upsert = (row: DetectedRow) => {
      const macKey = macIdentity(row.mac) ?? macIdentity(row.device_id);
      const match = savedMachineForBoard(macKey, row.device_id);
      if (match && macKey) merged.delete(`saved:${match.id}`);
      const key = macKey || (match ? `saved:${match.id}` : Number(row.id) > 0 ? `saved:${row.id}` : "");
      if (!key) return;
      const alreadyExists = row.alreadyExists || Boolean(match);
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, {
          ...row,
          id: match ? String(match.id) : row.id,
          name: match?.name || row.name,
          device_id: row.device_id || match?.device_id,
          mac: row.mac || match?.mac || undefined,
          alreadyExists,
        });
        return;
      }
      const prevMs = parsePresenceMs(prev.last_seen) ?? 0;
      const curMs = parsePresenceMs(row.last_seen) ?? 0;
      const winner = curMs >= prevMs ? row : prev;
      merged.set(key, {
        ...winner,
        id: match ? String(match.id) : winner.id,
        name: match?.name || winner.name,
        device_id: winner.device_id || prev.device_id || row.device_id || match?.device_id,
        mac: winner.mac || prev.mac || row.mac || match?.mac || undefined,
        alreadyExists: prev.alreadyExists || alreadyExists,
      });
    };

    if (firebaseDb && !discoveryCacheRef.current.ready) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        discoveryWaitersRef.current.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }

    // Read discovery itself. The listener cache can still be empty on the
    // first tap, which dropped a board that was already advertising.
    if (firebaseDb) {
      try {
        const snap = await Promise.race([
          dbGet(dbRef(firebaseDb, "discovery")),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 6000)),
        ]);
        if (snap && typeof snap.val === "function") {
          const raw = snap.val();
          if (raw && typeof raw === "object") {
            const prev = discoveryCacheRef.current;
            const prevFp = { ...prev.prevFp };
            const movedAt = { ...prev.movedAt };
            const seenAt = Date.now();
            for (const [key, node] of Object.entries(raw as Record<string, unknown>)) {
              const obj =
                node && typeof node === "object" ? (node as Record<string, unknown>) : null;
              if (!obj) continue;
              const fp = discoveryFingerprint(obj);
              const before = prevFp[key];
              const beaconMs = discoveryBeaconMs(obj);
              const beaconAge = beaconMs == null ? null : seenAt - beaconMs;
              const beaconFresh =
                beaconAge != null && beaconAge >= -300_000 && beaconAge <= LIVE_HEARTBEAT_MS;
              if (beaconFresh || (before != null && before !== fp)) {
                movedAt[key] = seenAt;
              }
              prevFp[key] = fp;
            }
            discoveryCacheRef.current = {
              val: raw as Record<string, unknown>,
              ready: true,
              prevFp,
              movedAt,
            };
          }
        }
      } catch (e) {
        console.log("discovery get:", e);
      }
    }

    const nowMs = Date.now();

    // Saved boards use the same heartbeat as the Online card. Offline stays off this list.
    for (const m of known) {
      const payloadMs =
        machineRtdbPayloadRef.current[m.id] ?? machineHwByIdRef.current[m.id]?.payloadMs;
      const receiveMs = machineRtdbReceiveRef.current[m.id] ?? null;
      if (!isFirebaseHeartbeatLive(payloadMs, nowMs, receiveMs)) continue;
      const seen = payloadMs ?? receiveMs ?? nowMs;
      upsert({
        id: String(m.id),
        name: m.name,
        device_id: m.device_id,
        mac: m.mac || undefined,
        last_seen: new Date(seen).toISOString(),
        status: "online",
        alreadyExists: true,
      });
    }

    const discovery = discoveryCacheRef.current;
    if (discovery.val) {
      for (const [macSafe, node] of Object.entries(discovery.val)) {
        const obj = node && typeof node === "object" ? (node as Record<string, unknown>) : null;
        if (!obj) continue;
        const macFromNode = String(obj.mac ?? "").trim();
        const macKey = macIdentity(macFromNode) ?? macIdentity(macSafe);
        if (!macKey) continue;
        const updatedMs = discoveryBeaconMs(obj);
        const movedAt = discovery.movedAt[macSafe] ?? discovery.movedAt[macKey] ?? null;
        if (!beaconIsLive(updatedMs, movedAt, nowMs)) continue;
        const seen = updatedMs ?? movedAt ?? nowMs;
        const dev = String(obj.device_id ?? obj.name ?? "").trim();
        const macText = macIdentity(macFromNode)
          ? macFromNode
          : macWithColonsFromKey(macKey);
        const saved = savedMachineForBoard(macKey, dev);
        upsert({
          id: saved ? String(saved.id) : macText,
          name: String(obj.name ?? obj.device_id ?? `Board ${macKey.slice(-4)}`),
          device_id: dev || undefined,
          mac: macText,
          last_seen: new Date(seen).toISOString(),
          status: "online",
          alreadyExists: Boolean(saved),
        });
      }
    }

    try {
      const res = await Promise.race([
        apiRequest("/machines/detect", { method: "POST" }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 8000)),
      ]);
      if (res) {
        asJsonArray<{
          id: string | number;
          name: string;
          device_id?: string;
          mac?: string;
          last_seen?: string | null;
          recent?: boolean;
          already_exists?: boolean;
        }>(res.data).forEach((d) => {
          if (d.recent !== true) return;
          const seenMs = beaconUpdatedMs(d.last_seen);
          if (seenMs != null && !beaconIsLive(seenMs, null, Date.now())) return;
          const macKey = macIdentity(d.mac) ?? macIdentity(d.device_id) ?? macIdentity(d.id);
          const saved = savedMachineForBoard(macKey, d.device_id);
          if (!macKey && savedIds.has(String(d.id))) {
            const idNum = Number(d.id);
            const payloadMs =
              machineRtdbPayloadRef.current[idNum] ??
              machineHwByIdRef.current[idNum]?.payloadMs;
            const receiveMs = machineRtdbReceiveRef.current[idNum] ?? null;
            if (firebaseDb && !isFirebaseHeartbeatLive(payloadMs, Date.now(), receiveMs)) return;
          }
          const apiExists = d.already_exists === true;
          upsert({
            id: saved ? String(saved.id) : macKey ? macWithColonsFromKey(macKey) : String(d.id),
            name: d.name,
            device_id: d.device_id,
            mac: d.mac || (macKey ? macWithColonsFromKey(macKey) : undefined),
            last_seen: new Date(seenMs ?? Date.now()).toISOString(),
            status: "online",
            alreadyExists: apiExists || Boolean(saved) || (!macKey && savedIds.has(String(d.id))),
          });
        });
      }
    } catch (e) {
      console.log("/machines/detect failed (ignored):", e);
    }

    return Array.from(merged.values()).sort((a, b) => {
      if (a.alreadyExists !== b.alreadyExists) return a.alreadyExists ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  };

  /** Refresh machine names from API; online/offline comes from Firebase when configured. */
  const refreshMachinesPresence = async () => {
    try {
      const res = await apiRequest("/machines");
      const list = asJsonArray<Machine>(res.data).map(normalizeMachineRow);
      const withPresence = list.map((m) => {
        if (!firebaseDb) return m;
        const payloadMs =
          machineRtdbPayloadRef.current[m.id] ??
          machineHwByIdRef.current[m.id]?.payloadMs;
        const live = isFirebaseHeartbeatLive(
          payloadMs,
          Date.now(),
          machineRtdbReceiveRef.current[m.id] ?? null
        );
        return machineRowWithLivePresence(m, payloadMs, payloadMs, live);
      });
      setMachines(withPresence);
      const sid = selectedMachineIdRef.current;
      setSelectedMachine((prev) => {
        if (!sid) return prev;
        const row = withPresence.find((m) => m.id === sid);
        if (!row) return prev;
        return row;
      });
    } catch (e) {
      console.log("refreshMachinesPresence:", e);
    }
  };

  const handleSaveMachine = async (
    machineName: string,
    selected: {
      id: string;
      name: string;
      device_id?: string;
      mac?: string;
      alreadyExists?: boolean;
    } | null
  ) => {
    try {
      const typedName = machineName.trim();
      if (!selected?.id) {
        Alert.alert(
          "Select a board",
          "Detect and tap your microcontroller first."
        );
        return;
      }

      if (selected.alreadyExists) {
        Alert.alert(
          "Already exists",
          "This microcontroller is already saved. Only a new microcontroller can be added."
        );
        return;
      }

      const deviceId = String(selected.device_id ?? "").trim();
      const mac = String(selected.mac ?? selected.id ?? "").trim();
      const macKey = macIdentity(mac) ?? macIdentity(selected.id) ?? macIdentity(deviceId);

      if (!deviceId && !macKey) {
        Alert.alert("Missing hardware ID", "Could not read MAC/device_id from the detected board.");
        return;
      }

      const linkedRow = machines.find((m) => {
        const savedMac = macIdentity(m.mac) ?? macIdentity(m.device_id);
        if (macKey && savedMac && macKey === savedMac) return true;
        const savedDev = String(m.device_id ?? "").trim().toLowerCase();
        return Boolean(deviceId && savedDev && deviceId.toLowerCase() === savedDev);
      });
      if (linkedRow) {
        Alert.alert(
          "Already exists",
          `${linkedRow.name} is already saved. Only a new microcontroller can be added.`
        );
        return;
      }

      // If user typed a new friendly name, don't treat it as a duplicate "machine row".
      const dupByDisplay =
        typedName &&
        machines.some(
          (m) => normalizeKey(String(m.display_name ?? m.name)) === normalizeKey(typedName)
        );

      if (dupByDisplay) {
        Alert.alert("Name already used", "Pick a different machine name.");
        return;
      }

      const saveBody: Record<string, unknown> = {
        name: typedName || null,
        device_id: deviceId || macWithColonsFromKey(macKey ?? ""),
        mac: macKey ? macWithColonsFromKey(macKey) : mac || undefined,
      };

      const res = await apiRequest("/machines", {
        method: "POST",
        body: JSON.stringify(saveBody),
      });

      const respData =
        (res && typeof res === "object" && (res as Record<string, unknown>).data) || res;
      const respObj = (respData && typeof respData === "object" ? respData : {}) as Record<
        string,
        unknown
      >;
      const assignedId =
        Number(respObj.id) ||
        Number(respObj.microcontroller_id) ||
        Number((respObj.machine as Record<string, unknown> | undefined)?.id) ||
        0;

      if (firebaseDb && macKey && assignedId > 0) {
        try {
          await ensureEspAssignment(firebaseDb, assignedId, macKey, {
            name: typedName || selected.name,
            deviceId: String(saveBody.device_id ?? ""),
          });
        } catch (e) {
          console.log("Failed to write assignments/{MAC} (board may not auto-adopt id):", e);
        }
      }

      await loadMachines();
      void refreshStoreMachines();
      setModalVisible(false);
      Alert.alert(
        "Saved",
        mac
          ? `${typedName || selected.name} saved. The board will adopt id ${
              assignedId || "—"
            } within ~3s.`
          : `${typedName || selected.name} saved.`
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save microcontroller.";
      Alert.alert("Save failed", message);
    }
  };

  const removeMachine = async (machine: Machine) => {
    try {
      await apiRequest(`/machines/${machine.id}`, { method: "DELETE" });
      const remaining = machines.filter((row) => row.id !== machine.id);
      setMachines(remaining);
      if (selectedMachineIdRef.current === machine.id) {
        const next = remaining[0] ?? null;
        if (next) {
          selectMachine(next);
        } else {
          userPickedMachineRef.current = true;
          setSelectedMachine(null);
          selectedMachineIdRef.current = null;
          await clearSelectedMachineId();
        }
      }
      await loadMachines();
      void refreshStoreMachines();
    } catch (e) {
      Alert.alert(
        "Could not remove machine",
        e instanceof Error ? e.message : "Request failed."
      );
    }
  };

  const confirmRemoveMachine = (machine: Machine) => {
    Alert.alert("Remove machine", "Do you want to remove this machine?", [
      { text: "No", style: "cancel" },
      {
        text: "Yes",
        style: "destructive",
        onPress: () => void removeMachine(machine),
      },
    ]);
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Hardware Status</Text>

        {apiError ? (
          <View style={styles.errorBanner}>
            <Text style={styles.errorBannerText}>{apiError}</Text>
            <Text style={styles.errorHint}>
              Check API URL in config, phone Wi‑Fi, and that Laravel is running. ESP must
              POST /api/hardware/esp32/status with the same device_id as the saved row, or
              include microcontroller_id (the id from the app) so last_seen updates that row.
            </Text>
          </View>
        ) : null}

        {/* MACHINE CARDS */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {machines.map((m) => {
            const liveCard = machineCardAppearsLive(m);
            return (
            <TouchableOpacity
              key={m.id}
              style={[
                styles.machineCard,
                liveCard && styles.online,
                !liveCard && styles.offline,
              ]}
              onPress={() => confirmRemoveMachine(m)}
            >
              <Text style={styles.machineTitle}>{m.name}</Text>
              <Text style={styles.machineStatusLine}>
                {liveCard ? "● Online" : "● Offline"}
              </Text>
            </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={styles.addCard}
            onPress={() => setModalVisible(true)}
          >
            <Icon name="plus" size={24} color="#1f4e6c" />
            <Text style={styles.addMachineText}>Add Machine</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* MACHINE DROPDOWN */}
        <MachineDropdown
          active={active}
          machines={machines.map((m) => ({
            id: m.id,
            name: m.name,
            status: m.status,
          }))}
          selectedId={selectedMachine?.id ?? null}
          loading={false}
          onSelect={(id) => {
            const m = machines.find((row) => row.id === id);
            if (!m) return;
            selectMachine(m);
            void loadComponents(id);
          }}
          style={styles.machineDropdown}
        />

        {/* COMPONENTS */}
        <View style={styles.componentsCard}>
          <View style={styles.header}>
            <Text style={styles.sectionTitle}>
              Hardware Components Status
            </Text>

            <TouchableOpacity
              style={[styles.testAll, isTestControlsDisabled && styles.disabledBtn]}
              onPress={handleTestAll}
              disabled={isTestControlsDisabled}
            >
              <Text style={styles.testAllText}>
                {testingAll ? "Testing..." : "Test All"}
              </Text>
            </TouchableOpacity>
          </View>

          {DEFAULT_COMPONENTS.map((name) => {
            const status = getComponentStatus(name);
            const iconName =
              HARDWARE_ICON_BY_LABEL[name] ?? "cube-outline";
            const iconColor = !selectedMachine
              ? "#9ca3af"
              : statusColorForComponent(name, status);

            return (
              <View key={name} style={styles.componentRow}>
                <View style={styles.left}>
                  <View style={styles.iconWrap}>
                    <MaterialCommunityIcons
                      name={iconName}
                      size={22}
                      color={iconColor}
                    />
                  </View>

                  <View style={styles.textContainer}>
                    <Text style={styles.componentName} numberOfLines={3}>
                      {name}
                    </Text>
                    {testingAll && name === "Moisture Sensor" ? (
                      <View style={styles.moistureTestSubRow}>
                        <ActivityIndicator size="small" color="#1f4e6c" />
                        <Text style={styles.subText}>
                          Touch the probe to test if it's working.
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.subText}>
                        {!selectedMachine
                          ? "Select a machine"
                          : !testingAll &&
                              moistureTestAllResult != null &&
                              name === "Moisture Sensor"
                            ? moistureTestAllResult
                              ? "Working"
                              : "Not working"
                            : statusLabel(name)}
                      </Text>
                    )}
                  </View>
                </View>

                <View style={styles.right}>
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: statusColorForComponent(name, status) },
                    ]}
                  >
                    <Text style={styles.badgeText}>
                      {statusLabel(name)}
                    </Text>
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.playBtn,
                      isTestControlsDisabled && styles.disabledBtn,
                    ]}
                    onPress={() => handleTestComponent(name)}
                    disabled={isTestControlsDisabled}
                  >
                    {testingComponent === name ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Icon name="play" size={12} color="#fff" />
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>

      {/* MODAL */}
      <HardwareStatusModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        onSave={handleSaveMachine}
        onDetect={handleDetectMicrocontrollers}
      />

      <DiagnosticResultsModal
        visible={diagModalOpen}
        title={diagModalTitle}
        results={diagModalResults}
        ageSec={diagModalAgeSec}
        machineName={selectedMachine?.name ?? null}
        testInProgress={diagTestInProgress}
        isTestAll={diagIsTestAll}
        includesLcd={diagIncludesLcd}
        includesKeypad={diagIncludesKeypad}
        keypadProgress={keypadTestProgress}
        outputVerdicts={outputVerdicts}
        onOutputAnswer={answerOutput}
        onClose={closeDiagnosticModal}
      />
    </SafeAreaView>
  );
}

/**
 * Pretty modal that renders one card per sensor diagnostic with:
 *  - color-coded header (green pass / red fail / amber needs-calibration)
 *  - icon for the sensor
 *  - headline + multi-line details
 *  - a footer with snapshot age and a Done button
 */
function DiagnosticResultsModal({
  visible,
  title,
  results,
  ageSec,
  machineName,
  testInProgress,
  isTestAll,
  includesLcd,
  includesKeypad,
  keypadProgress,
  outputVerdicts,
  onOutputAnswer,
  onClose,
}: {
  visible: boolean;
  title: string;
  results: SensorDiagnostic[];
  ageSec: number | null;
  machineName: string | null;
  testInProgress: boolean;
  isTestAll: boolean;
  includesLcd: boolean;
  includesKeypad: boolean;
  keypadProgress: KeypadTestProgress | null;
  outputVerdicts: Record<string, boolean>;
  onOutputAnswer: (key: string, yes: boolean) => void;
  onClose: () => void;
}) {
  const summary = (() => {
    if (results.length === 0) return null;
    const countable = results.filter((r) => {
      if (OUTPUT_CONFIRM_KEYS.has(r.key)) return outputVerdicts[r.key] !== undefined;
      return !(isTestAll && testInProgress && r.key === "moisture_sensor");
    });
    const passes = countable.filter((r) => {
      if (OUTPUT_CONFIRM_KEYS.has(r.key)) return outputVerdicts[r.key] === true;
      if (r.key === "keypad" && keypadProgress) return keypadProgress.ok;
      return r.ok;
    }).length;
    const fails = countable.length - passes;
    return { passes, fails, total: countable.length };
  })();

  const iconForKey = (k: SensorDiagnostic["key"]):
    React.ComponentProps<typeof MaterialCommunityIcons>["name"] => {
    switch (k) {
      case "esp32": return "chip";
      case "dht22": return "thermometer";
      case "moisture_sensor": return "water-percent";
      case "door_sensor": return "door";
      case "lcd": return "monitor";
      case "keypad": return "dialpad";
      case "heater": return "radiator";
      case "fan": return "fan";
      case "led_green":
      case "led_yellow":
      case "led_red":
        return "lightbulb-on-outline";
      case "buzzer": return "bell";
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Outer wrapper centers the card; pointerEvents:'box-none' so taps on the dim
          area pass through to the absolute-positioned backdrop Pressable behind. */}
      <View style={diagStyles.root} pointerEvents="box-none">
        <Pressable
          style={diagStyles.backdrop}
          onPress={testInProgress ? undefined : onClose}
        />

        {/* Card is a plain View — NOT a Pressable — so the inner ScrollView keeps
            ownership of vertical drag gestures and actually scrolls. */}
        <View style={diagStyles.card}>
          {/* Header */}
          <View style={diagStyles.header}>
            <View style={{ flex: 1 }}>
              <Text style={diagStyles.title}>{title}</Text>
              {machineName ? (
                <Text style={diagStyles.subtitle}>{machineName}</Text>
              ) : null}
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10} style={diagStyles.closeBtn}>
              <Icon name="close" size={16} color="#475569" />
            </TouchableOpacity>
          </View>

          {includesKeypad ? (
            <View style={diagStyles.keypadBanner}>
              <MaterialCommunityIcons name="dialpad" size={22} color="#1f4e6c" />
              <View style={{ flex: 1 }}>
                <Text style={diagStyles.keypadBannerTitle}>
                  PLEASE CLICK ALL THE BUTTONS
                </Text>
                <Text style={diagStyles.keypadBannerSub}>
                  Press every key on the machine
                  {keypadProgress
                    ? ` · ${keypadProgress.keysPressed}/${keypadProgress.keysTotal}`
                    : ""}
                </Text>
              </View>
              {testInProgress && includesKeypad ? (
                <ActivityIndicator size="small" color="#1f4e6c" />
              ) : null}
            </View>
          ) : null}

          {includesLcd && !includesKeypad && testInProgress ? (
            <View style={diagStyles.lcdBanner}>
              <MaterialCommunityIcons name="monitor" size={20} color="#0f766e" />
              <Text style={diagStyles.lcdBannerText}>
                Check the machine LCD — it should show "LCD IS WORKING!"
              </Text>
            </View>
          ) : null}

          {/* Summary chips (only when running Test All) */}
          {summary && summary.total > 1 ? (
            <View style={diagStyles.summaryRow}>
              <View style={[diagStyles.chip, { backgroundColor: "#dcfce7" }]}>
                <Icon name="check" size={11} color="#15803d" />
                <Text style={[diagStyles.chipText, { color: "#15803d" }]}>
                  {summary.passes} Passed
                </Text>
              </View>
              {summary.fails > 0 ? (
                <View style={[diagStyles.chip, { backgroundColor: "#fee2e2" }]}>
                  <Icon name="times" size={11} color="#b91c1c" />
                  <Text style={[diagStyles.chipText, { color: "#b91c1c" }]}>
                    {summary.fails} Failed
                  </Text>
                </View>
              ) : null}
              {ageSec != null ? (
                <View style={[diagStyles.chip, { backgroundColor: "#e0f2fe" }]}>
                  <Icon name="clock-o" size={11} color="#075985" />
                  <Text style={[diagStyles.chipText, { color: "#075985" }]}>
                    {ageSec}s ago
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Body */}
          <ScrollView
            style={diagStyles.body}
            contentContainerStyle={diagStyles.bodyContent}
            showsVerticalScrollIndicator
            bounces
          >
            {results.map((r) => {
              if (OUTPUT_CONFIRM_KEYS.has(r.key)) {
                const answered = outputVerdicts[r.key];
                const accent =
                  answered === true ? "#22c55e" : answered === false ? "#ef4444" : "#d97706";
                const tint =
                  answered === true ? "#f0fdf4" : answered === false ? "#fef2f2" : "#fffbeb";
                return (
                  <View key={r.key} style={[diagStyles.resultCard, { borderLeftColor: accent }]}>
                    <View style={diagStyles.resultHeader}>
                      <View style={[diagStyles.resultIcon, { backgroundColor: tint }]}>
                        <MaterialCommunityIcons
                          name={iconForKey(r.key)}
                          size={20}
                          color={accent}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={diagStyles.resultLabel}>{r.label}</Text>
                        <Text style={[diagStyles.resultHeadline, { color: accent }]}>
                          {answered === true
                            ? "Working"
                            : answered === false
                              ? "Not working"
                              : r.headline}
                        </Text>
                      </View>
                      <View style={[diagStyles.resultBadge, { backgroundColor: accent }]}>
                        <Text style={diagStyles.resultBadgeText}>
                          {answered === true ? "YES" : answered === false ? "NO" : "CHECK"}
                        </Text>
                      </View>
                    </View>
                    <Text style={diagStyles.detailLine}>{r.details}</Text>
                    <View style={diagStyles.answerRow}>
                      <TouchableOpacity
                        style={[diagStyles.yesBtn, answered === true && diagStyles.answerOn]}
                        onPress={() => onOutputAnswer(r.key, true)}
                      >
                        <Text style={diagStyles.answerBtnText}>Yes</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[diagStyles.noBtn, answered === false && diagStyles.answerOn]}
                        onPress={() => onOutputAnswer(r.key, false)}
                      >
                        <Text style={diagStyles.answerBtnText}>No</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              }

              const moisturePending =
                isTestAll && testInProgress && r.key === "moisture_sensor";

              if (moisturePending) {
                return (
                  <View
                    key={r.key}
                    style={[diagStyles.resultCard, { borderLeftColor: "#64748b" }]}
                  >
                    <View style={diagStyles.resultHeader}>
                      <View
                        style={[diagStyles.resultIcon, { backgroundColor: "#f1f5f9" }]}
                      >
                        <MaterialCommunityIcons
                          name={iconForKey(r.key)}
                          size={20}
                          color="#64748b"
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={diagStyles.resultLabel}>{r.label}</Text>
                        <Text style={[diagStyles.resultHeadline, { color: "#475569" }]}>
                          Testing…
                        </Text>
                      </View>
                      <ActivityIndicator size="small" color="#1f4e6c" />
                    </View>
                    <View style={diagStyles.detailsBlock}>
                      <Text style={diagStyles.probeTestSubtext}>
                        Touch the probe to test if it's working.
                      </Text>
                    </View>
                  </View>
                );
              }

              if (r.key === "keypad") {
                const pressed = keypadProgress?.keysPressed ?? 0;
                const total = keypadProgress?.keysTotal ?? 16;
                const keypadOk = keypadProgress?.ok ?? pressed >= total;
                const accent = keypadOk ? "#22c55e" : testInProgress ? "#0ea5e9" : "#ef4444";
                const tint = keypadOk ? "#f0fdf4" : testInProgress ? "#f0f9ff" : "#fef2f2";
                const headlineColor = keypadOk
                  ? "#15803d"
                  : testInProgress
                    ? "#0369a1"
                    : "#b91c1c";
                return (
                  <View key={r.key} style={[diagStyles.resultCard, { borderLeftColor: accent }]}>
                    <View style={diagStyles.resultHeader}>
                      <View style={[diagStyles.resultIcon, { backgroundColor: tint }]}>
                        <MaterialCommunityIcons
                          name={iconForKey(r.key)}
                          size={20}
                          color={accent}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={diagStyles.resultLabel}>{r.label}</Text>
                        <Text style={[diagStyles.resultHeadline, { color: headlineColor }]}>
                          PLEASE CLICK ALL THE BUTTONS
                        </Text>
                      </View>
                      <View style={[diagStyles.resultBadge, { backgroundColor: accent }]}>
                        <Text style={diagStyles.resultBadgeText}>
                          {testInProgress && !keypadOk
                            ? `${pressed}/${total}`
                            : keypadOk
                              ? "PASS"
                              : "FAIL"}
                        </Text>
                      </View>
                    </View>
                    <View style={diagStyles.detailsBlock}>
                      <Text style={diagStyles.detailLine}>
                        {testInProgress
                          ? `Detected ${pressed} of ${total} keys. Keep pressing randomly until all buttons register.`
                          : keypadOk
                            ? `All ${total} keys responded.`
                            : `Only ${pressed} of ${total} keys were detected. Check the keypad wiring.`}
                      </Text>
                    </View>
                  </View>
                );
              }

              if (r.key === "lcd") {
                const accent = r.ok ? "#22c55e" : "#ef4444";
                const tint = r.ok ? "#f0fdf4" : "#fef2f2";
                const headlineColor = r.ok ? "#15803d" : "#b91c1c";
                return (
                  <View key={r.key} style={[diagStyles.resultCard, { borderLeftColor: accent }]}>
                    <View style={diagStyles.resultHeader}>
                      <View style={[diagStyles.resultIcon, { backgroundColor: tint }]}>
                        <MaterialCommunityIcons
                          name={iconForKey(r.key)}
                          size={20}
                          color={accent}
                        />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={diagStyles.resultLabel}>{r.label}</Text>
                        <Text style={[diagStyles.resultHeadline, { color: headlineColor }]}>
                          {testInProgress
                            ? "LCD IS WORKING! (until Done)"
                            : r.ok
                              ? "LCD IS WORKING!"
                              : "Not Working"}
                        </Text>
                      </View>
                      <View style={[diagStyles.resultBadge, { backgroundColor: accent }]}>
                        <Text style={diagStyles.resultBadgeText}>
                          {r.ok ? "PASS" : "FAIL"}
                        </Text>
                      </View>
                    </View>
                    <View style={diagStyles.detailsBlock}>
                      <Text style={diagStyles.detailLine}>
                        {r.details ||
                          'Look at the machine display for "LCD IS WORKING!" Tap Done or X to stop.'}
                      </Text>
                    </View>
                  </View>
                );
              }

              const isMoistureTestAllDone =
                isTestAll && !testInProgress && r.key === "moisture_sensor";
              const accent = r.ok ? "#22c55e" : "#ef4444";
              const tint = r.ok ? "#f0fdf4" : "#fef2f2";
              const headlineColor = r.ok ? "#15803d" : "#b91c1c";
              const displayHeadline = isMoistureTestAllDone
                ? r.ok
                  ? "Working"
                  : "Not working"
                : r.headline;

              return (
                <View key={r.key} style={[diagStyles.resultCard, { borderLeftColor: accent }]}>
                  <View style={diagStyles.resultHeader}>
                    <View style={[diagStyles.resultIcon, { backgroundColor: tint }]}>
                      <MaterialCommunityIcons
                        name={iconForKey(r.key)}
                        size={20}
                        color={accent}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={diagStyles.resultLabel}>{r.label}</Text>
                      <Text style={[diagStyles.resultHeadline, { color: headlineColor }]}>
                        {displayHeadline}
                      </Text>
                    </View>
                    <View style={[diagStyles.resultBadge, { backgroundColor: accent }]}>
                      <Text style={diagStyles.resultBadgeText}>
                        {r.ok ? "PASS" : "FAIL"}
                      </Text>
                    </View>
                  </View>

                  {r.details ? (
                    <View style={diagStyles.detailsBlock}>
                      {r.details.split("\n").map((line, i) =>
                        line.trim() === "" ? (
                          <View key={i} style={{ height: 6 }} />
                        ) : (
                          <Text key={i} style={diagStyles.detailLine}>
                            {line}
                          </Text>
                        )
                      )}
                    </View>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>

          {/* Footer */}
          <View style={diagStyles.footer}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity style={diagStyles.doneBtn} onPress={onClose}>
              <Text style={diagStyles.doneBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f4f6f8" },
  scroll: { paddingHorizontal: 15 },

  title: {
    ...userTypography.pageTitle,
    marginTop: 20,
    marginBottom: 20,
  },

  errorBanner: {
    backgroundColor: "#fef2f2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
  },
  errorBannerText: { color: "#b91c1c", ...userTypography.bodyStrong },
  errorHint: { color: "#7f1d1d", ...userTypography.caption, marginTop: 6 },

  infoBanner: {
    backgroundColor: "#eff6ff",
    borderWidth: 1,
    borderColor: "#bfdbfe",
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
  },
  infoBannerTitle: { color: "#1e3a8a", ...userTypography.cardTitle, marginBottom: 6 },
  infoBannerText: { color: "#1e40af", ...userTypography.tableCell, lineHeight: 18 },
  infoBannerMeta: { color: "#3730a3", ...userTypography.caption, marginTop: 8 },

  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  machineCard: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 10,
    marginRight: 10,
  },

  online: { borderTopWidth: 3, borderColor: "#22c55e" },
  offline: { borderTopWidth: 3, borderColor: "#ef4444" },

  machineTitle: { ...userTypography.bodyStrong },

  machineStatusLine: {
    marginTop: 6,
    ...userTypography.caption,
  },

  addMachineText: {
    marginTop: 6,
    ...userTypography.bodyStrong,
    textAlign: "center",
  },

  addCard: {
    borderWidth: 2,
    borderStyle: "dashed",
    padding: 20,
    justifyContent: "center",
    alignItems: "center",
  },

  machineDropdown: {
    marginTop: 15,
    marginBottom: 4,
  },

  componentsCard: {
    marginTop: 15,
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 10,
  },

  textContainer: {
    flex: 1,
    marginLeft: 10,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  sectionTitle: { ...userTypography.cardTitle, marginBottom: 10, marginTop: 20 },

  testAll: {
    backgroundColor: "#1f4e6c",
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 5,
    marginTop: 15,
    alignSelf: "flex-start",
  },

  testAllText: {
    color: "#fff",
    ...userTypography.bodyStrong,
  },

  componentRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },

  left: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1, // 👈 takes remaining space ONLY
  },

  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
    justifyContent: "center",
  },

  componentName: {
    ...userTypography.bodyStrong,
    flexShrink: 1,
  },

  subText: {
    ...userTypography.caption,
    color: "#6b7280",
  },

  moistureTestSubRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
    flexShrink: 1,
  },

  right: {
    flexDirection: "row",
    alignItems: "center",
    marginLeft: 12,
    justifyContent: "flex-end",
  },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    minWidth: 50, // 👈 keeps space from button
    alignItems: "center",
    marginRight: 14,
  },

  badgeText: {
    color: "#fff",
    ...userTypography.caption,
    fontWeight: "700",
  },

  playBtn: {
    backgroundColor: "#22c55e",
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
  },

  disabledBtn: {
    opacity: 0.5,
  },
});

const diagStyles = StyleSheet.create({
  // Centers the card. pointerEvents:'box-none' on this view (set inline) lets touches
  // outside the card hit the absolute-positioned backdrop Pressable underneath.
  root: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },

  // Full-screen dim layer that catches taps in the empty area to close the modal.
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
  },

  // Card uses a fixed height so the inner ScrollView gets a bounded parent height
  // (required for `flex: 1` on a child ScrollView to actually be scrollable). 70%
  // of the screen is comfortable on phones; switch to a fixed dp if you want it
  // identical across screens.
  card: {
    width: "100%",
    maxWidth: 480,
    height: "70%",
    backgroundColor: "#fff",
    borderRadius: 18,
    paddingHorizontal: 18,
    paddingVertical: 16,
    flexDirection: "column",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowOffset: { width: 0, height: 12 },
    shadowRadius: 24,
    elevation: 12,
  },

  // flex:1 + minHeight:0 lets the ScrollView shrink within a flex parent on RN.
  // Without minHeight:0, native Android sometimes refuses to scroll because the
  // body would try to expand to fit all children.
  body: {
    flex: 1,
    minHeight: 0,
  },

  bodyContent: {
    paddingBottom: 8,
  },

  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },

  title: {
    ...userTypography.cardTitle,
    color: "#0f172a",
    fontSize: 18,
  },

  subtitle: {
    ...userTypography.caption,
    color: "#64748b",
    marginTop: 2,
  },

  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },

  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 12,
  },

  keypadBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "#e8f1f7",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },

  keypadBannerTitle: {
    ...userTypography.caption,
    fontWeight: "800",
    color: "#1f4e6c",
    letterSpacing: 0.2,
  },

  keypadBannerSub: {
    ...userTypography.caption,
    color: "#475569",
    marginTop: 2,
  },

  lcdBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#ecfdf5",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
  },

  lcdBannerText: {
    ...userTypography.caption,
    color: "#0f766e",
    flex: 1,
    fontWeight: "600",
  },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },

  chipText: {
    ...userTypography.caption,
    fontWeight: "700",
  },

  resultCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderLeftWidth: 4,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },

  resultHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  resultIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },

  resultLabel: {
    ...userTypography.bodyStrong,
    color: "#0f172a",
  },

  resultHeadline: {
    ...userTypography.caption,
    fontWeight: "700",
    marginTop: 2,
  },

  resultBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },

  resultBadgeText: {
    color: "#fff",
    ...userTypography.caption,
    fontWeight: "800",
    letterSpacing: 0.5,
  },

  detailsBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },

  detailLine: {
    ...userTypography.caption,
    color: "#334155",
    lineHeight: 18,
  },

  probeTestSubtext: {
    ...userTypography.body,
    color: "#475569",
    lineHeight: 20,
    textAlign: "center",
  },

  footer: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 12,
  },

  footerNote: {
    flex: 1,
    ...userTypography.caption,
    color: "#64748b",
  },

  answerRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  yesBtn: {
    flex: 1,
    backgroundColor: "#15803d",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  noBtn: {
    flex: 1,
    backgroundColor: "#b91c1c",
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: "center",
  },
  answerOn: {
    opacity: 1,
  },
  answerBtnText: {
    color: "#fff",
    ...userTypography.bodyStrong,
  },
  doneBtn: {
    backgroundColor: "#0f172a",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 10,
  },

  doneBtnText: {
    color: "#fff",
    ...userTypography.bodyStrong,
  },
});