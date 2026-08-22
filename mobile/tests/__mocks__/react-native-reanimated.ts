// Lightweight reanimated mock for unit/snapshot tests.
// Replaces `Animated.View` with a plain View and `entering` with a no-op so
// the test renderer doesn't try to wire up the native animation runtime.
//
// react-native-reanimated ships a `mock` script at
// `react-native-reanimated/mock`, but loading it here keeps the seam visible
// and lets us extend if other reanimated APIs are needed by future tests.

import { View } from "react-native";

const Animated = {
    View,
    Text: View,
    ScrollView: View,
    createAnimatedComponent: (c: unknown) => c,
};

// Entering animations are descriptors used by Animated.View — return a tag
// the mocked Animated.View ignores.
const noopEntering = {
    duration: () => noopEntering,
    delay: () => noopEntering,
};

export default Animated;
export const FadeInUp = noopEntering;
export const FadeIn = noopEntering;
export const SlideInRight = noopEntering;
