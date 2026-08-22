import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { ArrowLeft, KeyRound, Loader2, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KIOSK_STORAGE_KEYS } from "./constants";
import { isKioskApiError, kioskApi, setKioskToken } from "./services/kioskApi";
import { Palette, Type, Weight } from "../constants/theme";

// Task #53 — kiosk token onboarding. Flow:
//   1. Admin issues a token via /admin/kiosks/register on web (one-time
//      display). Pastes it here.
//   2. We persist it provisionally, ping /kiosk/heartbeat to confirm the
//      backend recognizes it (catches typos + expired/revoked tokens
//      before the tablet enters lock-in mode).
//   3. On 200: flip the kiosk-mode flag → app/index.tsx will route here
//      on every subsequent launch. Replace to /kiosk/clock-in.
//   4. On failure: clear the provisional token, surface the reason,
//      stay on this screen so the admin can re-paste.
//
// Deliberately minimal styling — this screen is admin-only and shown
// exactly once per device.

// Maps the backend's 403 `detail` codes (see core/dependencies.py
// get_kiosk_context) to operator-facing guidance, so a rejection says WHY and
// what to do — not just "rejected".
const KIOSK_TOKEN_ERRORS: Record<string, string> = {
  kiosk_token_not_found:
    "This device isn't registered on this server. Make sure the tablet and your dashboard point at the same environment (dev vs production), or ask your admin to register it.",
  kiosk_token_deactivated:
    "This device has been deactivated. Ask your admin to register a new device.",
  kiosk_token_expired:
    "This token has expired. Ask your admin to rotate it (Admin → Kiosks → Rotate) and paste the new one.",
  kiosk_token_invalid:
    "This token isn't valid. Re-copy the whole value from the dashboard — it's shown only once, so a partial copy won't work.",
  kiosk_token_malformed:
    "That doesn't look like a complete token. Copy the entire value (it contains a '.') from the dashboard.",
};

export default function KioskSetup() {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [adminPin, setAdminPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onActivate = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Paste a token first.");
      return;
    }
    if (!/^\d{4}$/.test(adminPin)) {
      setError("Enter the 4-digit admin PIN shown on the web when you registered this device.");
      return;
    }
    // Token format from KioskService.register_device is
    // `{device_uuid}.{secret}` — bail fast on obvious paste errors so we
    // don't waste a network round-trip and confuse the operator with a
    // 403 when the real issue is a missing fragment.
    if (!trimmed.includes(".") || trimmed.length < 30) {
      setError("That doesn't look like a kiosk token. It should contain a '.' and be long.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Persist provisionally so the axios interceptor attaches it on
      // the heartbeat call. If validation fails we revert.
      await setKioskToken(trimmed);
      const r = await kioskApi.heartbeat();
      if (isKioskApiError(r)) {
        await AsyncStorage.removeItem(KIOSK_STORAGE_KEYS.token);
        const detail =
          r.status === 0
            ? "Couldn't reach the server. Check the tablet's Wi-Fi and that the backend is reachable, then try again."
            : r.status === 401
              ? "The tablet didn't send a token. Re-paste it and try again."
              : r.status === 403
                ? KIOSK_TOKEN_ERRORS[r.error ?? ""] ??
                  "Token rejected by the server. Re-copy it from the dashboard, or ask your admin to re-issue it."
                : r.error || "Activation failed.";
        setError(detail);
        return;
      }
      // Token valid — now verify the admin PIN against the backend (the PIN
      // shown on the web at registration), so the operator can't just set an
      // arbitrary local PIN.
      const v = await kioskApi.verifyAdminPin(adminPin);
      if (isKioskApiError(v)) {
        await AsyncStorage.removeItem(KIOSK_STORAGE_KEYS.token);
        setError(
          v.status === 403
            ? "That admin PIN doesn't match this device. Use the PIN shown on the web when you registered it."
            : "Couldn't verify the admin PIN. Check the connection and try again.",
        );
        return;
      }
      // Both verified — cache the PIN locally (for offline / dead-token re-
      // onboarding), flip the mode flag, enter the kiosk.
      await AsyncStorage.setItem(KIOSK_STORAGE_KEYS.adminPin, adminPin);
      await AsyncStorage.setItem(KIOSK_STORAGE_KEYS.mode, "1");
      router.replace("/kiosk/clock-in" as never);
    } catch (e) {
      await AsyncStorage.removeItem(KIOSK_STORAGE_KEYS.token).catch(() => undefined);
      setError("Unexpected error. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <Pressable
            onPress={() => { if (router.canGoBack()) router.back(); else router.replace("/login" as never); }}
            style={styles.backBtn}
            hitSlop={12}
            disabled={busy}
          >
            <ArrowLeft size={20} color={Palette.gray300} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>

          <View style={styles.hero}>
            <View style={styles.iconBadge}>
              <ShieldCheck size={40} color={Palette.gold} />
            </View>
            <Text style={styles.title}>Set up this tablet{"\n"}as a kiosk</Text>
            <Text style={styles.subtitle}>
              Paste the device token from your admin dashboard
              {"\n"}(Admin → Kiosks → Register device).
            </Text>
          </View>

          <Text style={styles.fieldLabel}>Device token</Text>
          <View style={[styles.inputWrap, !!error && styles.inputWrapError]}>
            <KeyRound size={18} color={Palette.gray500} style={{ marginTop: 2 }} />
            <TextInput
              value={token}
              onChangeText={setToken}
              placeholder="Paste device token"
              placeholderTextColor={Palette.gray500}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              editable={!busy}
              style={styles.input}
              // Long token — multiline lets the operator see what they
              // pasted instead of a one-line scrollable smear.
              multiline
              numberOfLines={3}
            />
          </View>

          <Text style={[styles.fieldLabel, { marginTop: 18 }]}>Admin PIN (4 digits)</Text>
          <View style={styles.inputWrap}>
            <KeyRound size={18} color={Palette.gray500} style={{ marginTop: 2 }} />
            <TextInput
              value={adminPin}
              onChangeText={(v) => setAdminPin(v.replace(/\D/g, "").slice(0, 4))}
              placeholder="••••"
              placeholderTextColor={Palette.gray500}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              editable={!busy}
              style={styles.input}
            />
          </View>
          <Text style={styles.note}>
            Shown on the web with the device token. Needed to exit kiosk mode or
            re-enter the token later — no uninstall.
          </Text>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <Pressable
            onPress={onActivate}
            disabled={busy}
            style={[styles.activateBtn, busy && { opacity: 0.55 }]}
          >
            {busy ? (
              <ActivityIndicator color={Palette.ink} />
            ) : (
              <Text style={styles.activateText}>Activate kiosk mode</Text>
            )}
          </Pressable>

          <Text style={styles.note}>
            Once activated, this tablet boots straight into the kiosk clock-in
            screen. Admins can exit kiosk mode from inside the clock-in screen.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Palette.ink },
  scroll: { flexGrow: 1, padding: 24, paddingTop: 12 },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8 },
  backText: { color: Palette.gray300, fontSize: Type.body },
  hero: { alignItems: "center", marginTop: 16, marginBottom: 28 },
  iconBadge: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(242,183,5,0.12)",
    borderWidth: 1,
    borderColor: "rgba(242,183,5,0.35)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
  },
  title: {
    color: Palette.white,
    fontSize: Type.display,
    fontWeight: Weight.black,
    textAlign: "center",
    lineHeight: 38,
    marginBottom: 10,
  },
  subtitle: {
    color: Palette.gray400,
    fontSize: Type.body,
    textAlign: "center",
    lineHeight: 21,
    paddingHorizontal: 8,
  },
  fieldLabel: {
    color: Palette.gray400,
    fontSize: Type.small,
    fontWeight: Weight.semibold,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  inputWrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    backgroundColor: Palette.gray800,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Palette.gray700,
    padding: 14,
  },
  inputWrapError: { borderColor: Palette.error },
  input: {
    flex: 1,
    color: Palette.white,
    fontSize: Type.body,
    minHeight: 56,
    padding: 0,
    textAlignVertical: "top",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  errorCard: {
    marginTop: 14,
    backgroundColor: "rgba(220,38,38,0.12)",
    borderWidth: 1,
    borderColor: "rgba(220,38,38,0.4)",
    borderRadius: 12,
    padding: 12,
  },
  errorText: {
    color: Palette.errorAlt,
    fontSize: Type.label,
    fontWeight: Weight.medium,
    lineHeight: 19,
    textAlign: "center",
  },
  activateBtn: {
    backgroundColor: Palette.gold,
    borderRadius: 14,
    paddingVertical: 17,
    marginTop: 24,
    alignItems: "center",
  },
  activateText: {
    color: Palette.ink,
    fontSize: Type.title,
    fontWeight: Weight.bold,
  },
  note: {
    color: Palette.gray500,
    fontSize: Type.small,
    textAlign: "center",
    marginTop: 24,
    lineHeight: 18,
  },
});
