import { Palette, Type } from '@/app/constants/theme';
import {
  createLeaveRequest,
  deleteLeaveRequest,
  getUserLeaveRequests,
  getLeaveQuotas,
  isApiError,
  type Leave,
  type LeaveQuota,
} from '@/services/api';
import { leaveTypes as leaveTypesApi } from '@/services/payroll-api';
import type { LeaveType } from '../../../shared/types/payroll';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Box,
  Button,
  ButtonText,
  HStack,
  Heading,
  Input,
  InputField,
  Pressable,
  ScrollView,
  Spinner,
  Text,
  Toast,
  ToastDescription,
  ToastTitle,
  VStack,
  useToast,
} from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Dimensions, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeInUp } from '@/app/utils/animated';
import { SafeAreaView } from 'react-native-safe-area-context';
import useAuth from '../hooks/useAuth';
import { PremiumHeader } from '@/components/PremiumHeader';
import { LinearGradient } from 'expo-linear-gradient';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const DAY_SIZE = Math.floor((SCREEN_WIDTH - 64) / 7);

// Fallback colors keyed by leave-type code. Server-defined types pick up
// their colour from this map when a known code matches; custom company
// codes fall back to a deterministic palette below.
const FALLBACK_COLORS: Record<string, string> = {
  annual: Palette.blue,
  sick: Palette.green,
  emergency: Palette.gold,
  unpaid: Palette.gray500,
  maternity: Palette.violet,
  paternity: Palette.teal,
  bereavement: Palette.gray600,
  study: Palette.teal,
  other: Palette.violet,
};

const PALETTE = [Palette.blue, Palette.teal, Palette.warning, Palette.violet, Palette.teal, Palette.violet, Palette.teal, Palette.gold];

function colorForCode(code: string): string {
  if (FALLBACK_COLORS[code]) return FALLBACK_COLORS[code];
  // Hash-based fallback so the same custom code always picks the same colour
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) & 0xffff;
  return PALETTE[h % PALETTE.length];
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending:  { bg: Palette.warningTint, text: Palette.warning },
  approved: { bg: Palette.successTint, text: Palette.success },
  rejected: { bg: Palette.errorTint, text: Palette.error },
};

// Groups sorted date strings into contiguous date ranges
function groupConsecutiveDates(dates: string[]): { start: string; end: string }[] {
  if (dates.length === 0) return [];
  const sorted = [...dates].sort();
  const ranges: { start: string; end: string }[] = [];
  let rangeStart = sorted[0];
  let prev = sorted[0];

  for (let i = 1; i < sorted.length; i++) {
    const curr = sorted[i];
    const prevDate = parseISO(prev);
    const currDate = parseISO(curr);
    const diffMs = currDate.getTime() - prevDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    if (diffDays === 1) {
      prev = curr;
    } else {
      ranges.push({ start: rangeStart, end: prev });
      rangeStart = curr;
      prev = curr;
    }
  }
  ranges.push({ start: rangeStart, end: prev });
  return ranges;
}

function getDatesInRange(start: Date, end: Date): string[] {
  return eachDayOfInterval({ start, end }).map((d) => format(d, 'yyyy-MM-dd'));
}

export default function LeaveScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user } = useAuth();
  const toast = useToast();

  const privateUserId: number =
    (user as any)?.private_user?.private_user_id ??
    (user as any)?.private_user_id ??
    (user as any)?.user_id;
  const companyId: number | undefined =
    (user as any)?.private_user?.company_id ??
    (user as any)?.company?.company_id ??
    (user as any)?.company_id;

  const [viewMonth, setViewMonth] = useState(new Date());
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [leaveType, setLeaveType] = useState('annual');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requests, setRequests] = useState<Leave[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [activeTab, setActiveTab] = useState<'request' | 'history'>('request');
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [quotas, setQuotas] = useState<LeaveQuota[]>([]);

  const loadRequests = useCallback(async () => {
    if (!privateUserId) return;
    setLoadingRequests(true);
    const res = await getUserLeaveRequests(privateUserId);
    if (!isApiError(res)) setRequests(res as Leave[]);
    setLoadingRequests(false);
  }, [privateUserId]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  // Fetch the company's leave-type catalog (active only) once we know companyId.
  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    (async () => {
      const r = await leaveTypesApi.list(companyId, false);
      if (cancelled) return;
      if (!('error' in r)) {
        setTypes(r);
        // Default the picker to the first active type if our placeholder
        // 'annual' isn't present in the company's catalog
        if (r.length > 0 && !r.some((t) => t.code === 'annual')) {
          setLeaveType(r[0].code);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [companyId]);

  // Fetch this year's quotas
  useEffect(() => {
    if (!privateUserId) return;
    let cancelled = false;
    (async () => {
      const year = new Date().getFullYear();
      const r = await getLeaveQuotas(privateUserId, year);
      if (cancelled) return;
      if (r && !('error' in r) && (r as any).data) setQuotas((r as any).data as LeaveQuota[]);
    })();
    return () => { cancelled = true; };
  }, [privateUserId]);

  // Map by code for fast lookup in renderers
  const typeByCode = useMemo(() => {
    const m = new Map<string, LeaveType>();
    for (const t of types) m.set(t.code, t);
    return m;
  }, [types]);

  const quotaByCode = useMemo(() => {
    const m = new Map<string, LeaveQuota>();
    for (const q of quotas) m.set(q.leave_type, q);
    return m;
  }, [quotas]);

  // ─── Preset chips ────────────────────────────────────────────────────
  const applyPreset = (preset: 'today' | 'week' | 'next_week' | 'month') => {
    const now = new Date();
    let dates: string[] = [];
    if (preset === 'today') {
      dates = [format(now, 'yyyy-MM-dd')];
    } else if (preset === 'week') {
      const start = startOfWeek(now, { weekStartsOn: 1 });
      const end = endOfWeek(now, { weekStartsOn: 1 });
      dates = getDatesInRange(start, end);
      setViewMonth(start);
    } else if (preset === 'next_week') {
      const start = addWeeks(startOfWeek(now, { weekStartsOn: 1 }), 1);
      const end = addWeeks(endOfWeek(now, { weekStartsOn: 1 }), 1);
      dates = getDatesInRange(start, end);
      setViewMonth(start);
    } else if (preset === 'month') {
      const start = startOfMonth(now);
      const end = endOfMonth(now);
      dates = getDatesInRange(start, end);
      setViewMonth(start);
    }
    setSelectedDates(dates);
  };

  // ─── Calendar logic ───────────────────────────────────────────────────
  const toggleDay = (dateStr: string) => {
    setSelectedDates((prev) =>
      prev.includes(dateStr) ? prev.filter((d) => d !== dateStr) : [...prev, dateStr]
    );
  };

  const buildCalendarGrid = () => {
    const monthStart = startOfMonth(viewMonth);
    const monthEnd = endOfMonth(viewMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
    return days;
  };

  // ─── Submit ───────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (selectedDates.length === 0) {
      Alert.alert(t('leaveScreen.alertNoDatesTitle'), t('leaveScreen.alertNoDatesBody'));
      return;
    }
    setSubmitting(true);
    const ranges = groupConsecutiveDates(selectedDates);
    const results = await Promise.all(
      ranges.map((r) =>
        createLeaveRequest({
          private_user_id: privateUserId,
          leave_type: leaveType,
          start_date: r.start,
          end_date: r.end,
          status: 'pending',
          notes: notes.trim() || undefined,
        })
      )
    );
    const allOk = results.every((r) => !('error' in r));
    setSubmitting(false);
    if (allOk) {
      toast.show({
        render: () => (
          <Toast action="success">
            <ToastTitle>{t('leaveScreen.toastSubmittedTitle')}</ToastTitle>
            <ToastDescription>
              {t('leaveScreen.toastSubmittedBody', {
                count: ranges.length,
                plural: ranges.length === 1 ? '' : 's',
              })}
            </ToastDescription>
          </Toast>
        ),
      });
      setSelectedDates([]);
      setNotes('');
      loadRequests();
      setActiveTab('history');
    } else {
      Alert.alert(t('common.errorTitle'), t('leaveScreen.toastSomeFailed'));
    }
  };

  const handleDelete = async (leaveId: number) => {
    Alert.alert(t('leaveScreen.alertCancelTitle'), t('leaveScreen.alertCancelBody'), [
      { text: t('common.no'), style: 'cancel' },
      {
        text: t('leaveScreen.alertCancelConfirm'),
        style: 'destructive',
        onPress: async () => {
          await deleteLeaveRequest(leaveId);
          loadRequests();
        },
      },
    ]);
  };

  const calendarDays = buildCalendarGrid();
  const selectedTypeRow = typeByCode.get(leaveType);
  const selectedType = selectedTypeRow
    ? { key: selectedTypeRow.code, label: selectedTypeRow.label, color: colorForCode(selectedTypeRow.code) }
    : { key: leaveType, label: leaveType, color: colorForCode(leaveType) };

  // Leave is an employer-mediated feature: an employee requests, the employer
  // approves against a company quota. A user with no company has no approver
  // and no quota, so there's no meaningful request flow (and no catalog to
  // fetch — the leave-types API is company-scoped). Rather than render an
  // empty picker, show an empty state that points them to join/create a
  // company. We deliberately do NOT fall back to a hardcoded type list, which
  // would be fake types with no quota and codes the backend won't recognise.
  if (!companyId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
        <PremiumHeader title={t('leaveScreen.title')} onBack={() => router.back()} />
        <VStack flex={1} alignItems="center" justifyContent="center" px="$8" space="lg">
          <Box bg={Palette.gray100} rounded="$full" p="$5">
            <MaterialIcons name="event-busy" size={40} color={Palette.gray500} />
          </Box>
          <Text fontWeight="800" fontSize={Type.title} color={Palette.ink} textAlign="center">
            {t('leaveScreen.noCompanyTitle')}
          </Text>
          <Text fontSize={Type.body} color={Palette.gray600} textAlign="center" lineHeight={22}>
            {t('leaveScreen.noCompanyBody')}
          </Text>
        </VStack>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <PremiumHeader title={t('leaveScreen.title')} onBack={() => router.back()} />

      {/* Tab switcher */}
      <HStack mx="$4" mt="$3" bg={Palette.gray100} rounded="$xl" p="$1">
        {(['request', 'history'] as const).map((tab) => (
          <Pressable
            key={tab}
            flex={1}
            onPress={() => setActiveTab(tab)}
            bg={activeTab === tab ? Palette.white : 'transparent'}
            py="$2"
            rounded="$lg"
            alignItems="center"
            shadowColor={activeTab === tab ? Palette.black : 'transparent'}
            shadowOffset={{ width: 0, height: 1 }}
            shadowOpacity={activeTab === tab ? 0.08 : 0}
            shadowRadius={4}
            elevation={activeTab === tab ? 2 : 0}
          >
            <Text fontWeight="700" fontSize={Type.body} color={activeTab === tab ? Palette.ink : Palette.gray500}>
              {tab === 'request' ? t('leaveScreen.newRequest') : t('leaveScreen.myRequests')}
            </Text>
          </Pressable>
        ))}
      </HStack>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120, paddingTop: 12 }}
      >
        {/* Balances — shown above both tabs (was previously only rendered
            inside the "request" tab's branch, so switching to "My Requests"
            hid an employee's leave balance entirely even though it's exactly
            the context where they'd want to check it, e.g. before appealing
            a request). */}
        {types.length > 0 && (
          <Box px="$4" mb="$4">
            <Text fontWeight="700" fontSize={Type.label} color={Palette.gray500} mb="$2" textTransform="uppercase" letterSpacing={1}>
              {t('leaveScreen.balances', { year: new Date().getFullYear() })}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <HStack space="sm">
                {types.map((lt) => {
                  const q = quotaByCode.get(lt.code);
                  const total = q?.total_days ?? lt.days_per_year ?? 0;
                  const used = q?.used_days ?? 0;
                  const remaining = total - used;
                  const color = colorForCode(lt.code);
                  const noQuota = !q && (lt.days_per_year ?? 0) === 0;
                  return (
                    <Box
                      key={lt.id}
                      minWidth={120}
                      bg={Palette.white}
                      rounded="$xl"
                      px="$3"
                      py="$3"
                      borderWidth={1}
                      borderColor={Palette.gray100}
                      shadowColor={Palette.black}
                      shadowOffset={{ width: 0, height: 1 }}
                      shadowOpacity={0.04}
                      shadowRadius={4}
                      elevation={2}
                    >
                      <HStack alignItems="center" space="xs" mb="$1">
                        <Box width={8} height={8} rounded="$full" style={{ backgroundColor: color }} />
                        <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray700} numberOfLines={1}>
                          {lt.label}
                        </Text>
                        {lt.is_statutory && (
                          <Box px="$1" py="$0.5" rounded="$sm" bg={Palette.blueTint}>
                            <Text fontSize={Type.tiny} fontWeight="800" color={Palette.blue} letterSpacing={0.5}>{t('leaveScreen.statutoryBadge')}</Text>
                          </Box>
                        )}
                      </HStack>
                      {noQuota ? (
                        <Text fontSize={Type.caption} color={Palette.gray400} mt="$1">{t('leaveScreen.noQuotaSet')}</Text>
                      ) : (
                        <>
                          <HStack alignItems="baseline" space="xs">
                            <Text fontSize={Type.h2} fontWeight="800" color={Palette.ink}>
                              {remaining}
                            </Text>
                            <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="600">
                              {t('leaveScreen.daysLabel', { total })}
                            </Text>
                          </HStack>
                          {used > 0 && (
                            <Text fontSize={Type.tiny} color={Palette.gray500} mt="$0.5">
                              {t('leaveScreen.used', { count: used })}
                            </Text>
                          )}
                        </>
                      )}
                    </Box>
                  );
                })}
              </HStack>
            </ScrollView>
          </Box>
        )}

        {activeTab === 'request' ? (
          <Animated.View entering={FadeIn.duration(400)}>
            {/* Preset chips */}
            <Box px="$4" mb="$4">
              <Text fontWeight="700" fontSize={Type.label} color={Palette.gray500} mb="$2" textTransform="uppercase" letterSpacing={1}>
                {t('leaveScreen.quickSelect')}
              </Text>
              <HStack space="sm" flexWrap="wrap">
                {[
                  { labelKey: 'leaveScreen.today' as const, preset: 'today' as const },
                  { labelKey: 'leaveScreen.thisWeek' as const, preset: 'week' as const },
                  { labelKey: 'leaveScreen.nextWeek' as const, preset: 'next_week' as const },
                  { labelKey: 'leaveScreen.thisMonth' as const, preset: 'month' as const },
                ].map(({ labelKey, preset }) => (
                  <Pressable
                    key={preset}
                    onPress={() => applyPreset(preset)}
                    bg={Palette.blueTint}
                    borderWidth={1}
                    borderColor={Palette.gray200}
                    px="$3"
                    py="$1"
                    rounded="$full"
                    mb="$2"
                  >
                    <Text fontWeight="700" fontSize={Type.label} color={Palette.indigo}>{t(labelKey)}</Text>
                  </Pressable>
                ))}
              </HStack>
            </Box>

            {/* Calendar */}
            <Box mx="$4" bg={Palette.white} rounded="$2xl" p="$4" mb="$4"
              shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }}
              shadowOpacity={0.06} shadowRadius={12} elevation={4}
              borderWidth={1} borderColor={Palette.gray100}>
              {/* Month nav */}
              <HStack justifyContent="space-between" alignItems="center" mb="$4">
                <Pressable onPress={() => setViewMonth((m) => subMonths(m, 1))} p="$2">
                  <MaterialIcons name="chevron-left" size={24} color={Palette.gray700} />
                </Pressable>
                <Text fontWeight="800" fontSize={Type.title} color={Palette.ink}>
                  {format(viewMonth, 'MMMM yyyy')}
                </Text>
                <Pressable onPress={() => setViewMonth((m) => addMonths(m, 1))} p="$2">
                  <MaterialIcons name="chevron-right" size={24} color={Palette.gray700} />
                </Pressable>
              </HStack>

              {/* Day headers */}
              <HStack mb="$2">
                {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                  <Box key={i} width={DAY_SIZE} alignItems="center">
                    <Text fontSize={Type.small} fontWeight="700" color={Palette.gray500}>{d}</Text>
                  </Box>
                ))}
              </HStack>

              {/* Day grid */}
              <Box flexDirection="row" flexWrap="wrap">
                {calendarDays.map((day) => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const isSelected = selectedDates.includes(dateStr);
                  const isCurrentMonth = isSameMonth(day, viewMonth);
                  const isTodayDate = isToday(day);
                  return (
                    <Pressable
                      key={dateStr}
                      width={DAY_SIZE}
                      height={DAY_SIZE}
                      alignItems="center"
                      justifyContent="center"
                      onPress={() => isCurrentMonth && toggleDay(dateStr)}
                      mb="$1"
                    >
                      <Box
                        width={DAY_SIZE - 6}
                        height={DAY_SIZE - 6}
                        borderRadius={(DAY_SIZE - 6) / 2}
                        alignItems="center"
                        justifyContent="center"
                        bg={isSelected ? (selectedType?.color ?? Palette.blue) : isTodayDate ? Palette.blueTint : 'transparent'}
                        borderWidth={isTodayDate && !isSelected ? 1.5 : 0}
                        borderColor={isTodayDate ? Palette.indigo : 'transparent'}
                      >
                        <Text
                          fontSize={Type.label}
                          fontWeight={isSelected || isTodayDate ? '800' : '500'}
                          color={
                            isSelected ? Palette.white :
                            !isCurrentMonth ? Palette.gray300 :
                            isTodayDate ? Palette.indigo : Palette.gray800
                          }
                        >
                          {format(day, 'd')}
                        </Text>
                      </Box>
                    </Pressable>
                  );
                })}
              </Box>

              {selectedDates.length > 0 && (
                <VStack mt="$3" space="xs">
                  <HStack justifyContent="space-between" alignItems="center">
                    <Text fontSize={Type.label} color={Palette.gray500}>
                      {t('leaveScreen.daysSelected', {
                        count: selectedDates.length,
                        plural: selectedDates.length === 1 ? '' : 's',
                      })}
                    </Text>
                    <Pressable onPress={() => setSelectedDates([])}>
                      <Text fontSize={Type.label} color={Palette.indigo} fontWeight="700">{t('common.clear')}</Text>
                    </Pressable>
                  </HStack>
                  {/* Selected ranges summary */}
                  {groupConsecutiveDates(selectedDates).map((range, i) => (
                    <HStack key={i} bg={Palette.blueTint} px="$3" py="$2" rounded="$lg" alignItems="center" space="sm">
                      <MaterialIcons name="date-range" size={14} color={Palette.blue} />
                      <Text fontSize={Type.small} fontWeight="700" color={Palette.indigo}>
                        {format(parseISO(range.start), 'EEE, MMM d')}
                        {range.start !== range.end
                          ? ` → ${format(parseISO(range.end), 'EEE, MMM d')}`
                          : ''}
                      </Text>
                    </HStack>
                  ))}
                </VStack>
              )}
            </Box>

            {/* Leave type */}
            <Box mx="$4" mb="$4">
              <Text fontWeight="700" fontSize={Type.label} color={Palette.gray500} mb="$2" textTransform="uppercase" letterSpacing={1}>
                {t('leaveScreen.leaveType')}
              </Text>
              <HStack space="sm" flexWrap="wrap">
                {types.length === 0 ? (
                  <Text fontSize={Type.small} color={Palette.gray500} fontStyle="italic">
                    {t('leaveScreen.loadingTypes')}
                  </Text>
                ) : (
                  types.map((lt) => {
                    const active = leaveType === lt.code;
                    const color = colorForCode(lt.code);
                    return (
                      <Pressable
                        key={lt.id}
                        onPress={() => setLeaveType(lt.code)}
                        px="$4"
                        py="$2"
                        rounded="$full"
                        mb="$2"
                        borderWidth={1.5}
                        borderColor={active ? color : Palette.gray200}
                        bg={active ? color : Palette.white}
                      >
                        <HStack space="xs" alignItems="center">
                          <Text fontWeight="700" fontSize={Type.label} color={active ? Palette.white : Palette.gray600}>
                            {lt.label}
                          </Text>
                          {lt.is_statutory && (
                            <Box
                              px="$1.5"
                              py="$0.5"
                              rounded="$sm"
                              bg={active ? Palette.white : Palette.blueTint}
                            >
                              <Text fontSize={Type.tiny} fontWeight="800" color={active ? color : Palette.blue} letterSpacing={0.5}>
                                {t('leaveScreen.statutoryBadge')}
                              </Text>
                            </Box>
                          )}
                        </HStack>
                      </Pressable>
                    );
                  })
                )}
              </HStack>
            </Box>

            {/* Notes */}
            <Box mx="$4" mb="$6">
              <Text fontWeight="700" fontSize={Type.label} color={Palette.gray500} mb="$2" textTransform="uppercase" letterSpacing={1}>
                {t('leaveScreen.notes')}
              </Text>
              <Input bg={Palette.white} borderColor={Palette.gray200} borderRadius="$xl" height={80}>
                <InputField
                  placeholder={t('leaveScreen.notesPlaceholder')}
                  value={notes}
                  onChangeText={setNotes}
                  multiline
                  numberOfLines={3}
                  textAlignVertical="top"
                  paddingTop={12}
                />
              </Input>
            </Box>

            {/* Submit */}
            <Box mx="$4">
              <LinearGradient
                colors={[selectedType?.color ?? Palette.blue, selectedType?.color ?? Palette.blue]}
                style={{ borderRadius: 16 }}
              >
                <Pressable
                  onPress={handleSubmit}
                  disabled={submitting || selectedDates.length === 0}
                  py="$4"
                  px="$4"
                  minHeight={56}
                  alignItems="center"
                  justifyContent="center"
                  rounded="$2xl"
                  opacity={submitting || selectedDates.length === 0 ? 0.6 : 1}
                >
                  {submitting ? (
                    <Spinner color={Palette.white} />
                  ) : (
                    <Text color={Palette.white} fontWeight="800" fontSize={Type.title} textAlign="center">
                      {selectedDates.length > 0
                        ? `${t('leaveScreen.submit')} (${t('leaveScreen.daysSelected', {
                            count: selectedDates.length,
                            plural: selectedDates.length === 1 ? '' : 's',
                          })})`
                        : t('leaveScreen.submit')}
                    </Text>
                  )}
                </Pressable>
              </LinearGradient>
            </Box>
          </Animated.View>
        ) : (
          /* My Requests tab */
          <Animated.View entering={FadeIn.duration(400)}>
            <Box px="$4">
              {loadingRequests ? (
                <Box py="$12" alignItems="center">
                  <Spinner size="large" color={Palette.gold} />
                  <Text mt="$3" fontSize={Type.title} color={Palette.gray700}>{t('common.loading')}</Text>
                </Box>
              ) : requests.length === 0 ? (
                <Box py="$12" alignItems="center">
                  <Box bg={Palette.gray100} p="$5" rounded="$full" mb="$4">
                    <MaterialIcons name="event-busy" size={40} color={Palette.gray400} />
                  </Box>
                  <Text fontWeight="700" fontSize={Type.h3} color={Palette.ink} mb="$1">{t('leaveScreen.noRequests')}</Text>
                  <Text fontSize={Type.body} color={Palette.gray500} textAlign="center">
                    {t('leaveScreen.noRequestsHint')}
                  </Text>
                </Box>
              ) : (
                <VStack space="md">
                  {requests
                    .slice()
                    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
                    .map((req, i) => {
                      const statusStyle = STATUS_COLORS[req.status] ?? STATUS_COLORS.pending;
                      const typeColor = colorForCode(req.leave_type);
                      const leaveTypeLabel = typeByCode.get(req.leave_type)?.label ?? req.leave_type;
                      const days = eachDayOfInterval({
                        start: parseISO(req.start_date),
                        end: parseISO(req.end_date),
                      }).length;
                      const isSingleDay = req.start_date === req.end_date;
                      return (
                        <Animated.View key={req.leave_id} entering={FadeInUp.duration(300).delay(50 * i)}>
                          <Box
                            bg={Palette.white}
                            rounded="$2xl"
                            overflow="hidden"
                            shadowColor={Palette.black}
                            shadowOffset={{ width: 0, height: 2 }}
                            shadowOpacity={0.07}
                            shadowRadius={10}
                            elevation={3}
                          >
                            {/* Colored top bar */}
                            <Box height={4} style={{ backgroundColor: typeColor }} />

                            <Box p="$4">
                              {/* Row 1: type label + status badge + delete */}
                              <HStack justifyContent="space-between" alignItems="center" mb="$3">
                                <HStack space="xs" alignItems="center">
                                  <MaterialIcons name="event-available" size={16} color={typeColor} />
                                  <Text fontWeight="800" fontSize={Type.body} color={Palette.ink} style={{ textTransform: 'capitalize' }}>
                                    {leaveTypeLabel}
                                  </Text>
                                </HStack>
                                <HStack space="sm" alignItems="center">
                                  <Box
                                    px="$3"
                                    py="$1"
                                    rounded="$full"
                                    style={{ backgroundColor: statusStyle.bg }}
                                  >
                                    <Text
                                      fontSize={Type.small}
                                      fontWeight="700"
                                      style={{ color: statusStyle.text, textTransform: 'capitalize' }}
                                    >
                                      {t(`leaveScreen.status${req.status.charAt(0).toUpperCase() + req.status.slice(1)}` as
                                        | 'leaveScreen.statusPending'
                                        | 'leaveScreen.statusApproved'
                                        | 'leaveScreen.statusRejected')}
                                    </Text>
                                  </Box>
                                  {req.status === 'pending' && (
                                    <Pressable onPress={() => handleDelete(req.leave_id)} hitSlop={8}>
                                      <MaterialIcons name="delete-outline" size={20} color={Palette.errorAlt} />
                                    </Pressable>
                                  )}
                                </HStack>
                              </HStack>

                              {/* Date Timeline */}
                              <Box
                                style={{ backgroundColor: Palette.gray50, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Palette.gray200 }}
                              >
                                {isSingleDay ? (
                                  /* Single day */
                                  <HStack alignItems="center" space="sm">
                                    <MaterialIcons name="today" size={18} color={typeColor} />
                                    <VStack>
                                      <Text fontWeight="800" fontSize={Type.title} color={Palette.ink}>
                                        {format(parseISO(req.start_date), 'EEEE, d MMMM yyyy')}
                                      </Text>
                                      <Text fontSize={Type.small} color={Palette.gray500}>{t('leaveScreen.oneDay')}</Text>
                                    </VStack>
                                  </HStack>
                                ) : (
                                  /* Date range */
                                  <HStack alignItems="center">
                                    {/* Start */}
                                    <VStack flex={1}>
                                      <Text
                                        fontSize={Type.tiny}
                                        fontWeight="700"
                                        color={Palette.gray400}
                                        style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}
                                      >
                                        {t('leaveScreen.from')}
                                      </Text>
                                      <Text fontWeight="800" fontSize={Type.h2} color={Palette.ink} lineHeight={26}>
                                        {format(parseISO(req.start_date), 'd')}
                                      </Text>
                                      <Text fontWeight="600" fontSize={Type.label} color={Palette.gray700}>
                                        {format(parseISO(req.start_date), 'EEE')}
                                      </Text>
                                      <Text fontSize={Type.small} color={Palette.gray500}>
                                        {format(parseISO(req.start_date), 'MMM yyyy')}
                                      </Text>
                                    </VStack>

                                    {/* Connector */}
                                    <VStack alignItems="center" mx="$3">
                                      <Box
                                        style={{
                                          backgroundColor: typeColor,
                                          borderRadius: 20,
                                          paddingHorizontal: 10,
                                          paddingVertical: 4,
                                          marginBottom: 4,
                                        }}
                                      >
                                        <Text fontSize={Type.small} fontWeight="800" color={Palette.white}>
                                          {t('leaveScreen.daysShort', { count: days })}
                                        </Text>
                                      </Box>
                                      <MaterialIcons name="arrow-forward" size={16} color={typeColor} />
                                    </VStack>

                                    {/* End */}
                                    <VStack flex={1} alignItems="flex-end">
                                      <Text
                                        fontSize={Type.tiny}
                                        fontWeight="700"
                                        color={Palette.gray400}
                                        style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}
                                      >
                                        {t('leaveScreen.to')}
                                      </Text>
                                      <Text fontWeight="800" fontSize={Type.h2} color={Palette.ink} lineHeight={26}>
                                        {format(parseISO(req.end_date), 'd')}
                                      </Text>
                                      <Text fontWeight="600" fontSize={Type.label} color={Palette.gray700}>
                                        {format(parseISO(req.end_date), 'EEE')}
                                      </Text>
                                      <Text fontSize={Type.small} color={Palette.gray500}>
                                        {format(parseISO(req.end_date), 'MMM yyyy')}
                                      </Text>
                                    </VStack>
                                  </HStack>
                                )}
                              </Box>

                              {/* Footer: submitted date + notes */}
                              <HStack justifyContent="space-between" alignItems="center" mt="$3">
                                <Text fontSize={Type.small} color={Palette.gray400}>
                                  Submitted {format(parseISO(req.created_at), 'MMM d, yyyy')}
                                </Text>
                                {req.notes ? (
                                  <Text fontSize={Type.small} color={Palette.gray500} fontStyle="italic" flex={1} textAlign="right" numberOfLines={1} ml="$4">
                                    "{req.notes}"
                                  </Text>
                                ) : null}
                              </HStack>
                            </Box>
                          </Box>
                        </Animated.View>
                      );
                    })}
                </VStack>
              )}
            </Box>
          </Animated.View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({});
