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
  const d = new Date(String(iso));
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}
