"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Mirrors mobile/hooks/useIdleTimeout.ts (2m) but tuned for web: 15m idle →
// auto-logout, with a 60s warning. Reset on any user activity.
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const WARNING_MS = 60 * 1000;

export function useIdleTimeout(onIdle: () => void, enabled: boolean) {
  const idleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warnRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isWarning, setIsWarning] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(60);

  const clear = useCallback(() => {
    if (idleRef.current) clearTimeout(idleRef.current);
    if (warnRef.current) clearTimeout(warnRef.current);
    if (tickRef.current) clearInterval(tickRef.current);
    idleRef.current = null;
    warnRef.current = null;
    tickRef.current = null;
  }, []);

  const reset = useCallback(() => {
    if (!enabled) return;
    clear();
    setIsWarning(false);
    setSecondsLeft(60);
    // Warning fires 60s before idle
    warnRef.current = setTimeout(() => {
      setIsWarning(true);
      setSecondsLeft(60);
      let s = 60;
      tickRef.current = setInterval(() => {
        s -= 1;
        setSecondsLeft(s);
        if (s <= 0 && tickRef.current) clearInterval(tickRef.current);
      }, 1000);
    }, IDLE_TIMEOUT_MS - WARNING_MS);
    idleRef.current = setTimeout(() => {
      clear();
      onIdle();
    }, IDLE_TIMEOUT_MS);
  }, [enabled, onIdle, clear]);

  useEffect(() => {
    if (!enabled) {
      clear();
      return;
    }
    reset();
    const events: (keyof DocumentEventMap)[] = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    const handler = () => reset();
    events.forEach((e) => document.addEventListener(e, handler, { passive: true } as any));
    const visHandler = () => {
      if (document.visibilityState === "visible") reset();
    };
    document.addEventListener("visibilitychange", visHandler);
    return () => {
      clear();
      events.forEach((e) => document.removeEventListener(e, handler as any));
      document.removeEventListener("visibilitychange", visHandler);
    };
  }, [enabled, reset, clear]);

  return { isWarning, secondsLeft, reset, clear };
}
