import { createContext } from "react";

interface LanguageContextType {
	language: string;
	changeLanguage: (lang: string) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextType | undefined>(
	undefined
);

export default LanguageContext;