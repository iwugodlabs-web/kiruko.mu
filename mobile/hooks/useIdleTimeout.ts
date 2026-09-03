import { useEffect, useRef, useCallback } from 'react';
import { AppState } from 'react-native';

const IDLE_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

export default function useIdleTimeout(onIdle: () => void, enabled: boolean) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef(AppState.currentState);
  const backgroundedAtRef = useRef<number | null>(null);

  const resetTimer = useCallback(() => {
    if (!enabled) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      onIdle();
    }, IDLE_TIMEOUT_MS);
  }, [enabled, onIdle]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) { clearTimer(); return; }

    resetTimer();

    const subscription = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current === 'active' && (nextState === 'background' || nextState === 'inactive')) {
        // Record when app went to background and pause the in-app timer
        backgroundedAtRef.current = Date.now();
        clearTimer();
      } else if (appStateRef.current !== 'active' && nextState === 'active') {
        // App returning to foreground — check if idle timeout elapsed while backgrounded
        if (backgroundedAtRef.current !== null) {
          const elapsed = Date.now() - backgroundedAtRef.current;
          backgroundedAtRef.current = null;
          if (elapsed >= IDLE_TIMEOUT_MS) {
            // Been away long enough — lock immediately
            onIdle();
            return;
          }
          // Resume timer with remaining time
          const remaining = IDLE_TIMEOUT_MS - elapsed;
          if (timerRef.current) clearTimeout(timerRef.current);
          timerRef.current = setTimeout(() => { onIdle(); }, remaining);
        } else {
          resetTimer();
        }
      }
      appStateRef.current = nextState;
    });

    return () => { clearTimer(); subscription.remove(); };
  }, [enabled, resetTimer, clearTimer, onIdle]);

  return { resetTimer };
}
