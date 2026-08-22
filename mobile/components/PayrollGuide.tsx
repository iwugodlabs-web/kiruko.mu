/**
 * First-run payroll guide for the mobile employer side.
 *
 * Triggered on first visit to the payroll/salaries screens, dismissable,
 * re-openable via the empty-state "Show guide again" button. Persisted
 * under AsyncStorage key kontokaz.payrollGuide.dismissed.v1.
 *
 * Strings are sourced from i18n under the `payroll.guide.*` namespace so
 * EN/FR/MG renderings stay in sync with the web equivalent.
 *
 * Plain React Native primitives (Modal + View + StyleSheet) — the same
 * reasoning as AdsConsentModal: gluestack tokens don't resolve inside
 * RN's native Modal layer.
 */

import React, { useEffect, useState } from 'react';
import { Palette } from '@/app/constants/theme';
import {
    Modal,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';

export const PAYROLL_GUIDE_STORAGE_KEY = 'kontokaz.payrollGuide.dismissed.v1';

export async function hasSeenPayrollGuide(): Promise<boolean> {
    try {
        const v = await AsyncStorage.getItem(PAYROLL_GUIDE_STORAGE_KEY);
        return v === '1';
    } catch {
        return true; // fail closed — don't keep popping the guide if storage is broken
    }
}

async function markSeen(): Promise<void> {
    try {
        await AsyncStorage.setItem(PAYROLL_GUIDE_STORAGE_KEY, '1');
    } catch {
        // ignore
    }
}

interface Props {
    visible: boolean;
    onClose: () => void;
}

const STEP_COUNT = 4;

export default function PayrollGuide({ visible, onClose }: Props) {
    const { t } = useTranslation();
    const [step, setStep] = useState(0);
    const [tab, setTab] = useState<'steps' | 'glossary'>('steps');

    useEffect(() => {
        if (visible) {
            setStep(0);
            setTab('steps');
        }
    }, [visible]);

    const close = () => {
        void markSeen();
        onClose();
    };

    const stepKey = (n: number) => `payroll.guide.step${n + 1}`;
    const isLast = step === STEP_COUNT - 1;

    return (
        <Modal visible={visible} animationType="fade" transparent onRequestClose={close}>
            <Pressable style={styles.backdrop} onPress={close}>
                <Pressable style={styles.card} onPress={() => { /* swallow */ }}>
                    {/* Header */}
                    <View style={styles.header}>
                        <Text style={styles.title}>{t('payroll.guide.title')}</Text>
                        <Pressable onPress={close} hitSlop={10} accessibilityLabel="Close guide">
                            <Text style={styles.closeIcon}>×</Text>
                        </Pressable>
                    </View>

                    {/* Tabs */}
                    <View style={styles.tabRow}>
                        <Pressable
                            onPress={() => setTab('steps')}
                            style={[styles.tab, tab === 'steps' && styles.tabActive]}
                        >
                            <Text style={[styles.tabText, tab === 'steps' && styles.tabTextActive]}>
                                {t('payroll.guide.title')}
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={() => setTab('glossary')}
                            style={[styles.tab, tab === 'glossary' && styles.tabActive]}
                        >
                            <Text style={[styles.tabText, tab === 'glossary' && styles.tabTextActive]}>
                                {t('payroll.guide.glossaryTitle')}
                            </Text>
                        </Pressable>
                    </View>

                    {/* Body */}
                    {tab === 'steps' ? (
                        <View style={styles.body}>
                            <View style={styles.progressRow}>
                                {Array.from({ length: STEP_COUNT }).map((_, i) => (
                                    <View
                                        key={i}
                                        style={[
                                            styles.progressDot,
                                            i === step && styles.progressDotActive,
                                            i < step && styles.progressDotDone,
                                        ]}
                                    />
                                ))}
                            </View>
                            <Text style={styles.stepLabel}>Step {step + 1} of {STEP_COUNT}</Text>
                            <Text style={styles.stepTitle}>{t(`${stepKey(step)}Title`)}</Text>
                            <Text style={styles.stepBody}>{t(`${stepKey(step)}Body`)}</Text>
                        </View>
                    ) : (
                        <ScrollView style={styles.glossary} contentContainerStyle={styles.glossaryContent}>
                            {[
                                'payrollRun', 'payslip', 'component', 'structure', 'assignment',
                                'statutoryDeduction', 'paye', 'oneOffAllowance', 'stepUpToken',
                            ].map((key) => {
                                const full = t(`payroll.guide.glossary.${key}`);
                                const dashIdx = full.indexOf('—');
                                const term = dashIdx > 0 ? full.slice(0, dashIdx).trim() : key;
                                const def = dashIdx > 0 ? full.slice(dashIdx + 1).trim() : full;
                                return (
                                    <View key={key} style={styles.glossaryItem}>
                                        <Text style={styles.glossaryTerm}>{term}</Text>
                                        <Text style={styles.glossaryDef}>{def}</Text>
                                    </View>
                                );
                            })}
                        </ScrollView>
                    )}

                    {/* Footer */}
                    {tab === 'steps' && (
                        <View style={styles.footer}>
                            <Pressable onPress={close}>
                                <Text style={styles.skip}>{t('payroll.guide.skip')}</Text>
                            </Pressable>
                            <View style={styles.footerActions}>
                                {step > 0 && (
                                    <Pressable
                                        onPress={() => setStep((s) => s - 1)}
                                        style={[styles.btn, styles.btnSecondary]}
                                    >
                                        <Text style={styles.btnSecondaryText}>{t('payroll.guide.back')}</Text>
                                    </Pressable>
                                )}
                                {!isLast ? (
                                    <Pressable
                                        onPress={() => setStep((s) => s + 1)}
                                        style={[styles.btn, styles.btnPrimary]}
                                    >
                                        <Text style={styles.btnPrimaryText}>{t('payroll.guide.next')}</Text>
                                    </Pressable>
                                ) : (
                                    <Pressable onPress={close} style={[styles.btn, styles.btnSuccess]}>
                                        <Text style={styles.btnPrimaryText}>{t('payroll.guide.done')}</Text>
                                    </Pressable>
                                )}
                            </View>
                        </View>
                    )}
                </Pressable>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.4)',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
    },
    card: {
        width: '100%',
        maxWidth: 480,
        backgroundColor: 'white',
        borderRadius: 14,
        overflow: 'hidden',
        shadowColor: Palette.black,
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.18,
        shadowRadius: 16,
        elevation: 8,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 16,
        borderBottomWidth: 1,
        borderBottomColor: Palette.gray100,
    },
    title: { fontSize: 16, fontWeight: '700', color: Palette.ink },
    closeIcon: { fontSize: 22, color: Palette.gray500, lineHeight: 22 },
    tabRow: {
        flexDirection: 'row',
        paddingHorizontal: 16,
        paddingTop: 10,
        borderBottomWidth: 1,
        borderBottomColor: Palette.gray100,
    },
    tab: {
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: 6,
        marginRight: 4,
    },
    tabActive: { backgroundColor: Palette.blueTint },
    tabText: { fontSize: 12, color: Palette.gray500, fontWeight: '600' },
    tabTextActive: { color: Palette.blue },
    body: { padding: 22 },
    progressRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
    progressDot: { height: 6, width: 16, borderRadius: 3, backgroundColor: Palette.gray200 },
    progressDotActive: { backgroundColor: Palette.blue, width: 32 },
    progressDotDone: { backgroundColor: Palette.blue },
    stepLabel: { fontSize: 11, fontWeight: '700', color: Palette.blue, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 },
    stepTitle: { fontSize: 18, fontWeight: '700', color: Palette.ink, marginBottom: 8 },
    stepBody: { fontSize: 14, color: Palette.gray600, lineHeight: 20 },
    glossary: { maxHeight: 360 },
    glossaryContent: { padding: 20 },
    glossaryItem: { marginBottom: 12 },
    glossaryTerm: { fontSize: 13, fontWeight: '700', color: Palette.ink },
    glossaryDef: { fontSize: 12, color: Palette.gray600, marginTop: 2 },
    footer: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 20,
        paddingVertical: 12,
        borderTopWidth: 1,
        borderTopColor: Palette.gray100,
        backgroundColor: Palette.white,
    },
    footerActions: { flexDirection: 'row', gap: 8 },
    skip: { fontSize: 12, color: Palette.gray500, fontWeight: '600' },
    btn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 6 },
    btnSecondary: { borderWidth: 1, borderColor: Palette.gray200, backgroundColor: 'white' },
    btnPrimary: { backgroundColor: Palette.blue },
    btnSuccess: { backgroundColor: Palette.teal },
    btnSecondaryText: { color: Palette.gray700, fontSize: 12, fontWeight: '600' },
    btnPrimaryText: { color: 'white', fontSize: 12, fontWeight: '700' },
});
