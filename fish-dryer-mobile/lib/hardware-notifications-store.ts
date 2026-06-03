import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "fish_dryer_hardware_notifications_v1";
const MAX_ITEMS = 80;

export type StoredHardwareNotification = {
  id: string;
  /**
   * critical → undetected / disconnected component
   * warning  → unstable reading
   * info     → system events (drying started/paused/saved)
   */
  type: "critical" | "warning" | "info";
  title: string;
  desc: string;
  machineId: number;
  /** `drying_temp` = below/above target during drying; sensor keys = hardware faults. */
  componentKey: string;
  createdAt: string;
  read: boolean;
};

/** Drying session: target not reached (30+ min) or temperature exceeded target. */
export function isDryingTemperatureWarning(
  n: Pick<StoredHardwareNotification, "id" | "componentKey" | "type">
): boolean {
  if (n.componentKey === "drying_temp") {
    return n.type === "warning" || n.type === "critical";
  }
  const id = String(n.id ?? "");
  return id.startsWith("temp-below-target:") || id.startsWith("temp-above-target:");
}

export function isHardwareAlert(
  n: Pick<StoredHardwareNotification, "id" | "componentKey" | "type">
): boolean {
  if (isDryingTemperatureWarning(n)) return false;
  return n.type === "critical" || n.type === "warning";
}

function normalizeItem(x: Record<string, unknown>): StoredHardwareNotification {
  return {
    id: String(x.id ?? ""),
    type: (x.type as StoredHardwareNotification["type"]) ?? "info",
    title: String(x.title ?? ""),
    desc: String(x.desc ?? ""),
    machineId: Number(x.machineId) || 0,
    componentKey: String(x.componentKey ?? ""),
    createdAt: String(x.createdAt ?? new Date().toISOString()),
    read: x.read === true,
  };
}

function parseList(raw: string | null): StoredHardwareNotification[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.map((row) => normalizeItem(row && typeof row === "object" ? (row as Record<string, unknown>) : {}));
  } catch {
    return [];
  }
}

export async function loadHardwareNotifications(): Promise<StoredHardwareNotification[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return parseList(raw);
}

export async function countUnreadHardwareNotifications(
  machineId?: number | null
): Promise<number> {
  const list = await loadHardwareNotifications();
  return list.filter((x) => {
    if (x.read === true) return false;
    if (machineId != null && machineId > 0 && x.machineId !== machineId) {
      return false;
    }
    return true;
  }).length;
}

/** One-shot events (session started, first sensor fault snapshot, etc.). */
export async function appendHardwareNotification(
  item: Omit<StoredHardwareNotification, "read">
): Promise<void> {
  const list = await loadHardwareNotifications();
  const next: StoredHardwareNotification[] = [
    { ...item, read: false },
    ...list.filter((x) => x.id !== item.id),
  ].slice(0, MAX_ITEMS);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

/**
 * @deprecated Prefer {@link appendHardwareNotification} with a unique `id` per alert.
 * Kept for callers that intentionally replace one row (e.g. legacy upsert by stable key).
 */
export async function upsertHardwareNotification(
  item: Omit<StoredHardwareNotification, "read">
): Promise<void> {
  const list = await loadHardwareNotifications();
  const next: StoredHardwareNotification[] = [
    { ...item, read: false },
    ...list.filter((x) => x.id !== item.id),
  ].slice(0, MAX_ITEMS);
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function markAllHardwareNotificationsRead(): Promise<void> {
  const list = await loadHardwareNotifications();
  const next = list.map((x) => ({ ...x, read: true }));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function clearHardwareNotifications(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function markHardwareNotificationsReadByIds(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const set = new Set(ids);
  const list = await loadHardwareNotifications();
  const next = list.map((x) => (set.has(x.id) ? { ...x, read: true } : x));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export async function deleteHardwareNotificationsByIds(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const set = new Set(ids);
  const list = await loadHardwareNotifications();
  const next = list.filter((x) => !set.has(x.id));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
