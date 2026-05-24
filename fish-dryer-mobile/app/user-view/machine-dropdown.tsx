import React, { useEffect, useState } from "react";
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

type MachineDropdownProps = {
  onMachineChange?: (machineId: number) => void;
  style?: object;
  machines?: UserMachine[];
  selectedId?: number | null;
  loading?: boolean;
  onSelect?: (machineId: number) => void;
};

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

  useEffect(() => {
    if (sidebarOpen) setOpen(false);
  }, [sidebarOpen]);

  const selectedMachine =
    machines.find((m) => m.id === selectedId) ?? null;

  const handleSelect = async (m: UserMachine) => {
    setOpen(false);
    if (m.id === selectedId) return;
    await pickMachine(m.id);
    onMachineChange?.(m.id);
  };

  const label = selectedMachine?.name ?? "No Machine";

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
                {m.status ? (
                  <Text style={styles.menuItemMeta}>
                    {m.status === "online" ? "Online" : "Offline"}
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
    color: "#888",
    marginTop: 2,
  },
});
