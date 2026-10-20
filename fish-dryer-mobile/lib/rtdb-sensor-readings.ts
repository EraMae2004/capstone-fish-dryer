/**
 * Normalize Firebase `hardware_status.readings` (numbers may arrive as strings).
 */
export type RtdbSensorReadings = {
  temperature?: number;
  humidity?: number;
  moisture?: number;
  moisture_percent?: number;
  moisture_surface?: string;
  moisture_raw?: number;
  moisture_dry_adc?: number;
  moisture_wet_adc?: number;
  moisture_span?: number;
  moisture_calibrated?: boolean;
  moisture_connected?: boolean;
  moisture_spread?: number;
  door?: string;
  door_raw?: number;
  door_spread?: number;
  lcd_addr?: number;
  keypad_seen?: boolean;
};

function readNum(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function parseRtdbSensorReadings(raw: unknown): RtdbSensorReadings | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const out: RtdbSensorReadings = {};
  const t = readNum(r.temperature);
  const h = readNum(r.humidity);
  const m = readNum(r.moisture);
  const mp = readNum(r.moisture_percent);
  const mr = readNum(r.moisture_raw);
  const dry = readNum(r.moisture_dry_adc);
  const wet = readNum(r.moisture_wet_adc);
  const span = readNum(r.moisture_span);
  if (t != null) out.temperature = t;
  if (h != null) out.humidity = h;
  if (m != null) out.moisture = m;
  if (mp != null) out.moisture_percent = mp;
  if (mr != null) out.moisture_raw = mr;
  if (dry != null) out.moisture_dry_adc = dry;
  if (wet != null) out.moisture_wet_adc = wet;
  if (span != null) out.moisture_span = span;
  if (typeof r.moisture_calibrated === "boolean") {
    out.moisture_calibrated = r.moisture_calibrated;
  } else if (r.moisture_calibrated === "true") {
    out.moisture_calibrated = true;
  }
  if (typeof r.moisture_connected === "boolean") {
    out.moisture_connected = r.moisture_connected;
  } else if (r.moisture_connected === "true") {
    out.moisture_connected = true;
  } else if (r.moisture_connected === "false") {
    out.moisture_connected = false;
  }
  const spread = readNum(r.moisture_spread);
  if (spread != null) out.moisture_spread = spread;
  if (typeof r.moisture_surface === "string" && r.moisture_surface.trim()) {
    out.moisture_surface = r.moisture_surface.trim().toLowerCase();
  }
  if (typeof r.door === "string") out.door = r.door;
  const doorRaw = readNum(r.door_raw);
  const doorSpread = readNum(r.door_spread);
  const lcdAddr = readNum(r.lcd_addr);
  if (doorRaw != null) out.door_raw = doorRaw;
  if (doorSpread != null) out.door_spread = doorSpread;
  if (lcdAddr != null) out.lcd_addr = lcdAddr;
  if (typeof r.keypad_seen === "boolean") out.keypad_seen = r.keypad_seen;
  else if (r.keypad_seen === "true") out.keypad_seen = true;
  else if (r.keypad_seen === "false") out.keypad_seen = false;
  return Object.keys(out).length > 0 ? out : null;
}
