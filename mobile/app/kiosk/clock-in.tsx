/**
 * Task #54 + #56 — kiosk clock-in/out state machine + change-PIN entry.
 *
 * Mirrors web/ivor-web/src/app/kiosk/clock-in/page.tsx but native-first.
 * States:
 *   idle              → search input
 *   searching         → spinner while /kiosk/employee-lookup is in flight
 *   showingCandidates → tap one to proceed
 *   enteringPin       → PIN pad; label adapts to clock-in vs clock-out
 *                       based on the candidate's has_active_session flag
 *   submitting        → POSTing /kiosk/clock-in or /kiosk/clock-out
 *   success           → green confirmation, auto-returns to idle in 5s
 *   error             → red message, tap to retry
 *   changingPin       → entered when employee taps "Change PIN" on the
 *                       PIN pad screen. Requires current PIN then new PIN.
 *
 * The Idempotency-Key for a single submit attempt is held in component
 * state and rolled fresh on a brand-new attempt. Same key on every
 * retry of the same attempt → backend M26 dedup returns the original
 * timelog row.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import {
  ArrowRight,
  Check,
  Fingerprint,
  Loader2,
  LogIn,
  LogOut,
  Search,
  Settings,
  ShieldAlert,
  X,
} from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
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
import { KioskCameraMount, type KioskCameraHandle } from "./components/KioskCameraMount";
import { KioskPinPad } from "./components/KioskPinPad";
import {
  authenticateWithBiometric,
  getBiometricState,
  type BiometricState,
} from "./services/biometrics";
import { offlineQueue } from "./services/offlineQueue";
import {
  isKioskApiError,
  isQueuedResult,
  kioskApi,
  newIdempotencyKey,
  type KioskLookupCandidate,
} from "./services/kioskApi";
import { syncWorker } from "./services/syncWorker";

type State =
  | { name: "idle" }
  | { name: "searching" }
  | { name: "showingCandidates"; candidates: KioskLookupCandidate[] }
  | { name: "enteringPin"; candidate: KioskLookupCandidate; idempotencyKey: string; resetCount: number }
  | { name: "submitting"; candidate: KioskLookupCandidate }
  | { name: "success"; candidate: KioskLookupCandidate; action: "in" | "out"; at: string; photoCaptured?: boolean }
  | { name: "error"; message: string }
  | { name: "locked" }
  | { name: "changingPin"; candidate: KioskLookupCandidate; step: "current" | "new" | "submitting"; currentPin?: string; resetCount: number };

const AUTO_RETURN_MS = 5000;

export default function KioskClockIn() {
  const router = useRouter();
  const [state, setState] = useState<State>({ name: "idle" });
  const [query, setQuery] = useState("");
  const [queuedCount, setQueuedCount] = useState(0);
  // Admin PIN gate (overlays any state). Guards exit + re-onboard.
  const [adminGateOpen, setAdminGateOpen] = useState(false);
  const [adminGateError, setAdminGateError] = useState<string | null>(null);
  const [adminGateReset, setAdminGateReset] = useState(0);
  // Device biometric (Touch ID / Face ID / Android fingerprint) as an
  // alternative to the admin PIN. Only meaningful for the ADMIN, not
  // employees — see services/biometrics.ts.
  const [biometric, setBiometric] = useState<BiometricState>({ available: false, label: "Biometric" });
  const cameraRef = useRef<KioskCameraHandle>(null);

  // M31 — banner subscribes to drain events. Initial fetch on mount
  // covers the "tablet rebooted with stale queue" case before any
  // network event has fired.
  useEffect(() => {
    offlineQueue.count().then(setQueuedCount).catch(() => undefined);
    const unsub = syncWorker.onChange(({ pending }) => setQueuedCount(pending));
    return unsub;
  }, []);

  // Probe device biometrics once on mount so the admin gate can offer a
  // finger/face shortcut without a round-trip when the gear is long-pressed.
  useEffect(() => {
    getBiometricState().then(setBiometric).catch(() => undefined);
  }, []);

  // Auto-return from success → idle. Also resets the search input so the
  // next employee walks up to a clean slate.
  useEffect(() => {
    if (state.name !== "success") return;
    const t = setTimeout(() => {
      setQuery("");
      setState({ name: "idle" });
    }, AUTO_RETURN_MS);
    return () => clearTimeout(t);
  }, [state.name]);

  const goIdle = useCallback(() => {
    setQuery("");
    setState({ name: "idle" });
  }, []);

  const onSearch = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) return; // backend rejects <2 chars anyway
    setState({ name: "searching" });
    const r = await kioskApi.lookup(q);
    if (isKioskApiError(r)) {
      if (r.status === 401 || r.status === 403) {
        // Token revoked/deactivated — drop the dead token and show the locked
        // screen. Employees can't reach setup; an admin re-onboards via PIN.
        await AsyncStorage.removeItem(KIOSK_STORAGE_KEYS.token).catch(() => undefined);
        setState({ name: "locked" });
        return;
      }
      setState({ name: "error", message: "Search failed. Please try again." });
      return;
    }
    if (r.length === 0) {
      setState({ name: "error", message: "No match. Check the spelling or ask your admin." });
      return;
    }
    setState({ name: "showingCandidates", candidates: r });
  }, [query]);

  const onPickCandidate = useCallback((c: KioskLookupCandidate) => {
    if (!c.has_pin) {
      setState({
        name: "error",
        message: "This employee has no PIN set. Ask your admin to issue one.",
      });
      return;
    }
    setState({
      name: "enteringPin",
      candidate: c,
      idempotencyKey: newIdempotencyKey(),
      resetCount: 0,
    });
  }, []);

  // Single PIN submission — branches on has_active_session to call the
  // right endpoint. Reuses the same Idempotency-Key across retries of
  // this attempt; on a wrong-PIN bounce-back we roll a fresh key.
  const onPinComplete = useCallback(
    async (pin: string) => {
      if (state.name !== "enteringPin") return;
      const candidate = state.candidate;
      const key = state.idempotencyKey;
      const isClockOut = candidate.has_active_session;

      // Selfie only on clock-IN (parity with web). Capture it NOW, while the
      // visible camera preview is still mounted in PinView — switching to the
      // submitting state below unmounts it. null on permission denied; the
      // backend treats the field as optional.
      let photo_b64: string | null = null;
      if (!isClockOut) {
        photo_b64 = (await cameraRef.current?.capturePhoto().catch(() => null)) ?? null;
      }

      setState({ name: "submitting", candidate });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);

      // Best-effort location. The kiosk is wall-mounted so coords are
      // effectively constant; we send what we can and let the backend
      // accept 0,0 if permission is denied — same fallback as web.
      let location = { latitude: 0, longitude: 0 };
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.granted) {
          const loc = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
          if (loc) {
            location = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          }
        }
      } catch {
        // Silent — location is non-essential for kiosk clock-in.
      }

      if (isClockOut) {
        const r = await kioskApi.clockOutWithOfflineFallback(
          { private_user_id: candidate.private_user_id, pin, location },
          key,
        );
        handleResult(r, candidate, "out", pin);
      } else {
        const r = await kioskApi.clockInWithOfflineFallback(
          {
            private_user_id: candidate.private_user_id,
            pin,
            location,
            photo_b64,
          },
          key,
        );
        handleResult(r, candidate, "in", pin, photo_b64 != null);
      }
    },
    [state],
  );

  const handleResult = useCallback(
    (
      r:
        | Awaited<ReturnType<typeof kioskApi.clockInWithOfflineFallback>>
        | Awaited<ReturnType<typeof kioskApi.clockOutWithOfflineFallback>>,
      candidate: KioskLookupCandidate,
      action: "in" | "out",
      _attemptedPin: string,
      photoCaptured?: boolean,
    ) => {
      // M31 — queued offline. Treat as success in the UI; the worker
      // will drain when connectivity returns. `at` falls back to "now"
      // since we don't have a server timestamp yet.
      if (isQueuedResult(r)) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
        setState({
          name: "success",
          candidate,
          action,
          at: new Date().toISOString(),
          photoCaptured,
        });
        return;
      }
      if (isKioskApiError(r)) {
        const isPinErr = r.status === 400 && /pin/i.test(r.error);
        if (isPinErr) {
          // Bounce back to the PIN pad with a fresh idempotency key —
          // a wrong PIN is a new logical attempt, not a retry of the
          // failed one. Bump resetCount to clear the bullets.
          setState((s) => {
            // We're transitioning out of "submitting" — rebuild the
            // enteringPin state for the same candidate.
            return {
              name: "enteringPin",
              candidate,
              idempotencyKey: newIdempotencyKey(),
              resetCount: (s.name === "enteringPin" ? s.resetCount : 0) + 1,
            };
          });
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
          return;
        }
        if (r.status === 401 || r.status === 403) {
          // Token revoked/deactivated mid-session → locked screen (admin re-onboards).
          AsyncStorage.removeItem(KIOSK_STORAGE_KEYS.token).catch(() => undefined);
          setState({ name: "locked" });
          return;
        }
        const msg =
          r.status === 409 && /already_clocked_in/i.test(r.error)
            ? "Already clocked in — go to the clock-out screen instead."
            : r.status === 409 && /no_active_job/i.test(r.error)
              ? "You don't have an active job assignment. Talk to HR."
              : r.status === 429
                ? "Too many attempts. Wait a moment and try again."
                : r.error || "Something went wrong. Try again.";
        setState({ name: "error", message: msg });
        return;
      }
      const at =
        action === "in"
          ? (r as { clocked_in_at: string }).clocked_in_at
          : (r as { clocked_out_at: string }).clocked_out_at;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setState({ name: "success", candidate, action, at, photoCaptured });
    },
    [],
  );

  // -- Task #56 — Change-PIN entry point reachable from the PIN screen
  const onStartChangePin = useCallback(() => {
    if (state.name !== "enteringPin") return;
    setState({
      name: "changingPin",
      candidate: state.candidate,
      step: "current",
      resetCount: 0,
    });
  }, [state]);

  const onChangePinStep = useCallback(
    async (pin: string) => {
      if (state.name !== "changingPin") return;
      if (state.step === "current") {
        setState({ ...state, step: "new", currentPin: pin, resetCount: state.resetCount + 1 });
        return;
      }
      if (state.step === "new") {
        if (state.currentPin === pin) {
          Alert.alert(
            "Same PIN",
            "Your new PIN can't be the same as the current one. Try a different 4 digits.",
          );
          setState({ ...state, step: "new", resetCount: state.resetCount + 1 });
          return;
        }
        setState({ ...state, step: "submitting" });
        const r = await kioskApi.changePin({
          private_user_id: state.candidate.private_user_id,
          current_pin: state.currentPin!,
          new_pin: pin,
        });
        if (isKioskApiError(r)) {
          const msg =
            r.status === 400 && /current_pin/i.test(r.error)
              ? "Current PIN was wrong. Start over."
              : r.error || "Couldn't change PIN. Try again.";
          setState({ name: "error", message: msg });
          return;
        }
        // Success — show confirmation and route back to idle.
        setState({
          name: "success",
          candidate: state.candidate,
          action: "in",
          at: new Date().toISOString(),
        });
        // Override the success label below to "PIN updated"; reuse
        // success state to inherit the auto-return-to-idle behavior.
      }
    },
    [state],
  );

  // Admin gate — long-press the gear (or tap "Admin access" on the locked
  // screen) to open the admin PIN pad. Keeps employees on clock-in only.
  const onOpenAdminGate = useCallback(() => {
    setAdminGateError(null);
    setAdminGateReset((n) => n + 1);
    setAdminGateOpen(true);
  }, []);

  // Shared admin-menu opener — both the PIN path and the biometric path land
  // here after a successful gate. Extracted so neither duplicates the action
  // sheet.
  const openAdminMenu = useCallback(() => {
    setAdminGateOpen(false);
    setAdminGateError(null);
    Alert.alert("Kiosk admin", "Choose an action.", [
      { text: "Re-enter device token", onPress: () => router.replace("/kiosk/setup" as never) },
      {
        text: "Exit kiosk mode",
        style: "destructive",
        onPress: async () => {
          await AsyncStorage.multiRemove([
            KIOSK_STORAGE_KEYS.mode,
            KIOSK_STORAGE_KEYS.token,
            KIOSK_STORAGE_KEYS.adminPin,
          ]);
          router.replace("/login" as never);
        },
      },
      { text: "Cancel", style: "cancel" },
    ]);
  }, [router]);

  // Verify the admin PIN, then offer the admin actions. Legacy kiosks
  // provisioned before this feature have no stored PIN — don't lock the admin
  // out; let them through so they can set one by re-onboarding.
  const onAdminPinComplete = useCallback(async (pin: string) => {
    const stored = await AsyncStorage.getItem(KIOSK_STORAGE_KEYS.adminPin);
    if (stored && pin !== stored) {
      setAdminGateError("Wrong PIN. Try again.");
      setAdminGateReset((n) => n + 1);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
      return;
    }
    openAdminMenu();
  }, [openAdminMenu]);

  // Device-biometric admin unlock. The OS fingerprint/Face ID belongs to the
  // admin (device owner), so a successful match is equivalent to the admin
  // PIN. Cancellation is silently ignored.
  const onAdminBiometric = useCallback(async () => {
    setAdminGateError(null);
    const ok = await authenticateWithBiometric("Unlock kiosk admin");
    if (ok) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      openAdminMenu();
    } else {
      // Distinguish a real failure from a user cancel: LocalAuthentication
      // surfaces cancel via result.error, which our helper collapses to
      // false. Treat it as a no-op — don't show an error on cancel.
      setAdminGateError("Couldn't unlock. Use the PIN instead.");
    }
  }, [openAdminMenu]);

  // -- Render -----------------------------------------------------------------

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
          {/* Admin gear — long-press to exit kiosk mode. Always visible
              but unobtrusive in the top-right corner. */}
          <View style={styles.topBar}>
            <Pressable
              onLongPress={onOpenAdminGate}
              delayLongPress={1200}
              hitSlop={16}
              style={styles.gearBtn}
            >
              <Settings size={18} color="#475569" />
            </Pressable>
          </View>

          {queuedCount > 0 && (
            <View style={styles.queueBanner}>
              <Text style={styles.queueBannerText}>
                {queuedCount} {queuedCount === 1 ? "entry" : "entries"} waiting to sync
              </Text>
            </View>
          )}

          {state.name === "idle" && (
            <IdleView
              query={query}
              setQuery={setQuery}
              onSearch={onSearch}
            />
          )}

          {state.name === "searching" && <CenteredSpinner label="Searching..." />}

          {state.name === "showingCandidates" && (
            <CandidatesView
              candidates={state.candidates}
              onPick={onPickCandidate}
              onCancel={goIdle}
            />
          )}

          {state.name === "enteringPin" && (
            <PinView
              candidate={state.candidate}
              isClockOut={state.candidate.has_active_session}
              resetSignal={state.resetCount}
              onComplete={onPinComplete}
              onCancel={goIdle}
              onChangePin={onStartChangePin}
              cameraRef={cameraRef}
            />
          )}

          {state.name === "submitting" && (
            <CenteredSpinner
              label={
                state.candidate.has_active_session
                  ? "Clocking out..."
                  : "Clocking in..."
              }
            />
          )}

          {state.name === "success" && (
            <SuccessView
              candidate={state.candidate}
              action={state.action}
              at={state.at}
              photoCaptured={state.photoCaptured}
            />
          )}

          {state.name === "error" && (
            <ErrorView message={state.message} onRetry={goIdle} />
          )}

          {state.name === "changingPin" && (
            <ChangePinView
              candidate={state.candidate}
              step={state.step}
              resetSignal={state.resetCount}
              onComplete={onChangePinStep}
              onCancel={goIdle}
            />
          )}

          {state.name === "locked" && <LockedView onAdmin={onOpenAdminGate} />}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Admin PIN gate — overlays everything; guards exit + re-onboard. */}
      {adminGateOpen && (
        <View style={styles.adminOverlay}>
          <Text style={styles.adminTitle}>Admin PIN</Text>
          <Text style={styles.adminSub}>Enter the admin PIN to manage this kiosk</Text>
          <View style={{ marginTop: 24, alignItems: "center" }}>
            <KioskPinPad onComplete={onAdminPinComplete} resetSignal={adminGateReset} />
          </View>
          {biometric.available && (
            <Pressable onPress={onAdminBiometric} style={styles.biometricBtn} hitSlop={12}>
              <Fingerprint size={18} color="#60a5fa" />
              <Text style={styles.biometricText}>Unlock with {biometric.label}</Text>
            </Pressable>
          )}
          {adminGateError && <Text style={styles.adminError}>{adminGateError}</Text>}
          <Pressable onPress={() => setAdminGateOpen(false)} style={styles.adminCancel} hitSlop={12}>
            <Text style={styles.adminCancelText}>Cancel</Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Sub-views — kept inline so the state machine + props remain readable.
// ---------------------------------------------------------------------------

function IdleView({
  query,
  setQuery,
  onSearch,
}: {
  query: string;
  setQuery: (s: string) => void;
  onSearch: () => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Clock in / out</Text>
      <Text style={styles.sub}>
        Enter your email or phone number to begin.
      </Text>
      <View style={styles.searchRow}>
        <Search size={20} color="#64748b" style={{ marginLeft: 16 }} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="email or phone"
          placeholderTextColor="#64748b"
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          keyboardType="email-address"
          style={styles.searchInput}
          onSubmitEditing={onSearch}
          returnKeyType="search"
        />
        <Pressable onPress={onSearch} style={styles.searchBtn} disabled={query.trim().length < 2}>
          <ArrowRight size={22} color="white" />
        </Pressable>
      </View>
    </View>
  );
}

function CandidatesView({
  candidates,
  onPick,
  onCancel,
}: {
  candidates: KioskLookupCandidate[];
  onPick: (c: KioskLookupCandidate) => void;
  onCancel: () => void;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Is this you?</Text>
      <Text style={styles.sub}>Tap your name to continue.</Text>
      <View style={{ gap: 12, marginTop: 16 }}>
        {candidates.map((c) => (
          <Pressable
            key={c.private_user_id}
            onPress={() => onPick(c)}
            style={({ pressed }) => [styles.candidateRow, pressed && { backgroundColor: "#334155" }]}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(c.display_name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.candidateName}>{c.display_name}</Text>
              {(c.department_name || c.job_title) && (
                <Text style={styles.candidateMeta}>
                  {[c.department_name, c.job_title].filter(Boolean).join(" · ")}
                </Text>
              )}
            </View>
            {c.has_active_session ? (
              <View style={[styles.pill, styles.pillOut]}>
                <Text style={styles.pillText}>Clock out</Text>
              </View>
            ) : (
              <View style={[styles.pill, styles.pillIn]}>
                <Text style={styles.pillText}>Clock in</Text>
              </View>
            )}
          </Pressable>
        ))}
      </View>
      <Pressable onPress={onCancel} style={styles.cancelBtn}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function PinView({
  candidate,
  isClockOut,
  resetSignal,
  onComplete,
  onCancel,
  onChangePin,
  cameraRef,
}: {
  candidate: KioskLookupCandidate;
  isClockOut: boolean;
  resetSignal: number;
  onComplete: (pin: string) => void;
  onCancel: () => void;
  onChangePin: () => void;
  cameraRef: RefObject<KioskCameraHandle>;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>Hi, {candidate.display_name.split(" ")[0]}</Text>
      <Text style={styles.sub}>
        Enter your 4-digit PIN to{" "}
        <Text style={{ color: isClockOut ? "#fca5a5" : "#86efac", fontWeight: "700" }}>
          {isClockOut ? "clock out" : "clock in"}
        </Text>
      </Text>
      {/* Live selfie preview — clock-in only (parity with web). Mounting it
          here keeps the camera warming up while the PIN is entered, so the
          capture at PIN-complete is ready and the employee sees the photo
          being taken. */}
      {!isClockOut && (
        <View style={{ marginTop: 20, alignItems: "center" }}>
          <KioskCameraMount ref={cameraRef} />
        </View>
      )}
      <View style={{ marginTop: 24, alignItems: "center" }}>
        <KioskPinPad onComplete={onComplete} resetSignal={resetSignal} />
      </View>
      <View style={styles.pinFooter}>
        <Pressable onPress={onCancel} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Not me</Text>
        </Pressable>
        <Pressable onPress={onChangePin} style={styles.changePinBtn}>
          <Text style={styles.changePinText}>Change PIN</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ChangePinView({
  candidate,
  step,
  resetSignal,
  onComplete,
  onCancel,
}: {
  candidate: KioskLookupCandidate;
  step: "current" | "new" | "submitting";
  resetSignal: number;
  onComplete: (pin: string) => void;
  onCancel: () => void;
}) {
  if (step === "submitting") return <CenteredSpinner label="Saving new PIN..." />;
  return (
    <View style={styles.section}>
      <Text style={styles.heading}>
        {step === "current" ? "Confirm current PIN" : "Pick a new 4-digit PIN"}
      </Text>
      <Text style={styles.sub}>
        {step === "current"
          ? `So we know it's you, ${candidate.display_name.split(" ")[0]}.`
          : "Choose something you'll remember. Avoid 1234 or 0000."}
      </Text>
      <View style={{ marginTop: 32, alignItems: "center" }}>
        <KioskPinPad onComplete={onComplete} resetSignal={resetSignal} />
      </View>
      <Pressable onPress={onCancel} style={styles.cancelBtn}>
        <Text style={styles.cancelText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function SuccessView({
  candidate,
  action,
  at,
  photoCaptured,
}: {
  candidate: KioskLookupCandidate;
  action: "in" | "out";
  at: string;
  photoCaptured?: boolean;
}) {
  const time = formatTime(at);
  return (
    <View style={[styles.section, styles.centered]}>
      <View style={styles.successCircle}>
        <Check size={64} color="white" strokeWidth={3} />
      </View>
      <Text style={styles.successHeading}>
        Clocked {action === "in" ? "in" : "out"}
      </Text>
      <Text style={styles.successSub}>
        {candidate.display_name} · {time}
      </Text>
      {/* Photo-capture indicator — clock-in only. Tells the operator on the
          tablet whether the buddy-punch selfie was actually stored, so a
          camera-permission / capture failure is obvious without checking the
          dashboard. */}
      {action === "in" && photoCaptured !== undefined && (
        <Text
          style={[
            styles.photoStatus,
            { color: photoCaptured ? "#86efac" : "#fbbf24" },
          ]}
        >
          {photoCaptured
            ? "✓ Photo captured"
            : "⚠ No photo — check camera permission"}
        </Text>
      )}
      <Text style={styles.autoReturn}>Returning in 5s</Text>
    </View>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={[styles.section, styles.centered]}>
      <View style={styles.errorCircle}>
        <ShieldAlert size={56} color="white" />
      </View>
      <Text style={styles.errorHeading}>Something went wrong</Text>
      <Text style={styles.errorMsg}>{message}</Text>
      <Pressable onPress={onRetry} style={styles.retryBtn}>
        <Text style={styles.retryText}>OK</Text>
      </Pressable>
    </View>
  );
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <View style={[styles.section, styles.centered, { paddingTop: 80 }]}>
      <ActivityIndicator size="large" color="#60a5fa" />
      <Text style={[styles.sub, { marginTop: 16 }]}>{label}</Text>
    </View>
  );
}

function LockedView({ onAdmin }: { onAdmin: () => void }) {
  return (
    <View style={[styles.section, styles.centered, { paddingTop: 60 }]}>
      <View style={styles.errorCircle}>
        <ShieldAlert size={56} color="white" />
      </View>
      <Text style={styles.errorHeading}>Tablet needs re-onboarding</Text>
      <Text style={styles.errorMsg}>
        This kiosk&apos;s access was revoked. Please contact your administrator.
      </Text>
      <Pressable onPress={onAdmin} onLongPress={onAdmin} style={styles.lockedAdminBtn} hitSlop={16}>
        <Text style={styles.lockedAdminText}>Admin access</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0f172a" },
  scroll: { flexGrow: 1, padding: 24, paddingTop: 8 },
  topBar: { flexDirection: "row", justifyContent: "flex-end", marginBottom: 8 },
  gearBtn: { padding: 12, borderRadius: 999 },
  section: { flex: 1, justifyContent: "flex-start" },
  centered: { alignItems: "center", justifyContent: "center" },
  heading: { color: "white", fontSize: 32, fontWeight: "800", marginTop: 24, textAlign: "center" },
  sub: { color: "#94a3b8", fontSize: 16, marginTop: 8, textAlign: "center", paddingHorizontal: 16 },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e293b",
    borderRadius: 16,
    marginTop: 32,
    borderWidth: 1,
    borderColor: "#334155",
  },
  searchInput: {
    flex: 1,
    color: "white",
    fontSize: 18,
    paddingHorizontal: 12,
    paddingVertical: 18,
  },
  searchBtn: {
    backgroundColor: "#2563eb",
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 6,
  },
  candidateRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1e293b",
    borderRadius: 16,
    padding: 16,
    gap: 16,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#475569",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "white", fontSize: 18, fontWeight: "700" },
  candidateName: { color: "white", fontSize: 18, fontWeight: "600" },
  candidateMeta: { color: "#94a3b8", fontSize: 13, marginTop: 2 },
  pill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  pillIn: { backgroundColor: "#16a34a" },
  pillOut: { backgroundColor: "#dc2626" },
  pillText: { color: "white", fontSize: 12, fontWeight: "700" },
  pinFooter: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 24,
    paddingHorizontal: 16,
  },
  cancelBtn: { alignSelf: "center", paddingVertical: 14, paddingHorizontal: 24 },
  cancelText: { color: "#94a3b8", fontSize: 14, fontWeight: "600" },
  changePinBtn: { paddingVertical: 14, paddingHorizontal: 24 },
  changePinText: { color: "#60a5fa", fontSize: 14, fontWeight: "600" },
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  successHeading: { color: "white", fontSize: 32, fontWeight: "800" },
  successSub: { color: "#cbd5e1", fontSize: 18, marginTop: 8 },
  photoStatus: { fontSize: 14, fontWeight: "600", marginTop: 16, textAlign: "center", paddingHorizontal: 24 },
  autoReturn: { color: "#64748b", fontSize: 12, marginTop: 32 },
  errorCircle: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#dc2626",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
  },
  errorHeading: { color: "white", fontSize: 24, fontWeight: "800" },
  errorMsg: {
    color: "#fca5a5",
    fontSize: 15,
    marginTop: 12,
    textAlign: "center",
    paddingHorizontal: 16,
  },
  retryBtn: {
    backgroundColor: "#1e293b",
    paddingVertical: 14,
    paddingHorizontal: 48,
    borderRadius: 12,
    marginTop: 32,
  },
  retryText: { color: "white", fontSize: 16, fontWeight: "700" },
  lockedAdminBtn: {
    marginTop: 36,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
  },
  lockedAdminText: { color: "#94a3b8", fontSize: 14, fontWeight: "600" },
  adminOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#0f172a",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    zIndex: 50,
  },
  adminTitle: { color: "white", fontSize: 24, fontWeight: "800" },
  adminSub: { color: "#94a3b8", fontSize: 15, marginTop: 8, textAlign: "center" },
  adminError: { color: "#fca5a5", fontSize: 14, fontWeight: "600", marginTop: 16 },
  biometricBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#334155",
    backgroundColor: "#1e293b",
  },
  biometricText: { color: "#60a5fa", fontSize: 14, fontWeight: "600" },
  adminCancel: { marginTop: 28, paddingVertical: 10, paddingHorizontal: 24 },
  adminCancelText: { color: "#64748b", fontSize: 15, fontWeight: "600" },
  queueBanner: {
    backgroundColor: "#7c2d12",
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    marginBottom: 12,
    alignSelf: "center",
  },
  queueBannerText: {
    color: "#fed7aa",
    fontSize: 12,
    fontWeight: "600",
  },
});
