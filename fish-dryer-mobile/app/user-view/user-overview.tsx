import React, { useEffect, useRef, useState } from "react";
import { View, TouchableOpacity, Text, StyleSheet, ActivityIndicator, Alert } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { onValue, ref as dbRef, type DataSnapshot } from "firebase/database";
import OverviewStatus from "./overview-status";
import OverviewParameters from "./overview-parameters";
import { API_BASE_URL } from "@/config/api";
import { firebaseDb } from "@/config/firebase";

const LIVE_LAST_SEEN_MS = 90_000;

function parseIsoMs(iso: unknown): number | null {
  if (!iso) return null;
  const d = new Date(String(iso));
  const t = d.getTime();
  return Number.isFinite(t) ? t : null;
}

function isMachineLive(machine: any): boolean {
  if (!machine) return false;
  const raw = String(machine?.status ?? "")
    .trim()
    .toLowerCase();
  const apiOnline = raw === "online" || raw === "true" || raw === "1";
  const lastSeenMs = parseIsoMs(machine?.last_seen);
  const seenRecently =
    lastSeenMs !== null ? Date.now() - lastSeenMs <= LIVE_LAST_SEEN_MS : false;
  return apiOnline && seenRecently;
}

export default function UserOverview() {

  // ✅ DEFAULT = PARAMETERS
  const [activeTab, setActiveTab] = useState<"status" | "control">("control");

  const [machine, setMachine] = useState<any>(null);
  const [session, setSession] = useState<any>(null);
  const [hardwareStatuses, setHardwareStatuses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  /** RTDB `machines/{id}/hardware_status.updated_at` — same path Laravel mirrors on heartbeat. */
  const [overviewRtdbUpdatedAtMs, setOverviewRtdbUpdatedAtMs] = useState<number | null>(null);
  /** Ref: polling must not clobber RTDB-driven hardware rows (interval closure stays fresh). */
  const overviewHardwareFromRtdbRef = useRef(false);

  // PARAMETERS STATE
  const [fishType, setFishType] = useState("");
  const [totalFish, setTotalFish] = useState("");
  const [temperature, setTemperature] = useState("");
  const [fanSpeed, setFanSpeed] = useState("");
  const [duration, setDuration] = useState("");
  const [recommendation, setRecommendation] = useState<any>(null);
  const [needsExtension, setNeedsExtension] = useState(false);

  useEffect(() => {
    fetchOverview();
  }, []);

  /**
   * Single effect: reset RTDB flags *before* subscribe so another effect cannot run after
   * onValue and clear overviewHardwareFromRtdbRef (that made polling wipe live rows).
   */
  useEffect(() => {
    if (!firebaseDb) {
      setOverviewRtdbUpdatedAtMs(null);
      overviewHardwareFromRtdbRef.current = false;
      return;
    }

    if (!machine?.id) {
      setOverviewRtdbUpdatedAtMs(null);
      overviewHardwareFromRtdbRef.current = false;
      return;
    }

    setOverviewRtdbUpdatedAtMs(null);
    overviewHardwareFromRtdbRef.current = false;

    const r = dbRef(firebaseDb, `machines/${machine.id}/hardware_status`);
    const unsub = onValue(
      r,
      (snap: DataSnapshot) => {
        const val = snap.val();
        if (!val || typeof val !== "object") {
          setOverviewRtdbUpdatedAtMs(null);
          overviewHardwareFromRtdbRef.current = false;
          return;
        }

        const updatedMs = parseIsoMs((val as Record<string, unknown>).updated_at);
        setOverviewRtdbUpdatedAtMs(updatedMs);

        const componentsMap =
          (val as Record<string, unknown>).components &&
          typeof (val as Record<string, unknown>).components === "object"
            ? (val as Record<string, unknown>).components
            : val;

        if (!componentsMap || typeof componentsMap !== "object") return;

        const skip = new Set([
          "components",
          "updated_at",
          "microcontroller_id",
          "device_id",
        ]);

        const rows = Object.entries(componentsMap as Record<string, unknown>)
          .filter(([k]) => !skip.has(k))
          .map(([component_name, status]) => ({
            component_name,
            status: String(status ?? "unknown"),
          }));

        if (rows.length) {
          setHardwareStatuses(rows);
          overviewHardwareFromRtdbRef.current = true;
        }
      },
      (err: unknown) => {
        console.log("Overview hardware_status RTDB:", err);
      }
    );

    return () => {
      unsub();
      setOverviewRtdbUpdatedAtMs(null);
      overviewHardwareFromRtdbRef.current = false;
    };
  }, [machine?.id]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchOverview();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => {
      fetchRecommendation();
    }, 350);
    return () => clearTimeout(timeout);
  }, [fishType, temperature, fanSpeed, duration]);

  const fetchOverview = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/mobile/overview`, {
        headers: { Accept: "application/json" }
      });

      const data = await res.json();

      setMachine(data.machine);
      setSession(data.session);
      if (!firebaseDb || !overviewHardwareFromRtdbRef.current) {
        setHardwareStatuses(data.hardware_statuses ?? []);
      }
      fetchRecommendation(data.session);

    } catch (err) {
      console.log(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchRecommendation = async (sessionOverride?: any) => {
    try {
      const activeSession = sessionOverride ?? session;
      const elapsed = Number(activeSession?.drying_time_minutes ?? 0);
      const params = new URLSearchParams();
      if (fishType) params.append("fish_type", fishType);
      if (temperature) params.append("temperature", temperature);
      if (fanSpeed) params.append("fan_speed", fanSpeed);
      params.append("elapsed_minutes", String(elapsed));

      const url = `${API_BASE_URL}/mobile/recommendation?${params.toString()}`;
      const recRes = await fetch(url, { headers: { Accept: "application/json" } });
      const recData = await recRes.json();
      if (recData?.success) {
        setRecommendation(recData.recommendation);
        setNeedsExtension(Boolean(recData.needs_extension));
      }
    } catch (err) {
      console.log(err);
    }
  };

  const postSessionControl = async (action: "start" | "pause" | "stop") => {
    try {
      const raw = await AsyncStorage.getItem("user");
      if (!raw) {
        Alert.alert("Not logged in", "Please login again.");
        return;
      }

      const user = JSON.parse(raw);
      const userId = Number(user?.id);
      const microcontrollerId = Number(machine?.id);

      if (!Number.isFinite(userId) || userId <= 0) {
        Alert.alert("Missing user", "Could not read user id from storage.");
        return;
      }

      if (!Number.isFinite(microcontrollerId) || microcontrollerId <= 0) {
        Alert.alert("No machine", "Overview has no selected microcontroller yet.");
        return;
      }

      const body: Record<string, unknown> = {
        user_id: userId,
        microcontroller_id: microcontrollerId,
        action,
      };

      if (action === "start") {
        const ft = fishType.trim();
        const tf = Number.parseInt(String(totalFish).trim(), 10);
        const tt = Number.parseFloat(String(temperature).trim());
        const fs = Number.parseInt(String(fanSpeed || "1").trim(), 10);
        const dm = Number.parseInt(String(duration).trim(), 10);

        if (!ft) {
          Alert.alert("Missing field", "Fish type is required to start.");
          return;
        }
        if (!Number.isFinite(tf) || tf < 0) {
          Alert.alert("Missing field", "Number of fish is required to start.");
          return;
        }
        if (!Number.isFinite(tt)) {
          Alert.alert("Missing field", "Target temperature is required to start.");
          return;
        }
        if (!Number.isFinite(fs) || fs < 1 || fs > 3) {
          Alert.alert("Invalid fan speed", "Fan speed must be between 1 and 3.");
          return;
        }
        if (!Number.isFinite(dm) || dm < 1) {
          Alert.alert("Missing field", "Duration (minutes) is required to start.");
          return;
        }

        body.fish_type = ft;
        body.total_fish = tf;
        body.target_temperature = tt;
        body.fan_speed = fs;
        body.set_duration_minutes = dm;
      }

      const res = await fetch(`${API_BASE_URL}/mobile/drying-session/control`, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success === false) {
        Alert.alert("Control failed", String(data?.message ?? "Request failed."));
        return;
      }

      await fetchOverview();
      Alert.alert("OK", action === "start" ? "Drying started." : action === "pause" ? "Paused." : "Stopped.");
    } catch (e) {
      console.log(e);
      Alert.alert("Control failed", "Network error while contacting the API.");
    }
  };

  const startMachine = () => {
    void postSessionControl("start");
  };
  const pauseMachine = () => {
    void postSessionControl("pause");
  };
  const stopMachine = () => {
    void postSessionControl("stop");
  };
  const applyRecommendation = () => {
    if (!recommendation) return;
    setTemperature(String(recommendation.temperature ?? ""));
    setFanSpeed(String(recommendation.fan_speed ?? ""));
    const autoDuration = needsExtension
      ? (recommendation.extension_minutes ?? recommendation.duration_minutes ?? "")
      : (recommendation.duration_minutes ?? "");
    setDuration(String(autoDuration));
  };

  const machineOnline = isMachineLive(machine);

  const overviewRtdbRecent =
    Boolean(firebaseDb) &&
    overviewRtdbUpdatedAtMs !== null &&
    Date.now() - overviewRtdbUpdatedAtMs <= LIVE_LAST_SEEN_MS;
  const overviewHardwareStreamFresh = machineOnline || overviewRtdbRecent;

  const sessionStatus = String(session?.status ?? "").trim().toLowerCase();
  const controlStatusLabel = !machine
    ? "idle"
    : !machineOnline
      ? "offline"
      : sessionStatus === "running" || sessionStatus === "paused"
        ? sessionStatus
        : "idle";

  const dryingMinutes = session?.drying_time_minutes;
  const timerLabel =
    dryingMinutes === null || dryingMinutes === undefined || Number.isNaN(Number(dryingMinutes))
      ? "--"
      : `${Number(dryingMinutes)} mins`;

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
            hardwareStreamFresh={overviewHardwareStreamFresh}
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
            machineStatus={controlStatusLabel}
            machineName={machine?.name ?? "Machine"}
            timer={timerLabel}
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