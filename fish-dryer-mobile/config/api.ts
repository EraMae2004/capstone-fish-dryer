import Constants from "expo-constants";

type ExpoExtra = {
  apiBaseUrl?: string;
};

function readApiBaseUrl(): string {
  // 1) Expo public env (works with EAS / local env)
  const fromEnv = (process.env.EXPO_PUBLIC_API_BASE_URL ?? "").trim();
  if (fromEnv) return fromEnv.replace(/\/+$/, "");

  // 2) app.json -> expo.extra.apiBaseUrl
  const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
  const fromExtra = String(extra.apiBaseUrl ?? "").trim();
  if (fromExtra) return fromExtra.replace(/\/+$/, "");

  // 3) Final fallback (dev LAN). Change only if you want a default.
  return "http://10.124.242.15:8000/api";
}

export const API_BASE_URL = readApiBaseUrl();

/** Laravel `storage/app/public` files (profile pictures, etc.). */
export function apiStorageUrl(relativePath: string): string {
  const base = API_BASE_URL.replace(/\/api\/?$/i, "");
  const path = String(relativePath ?? "").replace(/^\/+/, "");
  return `${base}/storage/${path}`;
}
