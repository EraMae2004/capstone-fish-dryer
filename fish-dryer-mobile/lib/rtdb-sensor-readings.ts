/**
 * Normalize Firebase `hardware_status.readings` (numbers may arrive as strings).
 */
export type RtdbSensorReadings = {
  temperature?: number;
  humidity?: number;
  moisture?: number;
  moisture_percent?: number;
  moisture_raw?: number;
  moisture_dry_adc?: number;
  moisture_wet_adc?: number;
  moisture_span?: number;
  moisture_calibrated?: boolean;
  moisture_connected?: boolean;
  moisture_spread?: number;
  door?: string;
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
  if (typeof r.door === "string") out.door = r.door;
  return Object.keys(out).length > 0 ? out : null;
}
