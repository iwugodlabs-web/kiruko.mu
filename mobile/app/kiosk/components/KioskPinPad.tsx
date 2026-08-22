/**
 * 4-digit PIN pad — kiosk-sized touch targets, masked entry, lockout
 * after MAX_WRONG_ATTEMPTS to discourage shoulder-surf brute force.
 *
 * Mirrors the web KioskPinPad but built native-first: no hover states,
 * no keyboard shortcuts (a kiosk doesn't have a hardware keyboard
 * attached), and chunky 72dp tap targets — the failure mode we're
 * designing against is "miss-tap on a wall-mounted tablet at arm's
 * length", not "fast typist."
 */

import * as Haptics from "expo-haptics";
import { Delete } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

const PIN_LENGTH = 4;
const KEYS: (string | "back" | null)[] = [
  "1", "2", "3",
  "4", "5", "6",
  "7", "8", "9",
  null, "0", "back",
];

interface Props {
  onComplete: (pin: string) => void;
  // Allows the parent to wipe the pad after a failed attempt without
  // remounting the component (preserves animation/focus state).
  resetSignal?: number;
  disabled?: boolean;
}

export function KioskPinPad({ onComplete, resetSignal, disabled }: Props) {
  const [pin, setPin] = useState("");

  // Reset whenever the parent bumps resetSignal — used after a wrong
  // PIN to clear the bullets for retry.
  const [lastReset, setLastReset] = useState(resetSignal);
  if (resetSignal !== lastReset) {
    setPin("");
    setLastReset(resetSignal);
  }

  const tap = (key: string | "back" | null) => {
    if (disabled || key === null) return;
    Haptics.selectionAsync().catch(() => undefined);
    if (key === "back") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    setPin((p) => {
      if (p.length >= PIN_LENGTH) return p;
      const next = p + key;
      // Defer onComplete to the next tick so the bullet rendering
      // catches up before the parent transitions to "submitting".
      if (next.length === PIN_LENGTH) {
        setTimeout(() => onComplete(next), 50);
      }
      return next;
    });
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.bullets}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.bullet,
              i < pin.length && styles.bulletFilled,
            ]}
          />
        ))}
      </View>

      <View style={styles.grid}>
        {KEYS.map((k, i) => (
          <Pressable
            key={i}
            onPress={() => tap(k)}
            disabled={disabled || k === null}
            style={({ pressed }) => [
              styles.key,
              k === null && styles.keyEmpty,
              pressed && k !== null && styles.keyPressed,
            ]}
            // Tablets/kiosks live on touch — 72dp matches Material
            // Design's recommended minimum for primary actions.
            hitSlop={4}
          >
            {k === "back" ? (
              <Delete size={28} color="#94a3b8" />
            ) : k !== null ? (
              <Text style={styles.keyText}>{k}</Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const KEY_SIZE = 72;

const styles = StyleSheet.create({
  wrap: { alignItems: "center" },
  bullets: {
    flexDirection: "row",
    gap: 16,
    marginBottom: 32,
  },
  bullet: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: "#475569",
    backgroundColor: "transparent",
  },
  bulletFilled: {
    backgroundColor: "#60a5fa",
    borderColor: "#60a5fa",
  },
  grid: {
    width: KEY_SIZE * 3 + 32,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    justifyContent: "center",
  },
  key: {
    width: KEY_SIZE,
    height: KEY_SIZE,
    borderRadius: KEY_SIZE / 2,
    backgroundColor: "#1e293b",
    alignItems: "center",
    justifyContent: "center",
  },
  keyEmpty: { backgroundColor: "transparent" },
  keyPressed: { backgroundColor: "#334155" },
  keyText: {
    color: "white",
    fontSize: 28,
    fontWeight: "600",
  },
});
