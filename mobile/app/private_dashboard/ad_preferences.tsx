/**
 * Ad preferences screen (M12 / Phase 2).
 *
 * Linked from Settings → Preferences. Lets the employee:
 *   - See whether ads are currently on (`ads_consent_at IS NOT NULL` AND
 *     `is_ad_free=false`) or off (either flag flipped the other way).
 *   - Withdraw consent (DELETE /sponsored/consent) — DPA Article 7 requires
 *     this be at least as easy as accepting.
 *   - Re-grant consent (POST /sponsored/consent {accepted: true}) without
 *     having to wait for the next first-launch modal.
 *
 * Server is source of truth — we read consent state on focus (the user may
 * have toggled from another device).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Palette, Type } from '@/app/constants/theme';
import { ScrollView } from 'react-native';
import {
    Box,
    Heading,
    Text,
    VStack,
    HStack,
    Pressable,
    SafeAreaView,
    Spinner,
} from '@gluestack-ui/themed';
import { useFocusEffect, useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
    ConsentState,
    getAdsConsent,
    postAdsConsent,
    withdrawAdsConsent,
} from '@/api/sponsored';
import {
    ADS_CONSENT_STORAGE_KEY,
    ADS_CONSENT_POLICY_VERSION,
} from '@/components/AdsConsentModal';

export default function AdPreferencesScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [state, setState] = useState<ConsentState | null>(null);
    const [error, setError] = useState<string | null>(null);

    /**
     * Read current state from the server. The server returns:
     *   - ads_consent_at: ISO string or null
     *   - is_ad_free:     boolean (true blocks ads regardless of consent_at)
     *
     * We don't expose `is_ad_free=true via employer perk` separately — it's
     * not distinguishable from "user explicitly opted out" without an extra
     * field, and the user-facing UX is the same in both cases (ads off).
     */
    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            // Server is the source of truth (M13). Fall back to the local
            // AsyncStorage hint only if the network request fails — that
            // way a user offline at the airport still sees a sensible
            // initial position instead of a stuck spinner.
            const server = await getAdsConsent();
            if (server) {
                setState(server);
                return;
            }
            const raw = await AsyncStorage.getItem(ADS_CONSENT_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw) as { accepted: boolean };
                setState({
                    ok: true,
                    ads_consent_at: parsed.accepted ? new Date().toISOString() : null,
                    is_ad_free: !parsed.accepted,
                });
            } else {
                setState({ ok: true, ads_consent_at: null, is_ad_free: true });
            }
        } catch (e) {
            setError(String(e));
        } finally {
            setLoading(false);
        }
    }, []);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load]),
    );

    async function flip() {
        if (busy || !state) return;
        const adsOn = !state.is_ad_free && state.ads_consent_at !== null;
        const next = !adsOn;
        setBusy(true);
        try {
            const updated = next
                ? await postAdsConsent(true, ADS_CONSENT_POLICY_VERSION)
                : await withdrawAdsConsent();
            setState(updated);
            // Mirror the answer to local storage so the first-launch modal
            // stays in sync — flipping back ON via this screen counts as
            // having "answered" the prompt.
            await AsyncStorage.setItem(
                ADS_CONSENT_STORAGE_KEY,
                JSON.stringify({
                    answered: true,
                    accepted: next,
                    policy_version: ADS_CONSENT_POLICY_VERSION,
                    at: new Date().toISOString(),
                }),
            );
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    }

    const adsOn = state ? !state.is_ad_free && state.ads_consent_at !== null : false;

    return (
        <SafeAreaView flex={1} bg={Palette.white}>
            <HStack alignItems="center" px="$4" py="$3" space="sm">
                <Pressable
                    onPress={() => router.replace('/private_dashboard/settings')}
                    accessibilityLabel="Back"
                    p="$2"
                >
                    <MaterialIcons name="arrow-back" size={22} color={Palette.ink} />
                </Pressable>
                <Heading fontSize={Type.h2} fontWeight="800" color={Palette.ink} letterSpacing={-0.5}>
                    {t('sponsored.adPreferencesTitle')}
                </Heading>
            </HStack>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
                <Text fontSize={Type.body} color={Palette.gray600} mb="$5">
                    {t('sponsored.adPreferencesSubtitle')}
                </Text>

                {loading ? (
                    <Spinner mt="$5" color={Palette.gold} />
                ) : (
                    <VStack space="md">
                        <Pressable
                            onPress={flip}
                            disabled={busy}
                            bg={Palette.white}
                            borderRadius={18}
                            borderWidth={1}
                            borderColor={Palette.gray100}
                            p="$4"
                            opacity={busy ? 0.6 : 1}
                            shadowColor={Palette.black}
                            shadowOpacity={0.04}
                            shadowRadius={8}
                            shadowOffset={{ width: 0, height: 2 }}
                            elevation={2}
                        >
                            <HStack alignItems="center" justifyContent="space-between">
                                <VStack flex={1} pr="$3">
                                    <Text fontWeight="600" fontSize={Type.title} color={Palette.ink}>
                                        {t('sponsored.adPreferencesRow')}
                                    </Text>
                                    <Text fontSize={Type.body} color={adsOn ? Palette.success : Palette.gray500} mt="$1">
                                        {adsOn
                                            ? t('sponsored.adPreferencesEnabled')
                                            : t('sponsored.adPreferencesDisabled')}
                                    </Text>
                                </VStack>
                                {/* Custom toggle pill */}
                                <Box
                                    w={44}
                                    h={24}
                                    borderRadius={12}
                                    bg={adsOn ? Palette.success : Palette.gray300}
                                    justifyContent="center"
                                    px={2}
                                >
                                    <Box
                                        w={18}
                                        h={18}
                                        borderRadius={9}
                                        bg={Palette.white}
                                        alignSelf={adsOn ? 'flex-end' : 'flex-start'}
                                    />
                                </Box>
                            </HStack>
                        </Pressable>

                        <Text fontSize={Type.small} color={Palette.gray500} mt="$1">
                            {t('sponsored.adPreferencesWithdraw')}
                        </Text>

                        {error && (
                            <Text fontSize={Type.small} color={Palette.error} mt="$3">
                                {error}
                            </Text>
                        )}
                    </VStack>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}
