import React from "react";
import { ScrollView, View, Text, StyleSheet } from "react-native";
import { formatMoisturePercent, resolveMoisturePercent } from "@/lib/duration-format";
import { userTypography } from "./userTypography";
export default function OverviewStatus({
  session,
  hardware_statuses,
  /** When set, hardware rows treat RTDB+API combined “live” (from parent). */
  hardwareStreamFresh,
  /** RTDB `machines/{id}/hardware_status.readings` — live temp / humidity / moisture when present. */
  liveReadings,
  /** Only show Current Details values while a session is running or paused. */
  hasActiveSession,
  remainingTimeLabel,
}: any) {
  const showSessionDetails = Boolean(hasActiveSession);
  const normalizeKey = (value: string) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .trim();

  const normalizeStatus = (value: string) => {
    const raw = String(value ?? "").toLowerCase();
    if (["working", "ok", "online", "pass", "passed"].includes(raw)) return "working";
    if (["not_working", "error", "offline", "fail", "failed"].includes(raw)) return "not_working";
    if (raw === "warning") return "warning";
    if (raw === "unknown") return "unknown";
    return raw || "--";
  };

  const logs = session?.sensor_logs;
  const latestLog = Array.isArray(logs) && logs.length > 0 ? logs[logs.length - 1] : null;

  const lr = liveReadings && typeof liveReadings === "object" ? liveReadings : null;
  const liveTemp = lr?.temperature ?? lr?.temp;
  const liveHum = lr?.humidity ?? lr?.hum;
  const liveMoistLabel = formatMoisturePercent(resolveMoisturePercent(lr));

  /** ESP32 + real sensors only (matches Firebase `components` + firmware). */
  const hardwareComponents = [
    {
      key: "esp32",
      label: "ESP32 (board online)",
      aliases: ["esp32"],
    },
    {
      key: "dht22",
      label: "DHT22 (Temp & Humidity)",
      aliases: [
        "dht22",
        "dht11",
        "dht",
        "temp_humidity_sensor",
        "temperature_and_humidity_sensor",
        "temp_sensor",
        "humidity_sensor",
      ],
    },
    {
      key: "door_sensor",
      label: "Door Sensor (MC38)",
      aliases: [
        "door_sensor",
        "door",
        "reed_switch",
        "reed",
        "magnetic_switch",
        "mc38",
      ],
    },
    {
      key: "moisture_sensor",
      label: "YL-69 Moisture",
      aliases: [
        "moisture_sensor",
        "moisture",
        "yl69",
        "yl_69",
        "soil_moisture",
        "moisture_sensor_1",
        "moisture_sensor_2",
        "moisture1",
        "moisture2",
      ],
    },
  ];

  return (
    <ScrollView>

      <View style={styles.card}>
        <Text style={styles.cardHeader}>Current Details</Text>

        {renderRow("Type of Fish", showSessionDetails ? session?.fish_type : null)}
        {renderRow("No. of Fish", showSessionDetails ? session?.total_fish : null)}

        {renderRow(
          "Current Temp",
          showSessionDetails &&
            liveTemp != null &&
            String(liveTemp).trim() !== ""
            ? String(liveTemp) + "°C"
            : showSessionDetails && latestLog?.temperature
              ? latestLog.temperature + "°C"
              : null
        )}

        {renderRow(
          "Target Temp",
          showSessionDetails && session?.target_temperature
            ? session.target_temperature + "°C"
            : null
        )}

        {renderRow(
          "Humidity",
          showSessionDetails &&
            liveHum != null &&
            String(liveHum).trim() !== ""
            ? String(liveHum) + "%"
            : showSessionDetails && latestLog?.humidity
              ? latestLog.humidity + "%"
              : null
        )}

        {renderRow(
          "Current Moisture",
          showSessionDetails && liveMoistLabel
            ? liveMoistLabel
            : showSessionDetails && latestLog?.moisture != null
              ? `${Math.round(Number(latestLog.moisture))}%`
              : null
        )}

        {renderRow(
          "Fan Speed",
          showSessionDetails && session?.fan_speed ? "Level " + session.fan_speed : null
        )}

        {renderRow(
          "Remaining Time",
          showSessionDetails && typeof remainingTimeLabel === "string"
            ? remainingTimeLabel
            : null
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeader}>Hardware Status</Text>

        {hardwareComponents.map((component, index) => {
          const aliasSet = new Set(
            component.aliases.map((a: string) => normalizeKey(a))
          );

          const found = hardware_statuses?.find((item: any) => {
            const key = normalizeKey(item.component_name);
            return aliasSet.has(key);
          });

          const streamLive = typeof hardwareStreamFresh === "boolean" ? hardwareStreamFresh : true;
          const rawStatus = !streamLive
            ? "not_working"
            : (found?.status ?? "unknown");
          const statusValue = normalizeStatus(rawStatus);

          const color =
            statusValue === "working"
              ? "#2ecc71"
              : statusValue === "not_working"
              ? "#e74c3c"
              : statusValue === "warning"
              ? "#f59e0b"
              : statusValue === "unknown"
              ? "#95a5a6"
              : "#95a5a6";

          return (
            <View key={index} style={styles.row}>
              <Text style={styles.label}>{component.label}</Text>

              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={[styles.dotSmall, { backgroundColor: color }]} />
                <Text style={[styles.bold, { color }]}>
                  {statusValue ?? "--"}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

    </ScrollView>
  );
}

function renderRow(label: string, value: any) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.bold}>{value ?? "--"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...userTypography.body, color: "#444" },
  bold: { ...userTypography.bodyStrong, color: "#444" },

  dotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
  },

  cardHeader: {
    ...userTypography.cardTitle,
    marginBottom: 10,
  },

  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderColor: "#eee",
  },
});