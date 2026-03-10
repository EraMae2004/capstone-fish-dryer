import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  SafeAreaView,
  StatusBar,
  Dimensions,
  Alert,
} from "react-native";
import { FontAwesome as Icon } from "@expo/vector-icons";
import { API_BASE_URL } from "@/config/api";

const { width } = Dimensions.get("window");

const HardwareStatus = () => {
  const [machines, setMachines] = useState<any[]>([]);
  const [components, setComponents] = useState<any[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const [modalVisible, setModalVisible] = useState(false);
  const [machineName, setMachineName] = useState("");

  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    loadMachines();
  }, []);

  const apiRequest = async (endpoint: string, options: RequestInit = {}) => {
    try {
      const res = await fetch(`${API_BASE_URL}${endpoint}`, {
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {}),
        },
        ...options,
      });

      const data = await res.json();

      if (!res.ok) throw new Error(data.message || "API Error");

      return data;
    } catch (err) {
      throw new Error((err as Error).message);
    }
  };

  const loadMachines = async () => {
    try {
      setLoading(true);
      setApiError(null);

      const res = await apiRequest("/machines");

      if (res?.data) {
        setMachines(res.data);

        if (res.data.length) {
          setSelectedMachine(res.data[0]);
          loadComponents(res.data[0].id);
        }
      }
    } catch (err) {
      setApiError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const loadComponents = async (machineId: number) => {
    try {
      const res = await apiRequest(`/machines/${machineId}/components`);

      if (res?.data) setComponents(res.data);
    } catch (err) {
      console.log(err);
    }
  };

  const handleTestAll = async () => {
    if (!selectedMachine) return;

    try {
      await apiRequest(`/machines/${selectedMachine.id}/components/test-all`, {
        method: "POST",
      });

      loadComponents(selectedMachine.id);

      Alert.alert("Success", "All components tested");
    } catch (err) {
      Alert.alert("Error", (err as Error).message);
    }
  };

  const handleTestComponent = async (componentName: string) => {
    if (!selectedMachine) return;

    try {
      await apiRequest(
        `/machines/${selectedMachine.id}/components/${componentName}/test`,
        { method: "POST" }
      );

      loadComponents(selectedMachine.id);
    } catch (err) {
      Alert.alert("Error", (err as Error).message);
    }
  };

  const handleAddMachine = async () => {
    if (!machineName.trim()) return;

    try {
      await apiRequest("/machines", {
        method: "POST",
        body: JSON.stringify({
          name: machineName,
        }),
      });

      setMachineName("");
      setModalVisible(false);

      loadMachines();

      Alert.alert("Success", "Machine added");
    } catch (err) {
      Alert.alert("Error", (err as Error).message);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case "working":
        return "#2ecc71";
      case "not_working":
        return "#e74c3c";
      case "warning":
        return "#f39c12";
      default:
        return "#95a5a6";
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1f4e6c" />
        <Text>Loading hardware...</Text>
      </View>
    );
  }

  if (apiError) {
    return (
      <View style={styles.center}>
        <Icon name="exclamation-triangle" size={50} color="#e74c3c" />
        <Text style={styles.error}>{apiError}</Text>

        <TouchableOpacity style={styles.retry} onPress={loadMachines}>
          <Text style={{ color: "#fff" }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Hardware Status</Text>

        {/* Machines */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          {machines.map((m: any) => (
            <TouchableOpacity
              key={m.id}
              style={styles.machineCard}
              onPress={() => {
                setSelectedMachine(m);
                loadComponents(m.id);
              }}
            >
              <Text style={styles.machineName}>{m.name}</Text>
              <Text>Status: {m.status}</Text>
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={styles.addMachine}
            onPress={() => setModalVisible(true)}
          >
            <Icon name="plus" size={22} color="#fff" />
          </TouchableOpacity>
        </ScrollView>

        {/* Components */}
        <View style={styles.componentsCard}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>Hardware Components</Text>

            <TouchableOpacity style={styles.testAll} onPress={handleTestAll}>
              <Text style={{ color: "#fff" }}>Test All</Text>
            </TouchableOpacity>
          </View>

          {components.map((c: any) => (
            <View key={c.id} style={styles.componentRow}>
              <Text style={styles.componentName}>{c.component_name}</Text>

              <View
                style={[
                  styles.statusBadge,
                  { backgroundColor: getStatusColor(c.status) },
                ]}
              >
                <Text style={styles.statusText}>{c.status}</Text>
              </View>

              <TouchableOpacity
                style={styles.testBtn}
                onPress={() => handleTestComponent(c.component_name)}
              >
                <Icon name="play" size={12} color="#fff" />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      </ScrollView>

      {/* Add Machine Modal */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Add Machine</Text>

            <TextInput
              style={styles.input}
              placeholder="Machine Name"
              value={machineName}
              onChangeText={setMachineName}
            />

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancel}
                onPress={() => setModalVisible(false)}
              >
                <Text style={{ color: "#fff" }}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.save} onPress={handleAddMachine}>
                <Text style={{ color: "#fff" }}>Add Machine</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

export default HardwareStatus;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f5f5f5" },

  scroll: { padding: 20 },

  title: { fontSize: 22, fontWeight: "700", marginBottom: 20 },

  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  error: { marginVertical: 10, color: "#e74c3c" },

  retry: {
    backgroundColor: "#1f4e6c",
    padding: 10,
    borderRadius: 6,
  },

  machineCard: {
    backgroundColor: "#fff",
    padding: 15,
    borderRadius: 10,
    marginRight: 15,
    width: width * 0.6,
  },

  machineName: { fontWeight: "600", marginBottom: 5 },

  addMachine: {
    width: 60,
    height: 60,
    backgroundColor: "#1f4e6c",
    borderRadius: 30,
    justifyContent: "center",
    alignItems: "center",
  },

  componentsCard: {
    marginTop: 20,
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 15,
  },

  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },

  cardTitle: { fontSize: 16, fontWeight: "600" },

  testAll: {
    backgroundColor: "#1f4e6c",
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 6,
  },

  componentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },

  componentName: { fontSize: 14 },

  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },

  statusText: { color: "#fff", fontSize: 12 },

  testBtn: {
    backgroundColor: "#1f4e6c",
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 20,
  },

  modal: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 10,
  },

  modalTitle: { fontSize: 18, fontWeight: "600", marginBottom: 15 },

  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 6,
    padding: 10,
    marginBottom: 20,
  },

  modalButtons: { flexDirection: "row", justifyContent: "space-between" },

  cancel: {
    backgroundColor: "#7f8c8d",
    padding: 10,
    borderRadius: 6,
    width: "48%",
    alignItems: "center",
  },

  save: {
    backgroundColor: "#1f4e6c",
    padding: 10,
    borderRadius: 6,
    width: "48%",
    alignItems: "center",
  },
});