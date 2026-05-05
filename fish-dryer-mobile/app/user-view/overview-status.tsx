import React from "react";
import { ScrollView, View, Text, StyleSheet } from "react-native";
import { userTypography } from "./userTypography";

export default function OverviewStatus({
  machine,
  session,
  hardware_statuses,
  /** When set, machine + hardware rows treat RTDB+API combined “live” (from parent). */
  hardwareStreamFresh,
}: any) {
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

  /**
   * UI "live" is stricter than the API's long heartbeat window.
   * If we only trust `machine.status=online` while `last_seen` is stale, the UI looks fake.
   */
  const LIVE_LAST_SEEN_MS = 90_000;
  const parseIsoMs = (iso: unknown): number | null => {
    if (!iso) return null;
    const d = new Date(String(iso));
    const t = d.getTime();
    return Number.isFinite(t) ? t : null;
  };

  const lastSeenMs = parseIsoMs(machine?.last_seen);
  const seenRecently =
    lastSeenMs !== null ? Date.now() - lastSeenMs <= LIVE_LAST_SEEN_MS : false;

  const rawMc = String(machine?.status ?? "")
    .trim()
    .toLowerCase();
  const apiOnline = rawMc === "online" || rawMc === "true" || rawMc === "1";
  const mcOnline = Boolean(machine) && apiOnline && seenRecently;
  const overviewLive =
    typeof hardwareStreamFresh === "boolean" ? hardwareStreamFresh : mcOnline;
  const mcDotColor = overviewLive ? "#2ecc71" : machine ? "#e74c3c" : "#95a5a6";
  const mcStatusText = machine
    ? overviewLive
      ? "Online"
      : apiOnline && !seenRecently
        ? "Offline (stale)"
        : "Offline"
    : "—";

  const logs = session?.sensor_logs;
  const latestLog = Array.isArray(logs) && logs.length > 0 ? logs[logs.length - 1] : null;

  const remainingTime =
    session?.set_duration_minutes && session?.drying_time_minutes
      ? session.set_duration_minutes - session.drying_time_minutes
      : null;

  const hardwareComponents = [
    { key: "esp32", label: "ESP32" },
    { key: "solar_panel", label: "Solar Panel" },
    { key: "heater_fan_1", label: "Heater Fan 1" },
    { key: "heater_fan_2", label: "Heater Fan 2" },
    { key: "ventilation_fan", label: "Ventilation Fan" },
    { key: "buzzer", label: "Buzzer" },
    { key: "heater_1", label: "Heater 1" },
    { key: "heater_2", label: "Heater 2" },
    { key: "led_1", label: "LED 1" },
    { key: "led_2", label: "LED 2" },
    { key: "led_3", label: "LED 3" },
    { key: "temp_humidity_sensor", label: "Temp & Humidity Sensor" },
    { key: "moisture_sensor_1", label: "Moisture Sensor 1" },
    { key: "moisture_sensor_2", label: "Moisture Sensor 2" },
  ];

  return (
    <ScrollView>

      <Text style={styles.title}>OVERVIEW</Text>

      <View style={styles.statusRow}>
        <Text style={styles.label}>Machine status:</Text>
        <View style={[styles.dot, { backgroundColor: mcDotColor }]} />
        <Text style={styles.bold}>{mcStatusText}</Text>
      </View>

      <View style={styles.dropdown}>
        <Text>{machine?.name ?? "No Machine"}</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeader}>Current Details</Text>

        {renderRow("Type of Fish", session?.fish_type)}
        {renderRow("No. of Fish", session?.total_fish)}

        {renderRow("Current Temp",
          latestLog?.temperature ? latestLog.temperature + "°C" : null
        )}

        {renderRow("Target Temp",
          session?.target_temperature ? session.target_temperature + "°C" : null
        )}

        {renderRow("Humidity",
          latestLog?.humidity ? latestLog.humidity + "%" : null
        )}

        {renderRow("Current Moisture",
          latestLog?.moisture ? latestLog.moisture + "%" : null
        )}

        {renderRow("Fan Speed",
          session?.fan_speed ? "Level " + session.fan_speed : null
        )}

        {renderRow("Remaining Time",
          remainingTime ? remainingTime + " mins" : null
        )}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardHeader}>Hardware Status</Text>

        {hardwareComponents.map((component, index) => {

          const found = hardware_statuses?.find((item: any) => {
            const key = normalizeKey(item.component_name);
            const componentKey = normalizeKey(component.key);
            if (key === componentKey) return true;

            if (componentKey === "moisture_sensor_1" && [
              "moisture_sensor_1",
              "moisture1",
              "loadcell_1",
              "loadcell1",
              "load_cell_1",
              "weight_sensor_1",
            ].includes(key)) {
              return true;
            }

            if (componentKey === "moisture_sensor_2" && [
              "moisture_sensor_2",
              "moisture2",
              "loadcell_2",
              "loadcell2",
              "load_cell_2",
              "weight_sensor_2",
            ].includes(key)) {
              return true;
            }

            return false;
          });

          const rawStatus = !overviewLive ? "not_working" : (found?.status ?? "--");
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
  title: {
    ...userTypography.pageTitle,
    marginBottom: 15,
  },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },

  label: { ...userTypography.body, color: "#444" },
  bold: { ...userTypography.bodyStrong, color: "#444" },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },

  dotSmall: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },

  dropdown: {
    backgroundColor: "#fff",
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    marginBottom: 20,
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