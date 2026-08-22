/**
 * Notification preferences — per-category in-app / push toggles.
 *
 * Linked from Settings → Preferences (both the private and company dashboards
 * render this same screen). Server is the source of truth; we read on focus.
 * A category with no stored row defaults to both channels ON (opt-out).
 */

import React, { useCallback, useState } from 'react';
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
import { useFocusEffect, useRouter, usePathname } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { Palette, Type } from '@/app/constants/theme';
import { useTranslation } from 'react-i18next';
import {
    getNotificationPreferences,
    updateNotificationPreferences,
    NotificationPreference,
} from '@/services/api';

// Mirrors the backend categories (_category_for_type).
const CATEGORY_KEYS = ['leave', 'overtime', 'attendance', 'compliance', 'disputes', 'general'] as const;

type PrefMap = Record<string, { in_app: boolean; push: boolean }>;

function TogglePill({ on }: { on: boolean }) {
    return (
        <Box w={44} h={24} borderRadius={12} bg={on ? Palette.success : Palette.gray300} justifyContent="center" px={2}>
            <Box w={18} h={18} borderRadius={9} bg={Palette.white} alignSelf={on ? 'flex-end' : 'flex-start'} />
        </Box>
    );
}

export default function NotificationPreferencesScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const pathname = usePathname();
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [prefs, setPrefs] = useState<PrefMap>({});
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        const res = await getNotificationPreferences();
        if ('error' in res) {
            setError(res.error);
        } else {
            const map: PrefMap = {};
            for (const p of res.preferences) map[p.category] = { in_app: p.in_app, push: p.push };
            setPrefs(map);
        }
        setLoading(false);
    }, []);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load]),
    );

    async function toggle(category: string, channel: 'in_app' | 'push') {
        if (saving) return;
        const cur = prefs[category] ?? { in_app: true, push: true };
        const next: PrefMap = { ...prefs, [category]: { ...cur, [channel]: !cur[channel] } };
        setPrefs(next); // optimistic
        setSaving(true);
        const payload: NotificationPreference[] = CATEGORY_KEYS.map((key) => ({
            category: key,
            in_app: next[key]?.in_app ?? true,
            push: next[key]?.push ?? true,
        }));
        const res = await updateNotificationPreferences(payload);
        if (res && (res as any).error) {
            setError((res as any).error);
            load(); // revert to server truth
        }
        setSaving(false);
    }

    return (
        <SafeAreaView flex={1} bg={Palette.white}>
            <HStack alignItems="center" px="$4" py="$3" space="sm">
                <Pressable
                    onPress={() => router.replace(pathname.startsWith('/company_dashboard') ? '/company_dashboard/settings' : '/private_dashboard/settings')}
                    accessibilityLabel="Back"
                    p="$2"
                >
                    <MaterialIcons name="arrow-back" size={22} color={Palette.ink} />
                </Pressable>
                <Heading fontSize={Type.h2} fontWeight="800" color={Palette.ink} letterSpacing={-0.5}>
                    {t('notificationPrefs.title')}
                </Heading>
            </HStack>

            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}>
                <Text fontSize={Type.body} color={Palette.gray600} mb="$4">
                    {t('notificationPrefs.subtitle')}
                </Text>

                {loading ? (
                    <Spinner mt="$5" color={Palette.gold} />
                ) : (
                    <VStack space="sm">
                        <HStack alignItems="center" px="$2" pb="$1">
                            <Text flex={1} fontSize={Type.small} color={Palette.gray500}>{t('notificationPrefs.category')}</Text>
                            <Box w={56} alignItems="center"><Text fontSize={Type.small} color={Palette.gray500}>{t('notificationPrefs.inApp')}</Text></Box>
                            <Box w={56} alignItems="center"><Text fontSize={Type.small} color={Palette.gray500}>{t('notificationPrefs.push')}</Text></Box>
                        </HStack>

                        {CATEGORY_KEYS.map((key) => {
                            const p = prefs[key] ?? { in_app: true, push: true };
                            return (
                                <HStack
                                    key={key}
                                    alignItems="center"
                                    bg={Palette.white}
                                    borderRadius={16}
                                    borderWidth={1}
                                    borderColor={Palette.gray100}
                                    p="$3"
                                >
                                    <Text flex={1} fontWeight="600" fontSize={Type.title} color={Palette.ink}>{t(`notificationPrefs.${key}`)}</Text>
                                    <Box w={56} alignItems="center">
                                        <Pressable onPress={() => toggle(key, 'in_app')} disabled={saving}>
                                            <TogglePill on={p.in_app} />
                                        </Pressable>
                                    </Box>
                                    <Box w={56} alignItems="center">
                                        <Pressable onPress={() => toggle(key, 'push')} disabled={saving}>
                                            <TogglePill on={p.push} />
                                        </Pressable>
                                    </Box>
                                </HStack>
                            );
                        })}

                        {error && (
                            <Text fontSize={Type.small} color={Palette.error} mt="$3">{error}</Text>
                        )}
                    </VStack>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}
