import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function AdminDryingMachines() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Drying Machines</Text>
      <Text>No machines added yet.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  title: {
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 15,
  },
});