import React, { useEffect, useState } from "react";
import { View, TouchableOpacity, Text, StyleSheet, ActivityIndicator } from "react-native";
import OverviewStatus from "./overview-status";
import OverviewParameters from "./overview-parameters";
import { API_BASE_URL } from "@/config/api";

export default function UserOverview() {

  // ✅ DEFAULT = PARAMETERS
  const [activeTab, setActiveTab] = useState<"status" | "control">("control");

  const [machine, setMachine] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [hardwareStatuses, setHardwareStatuses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // PARAMETERS STATE
  const [fishType, setFishType] = useState("");
  const [totalFish, setTotalFish] = useState("");
  const [temperature, setTemperature] = useState("");
  const [fanSpeed, setFanSpeed] = useState("");
  const [duration, setDuration] = useState("");
  const [recommendation, setRecommendation] = useState<any>(null);

  useEffect(() => {
    fetchOverview();
  }, []);

  const fetchOverview = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/mobile/overview`, {
        headers: { Accept: "application/json" }
      });

      const data = await res.json();

      setMachine(data.machine);
      setSession(data.session);
      setHardwareStatuses(data.hardware_statuses);

      const recRes = await fetch(`${API_BASE_URL}/mobile/recommendation`, {
        headers: { Accept: "application/json" }
      });
      const recData = await recRes.json();
      if (recData?.success) {
        setRecommendation(recData.recommendation);
      }

    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  };

  // MACHINE ACTIONS (CONNECT TO API LATER)
  const startMachine = () => {};
  const pauseMachine = () => {};
  const stopMachine = () => {};
  const applyRecommendation = () => {
    if (!recommendation) return;
    setTemperature(String(recommendation.temperature ?? ""));
    setFanSpeed(String(recommendation.fan_speed ?? ""));
    setDuration(String(recommendation.duration_minutes ?? ""));
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, paddingBottom: 70 }}>

      <View style={{ flex: 1 }}>
        {activeTab === "status" ? (
          <OverviewStatus
            machine={machine}
            session={session}
            hardware_statuses={hardwareStatuses}
          />
        ) : (
          <OverviewParameters
            fishType={fishType}
            setFishType={setFishType}
            totalFish={totalFish}
            setTotalFish={setTotalFish}
            temperature={temperature}
            setTemperature={setTemperature}
            fanSpeed={fanSpeed}
            setFanSpeed={setFanSpeed}
            duration={duration}
            setDuration={setDuration}
            startMachine={startMachine}
            pauseMachine={pauseMachine}
            stopMachine={stopMachine}
            machineStatus={session?.status ?? machine?.status ?? "idle"}
            machineName={machine?.name ?? "Machine"}
            timer={session?.drying_time_minutes ? `${session.drying_time_minutes} mins` : "--"}
            recommendation={recommendation}
            applyRecommendation={applyRecommendation}
          />
        )}
      </View>

      {/* ✅ KEEP BUTTONS */}
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
  center: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center"
  },

  bottomNav: {
    flexDirection: "row",
    backgroundColor: "#3a5166",
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },

  navBtn: {
    flex: 1,
    padding: 18,
    alignItems: "center"
  },

  active: {
    backgroundColor: "#2f4456"
  },

  navText: {
    color: "#fff",
    fontWeight: "600"
  }
});