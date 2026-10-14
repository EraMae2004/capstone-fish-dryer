import AsyncStorage from "@react-native-async-storage/async-storage";
import { onValue, ref as dbRef } from "firebase/database";
import { firebaseDb } from "@/config/firebase";
import { applyDiscoveredApiBaseUrl, getApiBaseUrl, probeApiHealth } from "@/config/api";

const CACHE_KEY = "fishdryer.lan.apiBaseUrl";

function normalizeApiBase(raw: string): string | null {
  const trimmed = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed.replace(/\/api$/i, "") + "/api";
  }
  if (/^\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?$/.test(trimmed)) {
    const withPort = trimmed.includes(":") ? trimmed : `${trimmed}:8000`;
    return `http://${withPort}/api`;
  }
  return null;
}

async function adoptIfHealthy(url: string): Promise<boolean> {
  const ok = await probeApiHealth(url, 8000);
  if (!ok) return false;
  applyDiscoveredApiBaseUrl(url);
  return true;
}

/** Follow Firebase `lan/server`. Never reuse an address from another network. */
export async function startLanApiDiscovery(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY);

  if (!firebaseDb) return;

  onValue(dbRef(firebaseDb, "lan/server"), async (snap) => {
    const val = snap.val();
    if (!val || typeof val !== "object") return;
    const rec = val as Record<string, unknown>;
    const candidate =
      normalizeApiBase(String(rec.api_base_url ?? "")) ||
      normalizeApiBase(String(rec.origin ?? "")) ||
      normalizeApiBase(String(rec.host ?? ""));
    if (!candidate || candidate === getApiBaseUrl()) return;
    await adoptIfHealthy(candidate);
  });
}

export async function ensureApiBaseUrl(timeoutMs = 15000): Promise<string> {
  const started = Date.now();
  if (await probeApiHealth(getApiBaseUrl())) {
    return getApiBaseUrl();
  }
  while (Date.now() - started < timeoutMs) {
    if (await probeApiHealth(getApiBaseUrl())) {
      return getApiBaseUrl();
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return getApiBaseUrl();
}
