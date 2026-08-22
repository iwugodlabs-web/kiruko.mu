// Auto-applied mock — render icons as plain text so the test renderer
// doesn't try to load the font.
const React = require("react");
const { Text } = require("react-native");

const Icon = ({ name }) => React.createElement(Text, null, `icon:${name}`);

module.exports = {
    MaterialIcons: Icon,
    Ionicons: Icon,
    FontAwesome: Icon,
    Feather: Icon,
};
