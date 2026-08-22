import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { I18nManager } from "react-native";
import LanguageContext from "@/app/context/LanguageContext";
import { getLocales } from "expo-localization";
import i18n from "@/app/utils/i18n";

const RTL_LANGUAGES = ["ar"];

const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	const [language, setLanguage] = useState<string>("en");

	// Load saved language or fallback to device locale
	useEffect(() => {
		const loadLanguage = async () => {
			const storedLang = await AsyncStorage.getItem("user-language");
			const detectedLang = storedLang ?? getLocales()[0].languageCode ?? "en";

			setLanguage(detectedLang);
			i18n.changeLanguage(detectedLang);

			// Adjust layout for RTL languages
			const isRTL = RTL_LANGUAGES.includes(detectedLang);
			if (isRTL !== I18nManager.isRTL) {
				I18nManager.forceRTL(isRTL);
			}
		};

		loadLanguage();
	}, []);

	// Change language and persist it
	const changeLanguage = async (lang: string) => {
		await AsyncStorage.setItem("user-language", lang);
		setLanguage(lang);
		i18n.changeLanguage(lang);

		// Adjust layout for RTL languages
		const isRTL = RTL_LANGUAGES.includes(lang);
		if (isRTL !== I18nManager.isRTL) {
			I18nManager.forceRTL(isRTL);
		}
	};

	return (
		<LanguageContext.Provider value={{ language, changeLanguage }}>
			{children}
		</LanguageContext.Provider>
	);
};

export default LanguageProvider;