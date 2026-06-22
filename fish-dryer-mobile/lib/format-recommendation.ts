import { formatMinutesAsHMS } from "@/lib/duration-format";

export type RecommendationParams = {
  temperature?: unknown;
  moisture?: unknown;
  fan_speed?: unknown;
  duration_minutes?: unknown;
  extension_minutes?: unknown;
};

export type RecommendationDisplayRow = {
  id: string;
  label: string;
  value: string;
  icon: "thermometer-half" | "tint" | "leaf" | "sliders" | "clock-o";
};

export function getRecommendationRows(
  rec: RecommendationParams | null | undefined,
  extensionMode: boolean
): RecommendationDisplayRow[] | null {
  if (rec == null || rec.temperature == null) {
    return null;
  }

  const mins = extensionMode
    ? Number(rec.extension_minutes)
    : Number(rec.duration_minutes);

  const rows: RecommendationDisplayRow[] = [
    {
      id: "temperature",
      label: "Temperature",
      value: `${rec.temperature}°C`,
      icon: "thermometer-half",
    },
  ];

  if (Number.isFinite(mins) && mins >= 1) {
    rows.push({
      id: "time",
      label: extensionMode ? "Extension time" : "Drying time",
      value: formatMinutesAsHMS(mins),
      icon: "clock-o",
    });
  }

  const moist = Number(rec.moisture);
  if (Number.isFinite(moist)) {
    rows.push({
      id: "moisture",
      label: "Moisture",
      value: `${moist.toFixed(1)}%`,
      icon: "leaf",
    });
  }

  return rows;
}

/** Plain text for alerts / dialogs. */
export function formatRecommendationParams(
  rec: RecommendationParams | null | undefined,
  extensionMode: boolean
): string {
  const rows = getRecommendationRows(rec, extensionMode);
  if (!rows) return "No recommendation available.";
  return rows.map((r) => `${r.label}: ${r.value}`).join("\n");
}
