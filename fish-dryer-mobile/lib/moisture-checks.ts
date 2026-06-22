import { resolveMoisturePercent } from "@/lib/duration-format";

export type MoistureCheckLog = {
  id: number;
  moisture: number;
  check_label?: string | null;
  log_type?: string | null;
  recorded_at?: string;
  temperature?: number;
  humidity?: number;
};

export type MoistureFishReading = {
  localId: string;
  logId?: number;
  moisture: number;
  recordedAt?: string;
  fishLabel: string;
};

export type MoistureBatchDraft = {
  localId: string;
  label: string;
  readings: MoistureFishReading[];
};

export function isMoistureCheckLog(log: unknown): log is MoistureCheckLog {
  if (!log || typeof log !== "object") return false;
  const l = log as Record<string, unknown>;
  if (l.log_type === "moisture_check") return true;
  if (typeof l.check_label === "string" && l.check_label.trim() !== "") return true;
  return false;
}

export function moistureCheckLogs(logs: unknown): MoistureCheckLog[] {
  if (!Array.isArray(logs)) return [];
  return logs.filter(isMoistureCheckLog) as MoistureCheckLog[];
}

export function lastMoistureCheckPercent(logs: unknown): number | null {
  const checks = moistureCheckLogs(logs);
  if (checks.length === 0) return null;
  const m = Number(checks[checks.length - 1]?.moisture);
  return Number.isFinite(m) ? Math.round(m) : null;
}

export function moistureCheckSummaryLabel(logs: unknown): string | null {
  const checks = moistureCheckLogs(logs);
  if (checks.length === 0) return null;
  const last = Math.round(Number(checks[checks.length - 1]?.moisture));
  if (!Number.isFinite(last)) return null;
  if (checks.length === 1) return `${last}%`;
  const avg = Math.round(
    checks.reduce((sum, row) => sum + Number(row.moisture), 0) / checks.length
  );
  return `${last}% (${checks.length} checks, avg ${avg}%)`;
}

export function moistureDraftSummaryLabel(batches: MoistureBatchDraft[]): string | null {
  const all = batches.flatMap((batch) => batch.readings);
  if (all.length === 0) return null;
  const last = Math.round(Number(all[all.length - 1]?.moisture));
  if (!Number.isFinite(last)) return null;
  if (all.length === 1) return `${last}%`;
  const avg = Math.round(all.reduce((sum, row) => sum + Number(row.moisture), 0) / all.length);
  return `${last}% (${all.length} checks, avg ${avg}%)`;
}

export function isMoistureProbeConnected(
  lr: Record<string, unknown> | null | undefined
): boolean {
  if (!lr) return false;
  if (lr.moisture_connected === true || lr.moisture_connected === "true") return true;
  return resolveMoisturePercent(lr) != null;
}

function parseCheckLabel(checkLabel: string): { batchLabel: string; fishLabel: string } {
  const trimmed = checkLabel.trim();
  const sep = trimmed.indexOf(" · ");
  if (sep >= 0) {
    return {
      batchLabel: trimmed.slice(0, sep).trim() || "Batch 1",
      fishLabel: trimmed.slice(sep + 3).trim() || "Fish 1",
    };
  }
  return { batchLabel: trimmed || "Batch 1", fishLabel: "Fish 1" };
}

export function batchesFromSavedLogs(logs: unknown): MoistureBatchDraft[] {
  const checks = moistureCheckLogs(logs);
  const order: string[] = [];
  const map = new Map<string, MoistureBatchDraft>();

  for (const row of checks) {
    const rawLabel = row.check_label?.trim() || "Batch 1";
    const { batchLabel, fishLabel } = parseCheckLabel(rawLabel);
    if (!map.has(batchLabel)) {
      order.push(batchLabel);
      map.set(batchLabel, {
        localId: `batch-${batchLabel}`,
        label: batchLabel,
        readings: [],
      });
    }
    const batch = map.get(batchLabel)!;
    batch.readings.push({
      localId: `saved-${row.id}`,
      logId: row.id,
      moisture: Number.isFinite(Number(row.moisture)) ? Math.round(Number(row.moisture)) : 0,
      recordedAt: row.recorded_at,
      fishLabel,
    });
  }

  return order.map((key) => map.get(key)!);
}

export function newMoistureBatchLabel(existing: MoistureBatchDraft[]): string {
  return `Batch ${existing.length + 1}`;
}

export function nextFishLabel(batch: MoistureBatchDraft): string {
  return `Fish ${batch.readings.length + 1}`;
}

export function fullCheckLabel(batch: MoistureBatchDraft, fishLabel: string): string {
  return `${batch.label} · ${fishLabel}`;
}

export function lastFishLabel(batch: MoistureBatchDraft): string {
  if (batch.readings.length === 0) return "Fish 1";
  return batch.readings[batch.readings.length - 1].fishLabel;
}

export function totalMoistureCheckCount(batches: MoistureBatchDraft[]): number {
  return batches.reduce((sum, batch) => sum + batch.readings.length, 0);
}

/** Last recorded spot-check % from the in-session moisture draft (not an average). */
export function lastMoistureFromDraft(batches: MoistureBatchDraft[]): number | null {
  const all = batches.flatMap((batch) => batch.readings);
  if (all.length === 0) return null;
  const m = Number(all[all.length - 1]?.moisture);
  return Number.isFinite(m) ? Math.round(m) : null;
}
