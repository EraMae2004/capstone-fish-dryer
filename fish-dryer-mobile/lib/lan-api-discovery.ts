import AsyncStorage from "@react-native-async-storage/async-storage";
import { get, onValue, ref as dbRef } from "firebase/database";
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

function candidateFromRecord(val: unknown): string | null {
  if (!val || typeof val !== "object") return null;
  const rec = val as Record<string, unknown>;
  return (
    normalizeApiBase(String(rec.api_base_url ?? "")) ||
    normalizeApiBase(String(rec.origin ?? "")) ||
    normalizeApiBase(String(rec.host ?? ""))
  );
}

async function adoptIfHealthy(url: string): Promise<boolean> {
  const ok = await probeApiHealth(url, 8000);
  if (!ok) return false;
  applyDiscoveredApiBaseUrl(url);
  return true;
}

/** One read of Firebase `lan/server`. Slow mobile data must not hang login forever. */
async function readPublishedApiBase(): Promise<string | null> {
  if (!firebaseDb) return null;
  try {
    const snap = await Promise.race([
      get(dbRef(firebaseDb, "lan/server")),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("lan/server read timed out")), 8000)
      ),
    ]);
    return candidateFromRecord(snap.val());
  } catch {
    return null;
  }
}

/** Follow Firebase `lan/server`. Never reuse an address from another network. */
export async function startLanApiDiscovery(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY);

  if (!firebaseDb) return;

  onValue(dbRef(firebaseDb, "lan/server"), async (snap) => {
    const candidate = candidateFromRecord(snap.val());
    if (!candidate || candidate === getApiBaseUrl()) return;
    await adoptIfHealthy(candidate);
  });
}

export async function ensureApiBaseUrl(timeoutMs = 20000): Promise<string> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const current = getApiBaseUrl();
    if (current && (await probeApiHealth(current, 4000))) {
      return current;
    }
    try {
      const published = await readPublishedApiBase();
      if (published && (await probeApiHealth(published, 5000))) {
        applyDiscoveredApiBaseUrl(published);
        return published;
      }
    } catch {
      // The hotspot link to Firebase can drop. Try again.
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return getApiBaseUrl();
}
