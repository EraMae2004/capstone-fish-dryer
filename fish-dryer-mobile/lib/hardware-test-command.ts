import { ref as dbRef, set as dbSet } from "firebase/database";
import type { Database } from "firebase/database";

export const HARDWARE_TEST_ALL_MS = 10_000;
export const HARDWARE_TEST_ONE_MS = 8_000;

export type HardwareTestMode = "all" | "component";

export type HardwareTestComponentKey =
  | "esp32"
  | "dht22"
  | "moisture_sensor"
  | "door_sensor"
  | "led_1"
  | "led_2"
  | "led_3"
  | "buzzer";

export type HardwareTestCommand = {
  mode: HardwareTestMode;
  component: string;
  duration_ms: number;
  request_id: string;
  issued_at: string;
  /** Fan level 1–3 during test (Test All uses max by default). */
  fan_speed?: number;
};

/** UI label → RTDB / firmware component key. */
export function hardwareTestKeyForLabel(label: string): HardwareTestComponentKey | null {
  const map: Record<string, HardwareTestComponentKey> = {
    ESP32: "esp32",
    "DHT22 (Temp & Humidity)": "dht22",
    "Moisture Sensor": "moisture_sensor",
    "Door Sensor (MC38)": "door_sensor",
    "LED 1": "led_1",
    "LED 2": "led_2",
    "LED 3": "led_3",
    Buzzer: "buzzer",
  };
  return map[label] ?? null;
}

export async function publishHardwareTestCommand(
  db: Database,
  machineId: number,
  opts: {
    mode: HardwareTestMode;
    component?: HardwareTestComponentKey | string;
    durationMs?: number;
    fanSpeed?: number;
  }
): Promise<HardwareTestCommand> {
  const fs = Number(opts.fanSpeed);
  const cmd: HardwareTestCommand = {
    mode: opts.mode,
    component: opts.mode === "component" ? String(opts.component ?? "") : "",
    duration_ms:
      opts.durationMs ??
      (opts.mode === "all" ? HARDWARE_TEST_ALL_MS : HARDWARE_TEST_ONE_MS),
    request_id: `test-${machineId}-${Date.now()}`,
    issued_at: new Date().toISOString(),
    fan_speed:
      Number.isFinite(fs) && fs >= 1 && fs <= 3 ? fs : opts.mode === "all" ? 3 : 2,
  };
  await dbSet(dbRef(db, `machines/${machineId}/test_command`), cmd);
  return cmd;
}

export async function clearHardwareTestCommand(db: Database, machineId: number): Promise<void> {
  await dbSet(dbRef(db, `machines/${machineId}/test_command`), null);
}
