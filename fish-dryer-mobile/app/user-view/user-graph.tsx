import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  TouchableOpacity,
} from "react-native";
import { FontAwesome } from "@expo/vector-icons";
import { LineChart } from "react-native-gifted-charts";

export type HistoryRange = "all" | "weekly" | "monthly" | "3months";

const RANGE_OPTIONS: { value: HistoryRange; label: string }[] = [
  { value: "all", label: "All session" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "3months", label: "Last 3 months ago" },
];

function parseSessionDate(raw: unknown): Date | null {
  if (raw == null || raw === "") return null;
  const d = new Date(String(raw).trim().replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function sessionDurationMinutes(row: any): number {
  const sec = Number(row?.drying_time_seconds ?? row?.drying_time_minutes ?? 0);
  return Number.isFinite(sec) && sec > 0 ? sec / 60 : 0;
}

export default function UserGraph({
  sessions = [],
  summary,
  range,
  onChangeRange,
}: {
  sessions?: any[];
  summary?: { total_batches?: number };
  range?: HistoryRange;
  onChangeRange?: (r: HistoryRange) => void;
}) {
  const { width } = useWindowDimensions();
  const activeRange = range ?? "weekly";
  const [rangeOpen, setRangeOpen] = useState(false);

  const activeLabel =
    RANGE_OPTIONS.find((o) => o.value === activeRange)?.label ?? "Weekly";

  const groupedByPeriod = useMemo(() => {
    const grouped = sessions.reduce((acc: Record<string, any[]>, session: any) => {
      const d = parseSessionDate(session?.date ?? session?.ended_at ?? session?.created_at);
      if (!d) return acc;
      const key = d.toISOString().slice(0, 10);
      if (!acc[key]) acc[key] = [];
      acc[key].push(session);
      return acc;
    }, {});

    const dateKeys = Object.keys(grouped).sort((a: string, b: string) => a.localeCompare(b));
    if (dateKeys.length === 0) {
      return {
        duration: [{ value: 0, label: "N/A" }],
        humidity: [{ value: 0, label: "N/A" }],
        temperature: [{ value: 0, label: "N/A" }],
        hasData: false,
      };
    }

    const buildSeries = (valueFn: (row: any) => number) =>
      dateKeys.map((dateKey) => {
        const rows = grouped[dateKey];
        const vals = rows.map(valueFn).filter((v: number) => v > 0);
        const avg =
          vals.length > 0 ? vals.reduce((sum: number, v: number) => sum + v, 0) / vals.length : 0;
        return { value: Number(avg.toFixed(2)), label: dateKey.slice(5) };
      });

    const duration = buildSeries(sessionDurationMinutes);
    const humidity = buildSeries((row) => Number(row?.avg_humidity ?? row?.humidity) || 0);
    const temperature = buildSeries((row) => Number(row?.avg_temperature ?? row?.temperature) || 0);

    const hasData =
      duration.some((p) => p.value > 0) ||
      humidity.some((p) => p.value > 0) ||
      temperature.some((p) => p.value > 0);

    const padOnePoint = (series: { value: number; label: string }[]) =>
      series.length === 1
        ? [
            { value: series[0].value, label: series[0].label },
            { value: series[0].value, label: " " },
          ]
        : series;

    return {
      duration: padOnePoint(duration),
      humidity: padOnePoint(humidity),
      temperature: padOnePoint(temperature),
      hasData,
    };
  }, [sessions]);

  const totalBatches = summary?.total_batches ?? sessions.length ?? 0;
  const graphDurationData = groupedByPeriod.duration;
  const graphHumidityData = groupedByPeriod.humidity;
  const graphTemperatureData = groupedByPeriod.temperature;
  const chartMax = Math.max(
    20,
    ...graphDurationData.map((item: { value: number }) => item.value),
    ...graphHumidityData.map((item: { value: number }) => item.value),
    ...graphTemperatureData.map((item: { value: number }) => item.value)
  );
  const chartWidth = Math.max(220, width - 96);
  const pointCount = Math.max(
    graphHumidityData.length,
    graphTemperatureData.length,
    graphDurationData.length,
    2
  );

  const selectRange = (value: HistoryRange) => {
    setRangeOpen(false);
    onChangeRange?.(value);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>USER DRYING TREND</Text>

          <View style={styles.rangeDropdownWrap}>
            <TouchableOpacity
              style={styles.rangeTrigger}
              onPress={() => setRangeOpen((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="Select graph time range"
            >
              <Text style={styles.rangeTriggerText} numberOfLines={1}>
                {activeLabel}
              </Text>
              <FontAwesome
                name={rangeOpen ? "chevron-up" : "chevron-down"}
                size={12}
                color="#1f3b57"
              />
            </TouchableOpacity>

            {rangeOpen ? (
              <View style={styles.rangeMenu}>
                {RANGE_OPTIONS.map((opt) => {
                  const active = opt.value === activeRange;
                  return (
                    <TouchableOpacity
                      key={opt.value}
                      style={[styles.rangeMenuItem, active && styles.rangeMenuItemActive]}
                      onPress={() => selectRange(opt.value)}
                    >
                      <Text
                        style={[
                          styles.rangeMenuItemText,
                          active && styles.rangeMenuItemTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            ) : null}
          </View>
        </View>

        <View style={styles.sideInfo}>
          <Text style={styles.sideLabel}>Total Batches</Text>
          <Text style={styles.totalBatches}>{totalBatches}</Text>
        </View>
      </View>

      <View style={styles.chartWrap}>
        <View style={styles.legendWrap}>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: "#2563eb" }]} />
            <Text style={styles.legendItem}>Humidity</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: "#f97316" }]} />
            <Text style={styles.legendItem}>Temperature</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: "#16a34a" }]} />
            <Text style={styles.legendItem}>Duration</Text>
          </View>
        </View>

        <LineChart
          width={chartWidth}
          data={graphHumidityData}
          data2={graphTemperatureData}
          data3={graphDurationData}
          thickness={2.5}
          thickness2={2.5}
          thickness3={2.5}
          color="#2563eb"
          color2="#f97316"
          color3="#16a34a"
          hideDataPoints={false}
          dataPointsColor="#2563eb"
          dataPointsColor2="#f97316"
          dataPointsColor3="#16a34a"
          dataPointsRadius={3}
          yAxisColor="#d5dbe3"
          xAxisColor="#d5dbe3"
          maxValue={Math.ceil(chartMax * 1.2)}
          noOfSections={4}
          spacing={Math.max(20, (chartWidth - 60) / Math.max(pointCount - 1, 1))}
          initialSpacing={10}
          endSpacing={10}
          yAxisLabelWidth={36}
          yAxisLabelSuffix=" "
          xAxisLabelTextStyle={{ color: "#6b7280", fontSize: 10 }}
          yAxisTextStyle={{ color: "#6b7280", fontSize: 10 }}
          rulesColor="#eef2f7"
          areaChart={false}
          curved
          disableScroll={false}
          scrollToEnd
        />
        {!groupedByPeriod.hasData && (
          <View style={styles.noDataHint}>
            <Text style={styles.emptyText}>No saved sessions in this period.</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#fff",
    padding: 16,
    borderRadius: 12,
    marginBottom: 25,
    elevation: 2,
  },

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 10,
  },

  titleBlock: {
    flex: 1,
    marginRight: 12,
  },

  title: {
    fontSize: 15,
    fontWeight: "700",
    color: "#1f3b57",
    marginBottom: 8,
  },

  rangeDropdownWrap: {
    alignSelf: "stretch",
    maxWidth: 220,
  },

  rangeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },

  rangeTriggerText: {
    flex: 1,
    paddingRight: 10,
    fontSize: 13,
    fontWeight: "600",
    color: "#1f3b57",
  },

  rangeMenu: {
    marginTop: 4,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    overflow: "hidden",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },

  rangeMenuItem: {
    paddingVertical: 11,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },

  rangeMenuItemActive: {
    backgroundColor: "#e8f4fc",
  },

  rangeMenuItemText: {
    fontSize: 13,
    color: "#334155",
  },

  rangeMenuItemTextActive: {
    fontWeight: "700",
    color: "#1f3b57",
  },

  sideInfo: {
    alignItems: "center",
  },

  sideLabel: {
    color: "#6b7280",
    fontSize: 11,
  },

  totalBatches: {
    fontWeight: "700",
    fontSize: 18,
    color: "#1f3b57",
  },

  chartWrap: {
    width: "100%",
    borderWidth: 1,
    borderColor: "#edf1f7",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 6,
    backgroundColor: "#fafcff",
    overflow: "hidden",
  },

  emptyText: {
    color: "#6b7280",
    fontSize: 12,
  },

  legendWrap: {
    marginBottom: 10,
    gap: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },

  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    marginRight: 14,
  },

  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 6,
  },

  legendItem: {
    color: "#334155",
    fontSize: 11,
    fontWeight: "600",
  },

  noDataHint: {
    marginTop: 8,
    alignItems: "center",
  },
});
