import { Palette, Type } from '@/app/constants/theme';
import {
  DashboardData,
  getJobsByCompany,
  getLeaveRequestsByCompany,
  getTimeLogsByCompany,
  getUsersByCompany,
  getCompanyDashboardStats,
  getSchedulesByCompany,
  getUserNotifications,
  isApiError,
  Job,
  Leave,
  Schedule,
  TimeLog,
  User
} from '@/services/api';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Box,
  Heading,
  HStack,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalContent,
  Pressable,
  Progress,
  ProgressFilledTrack,
  ScrollView,
  Spinner,
  Text,
  VStack,
  RefreshControl,
  Avatar,
  AvatarFallbackText,
  Badge,
  BadgeText
} from '@gluestack-ui/themed';
import { format } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import Animated, {
  FadeInDown,
  FadeInUp,
  FadeInRight,
  SlideInRight,
  ZoomIn
} from '@/app/utils/animated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle as SvgCircle } from 'react-native-svg';
import { BlurView } from 'expo-blur';
import { Platform, View } from 'react-native';
import useAuth from '../hooks/useAuth';
import { qualifiesForModeChoice, setEntryMode } from '@/services/entryMode';
import { hasCompanyPermission } from '@/services/permissions';
import { useTranslation } from 'react-i18next';
// Payroll imports removed


// Coordinated brand palette for categories (gold/teal/indigo/green/bronze)
const departmentUI = {
  Operations: { color: Palette.gold, icon: 'build', gradient: [Palette.goldTint, Palette.gold] },
  Administration: { color: Palette.teal, icon: 'business', gradient: [Palette.tealTint, Palette.teal] },
  Security: { color: Palette.blue, icon: 'security', gradient: [Palette.blueTint, Palette.blue] },
  Maintenance: { color: Palette.violet, icon: 'handyman', gradient: [Palette.violetTint, Palette.violet] },
  Cleaning: { color: Palette.green, icon: 'cleaning-services', gradient: [Palette.green, Palette.success] },
};

const leaveUI = {
  bereavement: { color: Palette.gray500, icon: 'sentiment-very-dissatisfied', gradient: [Palette.gray500, Palette.gray400] },
  holiday: { color: Palette.green, icon: 'beach-access', gradient: [Palette.green, Palette.success] },
  sick: { color: Palette.error, icon: 'local-hospital', gradient: [Palette.error, Palette.errorAlt] },
  wedding: { color: Palette.gold, icon: 'favorite', gradient: [Palette.goldTint, Palette.gold] },
  personal: { color: Palette.teal, icon: 'person', gradient: [Palette.tealTint, Palette.teal] },
};

const kpiCards = [
  {
    id: 'active',
    title: 'Workforce Live',
    icon: 'people',
    route: null,
    action: 'showModal',
    colors: [Palette.green, Palette.success] as const,
    getValue: (stats: any) => stats.clockedInEmployees,
    getSubtitle: (stats: any) => `${stats.totalEmployees} total staff`
  },
  {
    id: 'scheduled',
    title: "Today's Roster",
    icon: 'assignment-ind',
    route: '/company_dashboard/schedule',
    action: null,
    colors: [Palette.tealTint, Palette.teal] as const,
    getValue: (stats: any) => stats.scheduledEmployees,
    getSubtitle: (stats: any) => `${stats.todaySchedules?.length || 0} active shifts`
  },
  {
    id: 'pending',
    title: 'Leave Requests',
    icon: 'pending-actions',
    route: '/company_dashboard/leaves',
    colors: [Palette.goldTint, Palette.gold] as const,
    getValue: (stats: any) => stats.pendingLeaves,
    getSubtitle: () => 'Awaiting approval'
  },
  {
    id: 'utilization',
    title: 'Total Workforce Hours',
    icon: 'trending-up',
    route: '/company_dashboard/salaries',
    colors: [Palette.blueTint, Palette.blue] as const,
    getValue: (stats: any) => `${stats.totalWorkHours}h`,
    getSubtitle: (stats: any) => `Total for this ${stats.selectedPeriod || 'period'}`
  }
];

// labels resolved via t() at render time so they switch with the user's language.
const quickActions = [
  { id: 'shift',   labelKey: 'companyHome.actionNewShift',     icon: 'add-circle-outline', color: Palette.gold, route: '/company_dashboard/schedule' },
  { id: 'docs',    labelKey: 'companyHome.actionHrDocs',       icon: 'folder-shared',      color: Palette.teal, route: '/company_dashboard/documents' },
  { id: 'leave',   labelKey: 'companyHome.actionReviewLeaves', icon: 'event-note',         color: Palette.blue, route: '/company_dashboard/leaves' },
  { id: 'project', labelKey: 'companyHome.actionActiveJobs',   icon: 'business-center',    color: Palette.violet, route: '/company_dashboard/schedule' },
  { id: 'report',  labelKey: 'companyHome.actionReports',      icon: 'assessment',         color: Palette.green, route: '/company_dashboard/salaries' },
] as const;


/**
 * Circular progress ring, drawn with react-native-svg (New-Architecture native)
 * — replaces the unmaintained react-native-progress Circle. Renders a track
 * plus a foreground arc starting at 12 o'clock. The % label is overlaid by the
 * caller, so showsText isn't needed.
 */
function UtilizationRing({
  size,
  progress,
  thickness,
  color,
  unfilledColor,
}: {
  size: number;
  progress: number;
  thickness: number;
  color: string;
  unfilledColor: string;
}) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.min(1, Math.max(0, progress));
  const c = size / 2;
  return (
    <Svg width={size} height={size}>
      <SvgCircle cx={c} cy={c} r={radius} stroke={unfilledColor} strokeWidth={thickness} fill="none" />
      <SvgCircle
        cx={c}
        cy={c}
        r={radius}
        stroke={color}
        strokeWidth={thickness}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${circumference * clamped} ${circumference}`}
        transform={`rotate(-90 ${c} ${c})`}
      />
    </Svg>
  );
}


const HomeScreen = () => {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const router = useRouter();
  const { t } = useTranslation();

  // Enhanced state management
  const [selectedPeriod, setSelectedPeriod] = useState('Monthly');
  const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());
  const [showClockedInModal, setShowClockedInModal] = useState(false);
  const [showScheduledModal, setShowScheduledModal] = useState(false);
  const [activityTypeFilter, setActivityTypeFilter] = useState<'all' | 'leave' | 'timelog' | 'overtime' | 'schedule_complete'>('all');

  // Real data state
  const [data, setData] = useState<DashboardData | null>(null);
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [allTimeLogs, setAllTimeLogs] = useState<TimeLog[]>([]);
  const [allJobs, setAllJobs] = useState<Job[]>([]);
  const [allLeaves, setAllLeaves] = useState<Leave[]>([]);
  const [allSchedules, setAllSchedules] = useState<Schedule[]>([]);
  // allFormulas state removed

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);

  const retryWithExponentialBackoff = useCallback(async (fn: () => Promise<any>, retries = 3, delay = 1000) => {
    try {
      return await fn();
    } catch (error) {
      if (retries > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
        return retryWithExponentialBackoff(fn, retries - 1, delay * 2);
      }
      throw error;
    }
  }, []);

  const fetchAllData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      console.log('🚀 Fetching comprehensive company dashboard data...');

      const companyId = user?.company?.company_id ||
        (user?.company as any)?.id ||
        (user as any)?.company_id ||
        (user?.private_user as any)?.company_id;

      if (!companyId) {
        console.warn('No company ID found, some data may be missing');
      }

      // Permission-gate each fetch so a delegated role (e.g. an HR Manager with
      // zero perms by default) doesn't spam 403s. Owners/admins pass implicitly.
      // Each call is skipped — and its state left empty — when the role lacks
      // the matching permission, mirroring the web's role guides.
      const canViewAttendance = hasCompanyPermission(user, 'view_attendance');
      const canViewEmployee = hasCompanyPermission(user, 'view_employee');
      const canViewLeave = hasCompanyPermission(user, 'view_leave');
      const canViewSchedule = hasCompanyPermission(user, 'view_schedule');

      // 1. Fetch all data using settled promises for resilience
      const [criticalResults, supplementaryResults] = await Promise.all([
        Promise.allSettled([
          canViewAttendance ? retryWithExponentialBackoff(() => getCompanyDashboardStats()) : Promise.resolve(undefined),
          canViewEmployee && companyId ? retryWithExponentialBackoff(() => getUsersByCompany(companyId)) : Promise.resolve([])
        ]),
        Promise.allSettled([
          canViewAttendance && companyId ? retryWithExponentialBackoff(() => getTimeLogsByCompany(companyId)) : Promise.resolve([]),
          canViewEmployee && companyId ? retryWithExponentialBackoff(() => getJobsByCompany(companyId)) : Promise.resolve([]),
          canViewLeave && companyId ? retryWithExponentialBackoff(() => getLeaveRequestsByCompany(companyId)) : Promise.resolve([]),
          canViewSchedule && companyId ? retryWithExponentialBackoff(() => getSchedulesByCompany(companyId)) : Promise.resolve([])
        ])

      ]);

      const [dashboardStatsResponse, usersResponse] = criticalResults;
      const [timeLogsResponse, jobsResponse, leavesResponse, schedulesResponse] = supplementaryResults;


      // Process critical responses first (value is undefined when attendance
      // was gated out for this role — leave the stats state untouched then).
      if (dashboardStatsResponse.status === 'fulfilled' && dashboardStatsResponse.value !== undefined && !isApiError(dashboardStatsResponse.value)) {
        setData(dashboardStatsResponse.value as DashboardData);
        console.log('✅ Dashboard stats loaded');
      }

      if (usersResponse.status === 'fulfilled' && !isApiError(usersResponse.value)) {
        setAllUsers(usersResponse.value as User[]);
        console.log('✅ Users loaded:', (usersResponse.value as User[]).length);
      }

      // Process supplementary data
      if (timeLogsResponse.status === 'fulfilled' && !isApiError(timeLogsResponse.value)) {
        setAllTimeLogs(timeLogsResponse.value as TimeLog[]);
      }

      if (jobsResponse.status === 'fulfilled' && !isApiError(jobsResponse.value)) {
        setAllJobs(jobsResponse.value as Job[]);
      }

      if (leavesResponse.status === 'fulfilled' && !isApiError(leavesResponse.value)) {
        setAllLeaves(leavesResponse.value as Leave[]);
      }

      if (schedulesResponse.status === 'fulfilled' && !isApiError(schedulesResponse.value)) {
        setAllSchedules(schedulesResponse.value as Schedule[]);
      }


      setLastRefreshTime(new Date());
      console.log('🎯 Company dashboard data loading complete');

    } catch (e: any) {
      console.error('💥 Critical error loading company dashboard:', e);
      setError('Failed to load dashboard data. Please check your connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [user, retryWithExponentialBackoff]);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  useFocusEffect(
    useCallback(() => {
      getUserNotifications().then(result => {
        if (Array.isArray(result)) {
          setUnreadNotificationCount(result.filter(n => !n.is_read).length);
        }
      });
    }, [])
  );

  // Update badge in real time when a push arrives while app is foregrounded
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener(() => {
      getUserNotifications().then(result => {
        if (Array.isArray(result)) {
          setUnreadNotificationCount(result.filter(n => !n.is_read).length);
        }
      });
    });
    return () => sub.remove();
  }, []);

  // O(1) user lookup by private_user_id — avoids per-item allUsers.find()
  // in the activity feed (every render) and the stats memo.
  const usersById = useMemo(() => {
    const m = new Map<any, any>();
    allUsers.forEach((u: any) => {
      const id = u?.private_user?.private_user_id;
      if (id != null) m.set(id, u);
    });
    return m;
  }, [allUsers]);

  // Calculate comprehensive real-time stats with memoization for performance
  const getRealTimeStats = useMemo(() => {
    const now = new Date();

    // Filter data based on selected period
    const getDateThreshold = () => {
      switch (selectedPeriod) {
        case 'Daily': {
          const d = new Date(now);
          d.setHours(0, 0, 0, 0);
          return d;
        }
        case 'Weekly': {
          const d = new Date(now);
          d.setDate(d.getDate() - d.getDay()); // start of current week (Sunday)
          d.setHours(0, 0, 0, 0);
          return d;
        }
        case 'Monthly': {
          const d = new Date(now.getFullYear(), now.getMonth(), 1); // 1st of current month
          return d;
        }
        case 'Yearly': {
          const d = new Date(now.getFullYear(), 0, 1); // Jan 1 of current year
          return d;
        }
        default: {
          const d = new Date(now.getFullYear(), now.getMonth(), 1);
          return d;
        }
      }
    };

    const threshold = getDateThreshold();

    // Real clocked in employees (active time logs without end_time)
    const activeTimeLogs = allTimeLogs.filter(log => {
      if (!log.start_time || log.end_time) return false;

      // Check if the time log is from today or recent (within last 24 hours)
      const logDate = new Date(log.start_time);
      const now = new Date();
      const timeDiff = now.getTime() - logDate.getTime();
      const hoursDiff = timeDiff / (1000 * 3600);

      // Only consider logs from last 24 hours as active
      return hoursDiff <= 24;
    });

    const clockedInEmployees = activeTimeLogs.length;

    // Get actual users who are clocked in with their details
    const clockedInUsers = activeTimeLogs.map(log => {
      const user = usersById.get(log.private_user_id);
      return {
        ...user,
        timeLog: log,
        startTime: new Date(log.start_time)
      };
    }).filter(Boolean);

    // Time logs in selected period
    const periodTimeLogs = allTimeLogs.filter(log => {
      const logDate = new Date(log.start_time);
      return logDate >= threshold;
    });

    // Recent Leave Requests (last 3)
    const recentLeaves = allLeaves
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 3);

    // Leaves in selected period
    const periodLeaves = allLeaves.filter(leave => {
      const leaveDate = new Date(leave.created_at);
      const startDate = new Date(leave.start_date);
      return leaveDate >= threshold || startDate >= threshold;
    });

    // Leave stats breakdown
    const leaveStats = periodLeaves.reduce((acc, leave) => {
      const type = leave.leave_type;
      if (!acc[type]) acc[type] = { total: 0, pending: 0, approved: 0, rejected: 0 };
      acc[type].total++;
      if (acc[type][leave.status as 'pending' | 'approved' | 'rejected'] !== undefined) {
        acc[type][leave.status as 'pending' | 'approved' | 'rejected']++;
      }
      return acc;
    }, {} as Record<string, { total: number, pending: number, approved: number, rejected: number }>);

    // Today's schedules
    const today = new Date();
    const todaySchedules = allSchedules.filter(s => {
      if (!s.start_time) return false;
      const start = new Date(s.start_time);
      const isToday = start.toDateString() === today.toDateString();
      return isToday;
    }).sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

    const scheduledEmployeeIds = new Set<string>();
    todaySchedules.forEach(s => {
      s.assigned_employees?.forEach((emp: any) => {
        if (emp.private_user_id) scheduledEmployeeIds.add(emp.private_user_id);
      });
    });
    const scheduledEmployees = scheduledEmployeeIds.size;

    const companyEmployees = allUsers;
    // Active jobs = approved verification_status (Job model has no status field)
    const companyJobs = allJobs.filter(j => (j as any).verification_status === 'approved');

    // Unified Activity Feed (Last 5 items of different types)
    const unifiedActivity = [
      ...allLeaves.map(l => ({ ...l, type: 'leave', timestamp: new Date(l.created_at) })),
      ...allTimeLogs.filter(t => t.start_time && !t.is_overtime).map(t => ({ ...t, type: 'timelog', timestamp: new Date(t.start_time) })),
      ...allTimeLogs.filter(t => t.is_overtime && t.marked_as_overtime_at).map(t => ({ ...t, type: 'overtime', timestamp: new Date(t.marked_as_overtime_at!) })),
      ...allSchedules.filter(s => s.status === 'completed').map(s => ({ ...s, type: 'schedule_complete', timestamp: new Date(s.updated_at || s.end_time) }))
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 5);

    // 7-day attendance trend (distinct staff clocked in per day)
    const weeklyAttendance = (() => {
      const now = new Date();
      const dayLetters = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
      const out: { label: string; count: number; isToday: boolean }[] = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        d.setHours(0, 0, 0, 0);
        const next = new Date(d);
        next.setDate(d.getDate() + 1);
        const ids = new Set<string>();
        allTimeLogs.forEach(log => {
          if (!log.start_time) return;
          const s = new Date(log.start_time);
          if (s >= d && s < next && log.private_user_id) ids.add(String(log.private_user_id));
        });
        out.push({ label: dayLetters[d.getDay()], count: ids.size, isToday: i === 0 });
      }
      return out;
    })();

    return {
      totalEmployees: companyEmployees.length,
      clockedInEmployees,
      clockedInUsers,
      weeklyAttendance,
      scheduledEmployees,
      scheduledEmployeeIds: Array.from(scheduledEmployeeIds),
      todaySchedules,
      activeTimeLogs: activeTimeLogs.length,
      periodTimeLogs: periodTimeLogs.length,
      totalJobs: companyJobs.length,
      pendingLeaves: periodLeaves.filter(l => l.status === 'pending').length,
      approvedLeaves: periodLeaves.filter(l => l.status === 'approved').length,
      rejectedLeaves: periodLeaves.filter(l => l.status === 'rejected').length,
      leaveStats,
      recentLeaves,
      unifiedActivity,
      workforceUtilization: companyEmployees.length > 0 ?
        Math.round((clockedInEmployees / companyEmployees.length) * 100) : 0,
      scheduleAdherence: scheduledEmployees > 0 ?
        Math.round((clockedInEmployees / scheduledEmployees) * 100) : 100,
      departmentStats: companyEmployees.reduce((acc, user) => {
        const dept = (user.private_user as any)?.department?.name || (user.private_user as any)?.department || '—';
        acc[dept] = (acc[dept] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      totalLeaveRequests: periodLeaves.length,
      leaveApprovalRate: periodLeaves.length > 0 ?
        Math.round((periodLeaves.filter(l => l.status === 'approved').length / periodLeaves.length) * 100) : 0,
      
      totalWorkHours: periodTimeLogs.reduce((acc, log) => {
        // Only count completed sessions (end_time set) — open/zombie sessions skew the total
        if (!log.end_time) return acc;
        // Use stored hours_worked (already has breaks deducted, set by backend on clock-out)
        if (log.hours_worked != null) {
          const h = parseFloat(String(log.hours_worked));
          // Cap at 24h — anything longer is almost certainly a missed clock-out (test/zombie data)
          return acc + (isNaN(h) ? 0 : Math.min(h, 24));
        }
        // Fallback: calculate from timestamps for legacy records missing hours_worked
        const start = new Date(log.start_time).getTime();
        const end = new Date(log.end_time).getTime();
        let hours = (end - start) / (1000 * 60 * 60);
        if (log.breaks && log.breaks.length > 0) {
          const breakHours = log.breaks.reduce((bAcc, b) => {
            if (!b.start_time || !b.end_time) return bAcc;
            return bAcc + (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / (1000 * 60 * 60);
          }, 0);
          hours = Math.max(0, hours - breakHours);
        }
        return acc + (isNaN(hours) ? 0 : Math.min(hours, 24));
      }, 0),
      totalGrossPay: 0,


      selectedPeriod,
      totalSchedules: allSchedules.length,
      todayCompletedSchedules: todaySchedules.filter(s => s.status === 'completed').length,
      employeesByDepartment: companyEmployees.reduce((acc, user) => {
        const dept = (user.private_user as any)?.department?.name || (user.private_user as any)?.department || '—';
        if (!acc[dept]) acc[dept] = [];
        acc[dept].push({
          name: `${user.private_user?.first_name || ''} ${user.private_user?.last_name || ''}`.trim(),
          email: user.email,
          private_user_id: user.private_user?.private_user_id
        });
        return acc;
      }, {} as Record<string, any[]>)
    };
  }, [usersById, allUsers, allTimeLogs, allJobs, allLeaves, allSchedules, selectedPeriod, user]);


  const realTimeStats = getRealTimeStats;

  // Helper for initials
  const getInitials = (name?: string) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Helper for greeting
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('companyHome.greetingMorning');
    if (hour < 18) return t('companyHome.greetingAfternoon');
    return t('companyHome.greetingEvening');
  };

  if (isLoading || !user) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
        <LinearGradient
          colors={[Palette.white, Palette.gray50, Palette.gray100]}
          style={{ flex: 1 }}
        >
          <Box flex={1} justifyContent="center" alignItems="center" px="$6">
            <Animated.View entering={ZoomIn.duration(800)}>
              <VStack space="lg" alignItems="center">
                <Spinner size="large" color={Palette.gold} />
                <Text color={Palette.gray700} fontSize={Type.title} fontWeight="600" textAlign="center">
                  {t('companyHome.loadingDashboard')}
                </Text>
              </VStack>
            </Animated.View>
          </Box>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <LinearGradient
        colors={[Palette.white, Palette.gray50, Palette.gray100]}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
        {/* Header */}
        <Box zIndex={50} overflow="hidden" borderBottomLeftRadius="$3xl" borderBottomRightRadius="$3xl">
          <BlurView intensity={Platform.OS === 'ios' ? 80 : 0} tint="light" style={{ width: '100%' }}>
            <Box bg={Platform.OS === 'android' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)'} px="$5" pt="$3" pb="$4">
              <HStack justifyContent="space-between" alignItems="flex-start">
                <VStack space="xs">
                  <Text fontSize={Type.caption} fontWeight="500" color={Palette.gray400}>
                    {getGreeting()}
                  </Text>
                  <Text fontSize={Type.h2} fontWeight="800" color={Palette.ink} letterSpacing={-0.5} numberOfLines={1}>
                    {/* Owner → user.company; delegated role-holder → private_user.company;
                        else fall back to the person's own name (not 'Dashboard'). */}
                    {user?.company?.company_name
                      || (user as any)?.private_user?.company?.company_name
                      || (user as any)?.private_user?.first_name
                      || user?.first_name
                      || 'Dashboard'}
                  </Text>
                  <HStack alignItems="center" space="xs" mt="$0.5">
                    <Box bg="rgba(242,183,5,0.12)" px="$2" py="$0.5" rounded="$md">
                      <Text fontSize={Type.tiny} fontWeight="700" color={Palette.gold} letterSpacing={0.5}>
                        {format(new Date(), 'EEE, MMM d').toUpperCase()}
                      </Text>
                    </Box>
                    {(user?.company?.brn || (user as any)?.private_user?.company?.brn) ? (
                      <Text fontSize={Type.tiny} color={Palette.gray400} fontWeight="500">BRN {user?.company?.brn || (user as any)?.private_user?.company?.brn}</Text>
                    ) : null}
                  </HStack>
                </VStack>

                <HStack alignItems="center" space="xs" mt="$1">
                  <Pressable onPress={() => router.push('/company_dashboard/notifications')}>
                    <Box position="relative" p="$1.5">
                      <MaterialIcons name="notifications-none" size={24} color={Palette.gray700} />
                      {unreadNotificationCount > 0 && (
                        <Box
                          position="absolute"
                          top={2}
                          right={2}
                          w={14}
                          h={14}
                          rounded="$full"
                          bg={Palette.gold}
                          justifyContent="center"
                          alignItems="center"
                        >
                          <Text fontSize={Type.tiny} fontWeight="800" color="white">
                            {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                          </Text>
                        </Box>
                      )}
                    </Box>
                  </Pressable>

                  {/* Avatar → account menu (switch / settings / log out). Keeps the
                      header to just notification + avatar. */}
                  <Pressable accessibilityLabel="Account menu" onPress={() => setMenuOpen(true)}>
                    <Box
                      p="$0.5"
                      rounded="$full"
                      borderWidth={2}
                      borderColor="rgba(242, 183, 5, 0.15)"
                      bg="white"
                    >
                      <Avatar size="sm" bgColor={Palette.indigo}>
                        <AvatarFallbackText>{getInitials(user?.first_name || user?.private_user?.first_name)}</AvatarFallbackText>
                      </Avatar>
                    </Box>
                  </Pressable>
                </HStack>
              </HStack>
            </Box>
          </BlurView>
        </Box>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
          style={{ flex: 1 }}
          decelerationRate="fast"
          overScrollMode="never"
          refreshControl={
            <RefreshControl refreshing={isLoading} onRefresh={fetchAllData} tintColor={Palette.gold} />
          }
        >
          {error && (
            <Box p="$6">
              <Animated.View entering={SlideInRight.duration(500)}>
                <Box
                  bg="rgba(239, 68, 68, 0.1)"
                  p="$6"
                  rounded="$2xl"
                  borderWidth={1}
                  borderColor="rgba(239, 68, 68, 0.3)"
                  alignItems="center"
                >
                  <MaterialIcons name="error-outline" size={48} color={Palette.error} />
                  <Text color={Palette.error} fontWeight="700" mt="$3" fontSize={Type.h3}>
                    {t('companyHome.connectionError')}
                  </Text>
                  <Text color={Palette.gray700} textAlign="center" mt="$2" fontSize={Type.body}>
                    {error}
                  </Text>
                  <Pressable onPress={fetchAllData} mt="$4">
                    <Box
                      bg={Palette.gold}
                      px="$6"
                      py="$3"
                      rounded="$lg"
                      borderWidth={1}
                      borderColor="rgba(242, 183, 5, 0.3)"
                    >
                      <Text color="white" fontWeight="600">
                        {t('companyHome.tryAgain')}
                      </Text>
                    </Box>
                  </Pressable>
                </Box>
              </Animated.View>
            </Box>
          )}

          {/* Company info absorbed into header */}

          {!error && (allUsers.length > 0 || data) && (
            <Box px="$6" mt="$6">
              <Animated.View entering={FadeInUp.duration(700).delay(200)}>
                <VStack space="md">

                  {/* Overview heading + inline period switcher */}
                  <VStack space="xs" mt="$2">
                    <HStack justifyContent="space-between" alignItems="center">
                      <VStack>
                        <Text fontSize={Type.h2} fontWeight="800" color={Palette.ink} letterSpacing={-0.5}>{t('companyHome.overview')}</Text>
                        <Text fontSize={Type.caption} color={Palette.gray400} fontWeight="500">
                          {selectedPeriod === 'Daily' && format(new Date(), 'MMM d, yyyy')}
                          {selectedPeriod === 'Weekly' && (() => {
                            const now = new Date();
                            const start = new Date(now);
                            start.setDate(now.getDate() - now.getDay());
                            const end = new Date(start);
                            end.setDate(start.getDate() + 6);
                            return `${format(start, 'MMM d')} – ${format(end, 'MMM d, yyyy')}`;
                          })()}
                          {selectedPeriod === 'Monthly' && format(new Date(), 'MMMM yyyy')}
                          {selectedPeriod === 'Yearly' && format(new Date(), 'yyyy')}
                        </Text>
                      </VStack>
                      <Box bg={Palette.gray100} p="$0.5" rounded="$xl">
                        <HStack>
                          {['Daily', 'Weekly', 'Monthly', 'Yearly'].map((period) => (
                            <Pressable
                              key={period}
                              onPress={() => setSelectedPeriod(period)}
                              px="$2.5"
                              py="$1.5"
                              rounded="$lg"
                              bg={selectedPeriod === period ? Palette.ink : 'transparent'}
                              style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
                            >
                              <Text
                                fontSize={Type.caption}
                                fontWeight={selectedPeriod === period ? '700' : '500'}
                                color={selectedPeriod === period ? 'white' : Palette.gray500}
                              >
                                {period === 'Yearly' ? 'Year' : period}
                              </Text>
                            </Pressable>
                          ))}
                        </HStack>
                      </Box>
                    </HStack>
                  </VStack>

                  {/* Quick Actions — compact pill chips */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
                    <HStack space="sm">
                      {quickActions.map((action) => (
                        <Pressable
                          key={action.id}
                          onPress={() => router.push(action.route as any)}
                          style={({ pressed }) => ({
                            opacity: pressed ? 0.75 : 1,
                            transform: [{ scale: pressed ? 0.97 : 1 }]
                          })}
                        >
                          <HStack
                            space="xs"
                            alignItems="center"
                            bg="white"
                            px="$3"
                            py="$2"
                            rounded="$full"
                            borderWidth={1}
                            borderColor={Palette.gray100}
                            shadowColor={Palette.black}
                            shadowOffset={{ width: 0, height: 1 }}
                            shadowOpacity={0.06}
                            shadowRadius={4}
                            elevation={1}
                          >
                            <Box
                              w={24}
                              h={24}
                              rounded="$full"
                              alignItems="center"
                              justifyContent="center"
                              style={{ backgroundColor: `${action.color}20` }}
                            >
                              <MaterialIcons name={action.icon as any} size={13} color={action.color} />
                            </Box>
                            <Text fontSize={Type.label} fontWeight="600" color={Palette.gray700}>{t(action.labelKey)}</Text>
                          </HStack>
                        </Pressable>
                      ))}
                    </HStack>
                  </ScrollView>

                      {/* Hero Card: Workforce Live — number + faces on left, utilization ring on right */}
                      <Pressable
                        onPress={() => setShowClockedInModal(true)}
                        style={({ pressed }) => ({
                          opacity: pressed ? 0.9 : 1,
                          transform: [{ scale: pressed ? 0.98 : 1 }]
                        })}
                      >
                        <LinearGradient
                          colors={[Palette.teal, Palette.success]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={{ borderRadius: 22, padding: 16 }}
                        >
                          <HStack justifyContent="space-between" alignItems="center">
                            <VStack flex={1}>
                              <HStack alignItems="center" space="xs">
                                <Box w={7} h={7} rounded="$full" bg={Palette.white} />
                                <Text color="rgba(255,255,255,0.95)" fontSize={Type.label} fontWeight="700" letterSpacing={0.3}>{t('companyHome.workforceLive')}</Text>
                              </HStack>
                              <HStack alignItems="flex-end" space="xs" mt="$1">
                                <Text color={Palette.white} fontSize={Type.hero} fontWeight="800" lineHeight={42} letterSpacing={-1}>{realTimeStats.clockedInEmployees}</Text>
                                <Text color="rgba(255,255,255,0.85)" fontSize={Type.body} fontWeight="600" mb="$2">/ {realTimeStats.totalEmployees} on shift</Text>
                              </HStack>
                              {realTimeStats.clockedInUsers?.length > 0 ? (
                                <HStack mt="$2.5" alignItems="center">
                                  {realTimeStats.clockedInUsers.slice(0, 5).map((u: any, idx: number) => (
                                    <Avatar key={idx} size="xs" bgColor="rgba(255,255,255,0.3)" borderWidth={2} borderColor={Palette.white} ml={idx === 0 ? '$0' : '-$2'}>
                                      <AvatarFallbackText color={Palette.white} fontSize={Type.tiny}>{getInitials(`${u.private_user?.first_name || ''} ${u.private_user?.last_name || ''}`)}</AvatarFallbackText>
                                    </Avatar>
                                  ))}
                                  {realTimeStats.clockedInUsers.length > 5 && (
                                    <Box ml="-$2" w={24} h={24} rounded="$full" bg="rgba(255,255,255,0.25)" borderWidth={2} borderColor={Palette.white} alignItems="center" justifyContent="center">
                                      <Text color={Palette.white} fontSize={Type.tiny} fontWeight="700">+{realTimeStats.clockedInUsers.length - 5}</Text>
                                    </Box>
                                  )}
                                  <Text color="rgba(255,255,255,0.85)" fontSize={Type.small} ml="$2" fontWeight="600">{t('companyHome.viewAll') || 'View all'}</Text>
                                </HStack>
                              ) : (
                                <Text color="rgba(255,255,255,0.8)" fontSize={Type.small} mt="$2">{t('companyHome.noOneClockedIn') || 'No one clocked in yet'}</Text>
                              )}
                            </VStack>
                            {/* Utilization ring */}
                            <VStack alignItems="center" justifyContent="center" ml="$3">
                              <UtilizationRing
                                size={86}
                                progress={Math.min(1, realTimeStats.workforceUtilization / 100)}
                                thickness={7}
                                color={Palette.white}
                                unfilledColor="rgba(255,255,255,0.25)"
                              />
                              <Box position="absolute" alignItems="center">
                                <Text color={Palette.white} fontSize={Type.h2} fontWeight="800" lineHeight={24}>{realTimeStats.workforceUtilization}%</Text>
                                <Text color="rgba(255,255,255,0.8)" fontSize={Type.tiny} fontWeight="600" letterSpacing={0.5}>UTILIZED</Text>
                              </Box>
                            </VStack>
                          </HStack>
                        </LinearGradient>
                      </Pressable>

                      {/* Performance card — hours worked + 7-day attendance, premium dark gradient.
                          Links into salaries, so hide it from roles without payroll access. */}
                      {hasCompanyPermission(user, ['view_salary', 'view_payslip', 'manage_payroll']) && (
                      <Pressable
                        onPress={() => router.push('/company_dashboard/salaries')}
                        style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1, transform: [{ scale: pressed ? 0.99 : 1 }] })}
                      >
                        <LinearGradient
                          colors={[Palette.ink, Palette.indigo]}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={{ borderRadius: 22, padding: 16 }}
                        >
                          <HStack justifyContent="space-between" alignItems="flex-start" mb="$3">
                            <VStack>
                              <Text color="rgba(255,255,255,0.55)" fontSize={Type.caption} fontWeight="700" letterSpacing={0.8}>
                                {(selectedPeriod === 'Yearly' ? t('companyHome.thisYear') : t('companyHome.thisPeriodLower', { period: selectedPeriod.toLowerCase() })).toUpperCase()}
                              </Text>
                              <HStack alignItems="flex-end" space="xs" mt="$1">
                                <Text color={Palette.white} fontSize={Type.display} fontWeight="800" lineHeight={36} letterSpacing={-1}>{realTimeStats.totalWorkHours.toFixed(1)}h</Text>
                                <Text color="rgba(255,255,255,0.6)" fontSize={Type.label} fontWeight="600" mb="$1.5">{t('companyHome.hoursWorked').toLowerCase()}</Text>
                              </HStack>
                            </VStack>
                            <Box bg="rgba(255,255,255,0.12)" px="$2.5" py="$1.5" rounded="$full">
                              <HStack alignItems="center" space="xs">
                                <MaterialIcons name="insights" size={13} color={Palette.gold} />
                                <Text color={Palette.white} fontSize={Type.caption} fontWeight="700">{t('companyHome.attendanceTrend') || '7-day attendance'}</Text>
                              </HStack>
                            </Box>
                          </HStack>
                          {(() => {
                            const data = realTimeStats.weeklyAttendance || [];
                            const max = Math.max(1, ...data.map((d: any) => d.count));
                            return (
                              <HStack justifyContent="space-between" alignItems="flex-end" h={56}>
                                {data.map((d: any, i: number) => (
                                  <VStack key={i} alignItems="center" flex={1} justifyContent="flex-end" h="100%">
                                    {d.count > 0 && (
                                      <Text color={d.isToday ? Palette.gold : 'rgba(255,255,255,0.7)'} fontSize={Type.tiny} fontWeight="700" mb="$0.5">{d.count}</Text>
                                    )}
                                    <Box
                                      w="52%"
                                      style={{
                                        height: Math.max(4, (d.count / max) * 36),
                                        backgroundColor: d.isToday ? Palette.gold : 'rgba(255,255,255,0.22)',
                                        borderRadius: 4,
                                      }}
                                    />
                                    <Text color={d.isToday ? Palette.white : 'rgba(255,255,255,0.5)'} fontSize={Type.tiny} fontWeight={d.isToday ? '800' : '600'} mt="$1.5">{d.label}</Text>
                                  </VStack>
                                ))}
                              </HStack>
                            );
                          })()}
                        </LinearGradient>
                      </Pressable>
                      )}

                      {/* 3-up tinted stat row — equal width, each with a clear meaning */}
                      <HStack space="sm" alignItems="stretch">
                        {[
                          { icon: 'event', color: Palette.blue, tint: Palette.blueTint, value: String(realTimeStats.todaySchedules?.length || 0), label: t('companyHome.statShifts') || 'Shifts', sub: t('companyHome.statShiftsSub') || 'scheduled today', route: '/company_dashboard/schedule' },
                          { icon: 'pending-actions', color: Palette.warning, tint: Palette.warningTint, value: String(realTimeStats.pendingLeaves), label: t('companyHome.statLeaves') || 'Leave', sub: t('companyHome.statLeavesSub') || 'awaiting approval', route: '/company_dashboard/leaves' },
                          { icon: 'work', color: Palette.violet, tint: Palette.violetTint, value: String(realTimeStats.totalJobs), label: t('companyHome.statJobs') || 'Jobs', sub: t('companyHome.statJobsSub') || 'currently active', route: '/company_dashboard/employees' },
                        ].map((c, i) => (
                          <Pressable
                            key={i}
                            onPress={() => router.push(c.route as any)}
                            style={({ pressed }) => ({ flex: 1, opacity: pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }] })}
                          >
                            <Box style={{ flex: 1, backgroundColor: c.tint, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: c.color + '22' }}>
                              <HStack justifyContent="space-between" alignItems="center" mb="$2">
                                <Box style={{ backgroundColor: c.color, borderRadius: 10, padding: 6 }}>
                                  <MaterialIcons name={c.icon as any} size={15} color={Palette.white} />
                                </Box>
                                <Text color={Palette.ink} fontSize={Type.h1} fontWeight="800" letterSpacing={-1}>{c.value}</Text>
                              </HStack>
                              <Text color={Palette.ink} fontSize={Type.label} fontWeight="700" numberOfLines={1}>{c.label}</Text>
                              <Text color={Palette.gray500} fontSize={Type.tiny} fontWeight="500" numberOfLines={1} mt="$0.5">{c.sub}</Text>
                            </Box>
                          </Pressable>
                        ))}
                      </HStack>


                    {/* Department Breakdown - Vertical Progress List */}
                    {Object.keys(realTimeStats.departmentStats).length > 0 && (
                      <VStack space="md" mt="$1" px="$2">
                        <HStack justifyContent="space-between" alignItems="center" mb="$2">
                          <Text fontSize={Type.h3} fontWeight="700" color={Palette.ink}>
                            {t('companyHome.departmentBreakdown')}
                          </Text>
                          <Box bg="rgba(0,0,0,0.05)" px="$2" py="$1" rounded="$sm">
                            <Text fontSize={Type.tiny} color={Palette.gray700} fontWeight="600">
                              {t('companyHome.departmentsCount', { count: Object.keys(realTimeStats.departmentStats).length })}
                            </Text>
                          </Box>
                        </HStack>

                        <Box bg="white" rounded="$2xl" p="$4" borderWidth={1} borderColor="rgba(0,0,0,0.05)">
                          <VStack space="md">
                            {Object.entries(realTimeStats.departmentStats)
                              .sort(([, a], [, b]) => b - a)
                              .map(([dept, count], index) => {
                                const percentage = Math.round((count / realTimeStats.totalEmployees) * 100);
                                const deptConfig = departmentUI[dept as keyof typeof departmentUI] || departmentUI.Operations;

                                return (
                                  <VStack key={dept} space="xs">
                                    <HStack justifyContent="space-between" alignItems="center">
                                      <HStack space="md" alignItems="center">
                                        <Box
                                          bg="rgba(0,0,0,0.06)"
                                          w={32}
                                          h={32}
                                          rounded="$full"
                                          alignItems="center"
                                          justifyContent="center"
                                        >
                                          <MaterialIcons
                                            name={deptConfig.icon as any}
                                            size={16}
                                            color={deptConfig.color}
                                          />
                                        </Box>
                                        <VStack>
                                          <Text fontSize={Type.body} fontWeight="600" color={Palette.ink}>
                                            {dept}
                                          </Text>
                                          <Text fontSize={Type.caption} color={Palette.gray500}>
                                            {count} {count === 1 ? 'staff' : 'staff'}
                                          </Text>
                                        </VStack>
                                      </HStack>
                                      <Text fontSize={Type.small} fontWeight="700" color={deptConfig.color}>
                                        {percentage}%
                                      </Text>
                                    </HStack>
                                    <Progress value={percentage} size="xs" h={4} bg="rgba(0,0,0,0.06)" rounded="$full">
                                      <ProgressFilledTrack bg={deptConfig.color} />
                                    </Progress>
                                  </VStack>
                                );
                              })
                            }
                          </VStack>
                        </Box>
                      </VStack>
                    )}


                    {/* Activity Feed */}
                    <VStack space="md" mt="$5">
                      <HStack justifyContent="space-between" alignItems="center">
                        <Text fontSize={Type.h2} fontWeight="800" color={Palette.ink} letterSpacing={-0.5}>{t('companyHome.activity')}</Text>
                        {hasCompanyPermission(user, 'view_attendance') && (
                        <Pressable onPress={() => router.push('/company_dashboard/clockin_history' as any)}>
                          <Text fontSize={Type.label} fontWeight="600" color={Palette.gold}>{t('companyHome.seeAll')}</Text>
                        </Pressable>
                        )}
                      </HStack>

                      {/* Type filter chips */}
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 2 }}>
                        <HStack space="xs">
                          {([
                            { key: 'all', label: t('companyHome.filterAll'), color: Palette.ink },
                            { key: 'leave', label: t('companyHome.filterLeaves'), color: Palette.warning },
                            { key: 'timelog', label: t('companyHome.filterClockIns'), color: Palette.teal },
                            { key: 'overtime', label: t('companyHome.filterOvertime'), color: Palette.gold },
                            { key: 'schedule_complete', label: t('companyHome.filterShifts'), color: Palette.blue },
                          ] as const).map(({ key, label, color }) => {
                            const active = activityTypeFilter === key;
                            return (
                              <Pressable
                                key={key}
                                onPress={() => setActivityTypeFilter(key)}
                                style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
                              >
                                <Box
                                  px="$3" py="$1.5" rounded="$full"
                                  bg={active ? color : Palette.gray100}
                                  borderWidth={1}
                                  borderColor={active ? color : Palette.gray200}
                                >
                                  <Text
                                    fontSize={Type.small}
                                    fontWeight="700"
                                    color={active ? 'white' : Palette.gray500}
                                  >
                                    {label}
                                  </Text>
                                </Box>
                              </Pressable>
                            );
                          })}
                        </HStack>
                      </ScrollView>

                      {(() => {
                        const filtered = activityTypeFilter === 'all'
                          ? realTimeStats.unifiedActivity
                          : realTimeStats.unifiedActivity.filter((a: any) => a.type === activityTypeFilter);

                        return filtered.length > 0 ? (
                          <VStack space="xs">
                            {filtered.map((activity: any, i: number) => {
                            let config = { icon: 'notifications', color: Palette.gray500, label: t('companyDashboard.actActivity'), detail: '' };
                            
                            const activityUser = usersById.get((activity as any).private_user_id);
                            const activityName = activityUser?.private_user ? `${activityUser.private_user.first_name} ${activityUser.private_user.last_name}` : null;
                            let activityRoute: string = '/company_dashboard/leaves';

                            if (activity.type === 'leave') {
                              activityRoute = '/company_dashboard/leaves';
                              const leaveType = activity.leave_type ? activity.leave_type.charAt(0).toUpperCase() + activity.leave_type.slice(1) : t('companyDashboard.actLeaveFallback');
                              config = {
                                icon: 'event-note',
                                color: Palette.warning,
                                label: t('companyDashboard.actLeaveSuffix', { type: leaveType }),
                                detail: activityName ? `${activityName} · ${activity.status}` : t('companyDashboard.actStatusOnly', { status: activity.status })
                              };
                            } else if (activity.type === 'timelog') {
                              activityRoute = '/company_dashboard/clockin_history';
                              const timeStr = activity.start_time ? format(new Date(activity.start_time), 'HH:mm') : '';
                              config = { 
                                icon: 'timer', 
                                color: Palette.teal, 
                                label: activity.end_time ? t('companyDashboard.actClockedOut') : t('companyDashboard.actClockedIn'),
                                detail: activityName ? `${activityName}${timeStr ? ' · ' + timeStr : ''}` : (activity.end_time ? t('companyDashboard.actSessionEnded') : t('companyDashboard.actAtTime', { time: timeStr }))
                              };
                            } else if (activity.type === 'overtime') {
                              activityRoute = '/company_dashboard/clockin_history';
                              const name = activityName || t('companyDashboard.actAnEmployee');
                              config = {
                                icon: 'schedule',
                                color: Palette.gold,
                                label: t('companyDashboard.actOvertime'),
                                detail: t('companyDashboard.actOvertimeFlaggedBy', { name })
                              };
                            } else if (activity.type === 'schedule_complete') {
                              activityRoute = '/company_dashboard/schedule';
                              config = { 
                                icon: 'task-alt', 
                                color: Palette.blue, 
                                label: t('companyDashboard.actShiftDone'),
                                detail: activity.title || t('companyDashboard.actWorkCompleted')
                              };
                            }

                            const isToday = activity.timestamp.toDateString() === new Date().toDateString();
                            const timeLabel = isToday
                              ? format(activity.timestamp, 'HH:mm')
                              : format(activity.timestamp, 'MMM d, HH:mm');

                            return (
                              <Animated.View key={i} entering={FadeInDown.duration(350).delay(i * 60)}>
                                <Pressable onPress={() => router.push(activityRoute as any)}>
                                  <Box
                                    bg="white"
                                    rounded="$2xl"
                                    overflow="hidden"
                                    mb="$2"
                                    borderWidth={1}
                                    borderColor={Palette.gray100}
                                    shadowColor={Palette.black}
                                    shadowOffset={{ width: 0, height: 1 }}
                                    shadowOpacity={0.04}
                                    shadowRadius={4}
                                    elevation={1}
                                  >
                                    <HStack>
                                      {/* Colored accent bar */}
                                      <Box w={3} bg={config.color} />
                                      <HStack flex={1} px="$3" py="$3" space="sm" alignItems="center">
                                        <VStack flex={1} space={"$0.5" as any}>
                                          <HStack justifyContent="space-between" alignItems="center">
                                            <Text fontSize={Type.body} fontWeight="700" color={Palette.ink}>{config.label}</Text>
                                            <Text fontSize={Type.caption} color={Palette.gray400}>{timeLabel}</Text>
                                          </HStack>
                                          <Text fontSize={Type.small} color={Palette.gray500} numberOfLines={1}>{config.detail}</Text>
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
                        ) : (
                          <Box py="$10" alignItems="center">
                            <Box bg={Palette.gray100} p="$5" rounded="$full" mb="$3">
                              <MaterialIcons name="event-note" size={32} color={Palette.gray300} />
                            </Box>
                            <Text color={Palette.gray400} fontSize={Type.body} fontWeight="600">
                              {activityTypeFilter === 'all' ? 'No recent activity' : `No ${activityTypeFilter === 'leave' ? 'leaves' : activityTypeFilter === 'timelog' ? 'clock-ins' : activityTypeFilter === 'overtime' ? 'overtime' : 'shifts'} found`}
                            </Text>
                          </Box>
                        );
                      })()}
                    </VStack>
                </VStack>
              </Animated.View>
            </Box>
          )}
        </ScrollView>

        {/* Modals */}
        <Modal isOpen={showClockedInModal} onClose={() => setShowClockedInModal(false)} size="full">
              <ModalBackdrop />
              <ModalContent maxHeight="85%" bg="white" rounded="$3xl" overflow="hidden" p="$0" mx="$4">
                <LinearGradient
                  colors={[Palette.teal, Palette.success]}
                  style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 }}
                >
                  <HStack justifyContent="space-between" alignItems="center">
                    <VStack>
                      <Heading size="md" color="white" fontWeight="800">{t('companyHome.workforceLive')}</Heading>
                      <Text fontSize={Type.small} color="rgba(255,255,255,0.75)" mt="$0.5">
                        {realTimeStats.clockedInEmployees} of {realTimeStats.totalEmployees} staff clocked in
                      </Text>
                    </VStack>
                    <HStack space="sm" alignItems="center">
                      <Box bg="rgba(255,255,255,0.2)" px="$3" py="$1.5" rounded="$full">
                        <Text fontSize={Type.label} fontWeight="800" color="white">{realTimeStats.workforceUtilization}% active</Text>
                      </Box>
                      <Pressable onPress={() => setShowClockedInModal(false)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                        <Box w={32} h={32} bg="rgba(255,255,255,0.15)" rounded="$full" alignItems="center" justifyContent="center">
                          <MaterialIcons name="close" size={16} color="white" />
                        </Box>
                      </Pressable>
                    </HStack>
                  </HStack>
                </LinearGradient>
                <ModalBody px="$4" pt="$4" pb="$6" maxHeight={400}>
                  {realTimeStats.clockedInUsers?.length === 0 ? (
                    <Box py="$8" alignItems="center">
                      <Box bg={Palette.gray100} p="$5" rounded="$full" mb="$3">
                        <MaterialIcons name="people-outline" size={36} color={Palette.gray400} />
                      </Box>
                      <Text color={Palette.gray700} fontWeight="600">{t('companyHome.noOneClockedIn')}</Text>
                      <Text color={Palette.gray400} fontSize={Type.small} mt="$1">No active sessions right now.</Text>
                    </Box>
                  ) : (
                    <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
                      <VStack space="sm">
                        {realTimeStats.clockedInUsers?.map((u: any, i: number) => (
                          <Box key={i} bg={Palette.gray50} p="$3" rounded="$2xl" borderWidth={1} borderColor={Palette.successTint}>
                            <HStack alignItems="center" space="sm">
                              <Box w={40} h={40} rounded="$full" bg={Palette.teal} alignItems="center" justifyContent="center">
                                <Text fontSize={Type.body} fontWeight="800" color="white">
                                  {getInitials(`${u.private_user?.first_name || ''} ${u.private_user?.last_name || ''}`)}
                                </Text>
                              </Box>
                              <VStack flex={1}>
                                <Text fontWeight="700" color={Palette.ink} fontSize={Type.body}>
                                  {u.private_user?.first_name} {u.private_user?.last_name}
                                </Text>
                                <HStack space="xs" alignItems="center">
                                  <MaterialIcons name="access-time" size={12} color={Palette.success} />
                                  <Text fontSize={Type.small} color={Palette.success} fontWeight="600">
                                    Since {new Date(u.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </Text>
                                </HStack>
                              </VStack>
                              <Box bg={Palette.successTint} px="$2.5" py="$1" rounded="$full">
                                <Text fontSize={Type.tiny} fontWeight="700" color={Palette.success}>{t('companyHome.statusActive')}</Text>
                              </Box>
                            </HStack>
                          </Box>
                        ))}
                      </VStack>
                    </ScrollView>
                  )}
                </ModalBody>
              </ModalContent>
            </Modal>

            <Modal isOpen={showScheduledModal} onClose={() => setShowScheduledModal(false)} size="full">
              <ModalBackdrop />
              <ModalContent maxHeight="85%" bg="white" rounded="$3xl" overflow="hidden" p="$0" mx="$4">
                <LinearGradient
                  colors={[Palette.blue, Palette.indigo]}
                  style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 }}
                >
                  <HStack justifyContent="space-between" alignItems="center">
                    <VStack>
                      <Heading size="md" color="white" fontWeight="800">{t('companyHome.todaysRoster')}</Heading>
                      <Text fontSize={Type.small} color="rgba(255,255,255,0.75)" mt="$0.5">
                        {t('companyHome.shiftEmployeeCount', { shifts: realTimeStats.todaySchedules?.length || 0, employees: realTimeStats.scheduledEmployees })}
                      </Text>
                    </VStack>
                    <Pressable onPress={() => setShowScheduledModal(false)} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
                      <Box w={32} h={32} bg="rgba(255,255,255,0.15)" rounded="$full" alignItems="center" justifyContent="center">
                        <MaterialIcons name="close" size={16} color="white" />
                      </Box>
                    </Pressable>
                  </HStack>
                </LinearGradient>
                <ModalBody px="$4" pt="$4" pb="$6" maxHeight={400}>
                  {realTimeStats.todaySchedules?.length === 0 ? (
                    <Box py="$8" alignItems="center">
                      <Box bg={Palette.gray100} p="$5" rounded="$full" mb="$3">
                        <MaterialIcons name="event-busy" size={36} color={Palette.gray400} />
                      </Box>
                      <Text color={Palette.gray700} fontWeight="600">{t('companyHome.noShiftsToday')}</Text>
                      <Text color={Palette.gray400} fontSize={Type.small} mt="$1">Nothing scheduled for today.</Text>
                    </Box>
                  ) : (
                    <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
                      <VStack space="sm">
                        {realTimeStats.todaySchedules?.map((s: any, i: number) => (
                          <Box key={i} bg={Palette.blueTint} p="$3" rounded="$2xl" borderWidth={1} borderColor={Palette.blueTint}>
                            <HStack alignItems="center" space="sm">
                              <Box w={40} h={40} rounded="$full" bg={Palette.blue} alignItems="center" justifyContent="center">
                                <MaterialIcons name="event" size={20} color="white" />
                              </Box>
                              <VStack flex={1}>
                                <Text fontWeight="700" color={Palette.ink} fontSize={Type.body} numberOfLines={1}>
                                  {s.title || 'Shift'}
                                </Text>
                                <HStack space="xs" alignItems="center">
                                  <MaterialIcons name="location-on" size={12} color={Palette.blue} />
                                  <Text fontSize={Type.small} color={Palette.blue} fontWeight="500" numberOfLines={1}>
                                    {s.location || format(new Date(s.start_time), 'p')}
                                  </Text>
                                </HStack>
                              </VStack>
                              <Box
                                bg={s.status === 'completed' ? Palette.successTint : Palette.blueTint}
                                px="$2.5" py="$1" rounded="$full"
                              >
                                <Text fontSize={Type.tiny} fontWeight="700" color={s.status === 'completed' ? Palette.success : Palette.blue}>
                                  {(s.status || 'PENDING').toUpperCase()}
                                </Text>
                              </Box>
                            </HStack>
                          </Box>
                        ))}
                      </VStack>
                    </ScrollView>
                  )}
                </ModalBody>
              </ModalContent>
            </Modal>

            {/* Account menu — opened from the avatar. Absolute overlay (not a
                react-native Modal, which freezes on Android in this app), so the
                header stays at just notification + avatar. */}
            {menuOpen ? (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000 }}>
                <Pressable style={{ flex: 1 }} onPress={() => setMenuOpen(false)}>
                  <View style={{ position: 'absolute', top: insets.top + 64, right: 16, minWidth: 232 }}>
                    <Pressable onPress={() => {}}>
                      <Box bg="white" rounded="$2xl" borderWidth={1} borderColor={Palette.gray100} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 8 }} shadowOpacity={0.15} shadowRadius={16} elevation={14} overflow="hidden">
                        <Box px="$4" pt="$3" pb="$2">
                          <Text fontWeight="800" color={Palette.ink} fontSize={Type.body} numberOfLines={1}>
                            {user?.first_name || (user as any)?.private_user?.first_name || 'Account'}
                          </Text>
                          {(user?.company?.company_name || (user as any)?.private_user?.company?.company_name) ? (
                            <Text fontSize={Type.tiny} color={Palette.gray400} numberOfLines={1}>
                              {user?.company?.company_name || (user as any)?.private_user?.company?.company_name}
                            </Text>
                          ) : null}
                        </Box>
                        <View style={{ height: 1, backgroundColor: Palette.gray100 }} />
                        {qualifiesForModeChoice(user) && (
                          <Pressable onPress={async () => { setMenuOpen(false); await setEntryMode('employee'); router.replace('/private_dashboard/home'); }}>
                            <HStack alignItems="center" space="md" px="$4" py="$3">
                              <MaterialIcons name="swap-horiz" size={20} color={Palette.indigo} />
                              <Text color={Palette.gray800} fontWeight="600">Switch</Text>
                            </HStack>
                          </Pressable>
                        )}
                        <Pressable onPress={() => { setMenuOpen(false); router.push('/company_dashboard/settings'); }}>
                          <HStack alignItems="center" space="md" px="$4" py="$3">
                            <MaterialIcons name="settings" size={20} color={Palette.gray600} />
                            <Text color={Palette.gray800} fontWeight="600">Settings</Text>
                          </HStack>
                        </Pressable>
                        <View style={{ height: 1, backgroundColor: Palette.gray100 }} />
                        <Pressable onPress={() => { setMenuOpen(false); logout(); router.replace('/'); }}>
                          <HStack alignItems="center" space="md" px="$4" py="$3">
                            <MaterialIcons name="logout" size={20} color={Palette.error} />
                            <Text color={Palette.error} fontWeight="700">Log out</Text>
                          </HStack>
                        </Pressable>
                      </Box>
                    </Pressable>
                  </View>
                </Pressable>
              </View>
            ) : null}
      </SafeAreaView>
  );
};

export default HomeScreen;