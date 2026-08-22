import { Palette } from "@/app/constants/theme";
import { ActivityIndicator, Image, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Kiruko branded splash / loading screen.
 *
 * Shown across every startup loading state (font load, DB migrations, and the
 * routing decision in app/index.tsx) so the launch experience is one
 * continuous Kiruko screen instead of a blank gap or a bare spinner. The
 * background is white to match the native splash (app.json → kiruko-splash.png,
 * #ffffff) so the hand-off from native → JS is seamless.
 *
 * Uses the logo image + system font (not Orbitron) so it renders correctly even
 * before the brand fonts have finished loading.
 */
export default function BrandSplash() {
  // Pad for the status bar (top) and nav bar (bottom) so content — especially the
  // footer — isn't clipped on Android. Falls back to 0 if no SafeAreaProvider.
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.center}>
        <Image
          source={require("@/assets/images/kiruko-logo.png")}
          style={styles.logo}
          resizeMode="contain"
        />
        <ActivityIndicator size="small" color={Palette.blue} style={styles.spinner} />
      </View>

      <View style={[styles.footer, { paddingBottom: insets.bottom + 40 }]}>
        <View style={styles.spark} />
        <Text style={styles.poweredBy}>Powered by Zilwa Eklere Ltd</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.white,
    alignItems: "center",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  logo: {
    // kiruko-logo.png is 920×260 (≈3.54:1).
    width: 244,
    height: 69,
  },
  spinner: {
    marginTop: 30,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 40,
  },
  spark: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Palette.gold,
  },
  poweredBy: {
    color: Palette.gray400,
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
});
