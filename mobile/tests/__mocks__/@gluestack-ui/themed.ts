// Mock GlueStack UI primitives as plain RN views/text so the snapshot tests
// don't pull in the design-system provider tree. Style-prop semantics (e.g.
// `$gray800` color tokens) are stripped — the tests assert structure and
// text content, not visual fidelity.

import { Text as RNText, View } from "react-native";

export const Box = View;
export const HStack = View;
export const VStack = View;
export const Text = RNText;
export const Heading = RNText;
export const Pressable = View;
export const Button = View;
export const ButtonText = RNText;
export const Spinner = View;
