import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Alert,
} from "react-native";
import { FontAwesome as Icon, MaterialCommunityIcons } from "@expo/vector-icons";
import { API_BASE_URL } from "@/config/api";
import HardwareStatusModal from "./hardware-status-modal";
import { onValue, ref as dbRef, type DataSnapshot } from "firebase/database";
import { firebaseDb } from "@/config/firebase";
import { userTypography } from "./userTypography";

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
  display_name?: string | null;
  status?: MachineOnlineStatus;
  /** ISO 8601 from Laravel — used to explain offline vs "detected" row. */
  last_seen?: string | null;
};

/** Stricter than API "online" window — prevents stale DB/Firebase from looking "live". */
const LIVE_LAST_SEEN_MS = 90_000;

function parseIsoMs(iso: unknown): number | null {
  if (!iso) return null;
  const d = new Date(String(iso));
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function isMachineLive(m: Machine | null | undefined): boolean {
  if (!m) return false;
  const raw = String(m.status ?? "")
    .trim()
    .toLowerCase();
  const apiOnline = raw === "online" || raw === "true" || raw === "1";
  const lastSeenMs = parseIsoMs(m.last_seen);
  const seenRecently =
    lastSeenMs !== null ? Date.now() - lastSeenMs <= LIVE_LAST_SEEN_MS : false;
  return apiOnline && seenRecently;
}

/**
 * @param streamFresh — true when we trust the current snapshot timing:
 *   Firebase: `hardware_status.updated_at` is recent (same heartbeat that wrote RTDB).
 *   No Firebase: fall back to API `last_seen` (strict window).
 */
function effectiveComponentStatus(rawStatus: string, streamFresh: boolean): string {
  if (streamFresh) return rawStatus;
  const s = String(rawStatus ?? "").trim().toLowerCase();
  if (["working", "ok", "online", "pass", "passed", "warning", "unknown"].includes(s)) {
    return "not_working";
  }
  return rawStatus;
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
  return {
    ...m,
    id: Number.isFinite(id) ? id : m.id,
    status: machineStatusFromApi(m.status),
    last_seen: m.last_seen ?? null,
  };
}

function formatLastSeen(iso: string | null | undefined): string {
  if (!iso) return "never (no heartbeat stored yet)";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString();
}

const DEFAULT_COMPONENTS = [
  "ESP32 Controller",
  "Solar Panel",
  "Buzzer",
  "Heater Fan 1",
  "Heater Fan 2",
  "Ventilation Fan",
  "Heater 1",
  "Heater 2",
  "Moisture Sensor 1",
  "Moisture Sensor 2",
  "Temperature and Humidity Sensor",
  "LED 1",
  "LED 2",
  "LED 3",
];

/** MaterialCommunityIcons glyph names (Expo) — per hardware row. */
const HARDWARE_ICON_BY_LABEL: Record<
  string,
  React.ComponentProps<typeof MaterialCommunityIcons>["name"]
> = {
  "ESP32 Controller": "chip",
  "Solar Panel": "solar-power",
  Buzzer: "bell",
  "Heater Fan 1": "fan",
  "Heater Fan 2": "fan",
  "Ventilation Fan": "weather-windy",
  "Heater 1": "radiator",
  "Heater 2": "radiator",
  "Moisture Sensor 1": "scale-balance",
  "Moisture Sensor 2": "scale-balance",
  "Temperature and Humidity Sensor": "thermometer",
  "LED 1": "lightbulb-on-outline",
  "LED 2": "lightbulb-on-outline",
  "LED 3": "lightbulb-on-outline",
};

export default function HardwareStatus() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [components, setComponents] = useState<ComponentStatus[]>([]);

  const [loading, setLoading] = useState(true);
  const [testingAll, setTestingAll] = useState(false);
  const [testingComponent, setTestingComponent] = useState<string | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  /** Laravel writes `updated_at` on each heartbeat — use for live/stale without blocking onValue. */
  const [hardwareRtdbUpdatedAtMs, setHardwareRtdbUpdatedAtMs] = useState<number | null>(null);

  /** Avoid stale `selectedMachine` inside interval / async refresh (was resetting wrong row). */
  const selectedMachineIdRef = useRef<number | null>(null);
  useEffect(() => {
    selectedMachineIdRef.current = selectedMachine?.id ?? null;
  }, [selectedMachine?.id]);

  useEffect(() => {
    loadMachines();
  }, []);

  // Realtime Firebase subscription: mirrors latest statuses without polling delay.
  useEffect(() => {
    if (!firebaseDb) {
      setHardwareRtdbUpdatedAtMs(null);
      return;
    }
    if (!selectedMachine?.id) {
      setHardwareRtdbUpdatedAtMs(null);
      return;
    }

    setHardwareRtdbUpdatedAtMs(null);

    const r = dbRef(firebaseDb, `machines/${selectedMachine.id}/hardware_status`);
    const unsub = onValue(
      r,
      (snap: DataSnapshot) => {
        const val = snap.val();
        if (!val || typeof val !== "object") {
          setHardwareRtdbUpdatedAtMs(null);
          return;
        }

        const updatedRaw = (val as Record<string, unknown>).updated_at;
        const updatedMs = parseIsoMs(updatedRaw);
        setHardwareRtdbUpdatedAtMs(updatedMs);

        // Expect { components: { heater_1: "working", ... } } (preferred)
        // but accept { heater_1: "working", ... } too.
        const componentsMap = (val.components && typeof val.components === "object")
          ? val.components
          : val;

        if (!componentsMap || typeof componentsMap !== "object") return;

        const skip = new Set([
          "components",
          "updated_at",
          "microcontroller_id",
          "device_id",
        ]);

        const next = Object.entries(componentsMap as Record<string, unknown>)
          .filter(([k]) => !skip.has(k))
          .map(([component_name, status]) => ({
            component_name,
            status: String(status ?? "unknown"),
          }));

        if (next.length) setComponents(next);
      },
      (err: unknown) => {
        console.log("Firebase hardware_status subscribe error:", err);
      }
    );

    return () => {
      unsub();
      setHardwareRtdbUpdatedAtMs(null);
    };
  }, [selectedMachine?.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      autoDetectAndRefresh();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  const normalizeKey = (value: string) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .trim();

  const displayToKeys: Record<string, string[]> = {
    "ESP32 Controller": ["esp32", "esp32_controller"],
    "Solar Panel": ["solar_panel"],
    Buzzer: ["buzzer"],
    "Heater Fan 1": ["heater_fan_1", "fan1"],
    "Heater Fan 2": ["heater_fan_2", "fan2"],
    "Ventilation Fan": ["ventilation_fan", "fan3", "fan"],
    "Heater 1": ["heater_1"],
    "Heater 2": ["heater_2"],
    "Moisture Sensor 1": ["moisture_sensor_1", "loadcell_1", "loadcell1", "moisture_sensor"],
    "Moisture Sensor 2": ["moisture_sensor_2", "loadcell_2", "loadcell2"],
    "Temperature and Humidity Sensor": ["temp_humidity_sensor", "dht22"],
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

  const loadMachines = async (): Promise<Machine[]> => {
    try {
      setApiError(null);
      const res = await apiRequest("/machines");
      const list = asJsonArray<Machine>(res.data).map(normalizeMachineRow);

      setMachines(list);
      const sid = selectedMachineIdRef.current;
      const next =
        list.find((m: Machine) => Number(m.id) === Number(sid)) ??
        list.find((m) => isMachineLive(m)) ??
        list[0] ??
        null;
      setSelectedMachine(next);
      selectedMachineIdRef.current = next?.id ?? null;

      if (next) await loadComponents(next.id);
      return list;
    } catch (e) {
      console.log(e);
      setApiError(
        e instanceof Error ? e.message : "Cannot load machines from the API."
      );
      return [];
    } finally {
      setLoading(false);
    }
  };

  const loadComponents = async (machineId: number) => {
    try {
      const res = await apiRequest(`/machines/${machineId}/components`);
      setComponents(asJsonArray<ComponentStatus>(res.data));
    } catch (e) {
      setComponents([]);
      setApiError(
        e instanceof Error
          ? `Components (#${machineId}): ${e.message}`
          : `Components (#${machineId}): request failed.`
      );
    }
  };

  /**
   * Trust snapshot for green/red if either path is alive:
   * - Laravel `last_seen` (strict window) — works even when RTDB mirror is off / misconfigured.
   * - RTDB `updated_at` recent — instant updates when mirror is working.
   */
  const hardwareStreamFresh = (() => {
    const apiLive = isMachineLive(selectedMachine);
    const rtdbRecent =
      Boolean(firebaseDb) &&
      hardwareRtdbUpdatedAtMs !== null &&
      Date.now() - hardwareRtdbUpdatedAtMs <= LIVE_LAST_SEEN_MS;
    return apiLive || rtdbRecent;
  })();

  const getComponentStatus = (name: string) => {
    const aliases = displayToKeys[name] ?? [normalizeKey(name)];
    const found = components.find((c) => {
      if (!c?.component_name) return false;
      const key = normalizeKey(String(c.component_name));
      return aliases.some((alias) => key === normalizeKey(alias));
    });
    const raw = found?.status || "unknown";
    return effectiveComponentStatus(raw, hardwareStreamFresh);
  };

  const isMcuReachable = isMachineLive(selectedMachine);
  /** Remote tests go through the API → require strict API presence, not only cached RTDB. */
  const isTestControlsDisabled = !selectedMachine || !isMcuReachable;

  const getStatusColor = (status: string) => {
    if (status === "working") return "#22c55e";
    if (status === "not_working") return "#ef4444";
    if (status === "warning") return "#f59e0b";
    return "#9ca3af";
  };

  const statusLabel = (name: string) => {
    const s = getComponentStatus(name);
    if (s === "working") return "Working";
    if (s === "not_working") return "Not Working";
    if (s === "warning") return "Warning";
    return "Unknown";
  };

  const handleTestAll = async () => {
    if (isTestControlsDisabled) {
      Alert.alert(
        "Cannot test components",
        !selectedMachine
          ? "Select a machine first."
          : `Machine is Offline.\n\nLast server signal: ${formatLastSeen(selectedMachine.last_seen)}`
      );
      return;
    }

    try {
      setTestingAll(true);
      await apiRequest(`/machines/${selectedMachine!.id}/components/test-all`, {
        method: "POST",
      });
      await loadComponents(selectedMachine!.id);
    } catch (e) {
      console.log(e);
      Alert.alert(
        "Test failed",
        e instanceof Error ? e.message : "Request failed."
      );
    } finally {
      setTestingAll(false);
    }
  };

  const handleTestComponent = async (name: string) => {
    if (isTestControlsDisabled) {
      Alert.alert(
        "Cannot test component",
        !selectedMachine
          ? "Select a machine first."
          : `Machine is Offline.\n\nLast server signal: ${formatLastSeen(selectedMachine.last_seen)}`
      );
      return;
    }

    try {
      setTestingComponent(name);
      await apiRequest(
        `/machines/${selectedMachine!.id}/components/${encodeURIComponent(
          normalizeKey((displayToKeys[name] ?? [name])[0])
        )}/test`,
        { method: "POST" }
      );
      await loadComponents(selectedMachine!.id);
    } catch (e) {
      console.log(e);
      Alert.alert(
        "Test failed",
        e instanceof Error ? e.message : "Request failed."
      );
    } finally {
      setTestingComponent(null);
    }
  };

  const handleDetectMicrocontrollers = async () => {
    try {
      const res = await apiRequest("/machines/detect", { method: "POST" });
      type DetectedRow = {
        id: string;
        name: string;
        device_id?: string;
        last_seen: string | null;
        status: MachineOnlineStatus;
      };

      let rows: DetectedRow[] = asJsonArray<{
        id: string | number;
        name: string;
        device_id?: string;
        last_seen?: string | null;
        recent?: boolean;
        status?: string;
      }>(res.data).map((d) => ({
        id: String(d.id),
        name: d.name,
        device_id: d.device_id,
        last_seen: d.last_seen ?? null,
        status: machineStatusFromApi(d.status ?? (d.recent ? "online" : "offline")),
      }));

      // Only show boards that are *actually* signaling recently (prevents "ghost" detection).
      rows = rows.filter((r) => isMachineLive({
        id: Number(r.id),
        name: r.name,
        device_id: r.device_id,
        last_seen: r.last_seen,
        status: r.status,
      }));

      // Fallback: if detect ever returns empty, still list boards from /machines.
      if (rows.length === 0) {
        const res2 = await apiRequest("/machines");
        rows = asJsonArray<Machine>(res2.data)
          .map((m) => normalizeMachineRow(m))
          .map((m) => ({
            id: String(m.id),
            name: m.name,
            device_id: m.device_id,
            last_seen: m.last_seen ?? null,
            status: m.status,
          }))
          .filter((r) => isMachineLive({
            id: Number(r.id),
            name: r.name,
            device_id: r.device_id,
            last_seen: r.last_seen,
            status: r.status,
          }));
      }

      return rows;
    } catch (e) {
      console.log(e);
      try {
        const res2 = await apiRequest("/machines");
        return asJsonArray<Machine>(res2.data)
          .map((m) => normalizeMachineRow(m))
          .map((m) => ({
            id: String(m.id),
            name: m.name,
            device_id: m.device_id,
            last_seen: m.last_seen ?? null,
            status: m.status,
          }))
          .filter((r) => isMachineLive({
            id: Number(r.id),
            name: r.name,
            device_id: r.device_id,
            last_seen: r.last_seen,
            status: r.status,
          }));
      } catch {
        return [];
      }
    }
  };

  /** Poll `/machines` only — keeps cards + selection status in sync (no `/detect` hijack of selection). */
  const autoDetectAndRefresh = async () => {
    try {
      await loadMachines();
    } catch (e) {
      console.log(e);
    }
  };

  const handleSaveMachine = async (
    machineName: string,
    selected: { id: string; name: string; device_id?: string } | null
  ) => {
    try {
      const typedName = machineName.trim();
      if (!selected?.id) {
        Alert.alert(
          "Select a board",
          "Detect and tap your microcontroller first. Saving only updates the friendly name — it will not change the hardware ID."
        );
        return;
      }

      const selectedNumId = Number(selected.id);
      const existingById = machines.find((m) => m.id === selectedNumId) ?? null;
      const deviceId = String(selected.device_id ?? existingById?.device_id ?? "").trim();

      if (!deviceId) {
        Alert.alert("Missing hardware ID", "Could not read device_id from the detected board.");
        return;
      }

      // If user typed a new friendly name, don't treat it as a duplicate "machine row".
      const dupByDisplay =
        typedName &&
        machines.some(
          (m) =>
            m.id !== selectedNumId &&
            normalizeKey(String(m.display_name ?? m.name)) === normalizeKey(typedName)
        );

      if (dupByDisplay) {
        Alert.alert("Name already used", "Pick a different machine name.");
        return;
      }

      await apiRequest("/machines", {
        method: "POST",
        body: JSON.stringify({
          // Friendly label only (backend maps this to display_name)
          name: typedName || null,
          selected_id: selectedNumId,
          // Explicit hardware identity (never derived from the friendly name)
          device_id: deviceId,
        }),
      });

      await loadMachines();
      setModalVisible(false);
      Alert.alert("Saved", typedName ? `${typedName} saved.` : "Microcontroller saved.");
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
          {machines.map((m) => (
            <TouchableOpacity
              key={m.id}
              style={[
                styles.machineCard,
                m.status === "online" && styles.online,
                m.status === "offline" && styles.offline,
              ]}
              onPress={() => {
                setSelectedMachine(m);
                selectedMachineIdRef.current = m.id;
                void loadComponents(m.id);
              }}
            >
              <Text style={styles.machineTitle}>{m.name}</Text>
              <Text style={styles.machineStatusLine}>
                {m.status === "online" ? "● Online" : "● Offline"}
              </Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={styles.addCard}
            onPress={() => setModalVisible(true)}
          >
            <Icon name="plus" size={24} color="#1f4e6c" />
            <Text style={styles.addMachineText}>Add Machine</Text>
          </TouchableOpacity>
        </ScrollView>

        {/* DROPDOWN DISPLAY */}
        <View style={styles.dropdown}>
          <Text style={styles.dropdownValue}>
            {selectedMachine
              ? selectedMachine.name
              : "No Microcontrollers"}
          </Text>
        </View>

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
                    <Text style={styles.subText}>
                      {!selectedMachine
                        ? "Select a machine"
                        : !hardwareStreamFresh
                          ? `${statusLabel(name)} · last snapshot`
                          : statusLabel(name)}
                    </Text>
                  </View>
                </View>

                <View style={styles.right}>
                  <View
                    style={[
                      styles.badge,
                      { backgroundColor: getStatusColor(status) },
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
    </SafeAreaView>
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

  dropdown: {
    backgroundColor: "#fff",
    padding: 10,
    borderRadius: 8,
    marginTop: 15,
  },

  dropdownValue: {
    ...userTypography.body,
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