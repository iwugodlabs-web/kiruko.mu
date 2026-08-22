import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useState } from "react";
import OnBoardContext from "./OnBoardContext";

const ONBOARD_STORAGE_KEY = "onboard";
const USER_ROLE_STORAGE_KEY = "userType";

const OnBoardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
	const [isBoardingComplete, setIsBoardingComplete] = useState<boolean | undefined>(undefined);
	const [cacheUserRole, setCacheUserRole] = useState<string>('');

	useEffect(() => {
		const loadStateFromStorage = async () => {
			try {
				const [[, onboardValue], [, userRoleValue]] = await AsyncStorage.multiGet([
					ONBOARD_STORAGE_KEY,
					USER_ROLE_STORAGE_KEY,
				]);

				const hasCompleted = onboardValue === "true";
				setIsBoardingComplete(hasCompleted);
				console.log("OnBoardProvider: Loaded onboarding status from storage:", hasCompleted);

				if (userRoleValue) {
					setCacheUserRole(userRoleValue);
					console.log("OnBoardProvider: Loaded user role from storage:", userRoleValue);
				} else {
					setCacheUserRole(''); // Explicitly clear if not found
				}
			} catch (err) {
				console.error("OnBoardProvider: Error loading state from storage:", err);
				// Fallback to a safe default state
				setIsBoardingComplete(false);
				setCacheUserRole('');
			}
		};

		loadStateFromStorage();
	}, []);

	const changeIsBoardingCompletes = useCallback(async (onboarding: boolean) => {
		try {
			await AsyncStorage.setItem(ONBOARD_STORAGE_KEY, String(onboarding));
			setIsBoardingComplete(onboarding);
			console.log("OnBoardProvider: Onboarding status saved:", onboarding);
		} catch (err) {
			console.error("OnBoardProvider: Error saving onboard status:", err);
		}
	}, []);

	const setUserAccountRole = useCallback(async (userRole: string) => {
		try {
			await AsyncStorage.setItem(USER_ROLE_STORAGE_KEY, userRole);
			setCacheUserRole(userRole);
			console.log("OnBoardProvider: User role saved:", userRole);
		} catch (err) {
			console.error("OnBoardProvider: Error saving user role:", err);
		}
	}, []);

	return (
		<OnBoardContext.Provider value={{
			isBoardingComplete,
			changeIsBoardingCompletes,
			setUserAccountRole,
			cacheUserRole
		 }}>
			{children}
		</OnBoardContext.Provider>
	);
};

export default OnBoardProvider;
