import Constants from "expo-constants";

type ExpoExtra = {
  apiBaseUrl?: string;
};

function lanHostFromExpo(): string | null {
  const extra = Constants.expoConfig?.extra as { expoGo?: { debuggerHost?: string } } | undefined;
  const candidates = [
    Constants.expoConfig?.hostUri,
    extra?.expoGo?.debuggerHost,
    Constants.linkingUri,
  ];
  for (const raw of candidates) {
    const host = String(raw ?? "")
      .replace(/^exp:\/\//, "")
      .replace(/^https?:\/\//, "")
      .split("/")[0]
      .split(":")[0]
      .trim();
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) && host !== "127.0.0.1") {
      return host;
    }
  }
  return null;
}

function normalizeApiBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function readInitialApiBaseUrl(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim();
  if (fromEnv) return normalizeApiBase(fromEnv);

  const expoHost = lanHostFromExpo();
  if (expoHost) return `http://${expoHost}:8000/api`;

  const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
  const fromExtra = String(extra.apiBaseUrl ?? "").trim();
  if (fromExtra && !/^\d{1,3}(?:\.\d{1,3}){3}/.test(fromExtra.replace(/^https?:\/\//, ""))) {
    return normalizeApiBase(fromExtra);
  }
  if (fromExtra.startsWith("http://") || fromExtra.startsWith("https://")) {
    // Ignore leftover hardcoded LAN IPs in app.json — discovery replaces them.
    const host = fromExtra.replace(/^https?:\/\//, "").split("/")[0].split(":")[0];
    if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      return normalizeApiBase(fromExtra);
    }
  }

  return "";
}

let currentApiBaseUrl = readInitialApiBaseUrl();

export function getApiBaseUrl(): string {
  return currentApiBaseUrl;
}

/** Live binding used by existing screens. Updated when Firebase `lan/server` changes. */
export let API_BASE_URL = currentApiBaseUrl;

export function applyDiscoveredApiBaseUrl(url: string): void {
  const next = normalizeApiBase(url);
  if (!next || next === currentApiBaseUrl) return;
  currentApiBaseUrl = next;
  API_BASE_URL = next;
}

export async function probeApiHealth(apiBase: string, timeoutMs = 2500): Promise<boolean> {
  const origin = String(apiBase ?? "").replace(/\/api\/?$/i, "").replace(/\/+$/, "");
  if (!origin) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${origin}/up`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** Laravel `storage/app/public` files (profile pictures, etc.). */
export function apiStorageUrl(relativePath: string): string {
  const base = getApiBaseUrl().replace(/\/api\/?$/i, "");
  const path = String(relativePath ?? "").replace(/^\/+/, "");
  return `${base}/storage/${path}`;
}
