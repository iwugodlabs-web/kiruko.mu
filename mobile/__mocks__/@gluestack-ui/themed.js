// Auto-applied mock — collapses GlueStack primitives to plain RN host views
// so the SponsoredCard tests don't need the design-system provider tree.
const { View, Text } = require("react-native");

module.exports = {
    Box: View,
    HStack: View,
    VStack: View,
    Text,
    Heading: Text,
    Pressable: View,
    Button: View,
    ButtonText: Text,
    Spinner: View,
};
