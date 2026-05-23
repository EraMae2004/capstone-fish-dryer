import { ref as dbRef, remove as dbRemove, set as dbSet } from "firebase/database";
import type { Database } from "firebase/database";

/** Same key the ESP uses: `assignments/{AABBCCDDEEFF}` (no colons, uppercase). */
export function macToAssignmentKey(mac: string | null | undefined): string | null {
  const raw = String(mac ?? "").trim();
  if (!raw) return null;
  const key = raw.replace(/:/g, "").toUpperCase();
  return key.length >= 8 ? key : null;
}

function macWithColons(mac: string): string {
  const raw = String(mac ?? "").trim();
  if (raw.includes(":")) return raw;
  const key = macToAssignmentKey(raw);
  return key ? key.match(/.{1,2}/g)?.join(":") ?? raw : raw;
}

/** ESP polls `assignments/{MAC}` — must match the machine id used for session/test_command. */
export async function ensureEspAssignment(
  db: Database,
  machineId: number,
  mac: string | null | undefined,
  opts?: { name?: string | null; deviceId?: string | null }
): Promise<void> {
  const id = Number(machineId);
  const macSafe = macToAssignmentKey(mac);
  if (!Number.isFinite(id) || id <= 0 || !macSafe) return;
  const macFormatted = macWithColons(String(mac ?? macSafe));
  const now = new Date().toISOString();
  const label = String(opts?.name ?? "").trim() || `Machine ${id}`;
  const deviceId = String(opts?.deviceId ?? "").trim() || macFormatted;

  await dbSet(dbRef(db, `assignments/${macSafe}`), {
    microcontroller_id: id,
    mac: macFormatted,
    name: label,
    device_id: deviceId,
    updated_at: now,
  });

  await dbSet(dbRef(db, `machines/${id}`), {
    microcontroller_id: id,
    name: label,
    device_id: deviceId,
    mac: macFormatted,
    updated_at: now,
  });

  try {
    await dbRemove(dbRef(db, `discovery/${macSafe}`));
  } catch {
    // Board may never have advertised in discovery/.
  }
}
