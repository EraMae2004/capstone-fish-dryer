import React, { useEffect, useState } from "react";
import { View, TouchableOpacity, Text, StyleSheet, ActivityIndicator } from "react-native";
import OverviewStatus from "./overview-status";
import OverviewControlPanel from "./overview-control-panel";

const API_URL = "https://spinproof-brineless-marleen.ngrok-free.dev/api/mobile/overview";

export default function UserOverview() {
  const [activeTab, setActiveTab] = useState<"status" | "control">("status");
  const [machine, setMachine] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [hardwareStatuses, setHardwareStatuses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchOverview();
  }, []);

  const fetchOverview = async () => {
    try {
      const res = await fetch(API_URL, {
        headers: {
          Accept: "application/json",
          "ngrok-skip-browser-warning": "true"
        }
      });
      const data = await res.json();
      setMachine(data.machine);
      setSession(data.session);
      setHardwareStatuses(data.hardware_statuses);
    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        {activeTab === "status" ? (
          <OverviewStatus
            machine={machine}
            session={session}
            hardware_statuses={hardwareStatuses}
          />
        ) : (
          <OverviewControlPanel
            session={session}
          />
        )}
      </View>

      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={[styles.navBtn, activeTab === "status" && styles.active]}
          onPress={() => setActiveTab("status")}
        >
          <Text style={styles.navText}>Status</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, activeTab === "control" && styles.active]}
          onPress={() => setActiveTab("control")}
        >
          <Text style={styles.navText}>Control Panel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: "center", alignItems: "center" },
  bottomNav: { flexDirection: "row", backgroundColor: "#3a5166" },
  navBtn: { flex: 1, padding: 18, alignItems: "center" },
  active: { backgroundColor: "#2f4456" },
  navText: { color: "#fff", fontWeight: "600" }
});