
import AsyncStorage from "@react-native-async-storage/async-storage";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Dimensions } from "react-native";
import BrandSplash from "@/components/BrandSplash";
import useAuth from "./hooks/useAuth";
import useOnBoard from "./hooks/useOnBoard";
import { qualifiesForModeChoice, getEntryMode, dashboardRouteForMode, EntryMode } from "@/services/entryMode";
import { KIOSK_STORAGE_KEYS, KIOSK_TABLET_MIN_WIDTH } from "./kiosk/constants";

export default function Index() {
  // isBoardingComplete is a boolean from AsyncStorage, managed by its own hook.
  const { isBoardingComplete, changeIsBoardingCompletes } = useOnBoard();
  // isLoading and user are from the AuthContext.
  const { user, isLoading } = useAuth();
  // State to ensure router is ready before we attempt to navigate.
  const [isRouterReady, setIsRouterReady] = useState(false);
  // Persisted dual-identity entry choice (undefined = not yet loaded).
  const [entryMode, setEntryModeState] = useState<EntryMode | null | undefined>(undefined);

  // Tri-state: undefined = checking AsyncStorage, true/false = resolved.
  // Treated as a routing prerequisite alongside isLoading + isBoardingComplete
  // so we never momentarily flash the auth gate before flipping into kiosk.
  const [kioskMode, setKioskMode] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    getEntryMode().then((m) => setEntryModeState(m));
    // Tablet-only kiosk gate — phones never bypass the user-auth flow even
    // if the flag got set somehow (defense against accidental provisioning).
    // 600dp covers every iPad at full screen (iPad mini = 768pt) and all
    // 7"+ Android tablets, while phones cap out around 430dp.
    const isTablet = Dimensions.get("window").width >= KIOSK_TABLET_MIN_WIDTH;
    if (!isTablet) {
      setKioskMode(false);
      return;
    }
    AsyncStorage.getItem(KIOSK_STORAGE_KEYS.mode)
      .then((v) => setKioskMode(v === "1"))
      .catch(() => setKioskMode(false));
  }, []);

  useEffect(() => {
    // This timeout ensures that navigation attempts are deferred until the next event loop tick,
    // giving the router and layout components time to mount properly. This helps prevent
    // the "Attempted to navigate before mounting the Root Layout" error.
    const timer = setTimeout(() => {
      console.log('🎯 Index: Router is now ready for navigation');
      setIsRouterReady(true);
    }, 100); // Increased from 1ms to 100ms for better reliability
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // We must wait for auth status, onboarding status, the entry-mode flag,
    // the kiosk flag, and the router.
    if (isLoading || isBoardingComplete === undefined || entryMode === undefined || kioskMode === undefined || !isRouterReady) {
      console.log('🔄 Index: Waiting for prerequisites...', {
        isLoading,
        isBoardingComplete,
        isRouterReady,
        kioskMode,
        userType: user?.user_type
      });
      return; // The loading spinner will be shown.
    }

    // Kiosk-mode short-circuit: tablet provisioned as a clock-in kiosk goes
    // straight to the kiosk flow and never touches the user-auth gate. Exit
    // is admin-driven from inside /kiosk/clock-in (clears the flag + token).
    if (kioskMode) {
      console.log('🏬 ENTRY: Kiosk-mode tablet → clock-in.');
      // Cast: expo-router typed-routes manifest regenerates on `expo start`;
      // standalone tsc doesn't see the new /kiosk/* paths until then.
      router.replace('/kiosk/clock-in' as never);
      return;
    }

    console.log('✅ Index: All prerequisites ready, determining route...', {
      hasUser: !!user,
      userType: user?.user_type,
      onboardComplete: user?.onboard_complete,
      isBoardingComplete
    });

    // Now we have all the information we need to make a routing decision.
    // Plan Phase 12.B — onboarding gate is now real. The flag
    // `user.onboard_complete` is server-authoritative; the client cannot
    // bypass it by mutating AsyncStorage.
    if (user) {
      // Dual-identity users (owner/admin/manager who are also employees) choose which
      // side to enter. If they've already picked (persisted), honor it; otherwise show
      // the chooser. Onboarding-incomplete private users still finish their profile first.
      if (qualifiesForModeChoice(user) && (user.user_type === 'company' || user.onboard_complete)) {
        if (isBoardingComplete === false) changeIsBoardingCompletes(true);
        if (entryMode) {
          console.log(`🔀 ENTRY: Dual-identity user → ${entryMode} (saved choice).`);
          router.replace(dashboardRouteForMode(entryMode) as any);
        } else {
          console.log('🔀 ENTRY: Dual-identity user → mode chooser.');
          router.replace('/choose-mode');
        }
      } else if (user.user_type === 'company') {
        // Company users are onboard-complete at signup commit time —
        // signup_company collects company_name/brn/address and register_user
        // auto-seeds Management + Operations departments. For the rare
        // partial-data case, the settings screen shows a "complete setup"
        // banner; no separate wizard route.
        if (isBoardingComplete === false) changeIsBoardingCompletes(true);
        console.log('🏢 ENTRY: Company user → company dashboard.');
        router.replace('/company_dashboard/home');
      } else if (user.onboard_complete) {
        if (isBoardingComplete === false) changeIsBoardingCompletes(true);
        console.log('🏠 ENTRY: Onboarded private user → private dashboard.');
        router.replace('/private_dashboard/home');
      } else {
        // Real gate: private users with incomplete onboarding land on the
        // profile screen, NOT home. profile.tsx already has the multi-step
        // form; the layout bounce-back (see _layout.tsx) keeps them there.
        console.log('🏠 ENTRY: Non-onboarded private user → profile completion.');
        router.replace('/private_dashboard/profile');
      }
    } else {
      // User is not authenticated.
      if (isBoardingComplete) {
        console.log('🔑 ENTRY: Returning logged-out user → login.');
        router.replace('/login');
      } else {
        // First-ever app launch: show the welcome carousel before any
        // signup/login choice. The carousel's "Get Started" flips
        // isBoardingComplete to true so we never show it twice per device.
        console.log('👋 ENTRY: First launch → welcome carousel.');
        router.replace('/onboarding');
      }
    }
  }, [isLoading, user, isBoardingComplete, changeIsBoardingCompletes, isRouterReady, entryMode, kioskMode]);

  // Branded splash while we determine where to route the user — the Kiruko
  // logo with the Zilwa attribution pinned at the bottom (shared with the
  // font/DB-load states in _layout.tsx for one continuous launch screen).
  if (isLoading || isBoardingComplete === undefined || entryMode === undefined || kioskMode === undefined) {
    return <BrandSplash />;
  }

  // This component will be unmounted after redirection. Returning null is safe.
  return null;
}