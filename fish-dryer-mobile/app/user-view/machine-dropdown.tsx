import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { FontAwesome } from "@expo/vector-icons";
import { userTypography } from "@/lib/user-typography";
import {
  useSelectedMachine,
  type UserMachine,
} from "@/lib/selected-machine";
import { useShellSidebarOpen } from "@/lib/shell-sidebar-context";
import { firebaseDb } from "@/config/firebase";
import {
  firebaseUpdatedAtMs,
  isFirebaseHeartbeatLive,
  subscribeLiveHardwareStatus,
} from "@/lib/live-hardware-rtdb";

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
    if (!firebaseDb) {
      setStableOnlineById({});
      return;
    }

    const watch = machineIds;
    const updatedAtById: Record<number, number> = {};
    const receiveById: Record<number, number> = {};
    const unsubs = watch.map((id) =>
      subscribeLiveHardwareStatus(
        firebaseDb,
        id,
        (hw) => {
          const now = Date.now();
          const t = firebaseUpdatedAtMs(hw.updated_at);
          if (t != null) updatedAtById[id] = t;
          if (
            isFirebaseHeartbeatLive(hw.updated_at, now) ||
            isFirebaseHeartbeatLive(t, now)
          ) {
            receiveById[id] = now;
          }
          setStableOnlineById((prev) => ({
            ...prev,
            [id]: isFirebaseHeartbeatLive(
              t ?? updatedAtById[id],
              now,
              receiveById[id]
            ),
          }));
        },
        () => {
          delete updatedAtById[id];
          delete receiveById[id];
          setStableOnlineById((prev) => ({ ...prev, [id]: false }));
        }
      )
    );
    const tick = setInterval(() => {
      const next: Record<number, boolean> = {};
      for (const id of watch) {
        next[id] = isFirebaseHeartbeatLive(
          updatedAtById[id],
          Date.now(),
          receiveById[id]
        );
      }
      setStableOnlineById(next);
    }, DROPDOWN_STATUS_TICK_MS);

    return () => {
      unsubs.forEach((unsub) => unsub());
      clearInterval(tick);
    };
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
