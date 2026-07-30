import { parsePresenceMs } from "@/lib/parse-presence-ms";
import { parseRtdbSensorReadings, type RtdbSensorReadings } from "@/lib/rtdb-sensor-readings";

/**
 * Sensor keys under `machines/{id}/hardware_status/components` — must match ESP firmware
 * and Laravel `DryingController::firebaseSensorHardwareComponentKeys()`.
 */
export const FIREBASE_SENSOR_COMPONENT_KEYS = [
  "esp32",
  "door_sensor",
  "moisture_sensor",
  "dht22",
] as const;

export type FirebaseSensorComponentKey = (typeof FIREBASE_SENSOR_COMPONENT_KEYS)[number];

export type HardwareComponentRow = {
  component_name: string;
  status: string;
};

export type ParsedHardwareStatus = {
  components: HardwareComponentRow[];
  readings: RtdbSensorReadings | null;
  payloadMs: number | null;
};

/** Shared labels + aliases for Overview and Hardware screens. */
export const SENSOR_HARDWARE_UI: {
  key: FirebaseSensorComponentKey;
  label: string;
  aliases: string[];
}[] = [
  {
    key: "esp32",
    label: "ESP32",
    aliases: ["esp32", "esp32_controller", "esp", "mcu", "microcontroller"],
  },
  {
    key: "dht22",
    label: "DHT22 (Temp & Humidity)",
    aliases: [
      "dht22",
      "dht11",
      "dht",
      "temp_humidity_sensor",
      "temperature_and_humidity_sensor",
      "temp_sensor",
      "humidity_sensor",
    ],
  },
  {
    key: "door_sensor",
    label: "Door Sensor (MC38)",
    aliases: ["door_sensor", "door", "mc38", "reed_switch", "reed", "magnetic_switch"],
  },
  {
    key: "moisture_sensor",
    label: "Moisture Sensor",
    aliases: ["moisture_sensor", "moisture", "yl69", "yl_69", "soil_moisture"],
  },
];

const HW_STATUS_SKIP_KEYS = new Set([
  "components",
  "updated_at",
  "microcontroller_id",
  "device_id",
  "readings",
  "name",
  "mac",
]);

export function normalizeHardwareComponentKey(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .trim();
}

/** Match Laravel `coerceComponentStatus` — never guess "working" for unknown strings. */
export function coerceHardwareStatus(status: unknown): string {
  if (typeof status === "boolean") {
    return status ? "working" : "not_working";
  }
  if (typeof status === "number" && Number.isFinite(status)) {
    if (Math.abs(status) <= 0.000001) return "not_working";
    if (Math.abs(status - 1) <= 0.000001) return "working";
    return "not_working";
  }
  if (status != null && typeof status === "object") {
    return "not_working";
  }

  const value = String(status ?? "")
    .trim()
    .toLowerCase();

  switch (value) {
    case "working":
    case "ok":
    case "on":
    case "online":
    case "connected":
    case "active":
    case "true":
    case "1":
    case "yes":
    case "up":
    case "good":
    case "present":
    case "detected":
    case "pass":
    case "passed":
      return "working";
    case "warning":
    case "warn":
    case "degraded":
      return "warning";
    case "standby":
    case "idle":
      return "standby";
    case "not_working":
    case "off":
    case "false":
    case "0":
    case "no":
    case "error":
    case "fail":
    case "failed":
    case "disconnected":
    case "bad":
    case "offline":
    case "down":
    case "absent":
    case "missing":
      return "not_working";
    default:
      return value ? "not_working" : "not_working";
  }
}

function canonicalKeyFromRawName(raw: string): FirebaseSensorComponentKey | null {
  const norm = normalizeHardwareComponentKey(raw);
  for (const row of SENSOR_HARDWARE_UI) {
    if (row.key === norm) return row.key;
    if (row.aliases.some((a) => normalizeHardwareComponentKey(a) === norm)) {
      return row.key;
    }
  }
  return null;
}

/** Map API / RTDB component_name to canonical sensor key (dht22, moisture_sensor, …). */
export function canonicalHardwareSensorKey(raw: string): FirebaseSensorComponentKey | null {
  return canonicalKeyFromRawName(raw);
}

/** Flatten RTDB `components` object, legacy flat payload, or list of rows into a status map. */
export function componentsMapFromRtdbPayload(val: Record<string, unknown>): Record<string, string> {
  const raw =
    val.components && typeof val.components === "object"
      ? val.components
      : val;

  const out: Record<string, string> = {};

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const name = String(
        rec.component_name ?? rec.component ?? rec.name ?? rec.key ?? rec.id ?? ""
      ).trim();
      if (!name) continue;
      const canonical = canonicalKeyFromRawName(name);
      if (!canonical) continue;
      out[canonical] = coerceHardwareStatus(
        rec.status ?? rec.state ?? rec.value ?? rec.connected ?? rec.ok
      );
    }
    return out;
  }

  if (!raw || typeof raw !== "object") return out;

  for (const [key, status] of Object.entries(raw as Record<string, unknown>)) {
    if (HW_STATUS_SKIP_KEYS.has(key)) continue;
    const canonical = canonicalKeyFromRawName(key);
    if (!canonical) continue;
    out[canonical] = coerceHardwareStatus(status);
  }

  return out;
}

/** Always four rows in firmware order — same shape Laravel returns from `/mobile/overview`. */
export function hardwareRowsFromComponentsMap(
  map: Record<string, string>
): HardwareComponentRow[] {
  return FIREBASE_SENSOR_COMPONENT_KEYS.map((key) => ({
    component_name: key,
    status: map[key] ?? "not_working",
  }));
}

export function parseHardwareStatusFromRtdb(val: Record<string, unknown>): ParsedHardwareStatus {
  const payloadMs = parsePresenceMs(val.updated_at);
  const readings = parseRtdbSensorReadings(val.readings);
  const map = componentsMapFromRtdbPayload(val);
  return {
    components: hardwareRowsFromComponentsMap(map),
    readings,
    payloadMs,
  };
}

export function lookupComponentStatus(
  rows: HardwareComponentRow[] | null | undefined,
  keyOrLabel: string
): string {
  const aliases =
    SENSOR_HARDWARE_UI.find(
      (r) => r.label === keyOrLabel || r.key === normalizeHardwareComponentKey(keyOrLabel)
    )?.aliases ?? [keyOrLabel];

  const aliasSet = new Set(aliases.map((a) => normalizeHardwareComponentKey(a)));

  const found = (rows ?? []).find((row) =>
    aliasSet.has(normalizeHardwareComponentKey(String(row.component_name ?? "")))
  );

  return coerceHardwareStatus(found?.status ?? "not_working");
}

export function displayLabelsForSensorUi(): string[] {
  return SENSOR_HARDWARE_UI.map((r) => r.label);
}

/** Moisture YL-69: no probe contact = standby (not a hardware fault). */
export function moistureSensorDisplayLabel(status: unknown): string {
  const s = coerceHardwareStatus(status);
  if (s === "working") return "Working";
  if (s === "standby" || s === "idle") return "Standby";
  return "Not Working";
}

export function moistureSensorDisplayColor(status: unknown): string {
  const s = coerceHardwareStatus(status);
  if (s === "working") return "#22c55e";
  if (s === "standby" || s === "idle") return "#95a5a6";
  return "#ef4444";
}

/** True when YL-69 probe is in contact (working), not idle standby. */
export function isMoistureProbeWorking(
  liveReadings: Record<string, unknown> | null | undefined,
  componentStatus?: unknown
): boolean {
  if (liveReadings && typeof liveReadings === "object") {
    if (liveReadings.moisture_connected === false) return false;
    if (liveReadings.moisture_connected === true) return true;
  }
  return coerceHardwareStatus(componentStatus) === "working";
}

export function aliasesForDisplayLabel(label: string): string[] {
  const row = SENSOR_HARDWARE_UI.find((r) => r.label === label);
  return row ? [row.key, ...row.aliases] : [normalizeHardwareComponentKey(label)];
}
