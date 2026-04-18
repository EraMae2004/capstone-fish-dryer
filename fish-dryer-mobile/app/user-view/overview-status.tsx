import React from "react";
import { ScrollView, View, Text, StyleSheet } from "react-native";

export default function OverviewStatus({
  machine,
  session,
  hardware_statuses,
}: any) {

  const status = session?.status;

  const dotColor =
    status === "running"
      ? "#2ecc71"
      : status === "stopped"
      ? "#e74c3c"
      : "#95a5a6";

  const statusText =
    status === "running"
      ? "Drying"
      : status === "stopped"
      ? "Stopped"
      : "Idle";

  const latestLog =
    session?.sensor_logs?.[session.sensor_logs.length - 1];

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
    { key: "moisture_sensor", label: "Moisture Sensor" },
  ];

  return (
    <ScrollView>

      <Text style={styles.title}>OVERVIEW</Text>

      <View style={styles.statusRow}>
        <Text style={styles.label}>Machine Status:</Text>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.bold}>{statusText}</Text>
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

          const found = hardware_statuses?.find(
            (item: any) => item.component_name === component.key
          );

          const statusValue = found?.status ?? null;

          const color =
            statusValue === "working"
              ? "#2ecc71"
              : statusValue === "not_working"
              ? "#e74c3c"
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
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 15,
  },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },

  label: { color: "#444" },
  bold: { fontWeight: "600" },

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
    fontWeight: "600",
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