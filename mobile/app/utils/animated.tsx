/**
 * Drop-in replacement for `react-native-reanimated`'s default export.
 *
 * WHY THIS EXISTS
 * ---------------
 * On the current native build (react-native-reanimated 3.16 + the New
 * Architecture, iOS 26 / Xcode 26) the *layout-animation* subsystem — the
 * `entering` / `exiting` / `layout` props — fails to run. The target mounts at
 * its initial keyframe (opacity 0 / translated off-screen) and never animates
 * in, so any screen that wraps its body in `<Animated.View entering=...>`
 * renders BLANK in production (Home, Settings, Calculator, and ~every other
 * dashboard screen).
 *
 * This shim re-exports everything from reanimated unchanged EXCEPT the animated
 * host components, which are wrapped to strip those three props. With them gone
 * the components render immediately visible. Every other reanimated feature
 * (useAnimatedStyle / useSharedValue / withTiming / …) is left untouched, so
 * value-driven animations keep working.
 *
 * HOW TO REVERT
 * -------------
 * Once layout animations work again upstream, either delete this file and point
 * the imports back at 'react-native-reanimated', or simply make
 * `stripLayoutProps` a no-op — that single change restores full behaviour.
 */
import React from 'react';
import Reanimated from 'react-native-reanimated';

// Re-export every named member (FadeInUp, Layout, SlideInRight, useAnimatedStyle,
// withTiming, the SharedValue type, …) so that
// `import Animated, { FadeIn } from '@/app/utils/animated'` resolves exactly as
// it did against the real package.
export * from 'react-native-reanimated';

const LAYOUT_ANIMATION_PROPS = ['entering', 'exiting', 'layout'] as const;

function stripLayoutProps(props: any) {
  if (!props) return props;
  let cloned: any = null;
  for (const key of LAYOUT_ANIMATION_PROPS) {
    if (key in props) {
      if (!cloned) cloned = { ...props };
      delete cloned[key];
    }
  }
  return cloned ?? props;
}

function safe(Component: any) {
  const Wrapped = React.forwardRef((props: any, ref: any) =>
    React.createElement(Component, { ...stripLayoutProps(props), ref }),
  );
  Wrapped.displayName = `Safe(${Component?.displayName ?? Component?.name ?? 'Animated'})`;
  return Wrapped;
}

const SafeAnimated: any = {
  ...Reanimated,
  View: safe(Reanimated.View),
  Text: safe(Reanimated.Text),
  ScrollView: safe(Reanimated.ScrollView),
  Image: safe(Reanimated.Image),
  FlatList: safe(Reanimated.FlatList),
  // Keep createAnimatedComponent working, and strip layout props from any
  // custom animated component created through it too.
  createAnimatedComponent: (component: any) =>
    safe(Reanimated.createAnimatedComponent(component)),
};

export default SafeAnimated;
