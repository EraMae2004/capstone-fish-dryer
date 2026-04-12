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

  // ✅ FINAL HARDWARE LIST (MATCHES YOUR SYSTEM EXACTLY)
  const hardwareComponents = [
    { key: "esp32", label: "ESP32 Controller" },
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

    { key: "temp_humidity_sensor", label: "Temperature & Humidity Sensor" },
    { key: "moisture_sensor", label: "Moisture Sensor" },
  ];

  return (
    <ScrollView>
      {/* OVERVIEW TITLE */}
      <Text style={styles.title}>OVERVIEW</Text>

      {/* STATUS */}
      <View style={styles.statusRow}>
        <Text style={styles.label}>Machine Status:</Text>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.bold}>{statusText}</Text>
      </View>

      {/* MACHINE NAME */}
      <View style={styles.dropdown}>
        <Text>{machine?.name ?? "No Machine"}</Text>
      </View>

      {/* ✅ CURRENT DETAILS (FIXED) */}
      <View style={styles.card}>
        <Text style={styles.cardHeader}>Current Details</Text>

        {renderRow("Current Temp",
          session?.final_temperature
            ? session.final_temperature + "°C"
            : null
        )}

        {renderRow("Target Temp",
          session?.target_temperature
            ? session.target_temperature + "°C"
            : null
        )}

        {renderRow("Humidity",
          session?.final_humidity
            ? session.final_humidity + "%"
            : null
        )}

        {renderRow("Current Moisture",
          session?.final_moisture
            ? session.final_moisture + "%"
            : null
        )}

        {renderRow("Fan Speed",
          session?.fan_speed
            ? "Level " + session.fan_speed
            : null
        )}

        {renderRow("Drying Time",
          session?.drying_time_minutes
            ? session.drying_time_minutes + " mins"
            : null
        )}
      </View>

      {/* ✅ HARDWARE STATUS */}
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
    color: "#1f2d3d",
  },

  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },

  label: {
    color: "#444",
  },

  bold: {
    fontWeight: "600",
  },

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
    elevation: 2,
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