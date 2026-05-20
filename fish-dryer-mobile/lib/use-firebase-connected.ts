import { useEffect, useState } from "react";
import { onValue, ref as dbRef } from "firebase/database";
import { firebaseDb } from "@/config/firebase";

/** RTDB `.info/connected` — false when phone loses Firebase socket. */
export function useFirebaseConnected(): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(
    firebaseDb ? null : false
  );

  useEffect(() => {
    if (!firebaseDb) {
      setConnected(false);
      return;
    }
    const r = dbRef(firebaseDb, ".info/connected");
    const unsub = onValue(r, (snap) => {
      setConnected(snap.val() === true);
    });
    return () => unsub();
  }, []);

  return connected;
}
