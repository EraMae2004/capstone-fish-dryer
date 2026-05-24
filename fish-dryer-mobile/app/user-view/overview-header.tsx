import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { FontAwesome } from "@expo/vector-icons";
import { userTypography } from "@/lib/user-typography";

type OverviewHeaderProps = {
  unreadCount: number;
  onPressNotifications: () => void;
  machineStatusLabel: string;
  machineOnline: boolean | null | undefined;
  timerLabel?: string;
  machineSelector?: React.ReactNode;
};

export default function OverviewHeader({
  unreadCount,
  onPressNotifications,
  machineStatusLabel,
  machineOnline,
  timerLabel = "--",
  machineSelector,
}: OverviewHeaderProps) {
  const badgeLabel = unreadCount > 99 ? "99+" : String(unreadCount);

  const dotColor =
    machineOnline === true
      ? "#2ecc71"
      : machineOnline === false
        ? "#e74c3c"
        : "#95a5a6";

  const statusText =
    machineStatusLabel && String(machineStatusLabel).trim().length > 0
      ? String(machineStatusLabel).trim()
      : "—";

  return (
    <View style={styles.wrap}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>OVERVIEW</Text>

        <TouchableOpacity
          style={styles.bellBtn}
          onPress={onPressNotifications}
          accessibilityRole="button"
          accessibilityLabel={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
        >
          <FontAwesome name="bell" size={22} color="#1f3b57" />
          {unreadCount > 0 ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badgeLabel}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
      </View>

      <View style={styles.statusRow}>
        <View style={styles.statusLeft}>
          <Text style={styles.statusLabel}>Machine Status:</Text>
          <Text style={[styles.statusDot, { color: dotColor }]}>●</Text>
          <Text style={styles.statusValue}>{statusText}</Text>
        </View>
        <Text style={styles.timerText}>{timerLabel}</Text>
      </View>

      {machineSelector}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  title: {
    ...userTypography.pageTitle,
    color: "#1f3b57",
  },
  bellBtn: {
    padding: 6,
    position: "relative",
  },
  badge: {
    position: "absolute",
    top: 0,
    right: 0,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#e74c3c",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 4,
    borderWidth: 2,
    borderColor: "#f5f5f5",
  },
  badgeText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  statusLeft: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    flexWrap: "wrap",
    gap: 4,
    paddingRight: 8,
  },
  statusLabel: {
    ...userTypography.body,
    color: "#444",
  },
  statusDot: {
    fontSize: 14,
  },
  statusValue: {
    ...userTypography.bodyStrong,
    color: "#1f3b57",
  },
  timerText: {
    ...userTypography.emphasis,
    color: "#1f3c5c",
  },
});
