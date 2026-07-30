import { ref as dbRef, set as dbSet } from "firebase/database";
import type { Database } from "firebase/database";

export const HARDWARE_TEST_ALL_MS = 15_000;
export const HARDWARE_TEST_ONE_MS = 8_000;
export const HARDWARE_TEST_LCD_MS = 3_000;
/** Keypad has no real countdown — keep RTDB command alive until user finishes or closes. */
export const HARDWARE_TEST_KEYPAD_MS = 10 * 60_000;

export type HardwareTestMode = "all" | "component";

export type HardwareTestComponentKey =
  | "esp32"
  | "dht22"
  | "moisture_sensor"
  | "door_sensor"
  | "lcd"
  | "keypad"
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
    "LCD 16x2": "lcd",
    "Keypad 4x4": "keypad",
    "LED 1": "led_1",
    "LED 2": "led_2",
    "LED 3": "led_3",
    Buzzer: "buzzer",
  };
  return map[label] ?? null;
}

export function defaultDurationForTestComponent(
  component: HardwareTestComponentKey | string | undefined
): number {
  const c = String(component ?? "").toLowerCase();
  if (c === "lcd" || c === "lcd_16x2") return HARDWARE_TEST_LCD_MS;
  if (c === "keypad" || c === "keypad_4x4") return HARDWARE_TEST_KEYPAD_MS;
  // Other component tests still run LCD + keypad UI on the board.
  return HARDWARE_TEST_KEYPAD_MS;
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
      (opts.mode === "all"
        ? HARDWARE_TEST_KEYPAD_MS
        : defaultDurationForTestComponent(opts.component)),
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
