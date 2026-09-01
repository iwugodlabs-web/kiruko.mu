// RN 0.81 removed `BackHandler.removeEventListener` — `addEventListener` now
// returns a subscription you `.remove()`. Several transitive deps still call the
// old API (@gluestack-ui/hooks → use-keyboard-dismissable, and
// @react-native-aria/interactions → useKeyboardDismisssable), which crashes any
// GlueStack overlay (Modal, Actionsheet, AlertDialog…) with:
//   "BackHandler.removeEventListener is not a function".
//
// Restore the old API, mapping it to the subscription model so listeners are
// actually cleaned up (not leaked). Pure JS — safe to import first at app entry.
import { BackHandler } from "react-native";

const bh = BackHandler as any;

if (typeof bh.removeEventListener !== "function") {
  const subs = new Map<Function, { remove: () => void }>();
  const originalAdd = bh.addEventListener.bind(bh);

  bh.addEventListener = (eventName: string, handler: Function) => {
    const subscription = originalAdd(eventName, handler);
    if (subscription && typeof subscription.remove === "function") {
      subs.set(handler, subscription);
    }
    return subscription;
  };

  bh.removeEventListener = (_eventName: string, handler: Function) => {
    const subscription = subs.get(handler);
    if (subscription) {
      subscription.remove();
      subs.delete(handler);
    }
  };
}

export {};
