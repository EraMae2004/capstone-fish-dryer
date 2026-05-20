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
  return "http://10.173.245.15:8000/api";
}

export const API_BASE_URL = readApiBaseUrl();
