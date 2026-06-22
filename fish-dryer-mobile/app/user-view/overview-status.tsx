import React from "react";
import { ScrollView, View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import {
  formatDoorSensorDisplay,
  doorSensorDisplayColor,
} from "@/lib/door-sensor-display";
import {
  moistureSensorDisplayColor,
  moistureSensorDisplayLabel,
} from "@/lib/hardware-status-rtdb";
import { type MoistureBatchDraft } from "@/lib/moisture-checks";
import { userTypography } from "@/lib/user-typography";

type OverviewStatusProps = {
  session: any;
  hardware_statuses: any;
  hardwareStreamFresh?: boolean;
  liveReadings: any;
  hasActiveSession?: boolean;
  remainingTimeLabel?: string;
  sessionStatus?: string;
  doorForceClosed?: boolean;
  moistureDraftBatches?: MoistureBatchDraft[];
  onMoistureDraftChange?: (next: MoistureBatchDraft[]) => void;
  onOpenMoistureModal?: () => void;
};

export default function OverviewStatus({
  session,
  hardware_statuses,
  hardwareStreamFresh,
  liveReadings,
  hasActiveSession,
  remainingTimeLabel,
  sessionStatus,
  doorForceClosed,
  moistureDraftBatches = [],
  onMoistureDraftChange,
  onOpenMoistureModal,
}: OverviewStatusProps) {
  const showSessionDetails = Boolean(hasActiveSession);
  const normalizeKey = (value: string) =>
    String(value ?? "")
      .toLowerCase()
      .replace(/[\s-]+/g, "_")
      .trim();

  const normalizeStatus = (value: string) => {
    const raw = String(value ?? "").toLowerCase();
    if (["working", "ok", "online", "pass", "passed"].includes(raw)) return "working";
    if (raw === "standby" || raw === "idle") return "standby";
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
  const sessionSt = String(sessionStatus ?? "").trim().toLowerCase();
  const useRealDoorSensor =
    !sessionSt || sessionSt === "stopped" || sessionSt === "paused";

  const moistureRowValue = showSessionDetails ? "Tap here" : null;

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
    <>
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

          {renderMoistureRow(
            "Current Moisture",
            moistureRowValue,
            showSessionDetails,
            () => onOpenMoistureModal?.()
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

            const doorLabel =
              component.key === "door_sensor"
                ? formatDoorSensorDisplay(lr?.door, {
                    streamLive: streamLive,
                    componentStatus: rawStatus,
                    forceClosed: !useRealDoorSensor && Boolean(doorForceClosed),
                  })
                : null;

            const moistureLabel =
              component.key === "moisture_sensor" && !doorLabel
                ? moistureSensorDisplayLabel(rawStatus)
                : null;

            const displayText = doorLabel
              ? doorLabel === "not_working"
                ? "not_working"
                : doorLabel
              : moistureLabel
                ? moistureLabel.toLowerCase()
                : statusValue === "working"
                  ? "working"
                  : statusValue === "standby"
                    ? "standby"
                    : statusValue === "not_working"
                      ? "not_working"
                      : statusValue ?? "--";

            const color = doorLabel
              ? doorSensorDisplayColor(doorLabel)
              : moistureLabel
                ? moistureSensorDisplayColor(rawStatus)
                : statusValue === "working"
                  ? "#2ecc71"
                  : statusValue === "standby"
                    ? "#95a5a6"
                    : statusValue === "not_working"
                      ? "#e74c3c"
                      : statusValue === "warning"
                        ? "#f59e0b"
                        : "#95a5a6";

            return (
              <View key={index} style={styles.row}>
                <Text style={styles.label}>{component.label}</Text>

                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={[styles.dotSmall, { backgroundColor: color }]} />
                  <Text style={[styles.bold, { color }]}>
                    {displayText}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </>
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

function renderMoistureRow(
  label: string,
  value: string | null,
  tappable: boolean,
  onPress: () => void
) {
  if (!tappable) {
    return renderRow(label, value);
  }

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.moistureValueWrap}>
        <Text style={[styles.bold, styles.moistureTappable]}>{value ?? "--"}</Text>
        <MaterialCommunityIcons name="chevron-right" size={18} color="#1f4e6c" />
      </View>
    </TouchableOpacity>
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
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderColor: "#eee",
  },

  moistureValueWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    maxWidth: "62%",
  },

  moistureTappable: {
    color: "#1f4e6c",
    textAlign: "right",
    flexShrink: 1,
  },
});
