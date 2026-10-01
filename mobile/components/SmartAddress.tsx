import React from "react";
import { Text, type StyleProp, type TextStyle } from "react-native";
import { useResolvedAddress } from "@/services/geocode";

/**
 * Address text that upgrades itself: offline `Coordinates: <lat>, <lng>`
 * strings resolve to human-readable addresses once online (cached after the
 * first resolve). Anything already human-readable renders untouched.
 * Plain RN Text with caller styling so it fits any screen's typography.
 */
export default function SmartAddress({
  text,
  style,
  numberOfLines,
  ellipsizeMode,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  ellipsizeMode?: "head" | "middle" | "tail" | "clip";
}) {
  const display = useResolvedAddress(text);
  return (
    <Text style={style} numberOfLines={numberOfLines} ellipsizeMode={ellipsizeMode}>
      {display}
    </Text>
  );
}
