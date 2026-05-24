import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "@/config/api";

const STORAGE_KEY = "fish_dryer_selected_machine_id";

export type UserMachine = {
  id: number;
  name: string;
  status?: string;
};

export async function getSelectedMachineId(): Promise<number | null> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function setSelectedMachineId(id: number): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, String(id));
}

export async function fetchUserMachines(): Promise<UserMachine[]> {
  try {
    const res = await fetch(`${API_BASE_URL}/machines`, {
      headers: { Accept: "application/json" },
    });
    const data = await res.json();
    const rows = data?.data ?? data?.machines ?? data ?? [];
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row: Record<string, unknown>) => {
        const id = Number(row.id);
        const name = String(row.name ?? row.display_name ?? row.device_id ?? "").trim();
        if (!Number.isFinite(id) || id <= 0) return null;
        return {
          id,
          name: name || `Machine #${id}`,
          status: row.status != null ? String(row.status) : undefined,
        } satisfies UserMachine;
      })
      .filter((m): m is UserMachine => m != null);
  } catch {
    return [];
  }
}

export function useSelectedMachine() {
  const [machines, setMachines] = useState<UserMachine[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchUserMachines();
      setMachines(list);
      let id = await getSelectedMachineId();
      if (!id || !list.some((m) => m.id === id)) {
        id = list[0]?.id ?? null;
        if (id != null) await setSelectedMachineId(id);
      }
      setSelectedId(id);
      return { machines: list, selectedId: id };
    } finally {
      setLoading(false);
    }
  }, []);

  const selectMachine = useCallback(async (id: number) => {
    await setSelectedMachineId(id);
    setSelectedId(id);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const selectedMachine =
    machines.find((m) => m.id === selectedId) ?? null;

  return {
    machines,
    selectedId,
    selectedMachine,
    selectMachine,
    loading,
    refresh,
  };
}
