import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { FontAwesome } from "@expo/vector-icons";
import { onValue, ref as dbRef, type DataSnapshot } from "firebase/database";
import { userTypography } from "@/lib/user-typography";
import {
  useSelectedMachine,
  type UserMachine,
} from "@/lib/selected-machine";
import { useShellSidebarOpen } from "@/lib/shell-sidebar-context";
import { firebaseDb } from "@/config/firebase";
import {
  computeStableOnlineByMachineId,
  recordMachineRtdbDelivery,
} from "@/lib/machine-presence";

type MachineDropdownProps = {
  onMachineChange?: (machineId: number) => void;
  style?: object;
  machines?: UserMachine[];
  selectedId?: number | null;
  loading?: boolean;
  onSelect?: (machineId: number) => void;
};

const DROPDOWN_STATUS_TICK_MS = 500;

function toPositiveId(value: unknown): number | null {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export default function MachineDropdown({
  onMachineChange,
  style,
  machines: machinesProp,
  selectedId: selectedIdProp,
  loading: loadingProp,
  onSelect,
}: MachineDropdownProps) {
  const internal = useSelectedMachine();
  const machines = machinesProp ?? internal.machines;
  const selectedId = selectedIdProp ?? internal.selectedId;
  const loading = loadingProp ?? internal.loading;
  const pickMachine = onSelect ?? internal.selectMachine;

  const [open, setOpen] = useState(false);
  const sidebarOpen = useShellSidebarOpen();
  const rtdbReceiveRef = useRef<Record<number, number>>({});
  const rtdbPayloadRef = useRef<Record<number, number>>({});
  const rtdbSeenRef = useRef<Record<number, boolean>>({});
  const stableOnlineRef = useRef<Record<number, boolean>>({});
  const offlineStreakRef = useRef<Record<number, number>>({});
  const [stableOnlineById, setStableOnlineById] = useState<Record<number, boolean>>({});

  const machineIds = useMemo(
    () =>
      machines
        .map((m) => toPositiveId(m.id))
        .filter((id): id is number => id != null),
    [machines]
  );
  const machineIdsKey = machineIds.join(",");

  useEffect(() => {
    if (sidebarOpen) setOpen(false);
  }, [sidebarOpen]);

  useEffect(() => {
    if (!firebaseDb || machineIds.length === 0) {
      stableOnlineRef.current = {};
      setStableOnlineById({});
      return;
    }

    const ids = [...machineIds];
    const unsubs = ids.map((id) =>
      onValue(dbRef(firebaseDb, `machines/${id}/hardware_status`), (snap: DataSnapshot) => {
        const val = snap.val();
        if (!val || typeof val !== "object") return;

        const hw = val as Record<string, unknown>;
        const payloadMachineId = toPositiveId(hw.microcontroller_id);
        if (payloadMachineId != null && payloadMachineId !== id) return;

        const bumped = recordMachineRtdbDelivery(
          rtdbReceiveRef.current,
          rtdbPayloadRef.current,
          id,
          hw.updated_at,
          rtdbSeenRef.current,
          Date.now()
        );
        if (!bumped.accepted) return;

        rtdbReceiveRef.current = bumped.receiveById;
        rtdbPayloadRef.current = bumped.payloadById;
        const next = computeStableOnlineByMachineId(
          rtdbReceiveRef.current,
          stableOnlineRef.current,
          ids,
          Date.now(),
          offlineStreakRef.current,
          false
        );
        stableOnlineRef.current = next;
        setStableOnlineById(next);
      })
    );

    return () => {
      ids.forEach((id) => {
        delete rtdbSeenRef.current[id];
        delete rtdbReceiveRef.current[id];
        delete rtdbPayloadRef.current[id];
        delete stableOnlineRef.current[id];
        delete offlineStreakRef.current[id];
      });
      unsubs.forEach((unsub) => unsub());
    };
  }, [machineIdsKey]);

  useEffect(() => {
    if (!firebaseDb || machineIds.length === 0) return;

    const ids = [...machineIds];
    const interval = setInterval(() => {
      const next = computeStableOnlineByMachineId(
        rtdbReceiveRef.current,
        stableOnlineRef.current,
        ids,
        Date.now(),
        offlineStreakRef.current,
        true
      );
      stableOnlineRef.current = next;
      setStableOnlineById(next);
    }, DROPDOWN_STATUS_TICK_MS);

    return () => clearInterval(interval);
  }, [machineIdsKey]);

  const selectedMachine =
    machines.find((m) => m.id === selectedId) ?? null;

  const handleSelect = async (m: UserMachine) => {
    setOpen(false);
    if (m.id === selectedId) return;
    await pickMachine(m.id);
    onMachineChange?.(m.id);
  };

  const label = selectedMachine?.name ?? "No Machine";
  const statusLabelFor = (machine: UserMachine) => {
    if (firebaseDb) {
      return stableOnlineById[machine.id] ? "Online" : "Offline";
    }
    return machine.status ? (machine.status === "online" ? "Online" : "Offline") : null;
  };

  return (
    <View style={[styles.wrap, style]}>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setOpen((v) => !v)}
        disabled={loading || machines.length === 0}
        accessibilityRole="button"
        accessibilityLabel="Select drying machine"
      >
        {loading ? (
          <ActivityIndicator size="small" color="#1f3b57" style={styles.spinner} />
        ) : (
          <Text style={styles.triggerText} numberOfLines={1}>
            {label}
          </Text>
        )}
        <FontAwesome
          name={open ? "chevron-up" : "chevron-down"}
          size={14}
          color="#1f3b57"
        />
      </TouchableOpacity>

      {open && machines.length > 0 ? (
        <View style={styles.menu}>
          {machines.map((m) => {
            const active = m.id === selectedId;
            const statusLabel = statusLabelFor(m);
            return (
              <TouchableOpacity
                key={m.id}
                style={[styles.menuItem, active && styles.menuItemActive]}
                onPress={() => void handleSelect(m)}
              >
                <Text
                  style={[styles.menuItemText, active && styles.menuItemTextActive]}
                  numberOfLines={1}
                >
                  {m.name}
                </Text>
                {statusLabel ? (
                  <Text
                    style={[
                      styles.menuItemMeta,
                      statusLabel === "Online" ? styles.menuItemOnline : styles.menuItemOffline,
                    ]}
                  >
                    {statusLabel}
                  </Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: 4,
  },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
  },
  triggerText: {
    ...userTypography.body,
    color: "#1f3b57",
    flex: 1,
    paddingRight: 12,
  },
  spinner: {
    flex: 1,
    alignItems: "flex-start",
  },
  menu: {
    marginTop: 4,
    backgroundColor: "#fff",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#ddd",
    overflow: "hidden",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  menuItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  menuItemActive: {
    backgroundColor: "#e8f4fc",
  },
  menuItemText: {
    ...userTypography.body,
    color: "#1f3b57",
  },
  menuItemTextActive: {
    ...userTypography.bodyStrong,
  },
  menuItemMeta: {
    fontSize: 11,
    marginTop: 2,
  },
  menuItemOnline: {
    color: "#2ecc71",
  },
  menuItemOffline: {
    color: "#e74c3c",
  },
});
