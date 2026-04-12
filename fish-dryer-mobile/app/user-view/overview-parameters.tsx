import React from "react";
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from "react-native";

export default function OverviewParameters({
  temperature,
  setTemperature,
  fanSpeed,
  setFanSpeed,
  duration,
  setDuration,
  startMachine,
  pauseMachine,
  stopMachine
}: any) {

  return (
    <View style={styles.card}>

      <Text style={styles.cardTitle}>Control Panel</Text>

      <TextInput
        placeholder="Temperature"
        value={temperature}
        onChangeText={setTemperature}
        style={styles.input}
        keyboardType="numeric"
      />

      <TextInput
        placeholder="Fan Speed"
        value={fanSpeed}
        onChangeText={setFanSpeed}
        style={styles.input}
        keyboardType="numeric"
      />

      <TextInput
        placeholder="Duration (minutes)"
        value={duration}
        onChangeText={setDuration}
        style={styles.input}
        keyboardType="numeric"
      />

      <View style={styles.buttonRow}>

        <TouchableOpacity style={styles.startBtn} onPress={startMachine}>
          <Text style={styles.btnText}>▶ Start</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.pauseBtn} onPress={pauseMachine}>
          <Text style={styles.btnText}>|| Pause</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.stopBtn} onPress={stopMachine}>
          <Text style={styles.btnText}>■ Stop</Text>
        </TouchableOpacity>

      </View>

    </View>
  );
}

const styles = StyleSheet.create({

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 15,
    marginBottom: 20,
    elevation: 3,
  },

  cardTitle: {
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 35,
    color: "#1f3c5c",
  },

  input: {
    backgroundColor: "#f5f5f5",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ccc",
    padding: 12,
    marginBottom: 12,
  },

  buttonRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 10,
    marginTop: 10,
    },

    startBtn: {
    flex: 1,
    maxWidth: 100,
    backgroundColor: "#2ecc71",
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
    },

    pauseBtn: {
    flex: 1,
    maxWidth: 100,
    backgroundColor: "#f1c40f",
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
    },

    stopBtn: {
    flex: 1,
    maxWidth: 100,
    backgroundColor: "#e74c3c",
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: "center",
    },

  btnText: {
    color: "#fff",
    fontWeight: "600",
  }

});