import LanguageProvider from "@/app/context/LanguageProvider";
import { config } from "@/config/gluestack-ui.config";
import migrations from "@/drizzle/migrations";
import "@/global.css";
import { GluestackUIProvider } from "@gluestack-ui/themed";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { useMigrations } from "drizzle-orm/expo-sqlite/migrator";
import { Stack } from "expo-router";
import { SQLiteProvider, openDatabaseSync } from "expo-sqlite";
import { Suspense, useState, useCallback } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import BrandSplash from "@/components/BrandSplash";

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
    </Suspense>
  );
}
