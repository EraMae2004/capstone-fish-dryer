import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function AdminOverview() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Admin Overview</Text>
      <Text>Total Machines: 0</Text>
      <Text>Active Sessions: 0</Text>
      <Text>Total Users: 0</Text>
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