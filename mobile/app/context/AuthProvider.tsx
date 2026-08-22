import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState, useRef } from 'react';
import { AppState } from 'react-native';
import { checkAuthToken } from '../../services/api';
import { api } from '../../services/apiClient';
import AuthContext, { type IUser } from './AuthContext';

import { useRouter } from 'expo-router';

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const router = useRouter();
    const [user, setUser] = useState<IUser | undefined>(undefined);
    const [isLoading, setIsLoading] = useState(true);
    const tokenCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);

    // Function to check if token is expired
    const isTokenExpired = (token: string): boolean => {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const currentTime = Date.now() / 1000;
            return payload.exp < currentTime;
        } catch (error) {
            console.error('Error checking token expiration:', error);
            return true; // If we can't decode, assume it's expired
        }
    };

    // Function to check token expiration and logout if expired
    const checkTokenExpiration = async (): Promise<void> => {
        try {
            const token = await AsyncStorage.getItem('authToken');
            if (token && isTokenExpired(token)) {
                console.log('⏰ AuthProvider: Token has expired — idle lock screen will handle re-auth on next interaction');
                // Do NOT force logout here — it bypasses the lock screen and creates jarring UX.
                // The idle lock screen already secures the session; the next API call will 401 if truly expired.
            }
        } catch (error) {
            console.error('Error checking token expiration:', error);
        }
    };

    // `silent` refreshes update the user WITHOUT toggling isLoading. isLoading
    // gates the route-group guard (useRequireAuth); flipping it unmounts the
    // active navigator and resets it to its first tab (home). Background /
    // foreground refreshes (e.g. returning from Android's location-permission
    // dialog) must NOT do that or the user gets bounced to home mid-task.
    const checkAuth = async (opts?: { silent?: boolean }): Promise<boolean> => {
        console.log('🔍 AuthProvider: Starting authentication check...');
        console.log('🔍 Current API headers:', JSON.stringify(api.defaults.headers, null, 2));
        if (!opts?.silent) setIsLoading(true);

        try {
            const token = await AsyncStorage.getItem('authToken');
            console.log('🔑 Token from storage:', token ? `${token.substring(0, 30)}...` : 'null');

            // 1. If no token, user is not authenticated.
            if (!token) {
                console.log('🤷 AuthProvider: No token found. User is not authenticated.');
                setUser(undefined);
                // Clear any existing authorization header
                delete api.defaults.headers.Authorization;
                console.log('🔐 AuthProvider: Authorization header cleared (no token)');
                return false; // No need to call logout, nothing to clear
            }

            // Client-side check for token expiration before hitting the server
            if (isTokenExpired(token)) {
                console.log('⏰ AuthProvider: Token found but expired client-side. Skipping server validation.');
                setUser(undefined);
                delete api.defaults.headers.Authorization;
                await logout(); // Clear storage just in case
                return false;
            }

            // Set the authorization header for API requests
            api.defaults.headers.Authorization = `Bearer ${token}`;
            console.log('🔐 AuthProvider: Authorization header set for token validation');
            console.log('🔐 Header value:', api.defaults.headers.Authorization ?
                `${api.defaults.headers.Authorization.toString().substring(0, 40)}...` : 'none');

            // 2. Validate token with the server. The server is the single source of truth.
            console.log('🔐 AuthProvider: Validating token with server...');
            const tokenValidation = await checkAuthToken();

            // 3. If token is valid, update user state with fresh data from server.
            if (tokenValidation.valid && tokenValidation.user) {
                const serverData = tokenValidation.user;
                console.log('✅ AuthProvider: Token is valid. Server returned user:', {
                    userId: serverData.user_id,
                    email: serverData.email,
                    onboardComplete: serverData.onboard_complete,
                });

                // Handle private_user_id based on user type
                const userType = serverData.user_type || 'private';
                // PRESERVE a real employee identity even for company users —
                // owners/admins are often also employees (dual identity, see
                // services/entryMode.ts). The backend includes private_user_id
                // only when a private_user record exists; without one it's
                // absent and this falls through to null, exactly as before.
                const privateUserId = serverData.private_user_id || serverData.private_user?.private_user_id || null;

                if (userType === 'private' && !privateUserId) {
                    console.warn('⚠️ AuthProvider: No private_user_id found for private user. User may need to complete onboarding.');
                } else if (userType === 'company' && privateUserId) {
                    console.log('ℹ️ AuthProvider: Company user with employee identity (dual) — private_user_id preserved.');
                }

                // Transform server data into the local IUser interface
                const freshUser: IUser = {
                    email: serverData.email || '',
                    user_id: serverData.user_id?.toString() || '',
                    token: token,
                    isAuthenticated: true,
                    onboard_complete: serverData.onboard_complete ?? false,
                    user_type: userType,
                    private_user_id: privateUserId?.toString() || '',
                    company: serverData.company || null,
                    company_onboarding_status: serverData.company_onboarding_status ?? undefined,
                    verification_note: serverData.verification_note || '',
                    user_name: serverData.user_name || serverData.email?.split('@')[0] || 'User',
                    private_user: serverData.private_user || undefined,
                    company_roles: serverData.company_roles ?? [],
                    is_company_admin: serverData.is_company_admin ?? false,
                    company_permissions: serverData.company_permissions ?? [],
                    company_rbac_enabled: serverData.company_rbac_enabled ?? false,
                };

                // Update local state and storage
                console.log('🔄 AuthProvider: Updating user state and storage with fresh data.');
                await AsyncStorage.setItem('user', JSON.stringify(freshUser));
                await AsyncStorage.setItem('userType', freshUser.user_type);
                setUser(freshUser);

                console.log('🎉 AuthProvider: Authentication successful.');
                return true;
            } else {
                // 4. If token is invalid, the user is not authenticated.
                console.log('❌ AuthProvider: Token validation failed:', tokenValidation.error);

                // CRITICAL: Only log out if the server explicitly says the token is unauthorized or forbidden.
                // If it's a network error (status is undefined) or other server error, we should NOT log out,
                // but instead fall through to the offline fallback logic.
                if (tokenValidation.status === 401 || tokenValidation.status === 403) {
                    console.log('🚫 AuthProvider: Token is unauthorized/forbidden. Logging out.');
                    delete api.defaults.headers.Authorization;
                    await logout();
                    return false;
                } else {
                    console.log('🌐 AuthProvider: Server error or network issue. Proceeding to offline fallback.');
                    throw new Error(tokenValidation.error || 'Server validation failed');
                }
            }
        } catch (error: any) {
            // 5. Handle network errors or other unexpected issues. This is the "offline" case.
            console.warn('⚠️ AuthProvider: Could not reach server for auth check. Attempting to use local data.', error.message);

            try {
                const storedUserJSON = await AsyncStorage.getItem('user');
                console.log('💾 AuthProvider: Checking stored user data for offline fallback');

                if (storedUserJSON) {
                    const storedUser = JSON.parse(storedUserJSON);
                    console.log('📄 AuthProvider: Stored user data found:', {
                        userId: storedUser.user_id,
                        userType: storedUser.user_type,
                        hasPrivateUserId: !!storedUser.private_user_id,
                        isAuthenticated: storedUser.isAuthenticated
                    });

                    // Check if the stored user is minimally valid based on user type
                    const isValidUser = storedUser && storedUser.user_id && (
                        storedUser.user_type === 'company' || // Company users don't need private_user_id
                        (storedUser.user_type === 'private' && storedUser.private_user_id) // Private users do
                    );

                    if (isValidUser) {
                        console.log('👍 AuthProvider: Using valid stored user data for offline mode.');
                        setUser(storedUser);
                        return true;
                    } else {
                        console.log('⚠️ AuthProvider: Stored user data is invalid for user type:', storedUser.user_type);
                    }
                } else {
                    console.log('📭 AuthProvider: No stored user data found');
                }
            } catch (storageError) {
                console.error('❌ AuthProvider: Failed to read or parse stored user data during offline fallback:', storageError);
            }

            // If we're here, either there was a network error and no valid local data, or something else went wrong.
            console.log('❌ AuthProvider: Offline fallback failed. User is not authenticated.');
            // Clear the authorization header
            delete api.defaults.headers.Authorization;
            await logout();
            return false;
        } finally {
            // 6. Ensure loading is off — unless this was a silent background
            // refresh, which never turned it on (see note above).
            if (!opts?.silent) setIsLoading(false);
            console.log('🏁 AuthProvider: Authentication check finished.');
        }
    };

    // Login function
    const login = async (userData: IUser, token: string, refreshToken?: string): Promise<void> => {
        try {
            // Resolve private_user_id from nested private_user when API returns raw backend shape
            if (!userData.private_user_id && (userData as any).private_user?.private_user_id) {
                userData = { ...userData, private_user_id: String((userData as any).private_user.private_user_id) };
            }

            console.log('🔑 AuthProvider: Logging in user:', {
                userId: userData.user_id,
                email: userData.email,
                userType: userData.user_type,
                privateUserId: userData.private_user_id
            });

            // Validate that we have required data based on user type
            if (userData.user_type === 'private' && !userData.private_user_id) {
                console.error('❌ AuthProvider: Cannot login private user without private_user_id');
                throw new Error('Private user data is incomplete - missing private_user_id');
            }

            // Store authentication data
            const storageItems: [string, string][] = [
                ['authToken', token],
                ['user', JSON.stringify(userData)],
                ['userType', userData.user_type]
            ];

            if (refreshToken) {
                storageItems.push(['refreshToken', refreshToken]);
            }

            await AsyncStorage.multiSet(storageItems);

            // Set the authorization header for future API requests
            api.defaults.headers.Authorization = `Bearer ${token}`;
            console.log('🔐 AuthProvider: Authorization header set for new login');

            // Ensure user is marked as authenticated
            const authenticatedUser = {
                ...userData,
                isAuthenticated: true,
                token: token
            };

            setUser(authenticatedUser);
            setIsLoading(false);

            console.log('✅ AuthProvider: Login successful');
        } catch (error) {
            console.error('❌ AuthProvider: Login failed:', error);
            throw error;
        }
    };

    // Logout function
    const logout = async (): Promise<boolean> => {
        try {
            console.log('🚪 AuthProvider: Logging out...');

            // Clear all cached/session data EXCEPT device-level preferences
            // that must survive logout. A blanket AsyncStorage.clear() here
            // previously wiped the 'onboard' flag too, which forced the
            // welcome carousel to replay on every launch after a logout.
            const keysToRemove = ['authToken', 'refreshToken', 'user', 'userType', 'userEmail', 'lastLoginTime'];
            const KEEP_KEYS = ['onboard', 'user-language', 'userCurrency', 'baseCurrency'];
            try {
                const allKeys = await AsyncStorage.getAllKeys();
                const keysToWipe = allKeys.filter((k) => !KEEP_KEYS.includes(k));
                if (keysToWipe.length) await AsyncStorage.multiRemove(keysToWipe);
                console.log('🧹 AuthProvider: Cleared session data, preserved device prefs:', KEEP_KEYS);
            } catch (clearError) {
                // Fallback: at least remove the known auth keys so the session ends.
                await AsyncStorage.multiRemove(keysToRemove);
                console.warn('⚠️ AuthProvider: getAllKeys failed; removed auth keys only');
            }

            // Clear the authorization header and reset API defaults
            delete api.defaults.headers.Authorization;
            if ('common' in api.defaults.headers) {
                delete (api.defaults.headers as any).common;
            }
            console.log('🔐 AuthProvider: All API headers cleared');

            // Reset user state completely
            setUser(undefined);
            setIsLoading(false);

            console.log('✅ AuthProvider: Logout and cache clearing successful');

            // Redirect to signup page
            router.replace('/');

            return true;
        } catch (error) {
            console.error('❌ AuthProvider: Logout failed:', error);

            // Force clear even if AsyncStorage fails
            delete api.defaults.headers.Authorization;
            if ('common' in api.defaults.headers) {
                delete (api.defaults.headers as any).common;
            }
            setUser(undefined);
            setIsLoading(false);

            router.replace('/');
            console.log('🔧 AuthProvider: Forced state reset completed');

            return false;
        }
    };

    // Change user function
    const changeUser = (newUser: IUser): void => {
        console.log('🔄 AuthProvider: Changing user data');
        setUser(newUser);
        // Update stored user data
        AsyncStorage.setItem('user', JSON.stringify(newUser));
    };

    // Initial authentication check with timeout
    useEffect(() => {
        console.log('🚀 AuthProvider: Initial load, checking authentication...');

        const timeoutId = setTimeout(() => {
            console.log('⏰ AuthProvider: Authentication timeout (10s), forcing loading to false');
            setIsLoading(false);
        }, 10000); // 10 second timeout

        checkAuth()
            .then((isAuthenticated) => {
                console.log('🔍 AuthProvider: Initial auth check completed:', { isAuthenticated });
            })
            .catch((error) => {
                console.error('❌ AuthProvider: Initial auth check failed:', error);
            })
            .finally(() => {
                clearTimeout(timeoutId);
                console.log('🏁 AuthProvider: Initial auth check finished, clearing timeout');
            });

        return () => {
            console.log('🧹 AuthProvider: Cleaning up timeout');
            clearTimeout(timeoutId);
        };
    }, []);

    // Debug log whenever auth state changes
    useEffect(() => {
        console.log('📊 Auth state changed:', {
            hasUser: !!user,
            isAuthenticated: user?.isAuthenticated || false,
            isLoading,
            userId: user?.user_id || null,
            userType: user?.user_type || null,
            privateUserId: user?.user_type === 'company' ? null : (user?.private_user_id || null)
        });
    }, [user, isLoading]);

    // Periodic token expiration check — paused when app is backgrounded
    useEffect(() => {
        const startInterval = () => {
            if (tokenCheckIntervalRef.current) clearInterval(tokenCheckIntervalRef.current);
            tokenCheckIntervalRef.current = setInterval(() => {
                if (user?.isAuthenticated) {
                    checkTokenExpiration();
                }
            }, 5 * 60 * 1000);
        };

        const stopInterval = () => {
            if (tokenCheckIntervalRef.current) {
                clearInterval(tokenCheckIntervalRef.current);
                tokenCheckIntervalRef.current = null;
            }
        };

        if (AppState.currentState === 'active') startInterval();

        const subscription = AppState.addEventListener('change', (nextState) => {
            if (nextState === 'active') startInterval();
            else if (nextState === 'background' || nextState === 'inactive') stopInterval();
        });

        return () => { stopInterval(); subscription.remove(); };
    }, [user?.isAuthenticated]);

    // Refresh full user data from server when app comes back to foreground.
    // This picks up verification status changes the employer may have made on the web.
    useEffect(() => {
        const subscription = AppState.addEventListener('change', (nextAppState) => {
            if (nextAppState === 'active' && user?.isAuthenticated) {
                console.log('📱 AuthProvider: App became active, silently refreshing user data from server');
                // Silent: must not flip isLoading, or the active navigator
                // unmounts and resets to the home tab (bounce-to-home bug).
                checkAuth({ silent: true });
            }
        });

        return () => {
            subscription?.remove();
        };
    }, [user?.isAuthenticated]);

    const value = {
        user,
        isLoading,
        login,
        logout,
        changeUser,
        checkAuth,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export default AuthProvider;