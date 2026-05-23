import { ref as dbRef, set as dbSet } from "firebase/database";
import type { Database } from "firebase/database";

/** Same key the ESP uses: `assignments/{AABBCCDDEEFF}` (no colons, uppercase). */
export function macToAssignmentKey(mac: string | null | undefined): string | null {
  const raw = String(mac ?? "").trim();
  if (!raw) return null;
  const key = raw.replace(/:/g, "").toUpperCase();
  return key.length >= 8 ? key : null;
}

/** ESP polls `assignments/{MAC}` — must match the machine id used for session/test_command. */
export async function ensureEspAssignment(
  db: Database,
  machineId: number,
  mac: string | null | undefined
): Promise<void> {
  const id = Number(machineId);
  const macSafe = macToAssignmentKey(mac);
  if (!Number.isFinite(id) || id <= 0 || !macSafe) return;
  const raw = String(mac ?? "").trim();
  await dbSet(dbRef(db, `assignments/${macSafe}`), {
    microcontroller_id: id,
    mac: raw.includes(":") ? raw : raw.match(/.{1,2}/g)?.join(":") ?? raw,
    updated_at: new Date().toISOString(),
  });
}
