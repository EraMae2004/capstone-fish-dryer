import { useCallback, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getApiBaseUrl } from "@/config/api";

const STORAGE_KEY = "fish_dryer_selected_machine_id";

export type UserMachine = {
  id: number;
  name: string;
  status?: string;
  mac?: string | null;
};

type SelectedMachineStore = {
  machines: UserMachine[];
  selectedId: number | null;
  loading: boolean;
};

const store: SelectedMachineStore = {
  machines: [],
  selectedId: null,
  loading: true,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function snapshot(): SelectedMachineStore {
  return {
    machines: store.machines,
    selectedId: store.selectedId,
    loading: store.loading,
  };
}

export async function getSelectedMachineId(): Promise<number | null> {
  if (store.selectedId != null && store.selectedId > 0) {
    return store.selectedId;
  }
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export async function setSelectedMachineId(id: number): Promise<void> {
  if (store.selectedId !== id) {
    store.selectedId = id;
    emit();
  }
  await AsyncStorage.setItem(STORAGE_KEY, String(id));
}

export async function clearSelectedMachineId(): Promise<void> {
  if (store.selectedId !== null) {
    store.selectedId = null;
    emit();
  }
  await AsyncStorage.removeItem(STORAGE_KEY);
}

let machinesCache: { list: UserMachine[]; at: number } | null = null;
const MACHINES_CACHE_MS = 20_000;
let machinesInFlight: Promise<UserMachine[]> | null = null;

export async function fetchUserMachines(force = false): Promise<UserMachine[]> {
  if (!force && machinesCache && Date.now() - machinesCache.at < MACHINES_CACHE_MS) {
    return machinesCache.list;
  }
  if (!force && machinesInFlight) return machinesInFlight;
  if (force) {
    machinesCache = null;
  }

  machinesInFlight = (async () => {
    try {
      const res = await fetch(`${getApiBaseUrl()}/machines`, {
        headers: { Accept: "application/json" },
      });
      const data = await res.json();
      const rows = data?.data ?? data?.machines ?? data ?? [];
      if (!Array.isArray(rows)) return machinesCache?.list ?? [];
      const list = rows
        .map((row: Record<string, unknown>) => {
          const id = Number(row.id);
          const name = String(row.name ?? row.display_name ?? row.device_id ?? "").trim();
          if (!Number.isFinite(id) || id <= 0) return null;
          const macRaw = String(row.mac ?? "").trim();
          return {
            id,
            name: name || `Machine #${id}`,
            status: row.status != null ? String(row.status) : undefined,
            mac: macRaw || null,
          } satisfies UserMachine;
        })
        .filter((m): m is UserMachine => m != null);
      machinesCache = { list, at: Date.now() };
      return list;
    } catch {
      return machinesCache?.list ?? [];
    } finally {
      machinesInFlight = null;
    }
  })();

  return machinesInFlight;
}

async function loadMachinesAndSelection(force = false): Promise<SelectedMachineStore> {
  store.loading = store.machines.length === 0;
  if (store.loading) emit();
  try {
    const list = await fetchUserMachines(force);
    store.machines = list;
    let id = store.selectedId ?? (await getSelectedMachineId());
    if (!id || !list.some((m) => m.id === id)) {
      id = list[0]?.id ?? null;
      if (id != null) {
        store.selectedId = id;
        await AsyncStorage.setItem(STORAGE_KEY, String(id));
      } else {
        store.selectedId = null;
      }
    } else {
      store.selectedId = id;
    }
    return snapshot();
  } finally {
    store.loading = false;
    emit();
  }
}

let initPromise: Promise<SelectedMachineStore> | null = null;

function ensureInitialized(): Promise<SelectedMachineStore> {
  if (!initPromise) {
    initPromise = loadMachinesAndSelection(false);
  }
  return initPromise;
}

export function useSelectedMachine() {
  const [state, setState] = useState<SelectedMachineStore>(snapshot);

  useEffect(() => {
    const sync = () => setState(snapshot());
    listeners.add(sync);
    void ensureInitialized();
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, []);

  const refresh = useCallback(async () => {
    return loadMachinesAndSelection(true);
  }, []);

  const selectMachine = useCallback(async (id: number) => {
    await setSelectedMachineId(id);
  }, []);

  const selectedMachine =
    state.machines.find((m) => m.id === state.selectedId) ?? null;

  return {
    machines: state.machines,
    selectedId: state.selectedId,
    selectedMachine,
    selectMachine,
    loading: state.loading,
    refresh,
  };
}
