// RN 0.81 compat shim — must run before any GlueStack overlay mounts.
import "@/shims/backHandlerCompat";
import LanguageProvider from "@/app/context/LanguageProvider";
import { config } from "@/config/gluestack-ui.config";
import migrations from "@/drizzle/migrations";
import "@/global.css";
import { GluestackUIProvider } from "@gluestack-ui/themed";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { Stack, usePathname } from "expo-router";
import { SQLiteProvider, openDatabaseSync } from "expo-sqlite";
import { Suspense, useState, useRef, useCallback, useEffect } from "react";
import { View, TextInput } from "react-native";
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BrandSplash from "@/components/BrandSplash";
import AppErrorBoundary from "@/components/AppErrorBoundary";
import { PostHogProvider, usePostHog } from "posthog-react-native";

// FONTS — Kiruko brand display font (Orbitron, matches the logo wordmark)
import { Orbitron_500Medium } from "@expo-google-fonts/orbitron/500Medium";
import { Orbitron_700Bold } from "@expo-google-fonts/orbitron/700Bold";
import { Orbitron_800ExtraBold } from "@expo-google-fonts/orbitron/800ExtraBold";
import { useFonts } from "@expo-google-fonts/orbitron/useFonts";
// Preload the icon fonts so @expo/vector-icons glyphs are guaranteed available
// on first paint. Without this, release builds can render icons before their
// font finishes lazy-loading, showing blank/tofu glyphs intermittently (e.g.
// the ⓘ role icon on the report screen).
import { MaterialIcons, Ionicons, FontAwesome5 } from "@expo/vector-icons";
import AuthProvider from "./context/AuthProvider";
import OnBoardProvider from "./context/OnBoardProvider";
import { CurrencyProvider } from "./context/CurrencyContext";
import usePushNotifications from "@/hooks/usePushNotifications";
import useRescheduleClockReminders from "@/hooks/useRescheduleClockReminders";
import useIdleTimeout from "@/hooks/useIdleTimeout";
import { emitIdleActivity, subscribeIdleActivity } from "@/hooks/idleActivityBus";
import IdleLockScreen from "@/components/IdleLockScreen";
import useAuth from "./hooks/useAuth";

export const DATABASE_NAME = "mywitnesstree.db";

// PostHog analytics — public project key + host injected at build time via EAS
// env (EXPO_PUBLIC_*). When the key is absent (e.g. a local build without it),
// `disabled` short-circuits the SDK so nothing is sent and nothing errors.
const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

// Session replay is a heavy native iOS module and the prime suspect for the
// app relaunching to the splash screen when connectivity flips (airplane mode).
// OFF by default; opt back in per-build with
// EXPO_PUBLIC_POSTHOG_SESSION_REPLAY=true once the crash is confirmed fixed.
const SESSION_REPLAY_ENABLED =
  process.env.EXPO_PUBLIC_POSTHOG_SESSION_REPLAY === "true";

// Manual screen tracking. expo-router doesn't expose a NavigationContainer, so
// PostHog's automatic captureScreens can't hook it — we emit a $screen event on
// each pathname change instead. This is what reveals the onboarding/signup
// funnel (which screens users reach before dropping off).
function ScreenTracker() {
  const pathname = usePathname();
  const posthog = usePostHog();
  useEffect(() => {
    if (pathname) posthog?.screen(pathname);
  }, [pathname, posthog]);
  return null;
}

// Registers push token once at app root — not re-created on every tab switch
function PushNotificationRegistrar() {
  usePushNotifications();
  return null;
}

// Re-registers weekly clock reminders from the server-side Job on launch —
// inside AuthProvider so it has auth access. Survives reinstall/clear.
function ClockReminderResync() {
  useRescheduleClockReminders();
  return null;
}

// Best practice: 2 min of inactivity LOCKS (fast biometric resume, works
// offline); the session only ENDS on escalation — no device passcode, 5
// failed unlocks, or 30 min locked. Full sign-out wipes authToken +
// refreshToken via AuthProvider.logout so silent refresh can't re-mint.
// (Backend JWTs are stateless with no server revocation, so this ends the
// session on this device; other devices keep theirs until tokens expire.)
const LOCKED_ESCALATION_MS = 30 * 60 * 1000; // 30 min locked → sign out

// Typing produces no touch events, so a long uninterrupted typing stretch
// would lock mid-form. There is no global keystroke API in RN and inputs are
// used raw in 100+ screens, so focus is polled as a typing proxy instead.
// Bounded: focus only extends the session within FOCUS_GRACE_MS of the last
// real touch — otherwise an abandoned phone with the keyboard open would
// never lock. Worst case the lock is non-destructive (overlay only, form
// state preserved) and costs a 1-second biometric resume.
const FOCUS_POLL_MS = 15 * 1000;
const FOCUS_GRACE_MS = 5 * 60 * 1000;

// Manages idle timeout and lock screen — sits inside AuthProvider so it has auth access
function IdleManager({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [isLocked, setIsLocked] = useState(false);
  const isAuthenticated = !!user?.isAuthenticated;

  // Hold logout in a ref so handleIdle keeps a stable identity. logout isn't
  // memoized, so depending on it directly would tear down and restart the
  // idle timer's effect on every render — the countdown could keep resetting
  // and never fire. Assigned in an effect to stay concurrent-mode safe.
  const logoutRef = useRef(logout);
  useEffect(() => {
    logoutRef.current = logout;
  }, [logout]);

  const handleIdle = useCallback(() => {
    if (isAuthenticated) setIsLocked(true);
  }, [isAuthenticated]);

  const { resetTimer } = useIdleTimeout(handleIdle, isAuthenticated);

  const handleUnlock = useCallback(() => {
    setIsLocked(false);
    resetTimer();
  }, [resetTimer]);

  const handleLogout = useCallback(async () => {
    setIsLocked(false);
    await logoutRef.current();
  }, []);

  // Activity subscription: the touch-catcher sits at the very root (above
  // GluestackUIProvider's overlay portal) and publishes every touch here.
  // Guarded by refs so the subscription stays stable across renders.
  const activityGuardRef = useRef({ isAuthenticated, isLocked });
  useEffect(() => {
    activityGuardRef.current = { isAuthenticated, isLocked };
  }, [isAuthenticated, isLocked]);

  // Last real touch — stamps activity for the focus-grace poll below.
  const lastTouchRef = useRef(0);

  useEffect(
    () =>
      subscribeIdleActivity(() => {
        lastTouchRef.current = Date.now();
        const guard = activityGuardRef.current;
        if (guard.isAuthenticated && !guard.isLocked) resetTimer();
      }),
    [resetTimer],
  );

  // Typing proxy poll (see FOCUS_GRACE_MS note above).
  useEffect(() => {
    if (!isAuthenticated) return;
    const id = setInterval(() => {
      if (activityGuardRef.current.isLocked) return;
      const focused = TextInput.State.currentlyFocusedInput?.();
      if (focused != null && Date.now() - lastTouchRef.current < FOCUS_GRACE_MS) {
        resetTimer();
      }
    }, FOCUS_POLL_MS);
    return () => clearInterval(id);
  }, [isAuthenticated, resetTimer]);

  // Clear a stale lock when the session ends elsewhere (e.g. token 401).
  // Effect, not render-time setState — setting state during render re-renders
  // the parent and can loop with the navigator guard.
  useEffect(() => {
    if (!isAuthenticated && isLocked) setIsLocked(false);
  }, [isAuthenticated, isLocked]);

  // Escalation: a lock left unresolved for 30 min ends the session. Taps on
  // the lock screen deliberately do NOT reset this — otherwise the timer
  // could be kept alive forever without ever authenticating.
  useEffect(() => {
    if (!isLocked) return;
    const id = setTimeout(() => {
      setIsLocked(false);
      void logoutRef.current();
    }, LOCKED_ESCALATION_MS);
    return () => clearTimeout(id);
  }, [isLocked]);

  return (
    <>
      {children}
      {isLocked && (
        <IdleLockScreen
          onUnlock={handleUnlock}
          onLogout={handleLogout}
          userName={user?.private_user?.first_name}
        />
      )}
    </>
  );
}

export default function RootLayout() {
  const expoSQLite = openDatabaseSync(DATABASE_NAME);
  const db = drizzle(expoSQLite);
  const { success, error } = useMigrations(db, migrations);
  let [fontsLoaded] = useFonts({
    Orbitron_500Medium,
    Orbitron_700Bold,
    Orbitron_800ExtraBold,
    ...MaterialIcons.font,
    ...Ionicons.font,
    ...FontAwesome5.font,
  });
  if (!fontsLoaded) return <BrandSplash />;
  return (
    <AppErrorBoundary>
      <Suspense fallback={<BrandSplash />}>
        <View
          style={{ flex: 1 }}
          // Root touch-catcher for the idle timer. Placed here — above
          // GluestackUIProvider — deliberately: GlueStack Modals/toasts render
          // in an overlay portal at the provider level, so a catcher next to
          // the Stack never sees those touches and the app would lock mid-use
          // inside any modal. Capture phase runs top-down on every touch start
          // even when a child claims the responder; returning false lets
          // children handle the touch normally. Publishes to IdleManager via
          // the activity bus (it owns the timer + auth state).
          onStartShouldSetResponderCapture={() => {
            emitIdleActivity();
            return false;
          }}
        >
        <PostHogProvider
        apiKey={POSTHOG_API_KEY}
        autocapture={{
          // expo-router: automatic screen capture can't hook the router, so we
          // capture screens manually in <ScreenTracker/>. Touch autocapture is
          // off to avoid noise and to keep from capturing PII in labels.
          captureScreens: false,
          captureTouches: false,
        }}
        options={{
          host: POSTHOG_HOST,
          // No key configured -> SDK is a no-op (safe for local/dev builds).
          disabled: !POSTHOG_API_KEY,
          // Application Installed / Updated / Opened — the top of the funnel
          // (install -> first open) we're currently blind on.
          captureAppLifecycleEvents: true,
          errorTracking: {
            autocapture: {
              uncaughtExceptions: true,
              unhandledRejections: true,
            },
          },
          // Session replay — gated OFF by default. It is a native iOS module
          // and the prime suspect for the crash-on-connectivity-change that
          // relaunched the app to the splash. Re-enable per-build with
          // EXPO_PUBLIC_POSTHOG_SESSION_REPLAY=true (and PostHog project
          // settings "Record user sessions"). When on, everything sensitive is
          // masked (payroll app).
          enableSessionReplay: SESSION_REPLAY_ENABLED,
          sessionReplayConfig: {
            maskAllTextInputs: true,
            maskAllImages: true,
            maskAllSandboxedViews: true,
          },
        }}
      >
      <SQLiteProvider
        databaseName={DATABASE_NAME}
        options={{
          enableChangeListener: true,
        }}
        useSuspense
      >
        <LanguageProvider>
          <GluestackUIProvider config={config}>
            <CurrencyProvider>
              <OnBoardProvider>
                <AuthProvider>
                  <IdleManager>
                    <ScreenTracker />
                    <PushNotificationRegistrar />
                    <ClockReminderResync />
                    <Stack screenOptions={{
                      headerShown: false
                    }} />
                  </IdleManager>
                </AuthProvider>
              </OnBoardProvider>
            </CurrencyProvider>
          </GluestackUIProvider>
        </LanguageProvider>
      </SQLiteProvider>
      </PostHogProvider>
        </View>
      </Suspense>
    </AppErrorBoundary>
  );
}
