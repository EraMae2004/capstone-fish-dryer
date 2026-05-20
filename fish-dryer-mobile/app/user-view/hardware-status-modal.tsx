import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from "react-native";
import { FontAwesome as Icon } from "@expo/vector-icons";

type Microcontroller = {
  id: string;
  name: string;
  device_id?: string;
  /** Hardware MAC ("AA:BB:CC:DD:EE:FF") — used to write assignments/{MAC} so the
   *  ESP32 can adopt its numeric ID at runtime without a reflash. */
  mac?: string;
  display_name?: string | null;
  /** Short line from RTDB components (discovery / hardware_status). */
  sensorSummary?: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSave: (name: string, selected: Microcontroller | null) => Promise<void>;
  onDetect: () => Promise<Microcontroller[]>;
};

export default function HardwareStatusModal({
  visible,
  onClose,
  onSave,
  onDetect,
}: Props) {
  const [machineName, setMachineName] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [controllers, setControllers] = useState<Microcontroller[]>([]);
  const [selected, setSelected] = useState<Microcontroller | null>(null);

  const [scanning, setScanning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 🔁 START CONTINUOUS SCANNING
  const startScanning = () => {
    if (scanning) return;

    setScanning(true);
    setLoading(true);
    const runDetect = async () => {
      try {
        const result = await onDetect();
        setControllers(Array.isArray(result) ? result : []);
      } catch (e) {
        console.log(e);
        setControllers([]);
      }
    };

    runDetect(); // immediate detect
    intervalRef.current = setInterval(runDetect, 2000); // scan every 2 sec
  };

  // 🛑 STOP SCANNING
  const stopScanning = () => {
    setScanning(false);
    setLoading(false);

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  // ❗ STOP when dropdown closes or modal closes
  useEffect(() => {
    if (!dropdownOpen) stopScanning();
  }, [dropdownOpen]);

  useEffect(() => {
    if (!visible) {
      stopScanning();
      setDropdownOpen(false);
      return;
    }

    // Auto-detect on modal open.
    setDropdownOpen(true);
    startScanning();
  }, [visible]);

  const handleSavePress = async () => {
    if (saving) return;
    if (!selected?.id) {
      // Saving requires a detected board so we never accidentally invent/overwrite hardware IDs.
      return;
    }
    setSaving(true);
    try {
      await onSave(machineName, selected);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.overlay}>
        <View style={styles.modal}>
          {/* HEADER */}
          <View style={styles.header}>
            <Text style={styles.title}>Add Machine</Text>
            <TouchableOpacity onPress={onClose}>
              <Icon name="times" size={18} />
            </TouchableOpacity>
          </View>

          {/* INPUT */}
          <Text style={styles.label}>Machine Name</Text>
          <TextInput
            style={styles.input}
            placeholder="enter your machine name"
            value={machineName}
            onChangeText={setMachineName}
          />

          {/* DROPDOWN */}
          <Text style={styles.label}>Select Microcontrollers</Text>

          <TouchableOpacity
            style={styles.dropdown}
            onPress={() => setDropdownOpen(!dropdownOpen)}
          >
            <Text style={{ color: selected ? "#000" : "#888" }}>
              {selected
                ? `${selected.name}${selected.device_id ? ` (${selected.device_id})` : ""}`
                : "Tap to detect & select"}
            </Text>
          </TouchableOpacity>

          {dropdownOpen && (
            <View style={styles.dropdownList}>
              {/* DETECT HEADER */}
              <View style={styles.detectHeader}>
                <TouchableOpacity onPress={startScanning}>
                  <Text style={styles.detectText}>
                    Detect Microcontrollers
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity onPress={startScanning}>
                  <Text style={styles.refresh}>Refresh</Text>
                </TouchableOpacity>
              </View>

              {/* LIST */}
              {controllers.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={styles.item}
                  onPress={() => {
                    setSelected(c);
                    setDropdownOpen(false);
                    stopScanning();
                  }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "600" }}>{c.name}</Text>
                    {!!c.device_id && (
                      <Text style={{ marginTop: 2, fontSize: 12, color: "#666" }}>
                        ID: {c.device_id}
                      </Text>
                    )}
                    {!!c.sensorSummary && (
                      <Text style={{ marginTop: 4, fontSize: 11, color: "#888" }} numberOfLines={2}>
                        {c.sensorSummary}
                      </Text>
                    )}
                  </View>
                  <View style={styles.greenDot} />
                </TouchableOpacity>
              ))}

              {/* LOADING ROW (SPINNER ALWAYS ROTATING) */}
              {scanning && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#1f4e6c" />
                  <Text style={{ marginLeft: 8 }}>
                    Detecting Microcontrollers...
                  </Text>
                </View>
              )}
            </View>
          )}

          {/* ACTIONS */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.save, !selected?.id && { opacity: 0.45 }]}
              onPress={handleSavePress}
              disabled={saving || !selected?.id}
            >
              <Text style={{ color: "#fff" }}>{saving ? "Saving..." : "Save"}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.cancel}
              onPress={() => {
                stopScanning();
                onClose();
              }}
            >
              <Text style={{ color: "#fff" }}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 20,
  },

  modal: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 20,
  },

  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 15,
  },

  title: { fontSize: 18, fontWeight: "700" },

  label: { marginBottom: 5, fontWeight: "600" },

  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 6,
    padding: 10,
    marginBottom: 15,
  },

  dropdown: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    padding: 12,
  },

  dropdownList: {
    borderWidth: 1,
    borderColor: "#ccc",
    marginTop: 5,
  },

  detectHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 10,
    backgroundColor: "#eee",
  },

  detectText: { fontSize: 12 },
  refresh: { fontSize: 12 },

  item: {
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 10,
  },

  greenDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "green",
  },

  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
  },

  actions: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 20,
  },

  save: {
    backgroundColor: "#1f4e6c",
    padding: 10,
    borderRadius: 6,
    width: "48%",
    alignItems: "center",
  },

  cancel: {
    backgroundColor: "#7f8c8d",
    padding: 10,
    borderRadius: 6,
    width: "48%",
    alignItems: "center",
  },
});