// Auto-applied mock for jest. Resolved from <rootDir>/__mocks__/<module>.js
// when a test calls `jest.mock('react-native-reanimated')` (no factory).
const { View } = require("react-native");

const noopEntering = {
    duration: () => noopEntering,
    delay: () => noopEntering,
};

module.exports = {
    __esModule: true,
    default: {
        View,
        createAnimatedComponent: (c) => c,
    },
    FadeInUp: noopEntering,
    FadeIn: noopEntering,
    SlideInRight: noopEntering,
};
