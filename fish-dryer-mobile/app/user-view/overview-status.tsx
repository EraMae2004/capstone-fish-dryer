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

  const hardwareComponents = [
    "esp32",
    "lcd",
    "fan",
    "buzzer",
    "led",
    "temp_humidity_sensor",
    "moisture_sensor",
  ];

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: "#f4f6f8" }}
      contentContainerStyle={{ padding: 15, paddingBottom: 120 }}
    >
      {/* OVERVIEW TITLE */}
      <Text style={styles.title}>OVERVIEW</Text>

      {/* STATUS LINE */}
      <View style={styles.statusRow}>
        <Text style={styles.label}>Machine Status:</Text>
        <View style={[styles.dot, { backgroundColor: dotColor }]} />
        <Text style={styles.bold}>{statusText}</Text>
      </View>

      {/* DROPDOWN */}
      <View style={styles.dropdown}>
        <Text>{machine?.name ?? "No Machine"}</Text>
      </View>

      {/* CURRENT DETAILS */}
      <View style={styles.card}>
        <Text style={styles.cardHeader}>Current Details</Text>

        {renderRow("Type of Fish", session?.fish_type)}
        {renderRow("No. of Fish",
          session?.quantity
            ? session.quantity + " " + session.quantity_unit
            : null
        )}
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
        {renderRow("Target Moisture",
          session?.target_moisture
            ? session.target_moisture + "%"
            : null
        )}
        {renderRow("Fan Speed",
          session?.fan_speed
            ? "Level " + session.fan_speed
            : null
        )}
        {renderRow("Remaining Time", session?.remaining_time)}
      </View>

      {/* HARDWARE STATUS — ALWAYS VISIBLE */}
      <View style={styles.card}>
        <Text style={styles.cardHeader}>Hardware Status</Text>

        {hardwareComponents.map((component, index) => {

          const found = hardware_statuses?.find(
            (item: any) => item.component_name === component
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
              <Text style={styles.label}>
                {component.replaceAll("_", " ").toUpperCase()}
              </Text>

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