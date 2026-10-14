import { ref as dbRef, set as dbSet } from "firebase/database";
import type { Database } from "firebase/database";

export type HardwareTestMode = "all" | "component";

export type HardwareTestComponentKey =
  | "esp32"
  | "dht22"
  | "moisture_sensor"
  | "door_sensor"
  | "lcd"
  | "keypad"
  | "heater"
  | "fan"
  | "led_1"
  | "led_2"
  | "led_3"
  | "buzzer";

export type HardwareTestCommand = {
  mode: HardwareTestMode;
  component: string;
  request_id: string;
  issued_at: string;
  stop_on: "done";
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
    "LED Green": "led_1",
    Heater: "heater",
    Fan: "fan",
    "LED 2": "led_2",
    "LED Yellow": "led_2",
    "LED 3": "led_3",
    "LED Red": "led_3",
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
    fanSpeed?: number;
  }
): Promise<HardwareTestCommand> {
  const fs = Number(opts.fanSpeed);
  const cmd: HardwareTestCommand = {
    mode: opts.mode,
    component: opts.mode === "component" ? String(opts.component ?? "") : "",
    request_id: `test-${machineId}-${Date.now()}`,
    issued_at: new Date().toISOString(),
    stop_on: "done",
    fan_speed:
      Number.isFinite(fs) && fs >= 1 && fs <= 3 ? fs : opts.mode === "all" ? 3 : 2,
  };
  await dbSet(dbRef(db, `machines/${machineId}/test_command`), cmd);
  return cmd;
}

/** Done / X. An explicit stop is what the board waits for — a deleted node can look like a failed read. */
export async function clearHardwareTestCommand(db: Database, machineId: number): Promise<void> {
  await dbSet(dbRef(db, `machines/${machineId}/test_command`), {
    mode: "stop",
    component: "",
    request_id: `stop-${machineId}-${Date.now()}`,
    issued_at: new Date().toISOString(),
    stop_on: "done",
  });
}
