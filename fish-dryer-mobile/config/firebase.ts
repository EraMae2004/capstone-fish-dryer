import Constants from "expo-constants";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getDatabase, type Database } from "firebase/database";

type ExpoExtra = {
  firebase?: {
    apiKey?: string;
    authDomain?: string;
    databaseURL?: string;
    projectId?: string;
    storageBucket?: string;
    messagingSenderId?: string;
    appId?: string;
    measurementId?: string;
  };
};

function defaultRealtimeDatabaseUrl(projectId: string): string | null {
  const pid = projectId.trim();
  if (!pid) return null;

  // Firebase commonly uses either:
  // - https://<project>-default-rtdb.firebaseio.com
  // - https://<project>-default-rtdb.<region>.firebasedatabase.app
  //
  // If your database is in a regional domain, set `databaseURL` explicitly
  // (EXPO_PUBLIC_FIREBASE_DATABASE_URL or app.json extra.firebase.databaseURL).
  const overrideHost = (process.env.EXPO_PUBLIC_FIREBASE_RTDB_HOST ?? "").trim();
  if (overrideHost) {
    const host = overrideHost.replace(/^https?:\/\//, "").replace(/\/+$/, "");
    return `https://${host}`;
  }

  return `https://${pid}-default-rtdb.firebaseio.com`;
}

function readFirebaseConfig() {
  const fromEnv = {
    apiKey: (process.env.EXPO_PUBLIC_FIREBASE_API_KEY ?? "").trim(),
    authDomain: (process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "").trim(),
    databaseURL: (process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL ?? "").trim(),
    projectId: (process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID ?? "").trim(),
    storageBucket: (process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "").trim(),
    messagingSenderId: (process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "").trim(),
    appId: (process.env.EXPO_PUBLIC_FIREBASE_APP_ID ?? "").trim(),
    measurementId: (process.env.EXPO_PUBLIC_FIREBASE_MEASUREMENT_ID ?? "").trim(),
  };

  const hasEnv = Object.values(fromEnv).some((v) => !!v);
  if (hasEnv) {
    return {
      ...fromEnv,
      databaseURL: fromEnv.databaseURL || defaultRealtimeDatabaseUrl(fromEnv.projectId) || "",
    };
  }

  const extra = (Constants.expoConfig?.extra ?? {}) as ExpoExtra;
  const fb = extra.firebase ?? {};
  const merged = {
    apiKey: String(fb.apiKey ?? "").trim(),
    authDomain: String(fb.authDomain ?? "").trim(),
    databaseURL: String(fb.databaseURL ?? "").trim(),
    projectId: String(fb.projectId ?? "").trim(),
    storageBucket: String(fb.storageBucket ?? "").trim(),
    messagingSenderId: String(fb.messagingSenderId ?? "").trim(),
    appId: String(fb.appId ?? "").trim(),
    measurementId: String(fb.measurementId ?? "").trim(),
  };

  return {
    ...merged,
    databaseURL: merged.databaseURL || defaultRealtimeDatabaseUrl(merged.projectId) || "",
  };
}

const firebaseConfig = readFirebaseConfig();

export const firebaseApp: FirebaseApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);

/**
 * Realtime Database requires a `databaseURL`.
 *
 * The common Firebase "web app" snippet often omits it unless you created a Realtime Database
 * instance and copied its URL from Firebase Console.
 */
export const firebaseDb: Database | null = firebaseConfig.databaseURL
  ? getDatabase(firebaseApp, firebaseConfig.databaseURL)
  : null;

if (!firebaseConfig.databaseURL) {
  // eslint-disable-next-line no-console
  console.warn(
    "[firebase] Missing databaseURL (and projectId). Set app.json -> expo.extra.firebase.databaseURL " +
      "or EXPO_PUBLIC_FIREBASE_DATABASE_URL. Realtime listeners will be disabled until then."
  );
}

