/**
 * Drying duration UI: show/store as HH:MM:SS (e.g. 01:30:00). Backend still uses whole minutes.
 */

function pad2(n: number): string {
  return String(Math.max(0, Math.min(59, n))).padStart(2, "0");
}

/**
 * Convert a digits-only string (e.g. "13000") into a stopwatch-style HH:MM:SS
 * display ("01:30:00"). Right-aligned: typing fills seconds first, then minutes,
 * then hours. Non-digits in the input are stripped; only the last 6 digits count.
 */
export function formatDigitsAsHMS(digits: string): string {
  const clean = String(digits ?? "").replace(/\D/g, "").slice(-6);
  const padded = clean.padStart(6, "0");
  return `${padded.slice(0, 2)}:${padded.slice(2, 4)}:${padded.slice(4, 6)}`;
}

/** Convert digits-only HHMMSS string → whole minutes for the API (rounds nearest). Returns null if invalid. */
export function digitsToMinutes(digits: string): number | null {
  const clean = String(digits ?? "").replace(/\D/g, "").slice(-6);
  if (!clean) return null;
  const padded = clean.padStart(6, "0");
  const h = parseInt(padded.slice(0, 2), 10);
  const m = parseInt(padded.slice(2, 4), 10);
  const s = parseInt(padded.slice(4, 6), 10);
  if (m > 59 || s > 59) return null;
  const totalSec = h * 3600 + m * 60 + s;
  const mins = Math.round(totalSec / 60);
  return mins >= 1 ? mins : null;
}

/** Whole minutes → digits string ("130000" for 13h, "013000" for 1h30m). */
export function minutesToDigits(totalMinutes: number): string {
  const m = Math.max(0, Math.round(Number(totalMinutes) || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, "0")}${pad2(mm)}00`;
}

/** Total seconds → "HH:MM:SS" (used by the live countdown). */
export function formatSecondsAsHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${String(h).padStart(2, "0")}:${pad2(m)}:${pad2(ss)}`;
}

/** Whole minutes → `HH:MM:SS` (seconds always 00 unless we add sub-minute later). */
export function formatMinutesAsHMS(totalMinutes: number): string {
  const m = Math.max(0, Math.round(Number(totalMinutes)));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const hh = String(h).padStart(2, "0");
  return `${hh}:${pad2(mm)}:00`;
}

/**
 * Accepts:
 * - Plain integer string → minutes (legacy), e.g. "90"
 * - `h:mm:ss` or `h:mm` with 0–59 for mm/ss
 */
export function parseHMSToMinutes(input: string): number | null {
  const s = String(input ?? "").trim();
  if (!s) return null;

  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }

  const parts = s.split(":").map((p) => p.trim()).filter(Boolean);
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;

  let h = 0;
  let mm = 0;
  let ss = 0;
  if (nums.length === 3) {
    [h, mm, ss] = nums;
  } else if (nums.length === 2) {
    [h, mm] = nums;
  } else {
    return null;
  }

  if (mm > 59 || ss > 59) return null;

  const totalSec = h * 3600 + mm * 60 + ss;
  const mins = Math.round(totalSec / 60);
  return mins >= 1 ? mins : null;
}

const YL69_DRY_ADC = 4095;
const YL69_WET_ADC = 1200;

export function resolveMoisturePercent(
  readings: Record<string, unknown> | null | undefined
): number | null {
  if (!readings || typeof readings !== "object") return null;
  const r = readings;
  if (typeof r.moisture_percent === "number" && Number.isFinite(r.moisture_percent)) {
    return Math.round(r.moisture_percent);
  }
  if (typeof r.moisture === "number" && Number.isFinite(r.moisture) && r.moisture <= 100) {
    return Math.round(r.moisture);
  }
  if (typeof r.moisture_raw === "number" && Number.isFinite(r.moisture_raw)) {
    const dry = YL69_DRY_ADC;
    const wet = YL69_WET_ADC;
    if (dry === wet) return null;
    const pct =
      dry > wet
        ? ((dry - r.moisture_raw) * 100) / (dry - wet)
        : ((r.moisture_raw - dry) * 100) / (wet - dry);
    return Math.max(0, Math.min(100, Math.round(pct)));
  }
  return null;
}

export function formatMoisturePercent(pct: number | null): string | null {
  return pct != null && Number.isFinite(pct) ? `${pct}%` : null;
}
