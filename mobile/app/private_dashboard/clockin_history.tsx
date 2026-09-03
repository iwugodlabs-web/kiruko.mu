import { getUserTimeLogs, getUserDetail, getJobById, getUserLeaveRequests, TimeLog } from '@/services/api';
import { Palette, Type } from '@/app/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { format, isToday, startOfDay, endOfDay, startOfWeek, endOfWeek, subDays } from 'date-fns';
import { router } from 'expo-router';
import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, RefreshControl, Dimensions, Alert } from 'react-native';
import Animated, { FadeInUp, FadeIn } from '@/app/utils/animated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import useAuth from '../hooks/useAuth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { PremiumHeader } from '@/components/PremiumHeader';
import { Box } from '@gluestack-ui/themed';
import { payroll } from '@/services/payroll-api';

const ClockInHistory: React.FC = () => {
  const { t } = useTranslation();
  const [logs, setLogs] = React.useState<TimeLog[]>([]);
  const [allLogs, setAllLogs] = React.useState<TimeLog[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = React.useState('today');
  const [userDetails, setUserDetails] = React.useState<any>(null);
  const [jobData, setJobData] = React.useState<any>(null);
  const [leaveRequests, setLeaveRequests] = React.useState<any[]>([]);
  const [allLeaveRequests, setAllLeaveRequests] = React.useState<any[]>([]);
  const [clockInState, setClockInState] = React.useState({
    isClockedIn: false,
    isBreaking: false,
    currentClockInTime: null as string | null,
    activeTimeLogId: null as number | null
  });
  const [lastRefreshTime, setLastRefreshTime] = React.useState<Date | null>(null);
  const [filterType, setFilterType] = React.useState<'all' | 'completed' | 'in_progress' | 'overtime' | 'holiday' | 'weekend' | 'with_break'>('all');
  const { user } = useAuth();

  const getDateRangeForPeriod = (period: string) => {
    const now = new Date();

    switch (period) {
      case 'today':
        return {
          dateFrom: startOfDay(now),
          dateTo: endOfDay(now),
        };
      case 'last_7_days': {
        const from = startOfDay(subDays(now, 7));
        return {
          dateFrom: from,
          dateTo: endOfDay(now),
        };
      }
      case 'last_30_days': {
        const from = startOfDay(subDays(now, 30));
        return {
          dateFrom: from,
          dateTo: endOfDay(now),
        };
      }
      case 'last_90_days': {
        const from = startOfDay(subDays(now, 90));
        return {
          dateFrom: from,
          dateTo: endOfDay(now),
        };
      }
      case 'this_month': {
        const from = startOfDay(new Date(now.getFullYear(), now.getMonth(), 1));
        return {
          dateFrom: from,
          dateTo: endOfDay(now),
        };
      }
      case 'this_week': {
        const from = startOfWeek(now, { weekStartsOn: 1 });
        return {
          dateFrom: startOfDay(from),
          dateTo: endOfDay(now),
        };
      }
      case 'last_week': {
        const lastWeekEnd = subDays(startOfWeek(now, { weekStartsOn: 1 }), 1);
        const from = startOfWeek(lastWeekEnd, { weekStartsOn: 1 });
        return {
          dateFrom: startOfDay(from),
          dateTo: endOfDay(lastWeekEnd),
        };
      }
      case 'last_month': {
        const from = startOfDay(new Date(now.getFullYear(), now.getMonth() - 1, 1));
        const to = endOfDay(new Date(now.getFullYear(), now.getMonth(), 0));
        return {
          dateFrom: from,
          dateTo: to,
        };
      }
      default:
        return { dateFrom: undefined, dateTo: undefined };
    }
  };

  const formatDuration = (hours: number): string => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  };

  const calculateBreakDuration = (breakItem: any): number => {
    if (breakItem.start_time && breakItem.end_time) {
      const start = new Date(breakItem.start_time);
      const end = new Date(breakItem.end_time);
      const durationMs = end.getTime() - start.getTime();
      return durationMs / (1000 * 60);
    }
    return 0;
  };

  const formatTime = (timeString?: string | null): string => {
    if (!timeString) return t('clockIn.timeNA');
    try {
      const time = new Date(timeString);
      return format(time, 'hh:mm a');
    } catch {
      return t('clockIn.invalidTime');
    }
  };

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString);
      return format(date, 'MMM dd, yyyy');
    } catch {
      return t('clockIn.invalidDate');
    }
  };

  const loadAllClockInData = React.useCallback(async (isMountedRef?: { current: boolean }) => {
    const privateUserId = user?.private_user_id || user?.private_user?.private_user_id;
    if (!privateUserId) {
      if (!isMountedRef || isMountedRef.current) setLoading(false);
      return;
    }
    const numericPrivateUserId = Number(privateUserId);
    if (isNaN(numericPrivateUserId)) {
      if (!isMountedRef || isMountedRef.current) setLoading(false);
      return;
    }

    if (!isMountedRef || isMountedRef.current) {
      setLoading(true);
      setError(null);
    }

    try {
      const [timeLogsResponse, userDetailsResponse, jobDataResponse, leaveRequestsResponse] = await Promise.allSettled([
        getUserTimeLogs(numericPrivateUserId),
        getUserDetail(user.user_id),
        getJobById(numericPrivateUserId),
        getUserLeaveRequests(numericPrivateUserId)
      ]);

      if (timeLogsResponse.status === 'fulfilled') {
        const timeLogsData = timeLogsResponse.value;
        if (Array.isArray(timeLogsData)) {
          if (!isMountedRef || isMountedRef.current) setAllLogs(timeLogsData);
        } else if (timeLogsData && 'error' in timeLogsData) {
          if (!isMountedRef || isMountedRef.current) setAllLogs([]);
        }
      }

      if (userDetailsResponse.status === 'fulfilled') {
        const userData = userDetailsResponse.value;
        if (userData && !('error' in userData) && (!isMountedRef || isMountedRef.current)) {
          setUserDetails(userData);
        }
      }

      if (jobDataResponse.status === 'fulfilled') {
        const jobResponse = jobDataResponse.value;
        if (jobResponse && !('error' in jobResponse) && (!isMountedRef || isMountedRef.current)) {
          setJobData(jobResponse);
        }
      }

      if (leaveRequestsResponse.status === 'fulfilled') {
        const leaveData = leaveRequestsResponse.value;
        if (Array.isArray(leaveData)) {
          const formattedRequests = leaveData.map(req => ({
            id: req.leave_id,
            date: new Date(req.start_date).toISOString(),
            type: req.leave_type,
            reason: req.notes,
            status: req.status,
            submitted: req.created_at,
          }));
          if (!isMountedRef || isMountedRef.current) setAllLeaveRequests(formattedRequests);
        } else if (leaveData && !('error' in leaveData) && (!isMountedRef || isMountedRef.current)) {
          setAllLeaveRequests([]);
        }
      }

      if (!isMountedRef || isMountedRef.current) await loadClockInStateFromStorage();
      if (!isMountedRef || isMountedRef.current) setLastRefreshTime(new Date());

    } catch (err) {
      if (!isMountedRef || isMountedRef.current) setError('Failed to load clock-in data. Please try again.');
    } finally {
      if (!isMountedRef || isMountedRef.current) setLoading(false);
    }
  }, [user]);

  const filterDataByPeriod = React.useCallback(() => {
    const { dateFrom, dateTo } = getDateRangeForPeriod(selectedPeriod);
    let filteredLogs = allLogs;
    if (dateFrom && dateTo) {
      filteredLogs = allLogs.filter(log => {
        const dateField = log.start_time || log.created_at;
        if (!dateField) return false;
        try {
          const logDate = new Date(dateField);
          return !isNaN(logDate.getTime()) && logDate >= dateFrom && logDate <= dateTo;
        } catch { return false; }
      });
    }

    // Apply session type filter
    if (filterType !== 'all') {
      filteredLogs = filteredLogs.filter(log => {
        if (filterType === 'completed') return !!log.end_time;
        if (filterType === 'in_progress') return !log.end_time;
        if (filterType === 'overtime') return !!log.is_overtime;
        if (filterType === 'holiday') return !!(log as any).is_holiday;
        if (filterType === 'weekend') {
          const dateField = log.start_time || log.created_at;
          if (!dateField) return false;
          const logDate = new Date(dateField);
          const day = logDate.getDay();
          return day === 0 || day === 6;
        }
        if (filterType === 'with_break') {
          return Array.isArray((log as any).breaks) && (log as any).breaks.length > 0;
        }
        return true;
      });
    }

    let filteredLeaveRequests = allLeaveRequests;
    if (dateFrom && dateTo) {
      const fromDate = new Date(dateFrom);
      const toDate = new Date(dateTo);
      fromDate.setHours(0, 0, 0, 0);
      toDate.setHours(23, 59, 59, 999);

      filteredLeaveRequests = allLeaveRequests.filter(req => {
        const reqDate = new Date(req.date);
        return reqDate >= fromDate && reqDate <= toDate;
      });
    }

    setLogs([...filteredLogs].sort((a, b) => new Date(b.start_time || b.created_at || 0).getTime() - new Date(a.start_time || a.created_at || 0).getTime()));
    setLeaveRequests(filteredLeaveRequests);
  }, [allLogs, allLeaveRequests, selectedPeriod, filterType]);

  const loadClockInStateFromStorage = React.useCallback(async () => {
    try {
      const storedClockInTime = await AsyncStorage.getItem('currentClockInTime');
      const storedIsClockedIn = await AsyncStorage.getItem('isClockedIn');
      const storedIsBreaking = await AsyncStorage.getItem('isBreaking');
      const storedActiveLogId = await AsyncStorage.getItem('activeTimeLogId');

      setClockInState({
        isClockedIn: storedIsClockedIn === 'true',
        isBreaking: storedIsBreaking === 'true',
        currentClockInTime: storedClockInTime,
        activeTimeLogId: storedActiveLogId ? Number(storedActiveLogId) : null
      });
    } catch (error) {
      console.error('Failed to load clock-in state:', error);
    }
  }, []);

  const handleRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await loadAllClockInData({ current: true });
    setRefreshing(false);
  }, [loadAllClockInData]);

  // M4: download a watermarked estimated payslip computed from these
  // clock-ins. Server-clamped to current month, ignored-by-finalized.
  const handleDownloadEstimate = React.useCallback(async () => {
    try {
      const url = payroll.estimatedPayslipPdfUrl();
      const token = await AsyncStorage.getItem('authToken');
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const localUri = `${FileSystem.cacheDirectory}estimated_payslip_${ts}.pdf`;
      const result = await FileSystem.downloadAsync(url, localUri, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      if (result.status === 409) {
        let code: string | undefined;
        try {
          const body = await FileSystem.readAsStringAsync(result.uri);
          code = JSON.parse(body)?.detail?.code;
        } catch {}
        if (code === 'NO_CLOCKINS_FOR_PERIOD') {
          Alert.alert(t('payslip.estimateDialogTitle'), t('payslip.noClockinsForEstimate'));
          return;
        }
        if (code === 'NO_PAY_BASIS_CONFIGURED') {
          Alert.alert(t('payslip.estimateDialogTitle'), t('payslip.noPayBasis'));
          return;
        }
        Alert.alert(t('payslip.estimateDialogTitle'), t('payslip.officialExists'));
        return;
      }
      if (result.status === 503) {
        Alert.alert(t('payslip.estimateDialogTitle'), t('payslip.estimatedNotAvailable'));
        return;
      }
      if (result.status !== 200) {
        Alert.alert(t('payslip.estimateDialogTitle'), t('payslip.couldNotOpenPdf'));
        return;
      }
      const ok = await Sharing.isAvailableAsync();
      if (!ok) {
        Alert.alert(t('payslip.estimateDialogTitle'), t('payslip.sharingNotAvailable'));
        return;
      }
      await Sharing.shareAsync(result.uri, {
        mimeType: 'application/pdf',
        dialogTitle: t('payslip.estimateDialogTitle'),
        UTI: 'com.adobe.pdf',
      });
    } catch (err) {
      console.warn('estimated payslip: download failed', err);
      Alert.alert(t('payslip.estimateDialogTitle'), t('payslip.couldNotOpenPdf'));
    }
  }, [t]);

  React.useEffect(() => {
    let isMounted = true;
    if (user) loadAllClockInData({ current: isMounted }); // Pass Ref logic if needed, simplify for now
    return () => { isMounted = false; };
  }, [user, loadAllClockInData]);

  React.useEffect(() => {
    if (allLogs.length > 0 || allLeaveRequests.length > 0) filterDataByPeriod();
  }, [selectedPeriod, filterType, allLogs, allLeaveRequests, filterDataByPeriod]);

  if (loading) {
    // Keep the header (back + title) mounted while data loads.
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <PremiumHeader title={t('clockIn.historyTitle')} />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={Palette.gold} />
          <Text style={styles.loadingText}>{t('clockIn.historyLoading')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <PremiumHeader title={t('clockIn.historyTitle')} />

      {/* M4 — Estimated payslip from these clock-ins. Watermarked,
          current month only, never persisted. Disclaimer is above the
          button so the caveat lands before the tap. */}
      <View style={styles.estimateCard}>
        <View style={styles.estimateRow}>
          <Box style={styles.estimateIconChip}>
            <MaterialIcons name="info-outline" size={16} color={Palette.white} />
          </Box>
          <View style={{ flex: 1, marginLeft: 8 }}>
            <Text style={styles.estimateTitle}>This month's estimated payslip</Text>
            <Text style={styles.estimateSubtitle}>
              Built from your clock-ins on this screen. Marked ESTIMATED — not
              valid for banks, tax, immigration, or legal use. Final pay may
              change.
            </Text>
          </View>
        </View>
        <Pressable onPress={handleDownloadEstimate}>
          <LinearGradient
            colors={[Palette.gold, Palette.gold]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.estimateButton}
          >
            <MaterialIcons name="download" size={18} color={Palette.white} />
            <Text style={styles.estimateButtonText}>Download estimated payslip</Text>
          </LinearGradient>
        </Pressable>
      </View>

      {/* Period Selector */}
      <View style={styles.periodContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16 }}>
          {[
            { key: 'today', label: t('clockIn.periodToday') },
            { key: 'this_week', label: t('clockIn.periodThisWeek') },
            { key: 'last_week', label: t('clockIn.periodLastWeek') },
            { key: 'last_7_days', label: t('clockIn.period7Days') },
            { key: 'this_month', label: t('clockIn.periodThisMonth') },
            { key: 'last_30_days', label: t('clockIn.period30Days') },
            { key: 'last_month', label: t('clockIn.periodLastMonth') },
            { key: 'last_90_days', label: t('clockIn.period3Months') },
            { key: 'all', label: t('clockIn.periodAllTime') },
          ].map((period) => {
            const isActive = selectedPeriod === period.key;
            return (
              <Pressable key={period.key} onPress={() => setSelectedPeriod(period.key)}>
                <Animated.View style={[styles.periodPill, isActive && styles.periodPillActive]}>
                  {isActive && (
                    <LinearGradient
                      colors={[Palette.success, Palette.teal]}
                      style={StyleSheet.absoluteFill}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                    />
                  )}
                  <Text style={[styles.periodText, isActive && styles.periodTextActive]}>
                    {period.label}
                  </Text>
                </Animated.View>
              </Pressable>
            )
          })}
        </ScrollView>

        {/* Session Type Filter */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8 }}>
          {[
            { key: 'all', label: t('clockIn.filterAll'), icon: 'list' as const },
            { key: 'completed', label: t('clockIn.filterCompleted'), icon: 'check-circle' as const },
            { key: 'in_progress', label: t('clockIn.filterActive'), icon: 'radio-button-checked' as const },
            { key: 'overtime', label: t('clockIn.filterOvertime'), icon: 'timer' as const },
            { key: 'holiday', label: t('clockIn.filterHoliday'), icon: 'star' as const },
            { key: 'weekend', label: t('clockIn.filterWeekend'), icon: 'beach-access' as const },
            { key: 'with_break', label: t('clockIn.filterWithBreak'), icon: 'restaurant' as const },
          ].map((f) => {
            const isActive = filterType === f.key;
            const activeColors: Record<string, string> = {
              all: Palette.gray700,
              completed: Palette.success,
              in_progress: Palette.blue,
              overtime: Palette.gold,
              holiday: Palette.violet,
            };
            const color = activeColors[f.key];
            return (
              <Pressable key={f.key} onPress={() => setFilterType(f.key as any)}>
                <View style={[
                  styles.typeFilterPill,
                  isActive && { backgroundColor: color, borderColor: color },
                ]}>
                  <MaterialIcons name={f.icon} size={12} color={isActive ? Palette.white : Palette.gray400} />
                  <Text style={[styles.typeFilterText, isActive && { color: Palette.white }]}>
                    {f.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Palette.teal} />}
      >
        {/* Summary Card */}
        {!loading && logs.length > 0 && (() => {
          const totalHours = logs.reduce((acc, log) => acc + (log.hours_worked || 0), 0);
          const completedLogs = logs.filter(l => !!l.end_time);
          const avgHours = completedLogs.length > 0 ? totalHours / completedLogs.length : 0;
          const otCount = logs.filter(l => l.is_overtime).length;
          const formatH = (h: number) => {
            const totalMins = Math.round(h * 60);
            const hh = Math.floor(totalMins / 60);
            const mm = totalMins % 60;
            if (hh === 0) return `${mm}m`;
            if (mm === 0) return `${hh}h`;
            return `${hh}h ${mm}m`;
          };
          return (
            <View style={styles.summaryCard}>
              <View style={{ flexDirection: 'row', padding: 16, gap: 8 }}>
                <View style={[styles.summaryStatBox, { backgroundColor: Palette.greenTint, borderColor: Palette.greenTint }]}>
                  <Box style={[styles.summaryStatChip, { backgroundColor: Palette.success }]}>
                    <MaterialIcons name="list" size={16} color={Palette.white} />
                  </Box>
                  <Text style={styles.summaryStatValue}>{logs.length}</Text>
                  <Text style={styles.summaryStatLabel}>{t('clockIn.summarySessions')}</Text>
                </View>
                <View style={[styles.summaryStatBox, { backgroundColor: Palette.tealTint, borderColor: Palette.tealTint }]}>
                  <Box style={[styles.summaryStatChip, { backgroundColor: Palette.teal }]}>
                    <MaterialIcons name="schedule" size={16} color={Palette.white} />
                  </Box>
                  <Text style={styles.summaryStatValue}>{formatH(totalHours)}</Text>
                  <Text style={styles.summaryStatLabel}>{t('clockIn.summaryTotalHrs')}</Text>
                </View>
                <View style={[styles.summaryStatBox, { backgroundColor: Palette.blueTint, borderColor: Palette.blueTint }]}>
                  <Box style={[styles.summaryStatChip, { backgroundColor: Palette.blue }]}>
                    <MaterialIcons name="show-chart" size={16} color={Palette.white} />
                  </Box>
                  <Text style={styles.summaryStatValue}>{formatH(avgHours)}</Text>
                  <Text style={styles.summaryStatLabel}>{t('clockIn.summaryAvgDay')}</Text>
                </View>
                <View style={[styles.summaryStatBox, { backgroundColor: Palette.warningTint, borderColor: Palette.warningTint }]}>
                  <Box style={[styles.summaryStatChip, { backgroundColor: Palette.gold }]}>
                    <MaterialIcons name="timer" size={16} color={Palette.white} />
                  </Box>
                  <Text style={styles.summaryStatValue}>{otCount}</Text>
                  <Text style={styles.summaryStatLabel}>{t('clockIn.summaryOvertime')}</Text>
                </View>
              </View>
            </View>
          );
        })()}

        {/* Result Count */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 4 }}>
          <Text style={{ fontSize: Type.label, fontWeight: '700', color: Palette.gray700 }}>
            {logs.length} {logs.length === 1 ? t('clockIn.sessionCountSingular') : t('clockIn.sessionCountPlural')}
          </Text>
          {filterType !== 'all' && (
            <Pressable onPress={() => setFilterType('all')}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Palette.gray100, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 }}>
                <MaterialIcons name="close" size={12} color={Palette.gray500} />
                <Text style={{ fontSize: Type.caption, fontWeight: '600', color: Palette.gray500 }}>{t('clockIn.clearFilter')}</Text>
              </View>
            </Pressable>
          )}
        </View>

        {/* Timeline List */}
        <View style={styles.timelineContainer}>
          {logs.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="history" size={48} color={Palette.gray300} />
              <Text style={styles.emptyText}>{t('clockIn.emptyPeriodMessage')}</Text>
            </View>
          ) : (
            logs.map((log, index) => {
              const isLast = index === logs.length - 1;
              const isCompleted = !!log.end_time;

              return (
                <Animated.View
                  key={log.timelog_id || index}
                  entering={FadeInUp.delay(index * 50)}
                  style={styles.timelineRow}
                >
                  {/* Left: Time & Line */}
                  <View style={styles.timelineLeft}>
                    <Text style={styles.timeText}>
                      {format(new Date(log.start_time), 'HH:mm')}
                    </Text>
                    <View style={styles.timelineDotContainer}>
                      <View style={[styles.timelineDot, !isCompleted && styles.timelineDotActive]} />
                      {!isLast && <View style={styles.timelineLine} />}
                    </View>
                  </View>

                  {/* Right: Card */}
                  <View style={styles.timelineContent}>
                    <View style={styles.card}>
                      <View style={styles.cardHeader}>
                        <View>
                          <Text style={styles.cardDate}>
                            {format(new Date(log.start_time), 'EEEE, MMM d')}
                          </Text>
                          <View style={styles.statusBadge}>
                            <View style={[styles.statusDot, isCompleted ? { backgroundColor: Palette.teal } : { backgroundColor: Palette.blue }]} />
                            <Text style={styles.statusText}>
                              {isCompleted ? t('clockIn.statusCompleted') : t('clockIn.statusInProgress')}
                            </Text>
                            {log.is_overtime && (
                              <View style={[styles.statusBadge, { backgroundColor: Palette.warningTint, marginLeft: 8, paddingHorizontal: 6 }]}>
                                <Text style={[styles.statusText, { color: Palette.gold, fontWeight: '800', fontSize: Type.tiny }]}>{t('clockIn.badgeOT')}</Text>
                              </View>
                            )}
                            {log.is_holiday && (
                              <View style={[styles.statusBadge, { backgroundColor: Palette.violetTint, marginLeft: 8, paddingHorizontal: 6 }]}>
                                <Text style={[styles.statusText, { color: Palette.violet, fontWeight: '800', fontSize: Type.tiny }]}>{t('clockIn.badgeHOL')}</Text>
                              </View>
                            )}
                          </View>
                        </View>
                        <View style={styles.hoursBadge}>
                          <Text style={styles.hoursText}>
                            {(() => {
                              const hours = isCompleted ? (log.hours_worked || 0) : 0;
                              const totalMins = Math.round(hours * 60);
                              const h = Math.floor(totalMins / 60);
                              const m = totalMins % 60;
                              if (!isCompleted) return t('clockIn.inProgressLabel');
                              if (h === 0) return `${m}m`;
                              if (m === 0) return `${h}h`;
                              return `${h}h ${m}m`;
                            })()}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.cardDivider} />

                      <View style={styles.cardDetails}>
                        <View style={styles.detailRow}>
                          <MaterialIcons name="login" size={16} color={Palette.success} />
                          <Text style={styles.detailText}>{t('clockIn.inLabel', { time: formatTime(log.start_time) })}</Text>
                        </View>
                        {isCompleted && (
                          <View style={styles.detailRow}>
                            <MaterialIcons name="logout" size={16} color={Palette.teal} />
                            <Text style={styles.detailText}>{t('clockIn.outLabel', { time: formatTime(log.end_time) })}</Text>
                          </View>
                        )}
                        {log.breaks && log.breaks.length > 0 && (
                          <View style={styles.detailRow}>
                            <MaterialIcons name="coffee" size={16} color={Palette.gold} />
                            <Text style={styles.detailText}>
                              {t('clockIn.breakSuffix', { minutes: Math.round(log.breaks.reduce((acc, b) => acc + calculateBreakDuration(b), 0)) })}
                            </Text>
                          </View>
                        )}
                        {(log.location?.clock_in?.address || log.location?.address) && (
                          <View style={[styles.detailRow, { alignItems: 'flex-start' }]}>
                            <MaterialIcons name="location-on" size={16} color={Palette.gray500} style={{ marginTop: 2 }} />
                            <Text style={[styles.detailText, { flex: 1 }]}>
                              {log.location?.clock_in?.address || log.location?.address}
                            </Text>
                          </View>
                        )}
                        {log.location?.clock_out?.address && log.location?.clock_out?.address !== (log.location?.clock_in?.address || log.location?.address) && (
                          <View style={[styles.detailRow, { alignItems: 'flex-start' }]}>
                            <MaterialIcons name="location-off" size={16} color={Palette.gray400} style={{ marginTop: 2 }} />
                            <Text style={[styles.detailText, { flex: 1 }]}>
                              {t('clockIn.outAddressPrefix', { address: log.location?.clock_out?.address })}
                            </Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                </Animated.View>
              )
            })
          )}
        </View>

      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Palette.gray50,
  },
  estimateCard: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    padding: 12,
    borderRadius: 12,
    backgroundColor: Palette.warningTint,
    borderWidth: 1,
    borderColor: Palette.gold,
  },
  estimateRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  estimateIconChip: {
    backgroundColor: Palette.gold,
    borderRadius: 10,
    padding: 7,
  },
  estimateTitle: {
    fontSize: Type.label,
    fontWeight: '800',
    color: Palette.gold,
  },
  estimateSubtitle: {
    fontSize: Type.caption,
    color: Palette.gold,
    lineHeight: 15,
    marginTop: 2,
  },
  estimateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 8,
  },
  estimateButtonText: {
    color: Palette.white,
    fontWeight: '700',
    fontSize: Type.body,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: Palette.gray50,
  },
  loadingText: {
    marginTop: 12,
    color: Palette.gray700,
    fontSize: Type.title,
    fontWeight: '500',
  },
  header: {
    paddingHorizontal: 24,
    paddingVertical: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: Palette.white,
    borderBottomWidth: 1,
    borderBottomColor: Palette.gray100,
  },
  headerTitle: {
    fontSize: Type.h1,
    fontWeight: '800',
    color: Palette.ink,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: Type.label,
    color: Palette.gray500,
    marginTop: 2,
    fontWeight: '500',
  },
  iconButton: {
    backgroundColor: Palette.gray100,
    padding: 8,
    borderRadius: 12,
  },
  periodContainer: {
    paddingVertical: 12,
    paddingBottom: 14,
    backgroundColor: Palette.white,
    borderBottomWidth: 1,
    borderBottomColor: Palette.gray100,
  },
  typeFilterPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Palette.gray50,
    borderWidth: 1,
    borderColor: Palette.gray200,
    marginRight: 8,
  },
  typeFilterText: {
    fontSize: Type.small,
    fontWeight: '600',
    color: Palette.gray500,
  },
  periodPill: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Palette.gray100,
    marginRight: 8,
    overflow: 'hidden',
  },
  periodPillActive: {
    backgroundColor: Palette.teal, // Fallback
  },
  periodText: {
    fontSize: Type.label,
    fontWeight: '600',
    color: Palette.gray500,
  },
  periodTextActive: {
    color: Palette.white,
  },
  content: {
    flex: 1,
  },
  summaryCard: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 4,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Palette.gray200,
    backgroundColor: Palette.white,
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },
  summaryStatBox: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    gap: 2,
  },
  summaryStatChip: {
    borderRadius: 10,
    padding: 7,
    marginBottom: 4,
  },
  summaryStatValue: {
    fontSize: Type.h1,
    fontWeight: '800',
    color: Palette.ink,
    marginTop: 2,
  },
  summaryStatLabel: {
    fontSize: Type.tiny,
    color: Palette.ink,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  summaryDivider: {
    width: 1,
    height: 40,
    backgroundColor: Palette.gray200,
    marginHorizontal: 20,
  },
  timelineContainer: {
    paddingHorizontal: 20,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: Palette.ink,
    fontSize: Type.h3,
    marginTop: 12,
    fontWeight: '700',
  },
  timelineRow: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  timelineLeft: {
    width: 60,
    alignItems: 'flex-end',
    paddingRight: 16,
  },
  timeText: {
    fontSize: Type.small,
    color: Palette.gray500,
    fontWeight: '600',
    marginBottom: 8,
  },
  timelineDotContainer: {
    alignItems: 'center',
    width: 16,
    marginRight: -8, // Center align with column edge
  },
  timelineDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Palette.gray200,
    borderWidth: 2,
    borderColor: Palette.white,
    zIndex: 10,
  },
  timelineDotActive: {
    backgroundColor: Palette.blue,
    borderColor: Palette.blueTint,
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: Palette.gray100,
    marginTop: -2,
    marginBottom: -20,
  },
  timelineContent: {
    flex: 1,
    paddingBottom: 4,
  },
  card: {
    backgroundColor: Palette.white,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: Palette.gray100,
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  cardDate: {
    fontSize: Type.title,
    fontWeight: '700',
    color: Palette.ink,
    marginBottom: 4,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 6,
  },
  statusText: {
    fontSize: Type.small,
    color: Palette.gray500,
    fontWeight: '500',
  },
  hoursBadge: {
    backgroundColor: Palette.gray100,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
  },
  hoursText: {
    fontSize: Type.body,
    fontWeight: '700',
    color: Palette.gray700,
  },
  cardDivider: {
    height: 1,
    backgroundColor: Palette.gray100,
    marginBottom: 12,
    marginHorizontal: -16,
  },
  cardDetails: {
    gap: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailText: {
    fontSize: Type.label,
    color: Palette.gray600,
    fontWeight: '500',
  },
});

export default ClockInHistory;