import gluestackPlugin from "@gluestack-ui/nativewind-utils/tailwind-plugin";

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "media",
  content: ["app/**/*.{tsx,jsx,ts,js}", "components/**/*.{tsx,jsx,ts,js}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Kiruko brand palette (matches the logo)
        gold: {
          50: "#FBF3E0", 100: "#F6E6BD", 200: "#EFD185", 300: "#E9BD52",
          400: "#E4AD3F", 500: "#E0A93B", 600: "#C08A27", 700: "#98691A",
          800: "#6F4D13", 900: "#49330C",
        },
        brandgreen: {
          50: "#ECFDE7", 100: "#D2FAC6", 200: "#A8F593", 300: "#79EC5A",
          400: "#4FDC2E", 500: "#33CC11", 600: "#28A30D", 700: "#1F7D0B",
          800: "#1A5E0C", 900: "#16400A",
        },
        "brand-indigo": "#1E2A52",
        "brand-teal": "#0E7C6B",
        "brand-ink": "#16203B",
      },
    },
  },
  plugins: [gluestackPlugin],
};
