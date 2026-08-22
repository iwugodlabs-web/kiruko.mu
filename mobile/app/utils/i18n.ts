import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { I18nManager } from "react-native";
import { getLocales } from "expo-localization";

// Import translation files
import translationAR from "@/app/locales/ar";
import translationEN from "@/app/locales/en";
import translationES from "@/app/locales/es";
import translationFR from "@/app/locales/fr";
import translationHI from "@/app/locales/hi";
import translationMG from "@/app/locales/mg";
import translationSW from "@/app/locales/sw";

const resources = {
	en: { translation: translationEN },
	es: { translation: translationES },
	fr: { translation: translationFR },
	ar: { translation: translationAR },
	mg: { translation: translationMG },
	hi: { translation: translationHI },
	sw: { translation: translationSW },
};

// getLocales() can be empty (e.g. on web, or before the native locale module
// is ready), so guard the [0] access — otherwise startup throws
// "Cannot read properties of undefined (reading 'languageCode')".
const primaryLocale = getLocales()?.[0];

// Initialize i18next
i18n.use(initReactI18next).init({
	resources,
	lng: primaryLocale?.languageCode ?? "en", // Default to device locale
	fallbackLng: "en",
	interpolation: { escapeValue: false },
});

// Update RTL layout if needed
const isRTL = primaryLocale?.textDirection === "rtl";
I18nManager.forceRTL(isRTL);

export default i18n;
