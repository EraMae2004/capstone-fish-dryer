/**
 * Parse RTDB/API heartbeat timestamps: ISO strings, Firebase epoch-ms numbers,
 * or unix seconds (some writers store seconds — normalize to ms).
 */
export function parsePresenceMs(iso: unknown): number | null {
  if (iso == null || iso === "") return null;
  if (typeof iso === "number" && Number.isFinite(iso)) {
    const ms = iso > 0 && iso < 1e12 ? iso * 1000 : iso;
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof iso === "string" && /^-?\d+(\.\d+)?$/.test(iso.trim())) {
    const n = Number(iso);
    if (!Number.isFinite(n)) return null;
    const ms = n > 0 && n < 1e12 ? n * 1000 : n;
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof iso === "object") {
    if (iso && ".sv" in (iso as object)) return Date.now();
    return null;
  }
  const d = new Date(String(iso));
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}
