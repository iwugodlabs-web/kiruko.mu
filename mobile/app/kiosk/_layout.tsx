import { Stack } from "expo-router";
import { useEffect } from "react";
import { syncWorker } from "./services/syncWorker";

// Kiosk route tree sits outside AuthProvider's redirect logic on purpose —
// kiosk screens authenticate via X-Kiosk-Token, not the user JWT. Mirrors
// the web client's `app/kiosk/` carve-out from the `(platform)` group.
export default function KioskLayout() {
  // M31 — register the offline-queue sync worker once when the kiosk
  // subtree mounts. Idempotent; safe across remounts. We do it here
  // (not in the root _layout) so a phone-mode launch never spins up
  // the worker — it's pure dead weight outside the kiosk flow.
  useEffect(() => {
    syncWorker.register();
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "fade",
        // Kiosks are wall-mounted — swipe-back would let a curious passerby
        // pop out of clock-in. Lock gestures off for the whole subtree.
        gestureEnabled: false,
      }}
    />
  );
}
