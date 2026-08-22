import { Palette, Type } from '@/app/constants/theme';
import PermissionGate from '@/components/PermissionGate';
import {
  getLeaveRequestsByCompany,
  getSchedulesByCompany,
  getTimeLogsByCompany,
  getUsersByCompany,
  isApiError,
  Leave,
  Schedule,
  TimeLog,
  User,
} from '@/services/api';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Avatar,
  AvatarFallbackText,
  Box,
  HStack,
  Input,
  InputField,
  InputSlot,
  Pressable,
  RefreshControl,
  ScrollView,
  Spinner,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import { format, isToday, isYesterday, isWithinInterval, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Animated, { FadeInDown } from '@/app/utils/animated';
import { Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import useAuth from '../hooks/useAuth';

type ActivityType = 'all' | 'leave' | 'timelog' | 'overtime' | 'schedule_complete';
type DateRange = 'today' | 'this_week' | 'this_month' | 'all';

const TYPE_FILTERS: { key: ActivityType; label: string; color: string }[] = [
  { key: 'all', label: 'All', color: Palette.ink },
  { key: 'leave', label: 'Leaves', color: Palette.warning },
  { key: 'timelog', label: 'Clock-Ins', color: Palette.teal },
  { key: 'overtime', label: 'Overtime', color: Palette.gold },
  { key: 'schedule_complete', label: 'Shifts', color: Palette.blue },
];

const DATE_FILTERS: { key: DateRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'this_week', label: 'This Week' },
  { key: 'this_month', label: 'This Month' },
  { key: 'all', label: 'All Time' },
];

function getInitials(name?: string) {
  if (!name) return 'U';
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

export default function ClockinHistoryPage() {
  return (
    <PermissionGate permission="view_attendance" label="clock-in history">
      <ClockinHistoryPageInner />
    </PermissionGate>
  );
}

function ClockinHistoryPageInner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();

  const typeFilterLabel = (k: ActivityType) => ({
    all: t('companyDashboard.actFilterAll'),
    leave: t('companyDashboard.actFilterLeaves'),
    timelog: t('companyDashboard.actFilterClockIns'),
    overtime: t('companyDashboard.actOvertime'),
    schedule_complete: t('companyDashboard.actFilterShifts'),
  }[k]);
  const dateFilterLabel = (k: DateRange) => ({
    today: t('companyDashboard.actDateToday'),
    this_week: t('companyDashboard.actDateThisWeek'),
    this_month: t('companyDashboard.actDateThisMonth'),
    all: t('companyDashboard.actDateAllTime'),
  }[k]);

  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [leaves, setLeaves] = useState<Leave[]>([]);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [allUsers, setAllUsers] = useState<User[]>([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<ActivityType>('all');
  const [dateFilter, setDateFilter] = useState<DateRange>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const companyId = useMemo(() => {
    return (
      user?.company?.company_id ||
      (user?.company as any)?.id ||
      (user as any)?.company_id ||
      (user?.private_user as any)?.company_id
    );
  }, [user]);

  const loadData = useCallback(async () => {
    if (!companyId) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    try {
      const [logsRes, leavesRes, schedulesRes, usersRes] = await Promise.allSettled([
        getTimeLogsByCompany(companyId),
        getLeaveRequestsByCompany(companyId),
        getSchedulesByCompany(companyId),
        getUsersByCompany(companyId),
      ]);

      if (logsRes.status === 'fulfilled' && !isApiError(logsRes.value))
        setTimeLogs(logsRes.value as TimeLog[]);
      if (leavesRes.status === 'fulfilled' && !isApiError(leavesRes.value))
        setLeaves(leavesRes.value as Leave[]);
      if (schedulesRes.status === 'fulfilled' && !isApiError(schedulesRes.value))
        setSchedules(schedulesRes.value as Schedule[]);
      if (usersRes.status === 'fulfilled' && !isApiError(usersRes.value))
        setAllUsers(usersRes.value as User[]);
    } catch (e) {
      console.error('Activity page load error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [companyId]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  // Build unified activity list
  const unifiedActivity = useMemo(() => {
    const items: any[] = [
      ...leaves.map((l) => ({ ...l, type: 'leave', timestamp: new Date(l.created_at) })),
      ...timeLogs
        .filter((t) => t.start_time && !t.is_overtime)
        .map((t) => ({ ...t, type: 'timelog', timestamp: new Date(t.start_time) })),
      ...timeLogs
        .filter((t) => t.is_overtime && t.marked_as_overtime_at)
        .map((t) => ({ ...t, type: 'overtime', timestamp: new Date(t.marked_as_overtime_at!) })),
      ...schedules
        .filter((s) => s.status === 'completed')
        .map((s) => ({ ...s, type: 'schedule_complete', timestamp: new Date(s.updated_at || s.end_time) })),
    ];
    return items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }, [timeLogs, leaves, schedules]);

  // Apply all filters
  const filteredActivity = useMemo(() => {
    const now = new Date();
    let list = unifiedActivity;

    // Type filter
    if (typeFilter !== 'all') {
      list = list.filter((a) => a.type === typeFilter);
    }

    // Date filter
    if (dateFilter !== 'all') {
      list = list.filter((a) => {
        const ts = a.timestamp;
        switch (dateFilter) {
          case 'today': return isToday(ts);
          case 'this_week':
            return isWithinInterval(ts, {
              start: startOfWeek(now, { weekStartsOn: 1 }),
              end: endOfWeek(now, { weekStartsOn: 1 }),
            });
          case 'this_month':
            return isWithinInterval(ts, { start: startOfMonth(now), end: endOfMonth(now) });
          default: return true;
        }
      });
    }

    // Search filter (by employee name)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((a) => {
        const u = allUsers.find(
          (u) => u.private_user?.private_user_id === a.private_user_id
        );
        const name = u?.private_user
          ? `${u.private_user.first_name} ${u.private_user.last_name}`.toLowerCase()
          : '';
        return name.includes(q);
      });
    }

    return list;
  }, [unifiedActivity, typeFilter, dateFilter, searchQuery, allUsers]);

  // Group by date
  const grouped = useMemo(() => {
    const groups: { label: string; items: any[] }[] = [];
    const seen: Record<string, number> = {};
    filteredActivity.forEach((a) => {
      const key = format(a.timestamp, 'yyyy-MM-dd');
      let label = format(a.timestamp, 'EEEE, MMM d');
      if (isToday(a.timestamp)) label = t('companyTimeLogs.dateToday');
      else if (isYesterday(a.timestamp)) label = t('companyTimeLogs.dateYesterday');
      if (seen[key] === undefined) {
        seen[key] = groups.length;
        groups.push({ label, items: [] });
      }
      groups[seen[key]].items.push(a);
    });
    return groups;
  }, [filteredActivity]);

  function buildConfig(activity: any): { color: string; label: string; detail: string; route: string } {
    const activityUser = allUsers.find(
      (u) => u.private_user?.private_user_id === activity.private_user_id
    );
    const name = activityUser?.private_user
      ? `${activityUser.private_user.first_name} ${activityUser.private_user.last_name}`
      : null;

    switch (activity.type) {
      case 'leave': {
        const lt = activity.leave_type
          ? activity.leave_type.charAt(0).toUpperCase() + activity.leave_type.slice(1)
          : t('companyDashboard.actLeaveFallback');
        return {
          color: Palette.warning,
          label: t('companyDashboard.actLeaveSuffix', { type: lt }),
          detail: name ? `${name} · ${activity.status}` : t('companyDashboard.actStatusOnly', { status: activity.status }),
          route: '/company_dashboard/leaves',
        };
      }
      case 'timelog': {
        const timeStr = activity.start_time
          ? format(new Date(activity.start_time), 'HH:mm')
          : '';
        const duration =
          activity.end_time && activity.start_time
            ? (() => {
                const diff = Math.round(
                  (new Date(activity.end_time).getTime() - new Date(activity.start_time).getTime()) / 60000
                );
                const h = Math.floor(diff / 60);
                const m = diff % 60;
                return h > 0 ? `${h}h ${m}m` : `${m}m`;
              })()
            : null;
        return {
          color: Palette.teal,
          label: activity.end_time ? t('companyDashboard.actClockedOut') : t('companyDashboard.actClockedIn'),
          detail: name
            ? `${name}${timeStr ? ' · ' + timeStr : ''}${duration ? ' · ' + duration : ''}`
            : activity.end_time
            ? t('companyDashboard.actSessionEnded')
            : t('companyDashboard.actAtTime', { time: timeStr }),
          route: '/company_dashboard/time_logs',
        };
      }
      case 'overtime':
        return {
          color: Palette.gold,
          label: t('companyDashboard.actOvertime'),
          detail: name ? t('companyDashboard.actOvertimeFlaggedBy', { name }) : t('companyDashboard.actOvertimeFlagged'),
          route: '/company_dashboard/time_logs',
        };
      case 'schedule_complete':
        return {
          color: Palette.blue,
          label: t('companyDashboard.actShiftDone'),
          detail: activity.title || t('companyDashboard.actWorkCompleted'),
          route: '/company_dashboard/schedule',
        };
      default:
        return { color: Palette.gray500, label: t('companyDashboard.actActivity'), detail: '', route: '/company_dashboard/home' };
    }
  }

  const totalCount = filteredActivity.length;

  return (
    <LinearGradient colors={[Palette.gray50, Palette.gray100, Palette.white]} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>

        {/* Header */}
        <Box zIndex={50} overflow="hidden" borderBottomLeftRadius={24} borderBottomRightRadius={24}>
          <BlurView intensity={Platform.OS === 'ios' ? 80 : 0} tint="light" style={{ width: '100%' }}>
            <Box
              bg={Platform.OS === 'android' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)'}
              px="$5" pt="$3" pb="$4"
            >
              <HStack justifyContent="space-between" alignItems="center">
                <HStack alignItems="center" space="sm">
                  <Pressable
                    onPress={() => router.back()}
                    style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                  >
                    <Box w={36} h={36} rounded="$full" bg={Palette.gray100} alignItems="center" justifyContent="center">
                      <MaterialIcons name="arrow-back" size={20} color={Palette.gray700} />
                    </Box>
                  </Pressable>
                  <VStack>
                    <Text fontSize={Type.h2} fontWeight="800" color={Palette.ink} letterSpacing={-0.5}>{t('companyDashboard.activityTitle')}</Text>
                    <Text fontSize={Type.small} color={Palette.gray400} fontWeight="500">
                      {t('companyDashboard.activityRecords', { count: totalCount })}
                    </Text>
                  </VStack>
                </HStack>

                <Pressable onPress={onRefresh} opacity={refreshing ? 0.5 : 1}>
                  <Box w={36} h={36} rounded="$full" bg={Palette.gray100} alignItems="center" justifyContent="center">
                    <MaterialIcons name="refresh" size={20} color={Palette.gray700} />
                  </Box>
                </Pressable>
              </HStack>
            </Box>
          </BlurView>
        </Box>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Palette.gold} />}
        >
          <VStack space="md" px="$4" pt="$4">

            {/* Search */}
            <Box
              bg={Palette.white}
              rounded="$2xl"
              borderWidth={1}
              borderColor={Palette.gray100}
              shadowColor={Palette.black}
              shadowOffset={{ width: 0, height: 2 }}
              shadowOpacity={0.04}
              shadowRadius={8}
              elevation={2}
            >
              <Input variant={"unstyled" as any} px="$2">
                <InputSlot pl="$2">
                  <MaterialIcons name="search" size={20} color={Palette.gray400} />
                </InputSlot>
                <InputField
                  placeholder={t('companyDashboard.activitySearchPlaceholder')}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  fontSize={Type.body}
                  color={Palette.ink}
                  placeholderTextColor={Palette.gray400}
                />
                {searchQuery.length > 0 && (
                  <InputSlot pr="$2">
                    <Pressable onPress={() => setSearchQuery('')}>
                      <MaterialIcons name="close" size={16} color={Palette.gray400} />
                    </Pressable>
                  </InputSlot>
                )}
              </Input>
            </Box>

            {/* Type filter */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 2 }}>
              <HStack space="xs">
                {TYPE_FILTERS.map(({ key, color }) => {
                  const active = typeFilter === key;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setTypeFilter(key)}
                      style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
                    >
                      <Box
                        px="$3" py="$2" rounded="$full"
                        bg={active ? color : Palette.white}
                        borderWidth={1}
                        borderColor={active ? color : Palette.gray200}
                        shadowColor={Palette.black}
                        shadowOffset={{ width: 0, height: 1 }}
                        shadowOpacity={active ? 0 : 0.04}
                        elevation={active ? 0 : 1}
                      >
                        <Text fontSize={Type.label} fontWeight="700" color={active ? Palette.white : Palette.gray500}>
                          {typeFilterLabel(key)}
                        </Text>
                      </Box>
                    </Pressable>
                  );
                })}
              </HStack>
            </ScrollView>

            {/* Date filter */}
            <Box bg={Palette.gray100} p="$0.5" rounded="$xl">
              <HStack>
                {DATE_FILTERS.map(({ key }) => {
                  const active = dateFilter === key;
                  return (
                    <Pressable
                      key={key}
                      flex={1}
                      onPress={() => setDateFilter(key)}
                      py="$2"
                      rounded="$lg"
                      bg={active ? Palette.ink : 'transparent'}
                      alignItems="center"
                      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
                    >
                      <Text
                        fontSize={Type.caption}
                        fontWeight={active ? '700' : '500'}
                        color={active ? Palette.white : Palette.gray500}
                      >
                        {dateFilterLabel(key)}
                      </Text>
                    </Pressable>
                  );
                })}
              </HStack>
            </Box>

            {/* Content */}
            {loading ? (
              <Box py="$16" alignItems="center">
                <Spinner size="large" color={Palette.gold} />
                <Text color={Palette.gray700} fontSize={Type.title} mt="$3">{t('companyDashboard.activityLoading')}</Text>
              </Box>
            ) : grouped.length === 0 ? (
              <Box py="$16" alignItems="center">
                <Box bg={Palette.gray100} p="$6" rounded="$full" mb="$4">
                  <MaterialIcons name="event-note" size={40} color={Palette.gray300} />
                </Box>
                <Text color={Palette.ink} fontSize={Type.h3} fontWeight="700">{t('companyDashboard.activityNothingHere')}</Text>
                <Text color={Palette.gray500} fontSize={Type.label} mt="$1">{t('companyDashboard.activityAdjustFilters')}</Text>
              </Box>
            ) : (
              grouped.map((group, gi) => (
                <VStack key={gi} space="xs">
                  {/* Date group header */}
                  <Text
                    fontSize={Type.small}
                    fontWeight="700"
                    color={Palette.gray400}
                    letterSpacing={0.5}
                    textTransform="uppercase"
                    px="$1"
                    mt={gi > 0 ? '$3' : '$0'}
                  >
                    {group.label}
                  </Text>

                  {group.items.map((activity: any, i: number) => {
                    const cfg = buildConfig(activity);
                    const timeLabel = format(activity.timestamp, 'HH:mm');

                    return (
                      <Animated.View key={`${gi}-${i}`} entering={FadeInDown.duration(300).delay(i * 50)}>
                        <Pressable onPress={() => router.push(cfg.route as any)}>
                          <Box
                            bg={Palette.white}
                            rounded={18}
                            overflow="hidden"
                            borderWidth={1}
                            borderColor={Palette.gray100}
                            shadowColor={Palette.black}
                            shadowOffset={{ width: 0, height: 2 }}
                            shadowOpacity={0.04}
                            shadowRadius={8}
                            elevation={2}
                          >
                            <HStack>
                              <Box w={3} bg={cfg.color} />
                              <HStack flex={1} px="$3" py="$3" alignItems="center" space="sm">
                                <Box
                                  w={36}
                                  h={36}
                                  rounded="$full"
                                  alignItems="center"
                                  justifyContent="center"
                                  style={{ backgroundColor: `${cfg.color}18` }}
                                >
                                  <MaterialIcons
                                    name={
                                      activity.type === 'leave'
                                        ? 'event-note'
                                        : activity.type === 'timelog'
                                        ? 'timer'
                                        : activity.type === 'overtime'
                                        ? 'schedule'
                                        : 'task-alt'
                                    }
                                    size={18}
                                    color={cfg.color}
                                  />
                                </Box>
                                <VStack flex={1} space={"$0.5" as any}>
                                  <HStack justifyContent="space-between" alignItems="center">
                                    <Text fontSize={Type.body} fontWeight="700" color={Palette.ink}>{cfg.label}</Text>
                                    <Text fontSize={Type.caption} color={Palette.gray400}>{timeLabel}</Text>
                                  </HStack>
                                  <Text fontSize={Type.small} color={Palette.gray500} numberOfLines={1}>{cfg.detail}</Text>
                                </VStack>
                                <MaterialIcons name="chevron-right" size={16} color={Palette.gray300} />
                              </HStack>
                            </HStack>
                          </Box>
                        </Pressable>
                      </Animated.View>
                    );
                  })}
                </VStack>
              ))
            )}
          </VStack>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}
