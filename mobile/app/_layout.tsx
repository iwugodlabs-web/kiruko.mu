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
import { Suspense, useState, useCallback, useEffect } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BrandSplash from "@/components/BrandSplash";
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
import IdleLockScreen from "@/components/IdleLockScreen";
import useAuth from "./hooks/useAuth";

export const DATABASE_NAME = "mywitnesstree.db";

// PostHog analytics — public project key + host injected at build time via EAS
// env (EXPO_PUBLIC_*). When the key is absent (e.g. a local build without it),
// `disabled` short-circuits the SDK so nothing is sent and nothing errors.
const POSTHOG_API_KEY = process.env.EXPO_PUBLIC_POSTHOG_API_KEY;
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

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

// Manages idle timeout and lock screen — sits inside AuthProvider so it has auth access
function IdleManager({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const [isLocked, setIsLocked] = useState(false);
  const isAuthenticated = !!user?.isAuthenticated;

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
    await logout();
  }, [logout]);

  // Reset lock when user logs out
  if (!isAuthenticated && isLocked) setIsLocked(false);

  return (
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponder={() => {
        if (isAuthenticated && !isLocked) resetTimer();
        return false;
      }}
    >
      {children}
      {isLocked && (
        <IdleLockScreen
          onUnlock={handleUnlock}
          onLogout={handleLogout}
          userName={user?.private_user?.first_name}
        />
      )}
    </View>
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
    <Suspense fallback={<BrandSplash />}>
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
    </Suspense>
  );
}
