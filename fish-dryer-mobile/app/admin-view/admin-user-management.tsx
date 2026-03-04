import React from "react";
import { View, Text, StyleSheet } from "react-native";

export default function AdminUserManagement() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>User Management</Text>
      <Text>No users available.</Text>
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