import React, { useMemo } from "react";
import { View, Text, StyleSheet } from "react-native";
import { FontAwesome } from "@expo/vector-icons";
import { userTypography } from "@/lib/user-typography";
import {
  getRecommendationRows,
  type RecommendationParams,
} from "@/lib/format-recommendation";

type Props = {
  recommendation: RecommendationParams | null | undefined;
  extensionMode: boolean;
};

export default function RecommendationParamsCard({
  recommendation,
  extensionMode,
}: Props) {
  const rows = useMemo(
    () => getRecommendationRows(recommendation, extensionMode),
    [recommendation, extensionMode]
  );

  if (!rows) {
    return (
      <View style={styles.emptyBox}>
        <FontAwesome name="info-circle" size={22} color="#94a3b8" />
        <Text style={styles.emptyText}>No recommendation available yet.</Text>
        <Text style={styles.emptyHint}>
          Complete more drying sessions with the same fish type to get suggestions.
        </Text>
      </View>
    );
  }

  const timeRow = rows.find((r) => r.id === "time");
  const metricRows = rows.filter((r) => r.id !== "time");

  return (
    <View style={styles.wrap}>
      {extensionMode ? (
        <View style={styles.banner}>
          <FontAwesome name="clock-o" size={14} color="#b45309" />
          <Text style={styles.bannerText}>Timer finished — suggested extension</Text>
        </View>
      ) : (
        <Text style={styles.subtitle}>Suggested settings from similar past dries</Text>
      )}

      <View style={styles.grid}>
        {metricRows.map((row) => (
          <View key={row.id} style={styles.metricCell}>
            <View style={styles.metricIconWrap}>
              <FontAwesome name={row.icon} size={14} color="#0d3b66" />
            </View>
            <View style={styles.metricBody}>
              <Text style={styles.metricLabel}>{row.label}</Text>
              <Text style={styles.metricValue}>{row.value}</Text>
            </View>
          </View>
        ))}
      </View>

      {timeRow ? (
        <View style={styles.timeRow}>
          <View style={styles.timeIconWrap}>
            <FontAwesome name="clock-o" size={16} color="#fff" />
          </View>
          <View style={styles.timeBody}>
            <Text style={styles.timeLabel}>{timeRow.label}</Text>
            <Text style={styles.timeValue}>{timeRow.value}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 14,
  },

  subtitle: {
    ...userTypography.caption,
    color: "#64748b",
    marginBottom: 10,
  },

  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#fff7ed",
    borderWidth: 1,
    borderColor: "#fed7aa",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    marginBottom: 10,
  },

  bannerText: {
    ...userTypography.bodyStrong,
    color: "#b45309",
    flex: 1,
  },

  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginHorizontal: -4,
  },

  metricCell: {
    width: "50%",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 4,
    marginBottom: 10,
  },

  metricIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#e8f4fc",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },

  metricBody: {
    flex: 1,
    minWidth: 0,
  },

  metricLabel: {
    ...userTypography.caption,
    color: "#64748b",
    marginBottom: 2,
  },

  metricValue: {
    ...userTypography.bodyStrong,
    color: "#0f172a",
    fontSize: 15,
  },

  timeRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#0d3b66",
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginTop: 4,
  },

  timeIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  timeBody: {
    flex: 1,
  },

  timeLabel: {
    ...userTypography.caption,
    color: "rgba(255,255,255,0.85)",
    marginBottom: 2,
  },

  timeValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: 0.5,
  },

  emptyBox: {
    alignItems: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    paddingVertical: 20,
    paddingHorizontal: 16,
    marginBottom: 14,
  },

  emptyText: {
    ...userTypography.bodyStrong,
    color: "#475569",
    marginTop: 10,
    textAlign: "center",
  },

  emptyHint: {
    ...userTypography.caption,
    color: "#94a3b8",
    marginTop: 6,
    textAlign: "center",
    lineHeight: 18,
  },
});
