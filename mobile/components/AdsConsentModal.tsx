/**
 * First-launch ads consent modal (M12 / Phase 2).
 *
 * Renders once per logged-in employee on the next home-screen mount after
 * Phase 2 ships. The user picks Accept or Decline; both branches hit
 * POST /sponsored/consent. Either way we set an AsyncStorage flag so the
 * modal never re-prompts.
 *
 * Why a modal + a settings toggle instead of just the settings toggle:
 *   - DPA Article 7 expects an explicit affirmative consent moment, not an
 *     implicit opt-in by inaction.
 *   - We need a per-policy-version checkpoint — if we update the privacy
 *     policy and reset the flag, the modal re-fires once.
 *
 * The modal is mounted in `private_dashboard/home.tsx` (the only
 * authenticated entry point where the home slot also lives, so the visual
 * context for "you might see sponsored cards here" is exactly where the
 * cards will appear).
 */

import React, { useEffect, useState } from 'react';
import { Palette } from '@/app/constants/theme';
import {
    Modal,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    useColorScheme,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { getAdsConsent, postAdsConsent } from '@/api/sponsored';

// Plain RN primitives — NOT gluestack — because React Native's Modal
// renders into a separate native layer that isn't a descendant of
// GluestackProvider. Design tokens like `$white` / `$emerald600` don't
// resolve inside it, leaving boxes with no background and text with no
// color. Explicit StyleSheet styles are unambiguous and look right in
// every theme.

// Storage shape — keep at top level so unit tests can pull it without
// reaching into the component.
export const ADS_CONSENT_STORAGE_KEY = 'kontokaz:ads_consent_prompt:v1';
// Bump the version suffix when the privacy policy changes so the modal
// re-prompts for re-consent against the new revision.
export const ADS_CONSENT_POLICY_VERSION = '2026-05-17';

interface StoredAnswer {
    answered: true;
    accepted: boolean;
    policy_version: string;
    at: string;            // ISO timestamp; debug only, not authoritative
}

export async function hasAnsweredAdsConsent(): Promise<boolean> {
    try {
        const raw = await AsyncStorage.getItem(ADS_CONSENT_STORAGE_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw) as StoredAnswer;
        // If the policy version on disk doesn't match the current one,
        // treat it as unanswered — gives us a re-consent loop when legal
        // bumps the policy.
        return parsed.policy_version === ADS_CONSENT_POLICY_VERSION;
    } catch {
        return false;
    }
}

async function persistAnswer(accepted: boolean): Promise<void> {
    const payload: StoredAnswer = {
        answered: true,
        accepted,
        policy_version: ADS_CONSENT_POLICY_VERSION,
        at: new Date().toISOString(),
    };
    try {
        await AsyncStorage.setItem(ADS_CONSENT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
        // Storage failure means we'll prompt again next launch — acceptable.
    }
}

interface Props {
    /** Force-show the modal regardless of prior answer (used by Settings to
     * re-collect consent after the user explicitly turned ads back on). */
    forceShow?: boolean;
    onResolved?: (accepted: boolean) => void;
}

export default function AdsConsentModal({ forceShow, onResolved }: Props) {
    const { t } = useTranslation();
    const colorScheme = useColorScheme();
    const dark = colorScheme === 'dark';
    const [visible, setVisible] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        let cancelled = false;
        if (forceShow) {
            setVisible(true);
            return;
        }
        (async () => {
            const answered = await hasAnsweredAdsConsent();
            if (cancelled || answered) return;
            // Gate the prompt on Company.ads_enabled — if the user's
            // employer has ads turned off, they will never see an ad
            // regardless of consent, so prompting is pure noise. Don't
            // persist anything: if the company flips ads_enabled=true
            // later, the modal fires on the next mount automatically.
            // Server unreachable → fall back to showing the modal (the
            // conservative default is "ask"; declining is one tap).
            const state = await getAdsConsent();
            if (cancelled) return;
            if (state && state.company_ads_enabled === false) return;
            // Don't re-prompt if the server already has a recorded
            // decision for this user. Logout calls AsyncStorage.clear(),
            // which wipes the local "answered" flag, but the server's
            // ads_consent_at / is_ad_free survive — those are the
            // source of truth. Without this check, a user who declined
            // before logout gets the consent modal again on next login.
            if (state && (state.ads_consent_at != null || state.is_ad_free === true)) return;
            setVisible(true);
        })();
        return () => {
            cancelled = true;
        };
    }, [forceShow]);

    async function answer(accepted: boolean) {
        if (busy) return;
        setBusy(true);
        try {
            await postAdsConsent(accepted, ADS_CONSENT_POLICY_VERSION);
            await persistAnswer(accepted);
            setVisible(false);
            onResolved?.(accepted);
        } catch {
            // Server failed — close the modal but DON'T persist. The user
            // gets prompted again next launch (better than silently flipping
            // the wrong way and never showing them this screen again).
            setVisible(false);
        } finally {
            setBusy(false);
        }
    }

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            // Tapping outside / hardware back is intentionally a no-op so the
            // user makes an explicit choice. They can still kill the app.
            onRequestClose={() => { /* no-op */ }}
        >
            <View style={styles.backdrop}>
                <View style={[styles.card, dark && styles.cardDark]}>
                    <Text style={[styles.title, dark && styles.titleDark]}>
                        {t('sponsored.consentTitle')}
                    </Text>
                    <Text style={[styles.body, dark && styles.bodyDark]}>
                        {t('sponsored.consentBody')}
                    </Text>
                    <View style={styles.buttonRow}>
                        <TouchableOpacity
                            onPress={() => answer(false)}
                            disabled={busy}
                            testID="ads-consent-decline"
                            style={[
                                styles.btn,
                                styles.btnOutline,
                                dark && styles.btnOutlineDark,
                                busy && styles.btnDisabled,
                            ]}
                            activeOpacity={0.7}
                        >
                            <Text style={[styles.btnOutlineText, dark && styles.btnOutlineTextDark]}>
                                {t('sponsored.consentDecline')}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => answer(true)}
                            disabled={busy}
                            testID="ads-consent-accept"
                            style={[styles.btn, styles.btnPrimary, busy && styles.btnDisabled]}
                            activeOpacity={0.7}
                        >
                            <Text style={styles.btnPrimaryText}>
                                {t('sponsored.consentAccept')}
                            </Text>
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.55)',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 20,
    },
    card: {
        backgroundColor: Palette.white,
        borderRadius: 20,
        padding: 22,
        width: '100%',
        maxWidth: 420,
        shadowColor: Palette.black,
        shadowOpacity: 0.25,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 10,
    },
    cardDark: {
        backgroundColor: Palette.ink,
    },
    title: {
        fontSize: 18,
        fontWeight: '700',
        color: Palette.ink,
        marginBottom: 10,
    },
    titleDark: {
        color: Palette.white,
    },
    body: {
        fontSize: 14,
        color: Palette.gray700,
        lineHeight: 20,
        marginBottom: 18,
    },
    bodyDark: {
        color: Palette.gray300,
    },
    buttonRow: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
    },
    btn: {
        paddingHorizontal: 16,
        paddingVertical: 11,
        borderRadius: 10,
        marginLeft: 8,
        minWidth: 100,
        alignItems: 'center',
    },
    btnOutline: {
        borderWidth: 1,
        borderColor: Palette.gray300,
        backgroundColor: 'transparent',
    },
    btnOutlineDark: {
        borderColor: Palette.gray700,
    },
    btnOutlineText: {
        color: Palette.gray700,
        fontSize: 14,
        fontWeight: '600',
    },
    btnOutlineTextDark: {
        color: Palette.gray300,
    },
    btnPrimary: {
        backgroundColor: Palette.success, // emerald-600
    },
    btnPrimaryText: {
        color: Palette.white,
        fontSize: 14,
        fontWeight: '600',
    },
    btnDisabled: {
        opacity: 0.55,
    },
});
