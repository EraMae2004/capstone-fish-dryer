import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
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
  /** Saved in the app already — shown in the list, but cannot be saved again. */
  alreadyExists?: boolean;
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
  const [scanSettled, setScanSettled] = useState(false);
  const [saving, setSaving] = useState(false);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectGenRef = useRef(0);
  const onDetectRef = useRef(onDetect);
  onDetectRef.current = onDetect;

  const stopScanning = () => {
    setScanning(false);
    detectGenRef.current += 1;
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  const startScanning = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const gen = detectGenRef.current + 1;
    detectGenRef.current = gen;
    setScanning(true);
    const runDetect = async () => {
      try {
        const result = await onDetectRef.current();
        if (detectGenRef.current !== gen) return;
        const rows = Array.isArray(result) ? result : [];
        setControllers(rows);
        setScanSettled(true);
        setSelected((prev) => {
          if (!prev) return prev;
          const still = rows.find(
            (row) =>
              row.id === prev.id ||
              (row.mac &&
                prev.mac &&
                row.mac.replace(/:/g, "").toUpperCase() ===
                  prev.mac.replace(/:/g, "").toUpperCase())
          );
          if (!still || still.alreadyExists) return null;
          return still;
        });
      } catch (e) {
        console.log(e);
        if (detectGenRef.current !== gen) return;
        setScanSettled(true);
      }
    };

    void runDetect();
    intervalRef.current = setInterval(() => {
      void runDetect();
    }, 2000);
  };

  useEffect(() => {
    if (!visible) {
      stopScanning();
      setDropdownOpen(false);
      setControllers([]);
      setSelected(null);
      setScanSettled(false);
      setMachineName("");
      return;
    }

    setDropdownOpen(true);
    startScanning();
    return () => stopScanning();
  }, [visible]);

  const canSave = Boolean(selected?.id) && !selected?.alreadyExists;

  const handleSavePress = async () => {
    if (saving || !canSave) return;
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
            onPress={() => {
              setDropdownOpen((open) => {
                if (!open) startScanning();
                return !open;
              });
            }}
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

              <ScrollView style={styles.detectScroll} nestedScrollEnabled>
              {controllers.map((c) => {
                const exists = Boolean(c.alreadyExists);
                return (
                  <TouchableOpacity
                    key={c.mac || c.device_id || c.id}
                    style={[styles.item, exists && styles.itemExists]}
                    disabled={exists}
                    onPress={() => {
                      if (exists) return;
                      setSelected(c);
                      setDropdownOpen(false);
                      stopScanning();
                    }}
                  >
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={{ fontWeight: "600", color: exists ? "#6b7280" : "#111" }}>
                        {c.name}
                      </Text>
                      {!!c.device_id && (
                        <Text style={{ marginTop: 2, fontSize: 12, color: "#666" }}>
                          ID: {c.device_id}
                        </Text>
                      )}
                      {!!c.mac && (
                        <Text style={{ marginTop: 2, fontSize: 11, color: "#888" }}>
                          {c.mac}
                        </Text>
                      )}
                      {!!c.sensorSummary && (
                        <Text style={{ marginTop: 4, fontSize: 11, color: "#888" }} numberOfLines={2}>
                          {c.sensorSummary}
                        </Text>
                      )}
                    </View>
                    {exists ? (
                      <Text style={styles.existsBadge}>Already exists</Text>
                    ) : (
                      <View style={styles.greenDot} />
                    )}
                  </TouchableOpacity>
                );
              })}

              {scanSettled && controllers.length === 0 && (
                <Text style={styles.emptyDetect}>
                  No powered microcontroller found. Turn the board on, connect it to Wi-Fi, then tap Refresh.
                </Text>
              )}

              {scanning && !scanSettled && (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#1f4e6c" />
                  <Text style={{ marginLeft: 8 }}>
                    Detecting Microcontrollers...
                  </Text>
                </View>
              )}

              {scanning && scanSettled && (
                <Text style={styles.listening}>Listening for powered boards...</Text>
              )}
              </ScrollView>
            </View>
          )}

          {/* ACTIONS */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.save, !canSave && { opacity: 0.45 }]}
              onPress={handleSavePress}
              disabled={saving || !canSave}
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

  detectScroll: {
    maxHeight: 280,
  },

  item: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    padding: 10,
  },

  itemExists: {
    backgroundColor: "#f4f5f7",
  },

  existsBadge: {
    color: "#9a6700",
    backgroundColor: "#fff4d6",
    borderRadius: 999,
    overflow: "hidden",
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: "700",
  },

  emptyDetect: {
    padding: 12,
    fontSize: 12,
    color: "#666",
  },

  listening: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    fontSize: 11,
    color: "#6b7280",
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