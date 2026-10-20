// Tiny pub/sub for user-activity signals (touches anywhere in the app).
//
// Why a bus: the idle timer's touch-catcher must sit ABOVE every view that
// can receive touches — including GlueStack Modals/toasts, which render in
// an overlay portal at the GluestackUIProvider level. A catcher placed next
// to the Stack (e.g. inside AuthProvider) never sees those touches, so the
// app would lock mid-use inside any modal. The catcher lives at the root of
// _layout.tsx and publishes here; IdleManager (which owns the timer and has
// auth access) subscribes. Module singleton — no context, no re-renders.
type IdleActivityListener = () => void;

const listeners = new Set<IdleActivityListener>();

export function emitIdleActivity(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A failing subscriber must never break touch handling.
    }
  });
}

export function subscribeIdleActivity(listener: IdleActivityListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
