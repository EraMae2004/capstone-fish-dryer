import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl, probeApiHealth } from "@/config/api";

const QUEUE_KEY = "fishdryer.sessionQueue.v1";
const SAVED_IDS_KEY = "fishdryer.sessionSavedIds.v1";

type QueuedItem = {
  id: string;
  kind: "control" | "local";
  body: Record<string, unknown>;
};

let flushing = false;

async function readQueue(): Promise<QueuedItem[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeQueue(items: QueuedItem[]): Promise<void> {
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(items));
}

async function readSavedIds(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(SAVED_IDS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map((id) => String(id)) : [];
  } catch {
    return [];
  }
}

async function rememberSavedId(id: string): Promise<void> {
  const ids = await readSavedIds();
  if (ids.includes(id)) return;
  ids.push(id);
  await AsyncStorage.setItem(SAVED_IDS_KEY, JSON.stringify(ids.slice(-80)));
}

async function alreadySaved(id: string): Promise<boolean> {
  const ids = await readSavedIds();
  return ids.includes(id);
}

async function enqueue(item: QueuedItem): Promise<void> {
  if (!item.id) return;
  if (await alreadySaved(item.id)) return;
  const queue = await readQueue();
  if (queue.some((row) => row.id === item.id)) return;
  queue.push(item);
  await writeQueue(queue);
  void flushSessionQueue();
}

/** App Start/Pause/Stop that did not reach Laravel. Replayed in order. */
export async function enqueueControlSession(body: Record<string, unknown>): Promise<void> {
  const action = String(body.action ?? "stop");
  const mc = String(body.microcontroller_id ?? "");
  const id = `control:${mc}:${action}:${Date.now()}`;
  await enqueue({ id, kind: "control", body });
}

/**
 * Keypad session finished. Same offline_id as the ESP, so a second upload
 * updates the existing history row instead of inserting another.
 */
export async function enqueueLocalSessionStop(body: {
  offlineId: string;
  microcontrollerId: number;
  fishType?: string;
  totalFish?: number;
  targetTemperature?: number;
  setDurationMinutes?: number;
  dryingTimeSeconds?: number;
}): Promise<void> {
  const offlineId = String(body.offlineId ?? "").replace(/[^A-Za-z0-9_-]/g, "");
  if (!offlineId || body.microcontrollerId <= 0) return;
  await enqueue({
    id: `local:${offlineId}`,
    kind: "local",
    body: {
      action: "stop",
      microcontroller_id: body.microcontrollerId,
      offline_id: offlineId,
      fish_type: body.fishType || "Local",
      total_fish: body.totalFish ?? 0,
      target_temperature: body.targetTemperature ?? 60,
      fan_speed: 1,
      set_duration_minutes: body.setDurationMinutes ?? 1,
      drying_time_seconds: body.dryingTimeSeconds ?? 0,
    },
  });
}

async function postItem(item: QueuedItem): Promise<boolean> {
  const base = getApiBaseUrl();
  if (!base) return false;
  const path =
    item.kind === "local" ? "/hardware/esp32/session" : "/mobile/drying-session/control";
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(item.body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.ok && data?.success !== false) {
    await rememberSavedId(item.id);
    return true;
  }
  return false;
}

/** Send queued sessions once the API answers. Leaves anything that still fails. */
export async function flushSessionQueue(): Promise<void> {
  if (flushing) return;
  const base = getApiBaseUrl();
  if (!base) return;
  flushing = true;
  try {
    if (!(await probeApiHealth(base, 1500))) return;
    const queue = await readQueue();
    if (!queue.length) return;
    const left: QueuedItem[] = [];
    for (const item of queue) {
      try {
        const ok = await postItem(item);
        if (!ok) left.push(item);
      } catch {
        left.push(item);
      }
    }
    await writeQueue(left);
  } finally {
    flushing = false;
  }
}
