import React, { useState } from "react";
import {
  ScrollView,
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
} from "react-native";

export default function OverviewControlPanel({ session }: any) {
  const [batches, setBatches] = useState([
    {
      frontImage: null,
      backImage: null,
      fully_dried: "--",
      partially_dried: "--",
      not_dried: "--",
      description: "--",
    },
  ]);

  const addBatch = () => {
    setBatches((prev) => [
      ...prev,
      {
        frontImage: null,
        backImage: null,
        fully_dried: "--",
        partially_dried: "--",
        not_dried: "--",
        description: "--",
      },
    ]);
  };

  const captureImage = (index: number, side: "front" | "back") => {
    console.log("Capture", side, "for batch", index);
    // Here you will later integrate Expo Camera
  };

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{ padding: 15, paddingBottom: 120 }}
    >
      <Text style={styles.title}>OVERVIEW</Text>

      {/* CONTROL PANEL CARD */}
      <View style={styles.card}>
        <Text style={styles.header}>Control Panel</Text>

        <Input label="Fish Species" value={session?.fish_type} />
        <Input label="No. of Fish" value={session?.quantity} />
        <Input label="Target Moisture (%)" value={session?.target_moisture} />
        <Input label="Set Humidity (%)" value={session?.target_humidity} />
        <Input label="Set Temperature (°C)" value={session?.target_temperature} />
        <Input label="Fan Speed" value={session?.fan_speed} />
        <Input label="Duration (minutes)" value={session?.planned_duration_minutes} />

        <View style={styles.actions}>
          <Button color="#2ecc71" text="Start" />
          <Button color="#f1c40f" text="Pause" textColor="#000" />
          <Button color="#e74c3c" text="Stop" />
        </View>
      </View>

      {/* BATCH EVALUATION */}
      <View style={styles.card}>
        <View style={styles.batchHeader}>
          <Text style={styles.header}>Batch Evaluation</Text>
          <TouchableOpacity style={styles.addBtn} onPress={addBatch}>
            <Text style={{ color: "#fff" }}>+ Add Batch</Text>
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator>
          {batches.map((batch, index) => (
            <View key={index} style={styles.batchCard}>
              <Text style={{ fontWeight: "600" }}>
                Batch {index + 1}
              </Text>

              {/* CAPTURE BUTTONS */}
              <TouchableOpacity
                style={styles.captureBtn}
                onPress={() => captureImage(index, "front")}
              >
                <Text style={{ color: "#fff" }}>Capture Front</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.captureBtn}
                onPress={() => captureImage(index, "back")}
              >
                <Text style={{ color: "#fff" }}>Capture Back</Text>
              </TouchableOpacity>

              <View style={styles.imageBox}>
                <Text>Front Image</Text>
              </View>

              <View style={styles.imageBox}>
                <Text>Back Image</Text>
              </View>

              <Text style={{ marginTop: 10, fontWeight: "600" }}>Status</Text>

              {renderStatus("Fully Dried", batch.fully_dried)}
              {renderStatus("Partially Dried", batch.partially_dried)}
              {renderStatus("Not Dried", batch.not_dried)}
              {renderStatus("Description", batch.description)}
            </View>
          ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

function renderStatus(label: string, value: string) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 4 }}>
      <Text>{label}:</Text>
      <Text>{value}</Text>
    </View>
  );
}

function Input({ label, value }: any) {
  return (
    <View style={{ marginBottom: 12 }}>
      <Text>{label}</Text>
      <TextInput
        defaultValue={value ? String(value) : ""}
        style={{
          borderWidth: 1,
          borderColor: "#ccc",
          borderRadius: 6,
          padding: 8,
          marginTop: 5,
        }}
      />
    </View>
  );
}

function Button({ color, text, textColor = "#fff" }: any) {
  return (
    <TouchableOpacity style={[styles.btn, { backgroundColor: color }]}>
      <Text style={{ color: textColor, fontWeight: "600" }}>{text}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: "700", marginBottom: 15 },
  card: { backgroundColor: "#fff", borderRadius: 12, padding: 15, marginBottom: 20, elevation: 2 },
  header: { fontWeight: "600", marginBottom: 10 },
  actions: { flexDirection: "row", justifyContent: "space-between", marginTop: 10 },
  btn: { padding: 10, borderRadius: 6, width: 90, alignItems: "center" },
  batchHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 10 },
  addBtn: { backgroundColor: "#0d3b66", padding: 6, borderRadius: 6 },
  batchCard: { width: 260, marginRight: 15 },
  captureBtn: {
    backgroundColor: "#0d3b66",
    padding: 8,
    borderRadius: 6,
    marginTop: 8,
    alignItems: "center",
  },
  imageBox: {
    height: 90,
    backgroundColor: "#ddd",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 8,
    borderRadius: 6,
  },
});