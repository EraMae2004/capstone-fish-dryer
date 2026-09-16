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

function readApiBaseUrl(): string {
  const fromEnv = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  // Same PC that is serving Expo Go — survives campus Wi‑Fi IP changes.
  const expoHost = lanHostFromExpo();
  if (expoHost) return `http://${expoHost}:8000/api`;

  const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
  const fromExtra = String(extra.apiBaseUrl ?? "").trim();
  if (fromExtra) return fromExtra.replace(/\/+$/, "");

  return "http://10.160.145.15:8000/api";
}

export const API_BASE_URL = readApiBaseUrl();

/** Laravel `storage/app/public` files (profile pictures, etc.). */
export function apiStorageUrl(relativePath: string): string {
  const base = API_BASE_URL.replace(/\/api\/?$/i, "");
  const path = String(relativePath ?? "").replace(/^\/+/, "");
  return `${base}/storage/${path}`;
}
