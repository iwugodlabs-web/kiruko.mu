/**
 * Offline capability policy (§10.2 of OFFLINE-CLOCKOUT-AND-REVIEW-BY-EXCEPTION-PLAN.md).
 *
 * Single source of truth for what the app may do with no signal. Capabilities:
 *   * `queue`       — safe to perform offline; the punch outbox persists the
 *                     exact request and the sync worker replays it (§3 payload
 *                     pinning invariant). Clock in/out live here today; breaks
 *                     join once the break queue lands.
 *   * `read-only`   — serve stale cache with a "last synced" strip; never mutate.
 *   * `online-only` — must reach the server. Attempt anyway and translate a
 *                     network-class failure into a plain message (never pre-block
 *                     on NetInfo alone — captive portals and some Android ROMs
 *                     false-negative, which would lock online users out).
 *
 * Why leave/expenses are online-only (not queued): leave needs server-side
 * quota/date validation (a late-synced request for elapsed dates is silently
 * wrong), and expenses carry photo blobs through OCR. Both persist as local
 * drafts instead — no work lost, no false submission.
 */

import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

export type OfflineCapability = "queue" | "read-only" | "online-only";

export type OfflineAction =
  | "clock_in"
  | "clock_out"
  | "break_start"
  | "break_end"
  | "leave_request"
  | "expense_submit"
  | "receipt_scan"
  | "profile_edit"
  | "overtime_confirm";

const POLICY: Record<OfflineAction, OfflineCapability> = {
  clock_in: "queue",
  clock_out: "queue",
  // Queued once the break outbox lands (same dependsOn chaining as punches).
  break_start: "online-only",
  break_end: "online-only",
  leave_request: "online-only",
  expense_submit: "online-only",
  receipt_scan: "online-only",
  profile_edit: "online-only",
  overtime_confirm: "online-only",
};

export function capabilityFor(action: OfflineAction): OfflineCapability {
  return POLICY[action] ?? "online-only";
}

/** True when the device currently reports usable connectivity. */
export async function isOnlineNow(): Promise<boolean> {
  try {
    const state = await NetInfo.fetch();
    return !!state.isConnected && state.isInternetReachable !== false;
  } catch {
    return true; // Unknown — let the attempt decide, don't pre-block.
  }
}

/**
 * Gate for online-only actions. Returns `{ ok: true }` when online, else
 * `{ ok: false, message }` with a caller-displayable reason. Callers should
 * still attempt the request and map network-class failures to the same
 * message — this gate is for upfront UX (disable with explanation), not for
 * correctness.
 */
export async function requireOnline(
  action: OfflineAction,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (capabilityFor(action) === "queue") return { ok: true };
  if (await isOnlineNow()) return { ok: true };
  return {
    ok: false,
    message:
      "You're offline. This action needs a connection — it will be available when you're back online.",
  };
}

/** Reactive connectivity flag for banners and disabled states. */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let mounted = true;
    NetInfo.fetch()
      .then((s) => {
        if (mounted) setOnline(!!s.isConnected && s.isInternetReachable !== false);
      })
      .catch(() => undefined);
    const unsub = NetInfo.addEventListener((s) => {
      if (mounted) setOnline(!!s.isConnected && s.isInternetReachable !== false);
    });
    return () => {
      mounted = false;
      unsub();
    };
  }, []);
  return online;
}
