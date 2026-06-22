import AsyncStorage from "@react-native-async-storage/async-storage";
import type { MoistureBatchDraft } from "@/lib/moisture-checks";

const STORAGE_PREFIX = "moisture_draft_v1_";

function storageKey(sessionId: number): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

export async function loadMoistureDraft(sessionId: number): Promise<MoistureBatchDraft[]> {
  if (!Number.isFinite(sessionId) || sessionId <= 0) return [];
  try {
    const raw = await AsyncStorage.getItem(storageKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as MoistureBatchDraft[]) : [];
  } catch {
    return [];
  }
}

export async function saveMoistureDraft(
  sessionId: number,
  batches: MoistureBatchDraft[]
): Promise<void> {
  if (!Number.isFinite(sessionId) || sessionId <= 0) return;
  try {
    if (batches.length === 0) {
      await AsyncStorage.removeItem(storageKey(sessionId));
      return;
    }
    await AsyncStorage.setItem(storageKey(sessionId), JSON.stringify(batches));
  } catch {
    // Non-fatal — in-memory state still works for this app session.
  }
}

export async function clearMoistureDraft(sessionId: number): Promise<void> {
  if (!Number.isFinite(sessionId) || sessionId <= 0) return;
  try {
    await AsyncStorage.removeItem(storageKey(sessionId));
  } catch {
    // ignore
  }
}

export type MoistureCheckStopPayload = {
  check_label: string;
  moisture: number;
  temperature?: number;
  humidity?: number;
  recorded_at?: string;
};

export function flattenMoistureDraftForStop(
  batches: MoistureBatchDraft[]
): MoistureCheckStopPayload[] {
  const out: MoistureCheckStopPayload[] = [];
  for (const batch of batches) {
    for (const reading of batch.readings) {
      if (!Number.isFinite(Number(reading.moisture))) continue;
      out.push({
        check_label: `${batch.label} · ${reading.fishLabel}`,
        moisture: Math.round(Number(reading.moisture)),
        recorded_at: reading.recordedAt,
      });
    }
  }
  return out;
}
