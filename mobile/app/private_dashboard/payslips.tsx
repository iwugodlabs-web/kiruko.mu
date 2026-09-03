import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Palette, Type } from '@/app/constants/theme';
import {
  Box,
  HStack,
  VStack,
  Text,
  Pressable,
  ScrollView,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  Spinner,
  Divider,
} from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system/legacy';
import Animated, { FadeIn, FadeInUp } from '@/app/utils/animated';
import { useRouter } from 'expo-router';
import { Alert, RefreshControl, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { PremiumHeader } from '@/components/PremiumHeader';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import useAuth from '../hooks/useAuth';
import { activeLocale } from '@/app/utils/intl';
import { format, parseISO, isValid } from 'date-fns';
import { payroll } from '@/services/payroll-api';
import type { LeaveBalanceResponse } from '@/services/payroll-api';
import type { Payslip, PayslipComponent } from '../../../shared/types/payroll';


// ─── Helpers ──────────────────────────────────────────────────────────────────


function isErr<T>(v: T | { error: string; status?: number }): v is { error: string; status?: number } {
  return typeof v === 'object' && v !== null && 'error' in v;
}


function formatMoney(amount: string | number, currency = 'MUR'): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (Number.isNaN(n)) return String(amount);
  try {
    return new Intl.NumberFormat(activeLocale(), {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}


// Signed money for correction rows: an adjustment's amounts are deltas, so we
// show an explicit +/− and a colour cue (green up / red down).
function formatSignedMoney(amount: string | number, currency = 'MUR'): { text: string; positive: boolean } {
  const raw = typeof amount === 'string' ? Number(amount) : amount;
  const n = Number.isNaN(raw) ? 0 : raw;
  const positive = n >= 0;
  return { text: `${positive ? '+' : '−'}${formatMoney(Math.abs(n), currency)}`, positive };
}


function periodLabel(p: { period_start?: string | null; period_end?: string | null } | undefined | null, fallback?: string): string {
  if (!p?.period_start) return fallback ?? '—';
  const d = parseISO(p.period_start);
  if (!isValid(d)) return fallback ?? p.period_start;
  return format(d, 'MMMM yyyy');
}


function periodRangeLabel(p: { period_start?: string | null; period_end?: string | null } | undefined | null): string | null {
  if (!p?.period_start || !p?.period_end) return null;
  const s = parseISO(p.period_start);
  const e = parseISO(p.period_end);
  if (!isValid(s) || !isValid(e)) return null;
  return `${format(s, 'd MMM yyyy')} → ${format(e, 'd MMM yyyy')}`;
}


function categoryColor(category: string, kind: 'earning' | 'deduction'): string {
  if (kind === 'deduction') return Palette.error;
  if (category.startsWith('earning.basic')) return Palette.ink;
  if (category.startsWith('earning.bonus')) return Palette.violet;
  if (category.startsWith('allowance')) return Palette.teal;
  return Palette.gray800;
}


// "How this was computed" line for the base-pay component, from the engine's
// proration meta (hours × rate, days × rate, or the part-month factor).
function prorationWhy(meta: any, currency: string): string | null {
  if (!meta?.pay_basis) return null;
  const num = (v: any) => { const x = Number(v); return Number.isFinite(x) ? x : null; };
  const trim = (x: number) => x.toFixed(2).replace(/\.?0+$/, '');
  if (meta.pay_basis === 'hourly') {
    const h = num(meta.hours), r = num(meta.rate);
    return h != null && r != null ? `${trim(h)} hrs × ${formatMoney(r, currency)}` : null;
  }
  if (meta.pay_basis === 'daily') {
    const d = num(meta.days), r = num(meta.rate);
    return d != null && r != null ? `${d} ${d === 1 ? 'day' : 'days'} × ${formatMoney(r, currency)}` : null;
  }
  if (meta.pay_basis === 'monthly') {
    const f = num(meta.proration_factor), full = num(meta.full_amount);
    if (f == null) return null;
    const pct = Math.round(f * 100);
    return full != null
      ? `${formatMoney(full, currency)} × ${pct}% (part-month)`
      : `× ${pct}% (part-month)`;
  }
  return null;
}


// ─── Component ────────────────────────────────────────────────────────────────


export default function PayslipsScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  // Mobile auth shape — same access pattern as documents.tsx
  const privateUserId: number | undefined =
    (user as any)?.private_user?.private_user_id ?? (user as any)?.private_user_id;

  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [leaveBalance, setLeaveBalance] = useState<LeaveBalanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Payslip | null>(null);

  const load = useCallback(async () => {
    if (!privateUserId) return;
    const [r, lb] = await Promise.all([
      payroll.listEmployeePayslips(privateUserId, { limit: 60 }),
      payroll.getLeaveBalance(),
    ]);
    if (isErr(r)) {
      Alert.alert(t('payslip.couldNotLoad'), r.error);
      setPayslips([]);
    } else {
      // Server returns most recent first; keep that order. Fall back to id desc.
      const sorted = [...r].sort((a, b) => b.id - a.id);
      setPayslips(sorted);
    }
    // Leave balance is best-effort — never block the payslip list on it.
    setLeaveBalance(isErr(lb) ? null : lb);
    setLoading(false);
    setRefreshing(false);
  }, [privateUserId]);

  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    load();
  }, [load]);

  const openDetail = useCallback((slip: Payslip) => {
    // No follow-up fetch needed — the enriched PayslipRead already
    // includes period_start / period_end / employer info inline.
    // Calling /payroll/runs/{id} would 403 for employees anyway
    // (admin-only, returns all employees' payslips in the run).
    setSelected(slip);
  }, []);

  const handleOpenPdf = async (slip: Payslip) => {
    if (!slip.pdf_url) return;
    try {
      // Download via the authenticated API stream endpoint into the app
      // cache, then hand the local file URI to expo-sharing. Direct
      // Sharing.shareAsync(slip.pdf_url) doesn't work because pdf_url is
      // a server-relative path the device can't fetch on its own and,
      // for S3, requires the auth header.
      const url = payroll.payslipPdfUrl(slip.id);
      const token = await AsyncStorage.getItem('authToken');
      const localUri = `${FileSystem.cacheDirectory}payslip_${slip.id}.pdf`;
      const result = await FileSystem.downloadAsync(url, localUri, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (result.status !== 200) {
        Alert.alert(t('common.errorTitle'), t('payslip.couldNotOpenPdf'));
        return;
      }
      const ok = await Sharing.isAvailableAsync();
      if (!ok) {
        Alert.alert(t('common.errorTitle'), t('payslip.sharingNotAvailable'));
        return;
      }
      await Sharing.shareAsync(result.uri, {
        mimeType: 'application/pdf',
        dialogTitle: t('payslip.title'),
        UTI: 'com.adobe.pdf',
      });
    } catch (err) {
      console.warn('payslip: download/share failed', err);
      Alert.alert(t('common.errorTitle'), t('payslip.couldNotOpenPdf'));
    }
  };

  // Raise a query about this payslip — routes into the concern/dispute flow
  // with the payslip context pre-filled, so the query lands with the period,
  // run id and figures already attached.
  const handleRaiseQuery = (slip: Payslip) => {
    const period = periodLabel(periodOf(slip));
    const title = t('payslip.queryTitle', { period });
    const description = t('payslip.queryDescription', {
      period,
      run: slip.payroll_run_id,
      net: formatMoney(slip.net_pay, slip.currency),
      gross: formatMoney(slip.gross, slip.currency),
    });
    setSelected(null);
    router.push({
      pathname: '/private_dashboard/your_right',
      params: {
        prefillTitle: title,
        prefillCategory: 'payroll',
        prefillDescription: description,
        // Structural link so the concern is tied to this run/payslip.
        prefillRunId: String(slip.payroll_run_id ?? ''),
        prefillPayslipId: String(slip.id ?? ''),
      },
    });
  };

  // M4: estimated payslip — current month, watermarked, never persisted.
  // 409 means the official payslip for this month is now ready; we route
  // there instead. 503 means the holdback flag is off in this env.
  const handleDownloadEstimate = async () => {
    try {
      const url = payroll.estimatedPayslipPdfUrl();
      const token = await AsyncStorage.getItem('authToken');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const localUri = `${FileSystem.cacheDirectory}estimated_payslip_${ts}.pdf`;
      const result = await FileSystem.downloadAsync(url, localUri, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (result.status === 409) {
        // 409 has three flavors: NO_CLOCKINS_FOR_PERIOD and
        // NO_PAY_BASIS_CONFIGURED (both block the download with their own
        // message) and OFFICIAL_PAYSLIP_EXISTS (route to the real payslip).
        // Discriminate by the error code the server wrote to disk.
        let code: string | undefined;
        try {
          const body = await FileSystem.readAsStringAsync(result.uri);
          code = JSON.parse(body)?.detail?.code;
        } catch {
          // body not JSON — fall through to generic alert.
        }
        if (code === 'NO_CLOCKINS_FOR_PERIOD') {
          Alert.alert(t('payslip.title'), t('payslip.noClockinsForEstimate'));
          return;
        }
        if (code === 'NO_PAY_BASIS_CONFIGURED') {
          Alert.alert(t('payslip.title'), t('payslip.noPayBasis'));
          return;
        }
        Alert.alert(
          t('payslip.title'),
          t('payslip.officialExists'),
        );
        load();
        return;
      }
      if (result.status === 503) {
        Alert.alert(
          t('payslip.title'),
          t('payslip.estimatedNotAvailable'),
        );
        return;
      }
      if (result.status !== 200) {
        Alert.alert(t('common.errorTitle'), t('payslip.couldNotOpenPdf'));
        return;
      }
      const ok = await Sharing.isAvailableAsync();
      if (!ok) {
        Alert.alert(t('common.errorTitle'), t('payslip.sharingNotAvailable'));
        return;
      }
      await Sharing.shareAsync(result.uri, {
        mimeType: 'application/pdf',
        dialogTitle: t('payslip.estimateDialogTitle'),
        UTI: 'com.adobe.pdf',
      });
    } catch (err) {
      console.warn('estimated payslip: download/share failed', err);
      Alert.alert(t('common.errorTitle'), t('payslip.couldNotOpenPdf'));
    }
  };

  // Period info comes inline on the enriched PayslipRead.
  const periodOf = (s: Payslip) =>
    s.period_start && s.period_end
      ? { period_start: s.period_start, period_end: s.period_end }
      : undefined;

  const grouped = useMemo(() => {
    const groups: Record<string, Payslip[]> = {};
    for (const slip of payslips) {
      const period = periodOf(slip);
      const year = period?.period_start ? period.period_start.slice(0, 4) : 'Pending';
      if (!groups[year]) groups[year] = [];
      groups[year].push(slip);
    }
    return Object.entries(groups).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [payslips]);

  const totalNetYTD = useMemo(() => {
    const thisYear = new Date().getFullYear().toString();
    const list = payslips.filter((s) => s.period_start?.startsWith(thisYear));
    return list.reduce((acc, s) => acc + Number(s.net_pay || 0), 0);
  }, [payslips]);

  const periodForSelected = selected ? periodOf(selected) : undefined;

  // Period-over-period: the most recent payslip whose period starts before the
  // selected one — used to show "+/− Rs X vs <last month>" on the detail.
  const prevSlip = useMemo(() => {
    // No period-over-period for a correction row — its net_pay is a delta, not
    // a monthly figure, so "vs last month" is meaningless. Also never compare
    // against an adjustment row (it would skew the delta).
    if (!selected?.period_start || selected.is_adjustment) return null;
    const earlier = payslips
      .filter((s) => !s.is_adjustment && s.period_start && s.period_start < selected.period_start!)
      .sort((a, b) => (a.period_start! < b.period_start! ? 1 : -1));
    return earlier[0] ?? null;
  }, [selected, payslips]);

  // Hide the estimated-payslip card once an official payslip exists for the
  // current calendar month — otherwise users see two entries for the same
  // period (the estimate above and the finalized slip in the list) showing
  // identical net pay, which reads as a duplicate.
  const currentMonthPrefix = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  })();
  const hasOfficialThisMonth = payslips.some((s) =>
    s.period_start?.startsWith(currentMonthPrefix)
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <PremiumHeader
        title={t('payslip.title')}
        onBack={() => router.replace('/private_dashboard/settings')}
      />

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Palette.blue} />
        }
      >
        {/* M4: estimated payslip (current month, watermarked, not official).
            Hidden once the official payslip for this month is finalized —
            otherwise users see two entries with identical net pay (estimate
            above + finalized slip in the list) and read it as a duplicate. */}
        {!hasOfficialThisMonth && (
          <Animated.View entering={FadeIn.duration(400)}>
            <Box mx="$4" mb="$3" style={styles.estimateCard}>
              <HStack space="sm" alignItems="flex-start" mb="$2">
                <Box style={styles.iconChipGold}>
                  <MaterialIcons name="info-outline" size={16} color={Palette.white} />
                </Box>
                <VStack flex={1}>
                  <Text style={styles.estimateTitle}>{t('payslip.estimateTitle')}</Text>
                  <Text style={styles.estimateSubtitle}>{t('payslip.estimateSubtitle')}</Text>
                </VStack>
              </HStack>
              <Pressable onPress={handleDownloadEstimate}>
                <LinearGradient
                  colors={[Palette.gold, Palette.gold]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.estimateButton}
                >
                  <HStack space="sm" alignItems="center">
                    <MaterialIcons name="download" size={18} color={Palette.white} />
                    <Text style={{ color: Palette.white, fontWeight: '700', fontSize: Type.body }}>
                      {t('payslip.downloadEstimated')}
                    </Text>
                  </HStack>
                </LinearGradient>
              </Pressable>
            </Box>
          </Animated.View>
        )}

        {/* YTD net pay summary */}
        {payslips.length > 0 && (
          <Animated.View entering={FadeIn.duration(400)}>
            <Box mx="$4" mb="$3">
              <LinearGradient
                colors={[Palette.gray800, Palette.ink]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.summaryCard}
              >
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: Type.caption, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                  {t('payslip.yearToDate', { year: new Date().getFullYear() })}
                </Text>
                <Text style={{ color: Palette.white, fontSize: Type.display, fontWeight: '800', marginTop: 4 }}>
                  {formatMoney(totalNetYTD, payslips[0]?.currency ?? 'MUR')}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: Type.small, marginTop: 4 }}>
                  {(() => {
                    const count = payslips.filter((s) => s.period_start?.startsWith(new Date().getFullYear().toString())).length;
                    return t('payslip.acrossCount', { count, plural: count === 1 ? '' : 's' });
                  })()}
                </Text>
              </LinearGradient>
            </Box>
          </Animated.View>
        )}

        {/* Leave balance — remaining days per paid leave type (current year) */}
        {leaveBalance && leaveBalance.balances.length > 0 && (
          <Animated.View entering={FadeIn.duration(400)}>
            <Box mx="$4" mb="$3" style={styles.leaveCard}>
              <HStack alignItems="center" space="sm" mb="$2">
                <Box style={styles.iconChipTeal}>
                  <MaterialIcons name="event-available" size={16} color={Palette.white} />
                </Box>
                <Text style={styles.leaveCardTitle}>{t('payslip.leaveBalanceTitle', { year: leaveBalance.year })}</Text>
              </HStack>
              {leaveBalance.balances.map((b) => (
                <HStack key={b.code} justifyContent="space-between" alignItems="center" py="$1">
                  <VStack>
                    <Text style={{ fontSize: Type.label, fontWeight: '600', color: Palette.ink }}>{b.label}</Text>
                    <Text style={{ fontSize: Type.tiny, color: Palette.gray400, marginTop: 1 }}>
                      {t('payslip.leaveTakenOfEntitlement', { taken: b.taken, total: b.entitlement })}
                    </Text>
                  </VStack>
                  <Text style={{ fontSize: Type.body, fontWeight: '800', color: b.remaining > 0 ? Palette.teal : Palette.gray500, fontVariant: ['tabular-nums'] }}>
                    {t('payslip.leaveDaysLeft', { days: Math.max(0, b.remaining) })}
                  </Text>
                </HStack>
              ))}
            </Box>
          </Animated.View>
        )}

        {loading ? (
          <Box mt="$10" alignItems="center">
            <Spinner size="large" color={Palette.gold} />
            <Text style={{ marginTop: 12, color: Palette.gray700, fontSize: Type.title }}>{t('payslip.loadingPayslips')}</Text>
          </Box>
        ) : payslips.length === 0 ? (
          <Box mx="$4" mt="$8" alignItems="center" style={styles.emptyCard}>
            <MaterialIcons name="receipt-long" size={48} color={Palette.gray300} />
            <Text style={{ marginTop: 12, fontSize: Type.h3, fontWeight: '700', color: Palette.ink }}>
              {t('payslip.noPayslips')}
            </Text>
            <Text style={{ marginTop: 4, color: Palette.gray500, fontSize: Type.label, textAlign: 'center', paddingHorizontal: 16 }}>
              {t('payslip.noPayslipsHint')}
            </Text>
          </Box>
        ) : (
          grouped.map(([year, slips], gi) => (
            <Animated.View key={year} entering={FadeInUp.delay(gi * 50).duration(400)}>
              <Box mx="$4" mb="$2" mt="$2">
                <Text style={styles.yearHeader}>{year}</Text>
              </Box>
              <VStack space="sm" mx="$4">
                {slips.map((slip) => {
                  const period = periodOf(slip);
                  const isAdj = !!slip.is_adjustment;
                  const signed = isAdj ? formatSignedMoney(slip.net_pay, slip.currency) : null;
                  return (
                    <Pressable key={slip.id} onPress={() => openDetail(slip)} style={[styles.slipCard, isAdj && styles.slipCardAdj]}>
                      <HStack justifyContent="space-between" alignItems="center">
                        <VStack flex={1}>
                          <HStack space="xs" alignItems="center">
                            <Text style={{ fontSize: Type.title, fontWeight: '800', color: Palette.ink, letterSpacing: -0.2 }}>
                              {periodLabel(period, t('payslip.runIdLabel', { id: slip.payroll_run_id }))}
                            </Text>
                            {isAdj && (
                              <Box style={styles.correctionBadge}>
                                <Text style={styles.correctionBadgeText}>{t('payslip.correctionBadge')}</Text>
                              </Box>
                            )}
                          </HStack>
                          <Text style={{ fontSize: Type.caption, color: Palette.gray500, marginTop: 1 }}>
                            {isAdj
                              ? t('payslip.correctionToRun', { id: slip.payroll_run_id })
                              : `${t('payslip.runIdLabel', { id: slip.payroll_run_id })} · ${t('payslip.gross')} ${formatMoney(slip.gross, slip.currency)}`}
                          </Text>
                        </VStack>
                        <VStack alignItems="flex-end">
                          <Text style={{ fontSize: Type.tiny, color: Palette.gray500, fontWeight: '600', letterSpacing: 0.4 }}>
                            {isAdj ? t('payslip.adjustmentLabel') : t('payslip.netLabel')}
                          </Text>
                          <Text style={{ fontSize: Type.body, fontWeight: '700', color: isAdj ? (signed!.positive ? Palette.success : Palette.error) : Palette.success }}>
                            {isAdj ? signed!.text : formatMoney(slip.net_pay, slip.currency)}
                          </Text>
                        </VStack>
                        <MaterialIcons name="chevron-right" size={20} color={Palette.gray300} style={{ marginLeft: 8 }} />
                      </HStack>
                    </Pressable>
                  );
                })}
              </VStack>
            </Animated.View>
          ))
        )}
      </ScrollView>

      {/* Detail Modal */}
      <Modal isOpen={!!selected} onClose={() => setSelected(null)} size="full">
        <ModalBackdrop />
        <ModalContent style={styles.modal}>
          <ModalHeader style={{ borderBottomWidth: 1, borderBottomColor: Palette.gray100, paddingHorizontal: 20, paddingVertical: 14 }}>
            <VStack flex={1}>
              <Text style={{ fontSize: Type.caption, fontWeight: '600', color: Palette.gray500, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                {t('payslip.title')}
              </Text>
              <Text style={{ fontSize: Type.title, fontWeight: '700', color: Palette.ink, marginTop: 2 }}>
                {periodLabel(periodForSelected, t('payslip.runIdLabel', { id: selected?.payroll_run_id ?? '' }))}
              </Text>
            </VStack>
            <ModalCloseButton>
              <MaterialIcons name="close" size={22} color={Palette.gray500} />
            </ModalCloseButton>
          </ModalHeader>
          <ModalBody style={{ paddingHorizontal: 0 }}>
            {selected && (
              <ScrollView style={{ maxHeight: 600 }} contentContainerStyle={{ paddingBottom: 24 }}>


                {/* Correction banner — this row amends an earlier payslip;
                    every amount below is the change (+/−), not an absolute. */}
                {selected.is_adjustment && (
                  <Box mx="$4" mt="$3" mb="$1" style={styles.correctionBanner}>
                    <HStack space="sm" alignItems="flex-start">
                      <MaterialIcons name="published-with-changes" size={18} color={Palette.gold} style={{ marginTop: 1 }} />
                      <VStack flex={1}>
                        <Text style={{ fontSize: Type.label, fontWeight: '800', color: Palette.ink }}>
                          {t('payslip.correctionBannerTitle', { period: periodLabel(periodForSelected) })}
                        </Text>
                        <Text style={{ fontSize: Type.caption, color: Palette.gray600, marginTop: 2, lineHeight: 16 }}>
                          {t('payslip.correctionBannerBody')}
                        </Text>
                        {selected.adjustment_reason ? (
                          <Text style={{ fontSize: Type.caption, color: Palette.gray500, marginTop: 4, fontStyle: 'italic' }}>
                            {t('payslip.correctionReason')}: {selected.adjustment_reason}
                          </Text>
                        ) : null}
                      </VStack>
                    </HStack>
                  </Box>
                )}

                {/* Net pay highlight (for a correction this is the net change) */}
                <Box mx="$4" my="$3" style={[styles.netPayCard, selected.is_adjustment && styles.netPayCardAdj]}>
                  <Text style={{ fontSize: Type.caption, color: Palette.gray500, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                    {selected.is_adjustment ? t('payslip.netAdjustment') : t('payslip.netPay')}
                  </Text>
                  {selected.is_adjustment ? (() => {
                    const s = formatSignedMoney(selected.net_pay, selected.currency);
                    return (
                      <Text style={{ fontSize: Type.display, fontWeight: '800', color: s.positive ? Palette.success : Palette.error, marginTop: 2 }}>
                        {s.text}
                      </Text>
                    );
                  })() : (
                    <Text style={{ fontSize: Type.display, fontWeight: '800', color: Palette.success, marginTop: 2 }}>
                      {formatMoney(selected.net_pay, selected.currency)}
                    </Text>
                  )}
                  {prevSlip && (() => {
                    const delta = Number(selected.net_pay) - Number(prevSlip.net_pay);
                    if (!Number.isFinite(delta) || Math.abs(delta) < 0.01) return null;
                    const up = delta > 0;
                    return (
                      <HStack space="xs" alignItems="center" mt="$1">
                        <MaterialIcons name={up ? 'arrow-upward' : 'arrow-downward'} size={14} color={up ? Palette.success : Palette.error} />
                        <Text style={{ fontSize: Type.small, fontWeight: '700', color: up ? Palette.success : Palette.error, fontVariant: ['tabular-nums'] }}>
                          {up ? '+' : '−'}{formatMoney(Math.abs(delta), selected.currency)}
                        </Text>
                        <Text style={{ fontSize: Type.small, color: Palette.gray500 }}>
                          {t('payslip.vsPeriod', { period: periodLabel(periodOf(prevSlip)) })}
                        </Text>
                      </HStack>
                    );
                  })()}
                </Box>

                {/* Employer + period header card. Hidden if neither
                    employer info nor period is known so legacy payslips
                    don't get a half-empty box. */}
                {(selected.employer_name || selected.employer_brn || periodRangeLabel(periodForSelected)) && (
                  <Box mx="$4" mb="$2" style={styles.headerCard}>
                    {selected.employer_name && (
                      <Text style={styles.headerCardEmployer}>{selected.employer_name}</Text>
                    )}
                    {selected.employer_brn && (
                      <Text style={styles.headerCardMeta}>
                        {t('payslip.brnLabel')}: {selected.employer_brn}
                      </Text>
                    )}
                    {selected.home_site_name && (
                      <Text style={styles.headerCardMeta}>
                        {t('payslip.homeSiteLabel')}: {selected.home_site_name}
                      </Text>
                    )}
                    {periodRangeLabel(periodForSelected) && (
                      <Text style={styles.headerCardMeta}>
                        {t('payslip.payPeriodLabel')}: {periodRangeLabel(periodForSelected)}
                      </Text>
                    )}
                  </Box>
                )}

                {/* Earnings */}
                <SectionTitle title={t('payslip.earnings')} />
                <ComponentList
                  components={(selected.components ?? []).filter((c) => c.kind === 'earning')}
                  currency={selected.currency}
                />

                {/* Leave taken in this period — sick / annual / etc.
                    Driven by the engine's leave_summary aggregation. */}
                {selected.leave_summary && selected.leave_summary.length > 0 && (
                  <>
                    <SectionTitle title="Leave taken" />
                    <Box mx="$4">
                      {selected.leave_summary.map((lv) => (
                        <HStack key={lv.code} justifyContent="space-between" alignItems="center" py="$1.5">
                          <VStack flex={1}>
                            <Text style={{ fontSize: Type.label, fontWeight: '600', color: Palette.ink }}>
                              {lv.label}
                            </Text>
                            <Text style={{ fontSize: Type.tiny, color: Palette.gray400, marginTop: 1 }}>
                              {lv.paid ? 'Paid' : 'Unpaid'}
                            </Text>
                          </VStack>
                          <Text style={{ fontSize: Type.label, fontWeight: '700', color: Palette.ink, fontVariant: ['tabular-nums'] }}>
                            {lv.days} {lv.days === 1 ? 'day' : 'days'}
                          </Text>
                        </HStack>
                      ))}
                    </Box>
                  </>
                )}

                {/* Deduction summary lines (server-aggregated) */}
                <SectionTitle title={t('payslip.statutoryEmployee')} />
                <Box mx="$4">
                  <Row label="PAYE" value={formatMoney(selected.paye, selected.currency)} negative />
                  {selected.statutory_employee &&
                    Object.entries(selected.statutory_employee).map(([code, amt]) => (
                      <Row
                        key={code}
                        label={code}
                        value={formatMoney(String(amt), selected.currency)}
                        negative
                      />
                    ))}
                </Box>

                {/* Other deductions (component-driven) */}
                {(selected.components ?? []).some((c) => c.kind === 'deduction') && (
                  <>
                    <SectionTitle title={t('payslip.otherDeductions')} />
                    <ComponentList
                      components={(selected.components ?? []).filter((c) => c.kind === 'deduction')}
                      currency={selected.currency}
                      negative
                    />
                  </>
                )}

                {/* Loan repayments / leave impact (only show if non-zero) */}
                {(Number(selected.loan_repayments) > 0 || Number(selected.leave_impact) !== 0) && (
                  <>
                    <SectionTitle title={t('payslip.otherAdjustments')} />
                    <Box mx="$4">
                      {Number(selected.loan_repayments) > 0 && (
                        <Row label={t('payslip.loanRepayments')} value={formatMoney(selected.loan_repayments, selected.currency)} negative />
                      )}
                      {Number(selected.leave_impact) !== 0 && (
                        <Row label={t('payslip.leaveImpact')} value={formatMoney(selected.leave_impact, selected.currency)} />
                      )}
                    </Box>
                  </>
                )}

                {/* Totals strip */}
                <SectionTitle title={t('payslip.summary')} />
                <Box mx="$4" style={styles.summaryStrip}>
                  <Row label={t('payslip.gross')} value={formatMoney(selected.gross, selected.currency)} bold />
                  <Row label={t('payslip.taxableIncome')} value={formatMoney(selected.taxable_income, selected.currency)} muted />
                  <Divider my="$1" bg={Palette.gray100} />
                  <Row
                    label={t('payslip.netPay')}
                    value={formatMoney(selected.net_pay, selected.currency)}
                    bold
                    big
                  />
                </Box>

                {/* Employer contributions (informational) */}
                {selected.statutory_employer && Object.keys(selected.statutory_employer).length > 0 && (
                  <>
                    <SectionTitle title={t('payslip.statutoryEmployer')} muted />
                    <Box mx="$4">
                      {Object.entries(selected.statutory_employer).map(([code, amt]) => (
                        <Row
                          key={code}
                          label={code}
                          value={formatMoney(String(amt), selected.currency)}
                          muted
                        />
                      ))}
                    </Box>
                  </>
                )}

                {/* Raise a query about this payslip → concern/dispute flow */}
                <Box mx="$4" mt="$4">
                  <Pressable onPress={() => handleRaiseQuery(selected)} style={styles.queryButton}>
                    <HStack space="sm" alignItems="center" justifyContent="center">
                      <MaterialIcons name="help-outline" size={18} color={Palette.ink} />
                      <Text style={{ color: Palette.ink, fontWeight: '700', fontSize: Type.body }}>
                        {t('payslip.raiseQuery')}
                      </Text>
                    </HStack>
                  </Pressable>
                  <Text style={{ fontSize: Type.tiny, color: Palette.gray400, textAlign: 'center', marginTop: 6 }}>
                    {t('payslip.raiseQueryHint')}
                  </Text>
                </Box>

                {/* PDF download — hidden until M21 sets pdf_url */}
                {selected.pdf_url && (
                  <Box mx="$4" mt="$4">
                    <Pressable onPress={() => handleOpenPdf(selected)}>
                      <LinearGradient
                        colors={[Palette.blue, Palette.blue]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={styles.pdfButton}
                      >
                        <HStack space="sm" alignItems="center">
                          <MaterialIcons name="picture-as-pdf" size={18} color={Palette.white} />
                          <Text style={{ color: Palette.white, fontWeight: '700', fontSize: Type.body }}>
                            {selected.is_adjustment ? t('payslip.downloadCorrection') : t('payslip.downloadPdf')}
                          </Text>
                        </HStack>
                      </LinearGradient>
                    </Pressable>
                  </Box>
                )}
              </ScrollView>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </SafeAreaView>
  );
}


// ─── Subcomponents ────────────────────────────────────────────────────────────


function SectionTitle({ title, muted }: { title: string; muted?: boolean }) {
  return (
    <Box mx="$4" mt="$3" mb="$1">
      <Text
        style={{
          fontSize: Type.h2,
          fontWeight: '800',
          letterSpacing: -0.5,
          color: muted ? Palette.gray500 : Palette.ink,
        }}
      >
        {title}
      </Text>
    </Box>
  );
}


function ComponentList({
  components,
  currency,
  negative,
}: {
  components: PayslipComponent[];
  currency: string;
  negative?: boolean;
}) {
  // Inner component — pull a fresh `t` rather than threading it down so
  // the parent doesn't have to pass it through.
  const { t } = useTranslation();
  if (components.length === 0) {
    return (
      <Box mx="$4">
        <Text style={{ fontSize: Type.small, color: Palette.gray400, fontStyle: 'italic' }}>{t('common.none')}</Text>
      </Box>
    );
  }
  return (
    <Box mx="$4">
      {components.map((c, i) => {
        const mult = c.meta?.multiplier ? Number(c.meta.multiplier) : null;
        const showMult = mult != null && !Number.isNaN(mult) && mult !== 1;
        const hours = c.meta?.hours ? Number(c.meta.hours) : null;
        return (
          <HStack key={`${c.code}-${i}`} justifyContent="space-between" alignItems="center" py="$1.5">
            <VStack flex={1}>
              <HStack space="xs" alignItems="center">
                <Text style={{ fontSize: Type.label, fontWeight: '600', color: categoryColor(c.category, c.kind) }}>
                  {c.label}
                </Text>
                {showMult && (
                  <Box style={styles.multBadge}>
                    <Text style={styles.multBadgeText}>
                      {mult!.toFixed(2).replace(/\.?0+$/, '')}×
                    </Text>
                  </Box>
                )}
              </HStack>
              <Text style={{ fontSize: Type.tiny, color: Palette.gray400, fontFamily: 'monospace', marginTop: 1 }}>
                {c.code}
                {hours != null && !Number.isNaN(hours) ? ` · ${hours.toFixed(2).replace(/\.?0+$/, '')}h` : ''}
              </Text>
              {(() => {
                const why = prorationWhy(c.meta, currency);
                return why ? (
                  <Text style={{ fontSize: Type.tiny, color: Palette.teal, marginTop: 2, fontWeight: '600' }}>
                    {why}
                  </Text>
                ) : null;
              })()}
            </VStack>
            <Text
              style={{
                fontSize: Type.label,
                fontWeight: '700',
                color: negative ? Palette.error : Palette.ink,
                fontVariant: ['tabular-nums'],
              }}
            >
              {negative ? '−' : ''}{formatMoney(c.amount, currency)}
            </Text>
          </HStack>
        );
      })}
    </Box>
  );
}


function Row({
  label, value, negative, bold, muted, big,
}: {
  label: string;
  value: string;
  negative?: boolean;
  bold?: boolean;
  muted?: boolean;
  big?: boolean;
}) {
  return (
    <HStack justifyContent="space-between" alignItems="center" py="$1.5">
      <Text
        style={{
          fontSize: big ? Type.body : Type.label,
          fontWeight: bold ? '700' : '500',
          color: muted ? Palette.gray400 : Palette.gray600,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          fontSize: big ? Type.h3 : Type.label,
          fontWeight: bold ? '800' : '600',
          color: negative ? Palette.error : muted ? Palette.gray400 : Palette.ink,
          fontVariant: ['tabular-nums'],
        }}
      >
        {negative ? '−' : ''}{value}
      </Text>
    </HStack>
  );
}


// ─── Styles ───────────────────────────────────────────────────────────────────


const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Palette.gray50,
  },
  scrollContent: {
    paddingTop: 12,
    // The tab bar is position:'absolute' and floats over screen content (see
    // private_dashboard/_layout.tsx) — 40 left the last payslip row(s) in a
    // long history hidden behind it, unreachable by scrolling. 160 matches
    // the padding already used by other content-heavy screens on this same
    // tab navigator (home, expenses, profile, your_right).
    paddingBottom: 160,
  },
  headerCard: {
    backgroundColor: Palette.white,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Palette.gray100,
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  headerCardEmployer: {
    fontSize: Type.body,
    fontWeight: '700',
    color: Palette.ink,
    marginBottom: 2,
  },
  headerCardMeta: {
    fontSize: Type.caption,
    color: Palette.gray500,
    marginTop: 2,
  },
  iconChipGold: {
    backgroundColor: Palette.gold,
    borderRadius: 10,
    padding: 7,
  },
  iconChipTeal: {
    backgroundColor: Palette.teal,
    borderRadius: 10,
    padding: 7,
  },
  leaveCard: {
    backgroundColor: Palette.white,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Palette.gray100,
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  leaveCardTitle: {
    fontSize: Type.label,
    fontWeight: '800',
    color: Palette.ink,
  },
  summaryCard: {
    borderRadius: 18,
    padding: 18,
    shadowColor: Palette.ink,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 6,
  },
  yearHeader: {
    fontSize: Type.caption,
    fontWeight: '700',
    color: Palette.gray500,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  slipCard: {
    backgroundColor: Palette.white,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: Palette.gray100,
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  slipCardAdj: {
    borderColor: Palette.gold,
    borderStyle: 'dashed',
    backgroundColor: Palette.goldTint,
  },
  correctionBadge: {
    backgroundColor: Palette.gold,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  correctionBadgeText: {
    fontSize: Type.tiny,
    fontWeight: '800',
    color: Palette.white,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  correctionBanner: {
    backgroundColor: Palette.goldTint,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Palette.gold,
  },
  netPayCardAdj: {
    backgroundColor: Palette.goldTint,
    borderColor: Palette.gold,
  },
  emptyCard: {
    backgroundColor: Palette.white,
    borderRadius: 18,
    paddingVertical: 32,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: Palette.gray100,
  },
  modal: {
    backgroundColor: Palette.white,
    width: '94%',
    maxHeight: '92%',
    borderRadius: 18,
    overflow: 'hidden',
  },
  netPayCard: {
    backgroundColor: Palette.greenTint,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: Palette.greenTint,
  },
  summaryStrip: {
    backgroundColor: Palette.gray50,
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pdfButton: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Palette.blue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  queryButton: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Palette.white,
    borderWidth: 1.5,
    borderColor: Palette.gray200,
  },
  estimateCard: {
    backgroundColor: Palette.goldTint,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Palette.gold,
  },
  estimateTitle: {
    fontSize: Type.label,
    fontWeight: '800',
    color: Palette.ink,
  },
  estimateSubtitle: {
    fontSize: Type.caption,
    color: Palette.gray600,
    lineHeight: 15,
    marginTop: 2,
  },
  estimateButton: {
    paddingVertical: 11,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  multBadge: {
    backgroundColor: Palette.goldTint,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  multBadgeText: {
    fontSize: Type.tiny,
    fontWeight: '800',
    color: Palette.gold,
    fontVariant: ['tabular-nums'],
  },
});
