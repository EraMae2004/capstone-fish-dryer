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
import { API_BASE_URL } from "@/config/api";
import HardwareStatusModal from "./hardware-status-modal";
import { onValue, ref as dbRef, get as dbGet, type DataSnapshot } from "firebase/database";
import { firebaseDb } from "@/config/firebase";
import { parsePresenceMs } from "@/lib/parse-presence-ms";
import { resolveMoisturePercent } from "@/lib/duration-format";
import { ensureEspAssignment } from "@/lib/ensure-esp-assignment";
import {
  computeStableOnlineByMachineId,
  hardwareStatusBelongsToMachine,
  ingestRtdbHardwareSnapshot,
  isMachineDetectable,
  isMachineLive,
  isMachineOnlineForUi,
  isRtdbPayloadFresh,
  normalizeHardwareMacKey,
  recordMachineRtdbDelivery,
} from "@/lib/machine-presence";
import { moistureSensorDisplayColor, moistureSensorDisplayLabel } from "@/lib/hardware-status-rtdb";
import {
  clearHardwareTestCommand,
  HARDWARE_TEST_ALL_MS,
  HARDWARE_TEST_ONE_MS,
  hardwareTestKeyForLabel,
  publishHardwareTestCommand,
} from "@/lib/hardware-test-command";
import { userTypography } from "@/lib/user-typography";
import {
  formatDoorSensorDisplay,
  doorSensorDisplayColorHardware,
  doorSensorDisplayTitle,
  isDoorSensorUiLabel,
} from "@/lib/door-sensor-display";
import MachineDropdown from "./machine-dropdown";
import { getSelectedMachineId, setSelectedMachineId } from "@/lib/selected-machine";

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
const PRESENCE_UI_TICK_MS = 500;

/** MCU offline ⇒ every component reads not_working (no stale "working" ghosts). */
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
  return normalizeHardwareMacKey(m.mac) ?? normalizeHardwareMacKey(m.device_id);
}

function macWithColonsFromKey(macKey: string): string {
  return macKey.match(/.{1,2}/g)?.join(":") ?? macKey;
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
];

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
  "Moisture Sensor": "scale-balance",
  "DHT22 (Temp & Humidity)": "thermometer",
  "LED 1": "lightbulb-on-outline",
  "LED 2": "lightbulb-on-outline",
  "LED 3": "lightbulb-on-outline",
};

/** Sensor diagnostic payload built from latest RTDB heartbeat. Used by Test buttons. */
type SensorDiagnostic = {
  key: "esp32" | "dht22" | "moisture_sensor" | "door_sensor";
  label: string;
  ok: boolean;
  /** Short headline shown in alert/title row. */
  headline: string;
  /** Multi-line body shown under headline. */
  details: string;
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

export default function HardwareStatus() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  /** Per-machine RTDB hardware — keyed by Laravel/Firebase machine id. */
  const [machineHwById, setMachineHwById] = useState<Record<number, MachineHardwareSnapshot>>({});
  const machineHwByIdRef = useRef<Record<number, MachineHardwareSnapshot>>({});

  const [loading, setLoading] = useState(true);
  const [testingAll, setTestingAll] = useState(false);
  const [testingComponent, setTestingComponent] = useState<string | null>(null);
  const testPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** User closed the diagnostic modal — do not reopen until the next test starts. */
  const testDismissedRef = useRef(false);
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

  const [modalVisible, setModalVisible] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

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
    selectedMachineIdRef.current = selectedMachine?.id ?? null;
  }, [selectedMachine?.id]);

  const machineIdsKey = useMemo(
    () => machines.map((m) => m.id).join(","),
    [machines]
  );

  useEffect(() => {
    machinesRef.current = machines;
  }, [machines]);

  const selectedHw =
    selectedMachine != null ? machineHwById[selectedMachine.id] : undefined;
  const components = selectedHw?.components ?? [];
  const liveReadings = selectedHw?.readings ?? null;
  const hardwareRtdbLastReceiveMs =
    selectedMachine != null
      ? machineRtdbReceiveMs[selectedMachine.id] ?? selectedHw?.receiveMs ?? null
      : null;
  const hardwareRtdbPayloadAtMs =
    selectedMachine != null
      ? machineRtdbPayloadMs[selectedMachine.id] ?? selectedHw?.payloadMs ?? null
      : null;

  useEffect(() => {
    loadMachines();
  }, []);

  /** RTDB does not push when the ESP stops; re-render periodically so "recent" expires → offline. */
  useEffect(() => {
    if (!firebaseDb) return;
    const id = setInterval(() => setPresenceTick((n) => n + 1), PRESENCE_UI_TICK_MS);
    return () => clearInterval(id);
  }, [firebaseDb]);

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

  // Per-machine RTDB listeners — every live heartbeat refreshes receiveMs (no parent-scan flicker).
  useEffect(() => {
    if (!firebaseDb || !machineIdsKey) {
      return;
    }
    const db = firebaseDb;

    const ids = machineIdsKey
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((id) => Number.isFinite(id));

    const unsubs = ids.map((id) => {
      const path = `machines/${id}/hardware_status`;
      return onValue(dbRef(db, path), (snap: DataSnapshot) => {
        const val = snap.val();
        if (!val || typeof val !== "object") return;
        const hwRec = val as Record<string, unknown>;
        const row = machinesRef.current.find((r) => r.id === id);
        if (!hardwareStatusBelongsToMachine(id, hwRec, machineMacForRow(row))) {
          return;
        }

        const now = Date.now();
        const parsed = parseHardwareStatusFromRtdb(hwRec);
        const bumped = recordMachineRtdbDelivery(
          machineRtdbReceiveRef.current,
          machineRtdbPayloadRef.current,
          id,
          hwRec.updated_at,
          machineRtdbSeenCallbackRef.current,
          now
        );
        if (!bumped.accepted) return;

        machineRtdbReceiveRef.current = bumped.receiveById;
        machineRtdbPayloadRef.current = bumped.payloadById;
        machineHwByIdRef.current = {
          ...machineHwByIdRef.current,
          [id]: {
            components: parsed.components,
            readings: parsed.readings,
            receiveMs: bumped.receiveById[id] ?? now,
            payloadMs: bumped.payloadById[id] ?? parsed.payloadMs ?? now,
          },
        };

        setMachineRtdbReceiveMs({ ...machineRtdbReceiveRef.current });
        setMachineRtdbPayloadMs({ ...machineRtdbPayloadRef.current });
        setMachineHwById({ ...machineHwByIdRef.current });
      });
    });

    return () => {
      for (const id of ids) {
        delete machineRtdbSeenCallbackRef.current[id];
      }
      unsubs.forEach((u) => u());
    };
  }, [firebaseDb, machineIdsKey]);

  useEffect(() => {
    const interval = setInterval(() => {
      void refreshMachinesPresence();
    }, MACHINE_PRESENCE_POLL_MS);

    return () => clearInterval(interval);
  }, []);

  const normalizeKey = (value: string) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .trim();

  const displayToKeys: Record<string, string[]> = {
    ESP32: ["esp32", "esp32_controller"],
    Buzzer: ["buzzer"],
    "Door Sensor (MC38)": ["door_sensor", "door", "mc38", "reed_switch", "reed", "magnetic_switch"],
    "Heater 1": ["heater_1"],
    "Heater 2": ["heater_2"],
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
    "LED 1": ["led_1", "led_drying", "led1"],
    "LED 2": ["led_2", "led_pause", "led2"],
    "LED 3": ["led_3", "led_stop", "led3"],
  };

  const apiRequest = async (endpoint: string, options: RequestInit = {}) => {
    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
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

  /**
   * Read `machines/` from Firebase RTDB and synthesize a machine list — used as a
   * fallback when Laravel `/machines` is unreachable so the user can still see
   * the live hardware status. Considers a machine "online" if its hardware_status
   * was written within RTDB_HEARTBEAT_STALE_MS.
   */
  const loadMachinesFromFirebase = async (): Promise<Machine[]> => {
    if (!firebaseDb) return [];
    try {
      const snap = await dbGet(dbRef(firebaseDb, "machines"));
      const val = snap.val();
      if (!val || typeof val !== "object") return [];

      const rows: Machine[] = Object.entries(val as Record<string, unknown>)
        .map(([rawId, node]) => {
          const id = Number(rawId);
          if (!Number.isFinite(id)) return null;
          const obj = (node && typeof node === "object" ? node : {}) as Record<string, unknown>;
          const hw = (obj.hardware_status && typeof obj.hardware_status === "object"
            ? obj.hardware_status
            : {}) as Record<string, unknown>;
          const ing = ingestRtdbHardwareSnapshot(hw.updated_at);
          return {
            id,
            name: (obj.name as string) || `Machine ${id}`,
            device_id: (obj.device_id as string) || undefined,
            status: ing.acceptDelivery ? "online" : "offline",
            last_seen: ing.payloadMs != null ? new Date(ing.payloadMs).toISOString() : null,
          } as Machine;
        })
        .filter((m): m is Machine => m !== null);

      return rows;
    } catch (e) {
      console.log("Firebase machine fallback failed:", e);
      return [];
    }
  };

  const loadMachines = async (): Promise<Machine[]> => {
    setApiError(null);
    let list: Machine[] = [];
    let usedFallback = false;

    try {
      const res = await apiRequest("/machines");
      list = asJsonArray<Machine>(res.data).map(normalizeMachineRow);
    } catch (e) {
      console.log("/machines failed, falling back to Firebase:", e);
      list = await loadMachinesFromFirebase();
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

  const selectedMachineOnline = isMachineOnlineForUi({
    firebaseConfigured: Boolean(firebaseDb),
    rtdbLastReceiveMs: hardwareRtdbLastReceiveMs,
    machine: selectedMachine,
    stableOnline: hardwareStableOnline,
  });

  const hardwareStreamFresh = selectedMachineOnline;

  const machineCardAppearsLive = (m: Machine) => {
    if (!firebaseDb) return isMachineLive(m);
    return stableOnlineById[m.id] ?? false;
  };

  const getComponentStatus = (name: string) => {
    const aliases = displayToKeys[name] ?? [normalizeKey(name)];
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
    const s = normalizeStatusWord(getComponentStatus(name));
    if (name === "Moisture Sensor") {
      return moistureSensorDisplayLabel(getComponentStatus(name));
    }
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
        headline: connected ? "Online" : "Not responding",
        details: connected
          ? "WiFi healthy, heap OK, no recent crash."
          : "Self-check failed (low heap, WiFi loss, or recent reset). Check power and Wi-Fi.",
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
      if (!connected) {
        return {
          key,
          label: "Moisture Sensor",
          ok: false,
          headline: "Not connected",
          details: "Probe is not responding on GPIO34. Check probe leads and ADC supply.",
        };
      }
      const pct = resolveMoisturePercent(r as Record<string, unknown>);
      const calibrated = r.moisture_calibrated === true;
      const span = typeof r.moisture_span === "number" ? r.moisture_span : null;

      const lines: string[] = [];
      if (pct != null) {
        lines.push(`Moisture: ${Math.round(pct)}%`);
      } else {
        lines.push("Waiting for moisture reading from the board…");
      }
      if (!calibrated && span != null && span < 800) {
        lines.push("");
        lines.push(
          "Tip: touch the probe with a wet finger or dip in water briefly — readings will track 0% (dry) to 100% (wet)."
        );
      }

      return {
        key,
        label: "Moisture Sensor",
        ok: pct != null,
        headline:
          pct != null
            ? `Connected · ${Math.round(pct)}% moisture`
            : "Connected · waiting for %",
        details: lines.join("\n") || "Connected.",
      };
    }

    // door_sensor
    if (!connected) {
      return {
        key,
        label: "Door Sensor (MC38)",
        ok: false,
        headline: "Not Working",
        details: "Sensor is not responding on GPIO16. Check wiring and the door magnet.",
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
  };

  /** Map UI label → diagnostic key. */
  const diagnosticKeyForLabel = (name: string): SensorDiagnostic["key"] | null => {
    if (name === "ESP32") return "esp32";
    if (name === "DHT22 (Temp & Humidity)") return "dht22";
    if (name === "Moisture Sensor") return "moisture_sensor";
    if (name === "Door Sensor (MC38)") return "door_sensor";
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
    const mid = selectedMachineIdRef.current;
    if (mid != null && firebaseDb) {
      void clearHardwareTestCommand(firebaseDb, mid).catch(() => {});
    }
  }, []);

  const runLiveSensorTest = async (
    machineId: number,
    keys: SensorDiagnostic["key"][],
    title: string,
    durationMs: number,
    onStart: () => void,
    onEnd: () => void,
    opts?: { deferModalUntilEnd?: boolean }
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
    const endAt = Date.now() + durationMs;

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

    const refreshModal = async (openAfterUpdate: boolean) => {
      if (activeTestRunRef.current !== runId || testDismissedRef.current) return;
      const snapshot = await fetchLatestSnapshot(machineId);
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
        void refreshModal(false);
        if (Date.now() >= endAt) {
          void finishTest();
        }
      }, 1000);
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
    try {
      await publishHardwareTestCommand(firebaseDb!, machineId, {
        mode: "all",
        durationMs: HARDWARE_TEST_ALL_MS,
      });
    } catch (e) {
      console.log(e);
      Alert.alert("Test failed", "Could not send test command to the board.");
      return;
    }

    const keys: SensorDiagnostic["key"][] = [
      "esp32",
      "dht22",
      "moisture_sensor",
      "door_sensor",
    ];
    await runLiveSensorTest(
      machineId,
      keys,
      "Test All (10s)",
      HARDWARE_TEST_ALL_MS,
      () => setTestingAll(true),
      () => setTestingAll(false)
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
    try {
      await publishHardwareTestCommand(firebaseDb!, machineId, {
        mode: "component",
        component: componentKey,
        durationMs: HARDWARE_TEST_ONE_MS,
      });
    } catch (e) {
      console.log(e);
      Alert.alert("Test failed", "Could not send test command to the board.");
      return;
    }

    await runLiveSensorTest(
      machineId,
      [key],
      `Testing ${name}`,
      HARDWARE_TEST_ONE_MS,
      () => setTestingComponent(name),
      () => setTestingComponent(null)
    );
  };

  /**
   * Detect microcontrollers from THREE sources, merged by id/device_id:
   *   1. Firebase RTDB `discovery/` — every alive ESP32 advertises here regardless of Laravel ID.
   *   2. Firebase RTDB `machines/{id}/hardware_status` — already-claimed boards still pulsing.
   *   3. Laravel `/machines/detect` — server view (works only when Laravel reachable).
   * Detection is *not* gated on Laravel; if the API is down but the board is publishing,
   * the user can still see and add it.
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
    };

    // Key by MAC when we have one (uniquely identifies the physical ESP32). Fall back
    // to laravel id / device_id only for legacy rows that never advertised a MAC.
    const merged = new Map<string, DetectedRow>();
    const upsert = (row: DetectedRow) => {
      const key = (row.mac || row.device_id || row.id || row.name || "")
        .toLowerCase()
        .replace(/:/g, "")
        .trim();
      if (!key) return;
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, row);
        return;
      }
      const prevMs = parsePresenceMs(prev.last_seen) ?? 0;
      const curMs = parsePresenceMs(row.last_seen) ?? 0;
      // Always carry forward the MAC if either side has it.
      const winner = curMs >= prevMs ? row : prev;
      merged.set(key, { ...winner, mac: winner.mac || prev.mac || row.mac });
    };

    // (1) Firebase discovery — boards advertise even before Laravel knows about them.
    if (firebaseDb) {
      try {
        const snap = await dbGet(dbRef(firebaseDb, "discovery"));
        const val = snap.val();
        if (val && typeof val === "object") {
          for (const [macSafe, node] of Object.entries(val as Record<string, unknown>)) {
            const obj = node && typeof node === "object" ? (node as Record<string, unknown>) : null;
            if (!obj) continue;
            const assignedRaw = obj.assigned;
            const assigned =
              assignedRaw === true ||
              assignedRaw === 1 ||
              String(assignedRaw).toLowerCase() === "true";
            const mcId = Number(obj.microcontroller_id ?? obj.id ?? 0);
            // Claimed boards live under machines/{id}/ — ignore stale discovery rows.
            if (assigned || (Number.isFinite(mcId) && mcId > 0)) continue;
            const disc = ingestRtdbHardwareSnapshot(obj.updated_at);
            if (!disc.acceptDelivery || disc.payloadMs == null) continue;
            if (!isRtdbPayloadFresh(disc.payloadMs)) continue;
            const id = String(obj.microcontroller_id ?? obj.id ?? "0");
            const macFromNode = String(obj.mac ?? "");
            const mac = macFromNode || macSafe.match(/.{1,2}/g)?.join(":") || "";
            const macKey = normalizeHardwareMacKey(mac);
            if (macKey && machinesRef.current.some((m) => normalizeHardwareMacKey(m.mac) === macKey)) {
              continue;
            }
            const dev = String(obj.device_id ?? obj.name ?? mac);
            const name = String(obj.name ?? obj.device_id ?? `Board ${mac || id}`);
            upsert({
              id: Number(id) > 0 ? id : mac, // unassigned boards key by MAC, not 0
              name,
              device_id: dev || undefined,
              mac: mac || undefined,
              last_seen: new Date(disc.payloadMs).toISOString(),
              status: "online",
            });
          }
        }
      } catch (e) {
        console.log("discovery/ read failed:", e);
      }

      // (2) Already-publishing machines/{id}/hardware_status still alive.
      try {
        const known = machinesRef.current;
        const snap = await dbGet(dbRef(firebaseDb, "machines"));
        const val = snap.val();
        if (val && typeof val === "object") {
          for (const [rawId, node] of Object.entries(val as Record<string, unknown>)) {
            const obj = node && typeof node === "object" ? (node as Record<string, unknown>) : null;
            if (!obj) continue;
            const hw = obj.hardware_status && typeof obj.hardware_status === "object"
              ? (obj.hardware_status as Record<string, unknown>)
              : null;
            if (!hw) continue;
            const snapIng = ingestRtdbHardwareSnapshot(hw.updated_at);
            if (!snapIng.acceptDelivery || snapIng.payloadMs == null) continue;
            if (!isRtdbPayloadFresh(snapIng.payloadMs)) continue;
            const hwMacRaw = String(hw.mac ?? obj.mac ?? "").trim();
            const hwMacKey = normalizeHardwareMacKey(hwMacRaw);
            if (!hwMacKey) continue;
            const alreadyOwned = known.some(
              (m) => normalizeHardwareMacKey(m.mac) === hwMacKey
            );
            if (alreadyOwned) continue;
            // Unassigned board publishing hardware_status — offer for add-by-MAC only.
            upsert({
              id: hwMacKey,
              name: String(hw.name ?? obj.name ?? `Board ${hwMacKey.slice(-4)}`),
              device_id: String(hw.device_id ?? obj.device_id ?? hwMacRaw) || undefined,
              mac: hwMacRaw || macWithColonsFromKey(hwMacKey),
              last_seen: new Date(snapIng.payloadMs).toISOString(),
              status: "online",
            });
          }
        }
      } catch (e) {
        console.log("machines/ read failed:", e);
      }
    }

    // (3) Laravel — best-effort augmentation; errors are tolerated.
    try {
      const res = await apiRequest("/machines/detect", { method: "POST" });
      asJsonArray<{
        id: string | number;
        name: string;
        device_id?: string;
        mac?: string;
        last_seen?: string | null;
        recent?: boolean;
        status?: string;
      }>(res.data).forEach((d) => {
        const row: DetectedRow = {
          id: String(d.id),
          name: d.name,
          device_id: d.device_id,
          mac: d.mac,
          last_seen: d.last_seen ?? null,
          status: machineStatusFromApi(d.status ?? (d.recent ? "online" : "offline")),
        };
        if (d.recent === true && isMachineDetectable({ last_seen: row.last_seen, status: row.status })) {
          upsert(row);
        }
      });
    } catch (e) {
      console.log("/machines/detect failed (ignored):", e);
    }

    return Array.from(merged.values()).filter((row) =>
      isMachineDetectable({ last_seen: row.last_seen, status: row.status })
    );
  };

  /** Refresh machine names from API; online/offline comes from Firebase when configured. */
  const refreshMachinesPresence = async () => {
    try {
      const res = await apiRequest("/machines");
      const list = asJsonArray<Machine>(res.data).map(normalizeMachineRow);
      const receiveMap = machineRtdbReceiveRef.current;
      const stableMap = stableOnlineByIdRef.current;
      const withPresence = list.map((m) => {
        if (!firebaseDb) return m;
        const live = stableMap[m.id] ?? false;
        return machineRowWithLivePresence(m, receiveMap[m.id], undefined, live);
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
    selected: { id: string; name: string; device_id?: string; mac?: string } | null
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

      const deviceId = String(selected.device_id ?? "").trim();
      const mac = String(selected.mac ?? selected.id ?? "").trim();
      const macKey = normalizeHardwareMacKey(mac) ?? normalizeHardwareMacKey(selected.id);

      if (!deviceId && !macKey) {
        Alert.alert("Missing hardware ID", "Could not read MAC/device_id from the detected board.");
        return;
      }

      // If this physical MAC is already in the DB, update that row. Otherwise always mint a new id
      // (never reuse machines/1 from detection when board 2 was wrongly publishing there).
      const linkedRow = macKey
        ? machines.find((m) => normalizeHardwareMacKey(m.mac) === macKey)
        : undefined;

      // If user typed a new friendly name, don't treat it as a duplicate "machine row".
      const dupByDisplay =
        typedName &&
        machines.some(
          (m) =>
            m.id !== linkedRow?.id &&
            normalizeKey(String(m.display_name ?? m.name)) === normalizeKey(typedName)
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
      if (linkedRow) {
        saveBody.selected_id = linkedRow.id;
      }

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
        linkedRow?.id ||
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
              onPress={() => {
                selectMachine(m);
                void loadComponents(m.id);
              }}
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
              : isDoorSensorUiLabel(name)
                ? statusColorForComponent(name, status)
                : status === "working"
                  ? "#22c55e"
                  : status === "not_working"
                    ? "#ef4444"
                    : status === "warning"
                      ? "#f59e0b"
                      : "#9ca3af";

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
  onClose,
}: {
  visible: boolean;
  title: string;
  results: SensorDiagnostic[];
  ageSec: number | null;
  machineName: string | null;
  testInProgress: boolean;
  isTestAll: boolean;
  onClose: () => void;
}) {
  const summary = (() => {
    if (results.length === 0) return null;
    const countable = results.filter(
      (r) => !(isTestAll && testInProgress && r.key === "moisture_sensor")
    );
    const passes = countable.filter((r) => r.ok).length;
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
        <Pressable style={diagStyles.backdrop} onPress={onClose} />

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
            {summary && summary.total === 1 && ageSec != null ? (
              <Text style={diagStyles.footerNote}>Readings age: {ageSec}s</Text>
            ) : (
              <View style={{ flex: 1 }} />
            )}
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