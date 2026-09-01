import { createLeaveRequest, endBreak, getJobById, getLeaveQuotas, getSalaryByJobId, getUserDetail, getUserLeaveRequests, getUserTimeLogs, postClockIn, startBreak, TimeLog, updateTimeLog, getUserNotifications, markNotificationAsRead, markTimeLogAsOvertime, Notification, LeaveQuota, isPermissionDeniedError } from '@/services/api';
import { salaryStructures, type ResolvedSalary } from '@/services/payroll-api';
import { Palette, Type } from '@/app/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Box,
  Button,
  ButtonText,
  Heading,
  HStack,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Pressable,
  Radio,
  RadioGroup,
  RadioIcon,
  RadioIndicator,
  RadioLabel,
  Spinner,
  Text,
  Textarea,
  TextareaInput,
  VStack,
  useToken
} from '@gluestack-ui/themed';
import { zodResolver } from '@hookform/resolvers/zod';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { addDays, addWeeks, addMonths, eachDayOfInterval, endOfMonth, endOfWeek, format, isAfter, isBefore, isSameDay, isSameMonth, isThisWeek, isToday, isWithinInterval, parseISO, startOfMonth, startOfWeek, subDays, subMonths } from 'date-fns';
import * as Location from 'expo-location';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { MotiView } from 'moti';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import { Alert, Dimensions, KeyboardAvoidingView, Linking, Platform, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import z from 'zod';
import useAuth from '../hooks/useAuth';
import useCurrency from '../hooks/useCurrency';
import { getOrCreateDeviceId } from '@/services/deviceId';

import { StandardButton } from '../design-system';

// Extracted components
import ClockInModeTabs from '../../components/calculator/ClockInModeTabs';
import { resolveShowBreakAlert } from '@/components/clock_in/resolveShowBreakAlert';

type EventHistoryEntry = {
  id?: number;
  type: 'CLOCK_IN' | 'CLOCK_OUT' | 'BREAK_START' | 'BREAK_END';
  timestamp: string;
  duration?: string;
  location?: string;
};

type DailyHistoryGroup = {
  date: string;
  day_of_week: string;
  events: EventHistoryEntry[];
  total_hours_worked: number;
  total_session_seconds: number;
  total_break_seconds: number;
  id?: number;
  is_active_day: boolean;
};

// Helper functions for formatting time
const formatSecondsToHMS = (seconds: number) => {
  if (isNaN(seconds) || seconds < 0) {
    return '00:00:00';
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
};

const formatHoursToHMS = (hours: number) => {
  if (isNaN(hours) || hours < 0) {
    return '00:00:00';
  }
  const totalSeconds = hours * 3600;
  return formatSecondsToHMS(totalSeconds);
};

const formatHoursToDisplay = (hours: number) => {
  if (isNaN(hours) || hours <= 0) {
    return '0h 0m';
  }
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h > 0) {
    return `${h}h ${m}m`;
  }
  return `${m}m`;
};

// Memoized History Item Component for Performance
const HistoryItem = React.memo(({ group, onLocationPress, t }: { group: DailyHistoryGroup, onLocationPress: (location: string) => void, t: (key: string, options?: any) => string }) => {
  if (!group || !group.date) {
    return null;
  }

  const date = format(new Date(group.date + 'T00:00:00'), 'MMM dd, yyyy');
  const totalSessionDuration = formatSecondsToHMS(group.total_session_seconds);
  const totalNetWorkedDuration = formatHoursToHMS(group.total_hours_worked);
  const totalBreakDuration = formatSecondsToHMS(group.total_break_seconds);
  const isActiveDay = group.is_active_day;

  return (
    <Box mb="$4">
      {/* Daily Summary Header */}
      <Box
        p="$4"
        bg="white"
        rounded="$xl"
        borderBottomWidth={group.events.length > 0 ? 1 : 0}
        borderColor={Palette.gray200}
        shadowColor={Palette.black}
        shadowOffset={{ width: 0, height: 2 }}
        shadowOpacity={0.05}
        shadowRadius={5}
        elevation={3}
        borderLeftWidth={4}
        borderLeftColor={isActiveDay ? Palette.success : Palette.gray300}
      >
        <VStack space="md">
          <HStack justifyContent="space-between" alignItems="center">
            <HStack alignItems="center" space="sm" flex={1}>
              <Box bg={isActiveDay ? Palette.successTint : Palette.gray100} p="$3" rounded="$full">
                <MaterialIcons
                  name="event-note"
                  size={20}
                  color={isActiveDay ? Palette.success : Palette.gray700}
                />
              </Box>
              <VStack flex={1}>
                <Text fontWeight="600" color={Palette.ink} fontSize={Type.body} numberOfLines={1} ellipsizeMode="tail">
                  {date}
                </Text>
                <Text color={Palette.gray500} fontSize={Type.small} numberOfLines={1} ellipsizeMode="tail">
                  {group.day_of_week}
                </Text>
              </VStack>
            </HStack>
          </HStack>

          {/* Daily Totals - Separate Row */}
          <HStack justifyContent="space-around" alignItems="center" space="xs">
            {group.total_session_seconds > 0 && (
              <VStack flex={1} alignItems="center" space="xs">
                <Text color={Palette.gray600} fontSize={Type.tiny} fontWeight="500" textAlign="center">
                  {t('clockIn.totalLabel')}
                </Text>
                <Text fontWeight="700" color={Palette.gray700} fontSize={Type.small} numberOfLines={1} textAlign="center">
                  {totalSessionDuration}
                </Text>
              </VStack>
            )}
            {group.total_hours_worked > 0 && (
              <VStack flex={1} alignItems="center" space="xs">
                <Text color={Palette.gray600} fontSize={Type.tiny} fontWeight="500" textAlign="center">
                  {t('clockIn.netLabel')}
                </Text>
                <Text fontWeight="700" color={Palette.success} fontSize={Type.small} numberOfLines={1} textAlign="center">
                  {totalNetWorkedDuration}
                </Text>
              </VStack>
            )}
            {group.total_break_seconds > 60 && (
              <VStack flex={1} alignItems="center" space="xs">
                <Text color={Palette.gray600} fontSize={Type.tiny} fontWeight="500" textAlign="center">
                  {t('clockIn.breakLabel')}
                </Text>
                <Text fontWeight="700" color={Palette.warning} fontSize={Type.small} numberOfLines={1} textAlign="center">
                  {totalBreakDuration}
                </Text>
              </VStack>
            )}
          </HStack>
        </VStack>
      </Box>

      {/* Events Timeline */}
      {group.events.length > 0 && (
        <VStack p="$2" bg={Palette.gray50} rounded="$xl" space="lg">
          {group.events.map((event, eventIndex) => {
            const eventTime = format(new Date(event.timestamp), 'hh:mm:ss a');
            const eventConfig = {
              CLOCK_IN: { label: t('clockIn.eventClockIn'), icon: 'login', color: Palette.success, bg: Palette.successTint },
              CLOCK_OUT: { label: t('clockIn.eventClockOut'), icon: 'logout', color: Palette.indigo, bg: Palette.blueTint },
              BREAK_START: { label: t('clockIn.eventBreakStart'), icon: 'pause-circle-filled', color: Palette.warning, bg: Palette.warningTint },
              BREAK_END: { label: t('clockIn.eventBreakEnd'), icon: 'play-circle-filled', color: Palette.gray700, bg: Palette.gray100 },
            }[event.type];

            // Calculate break duration and find related events
            let breakDuration = null;
            let breakStartEvent = null;
            let breakEndEvent = null;

            if (event.type === 'BREAK_END' && eventIndex > 0) {
              breakStartEvent = group.events.slice(0, eventIndex).reverse().find(e => e.type === 'BREAK_START');
              if (breakStartEvent) {
                breakEndEvent = event;
                const startTime = new Date(breakStartEvent.timestamp);
                const endTime = new Date(event.timestamp);
                const durationSeconds = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);
                const hours = Math.floor(durationSeconds / 3600);
                const minutes = Math.floor((durationSeconds % 3600) / 60);
                const seconds = durationSeconds % 60;

                if (hours > 0) {
                  breakDuration = `${hours}h ${minutes}m ${seconds}s`;
                } else if (minutes > 0) {
                  breakDuration = `${minutes}m ${seconds}s`;
                } else {
                  breakDuration = `${seconds}s`;
                }
              }
            } else if (event.type === 'BREAK_START') {
              // For break start events, look for the corresponding end event
              breakStartEvent = event;
              breakEndEvent = group.events.slice(eventIndex + 1).find(e => e.type === 'BREAK_END');
              if (breakEndEvent) {
                const startTime = new Date(event.timestamp);
                const endTime = new Date(breakEndEvent.timestamp);
                const durationSeconds = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);
                const hours = Math.floor(durationSeconds / 3600);
                const minutes = Math.floor((durationSeconds % 3600) / 60);
                const seconds = durationSeconds % 60;

                if (hours > 0) {
                  breakDuration = `${hours}h ${minutes}m ${seconds}s`;
                } else if (minutes > 0) {
                  breakDuration = `${minutes}m ${seconds}s`;
                } else {
                  breakDuration = `${seconds}s`;
                }
              }
            }

            return (
              <HStack key={`${event.id}-${eventIndex}`} space="lg" alignItems="flex-start" mb={eventIndex < group.events.length - 1 ? "$3" : "$2"}>
                {/* Timeline Connector */}
                <VStack alignItems="center" pt="$2">
                  <Box w={2} h={eventIndex === 0 ? 0 : 12} bg={eventIndex === 0 ? 'transparent' : Palette.gray200} />
                  <Box bg={eventConfig.bg} p="$3" rounded="$full" borderWidth={2} borderColor={eventConfig.color + '30'} shadowColor={eventConfig.color} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.2} shadowRadius={4} elevation={3}>
                    <MaterialIcons name={eventConfig.icon as any} size={18} color={eventConfig.color} />
                  </Box>
                  <Box w={2} h={eventIndex === group.events.length - 1 ? 0 : 20} bg={eventIndex === group.events.length - 1 ? 'transparent' : Palette.gray200} />
                </VStack>

                {/* Event Details */}
                <Box flex={1} bg="white" p="$2" rounded="$xl" borderWidth={1} borderColor={Palette.gray200} my="$2" minWidth={0} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.08} shadowRadius={8} elevation={4}>
                  <VStack space="lg" minWidth={0}>
                    {/* Event Type and Time Row */}
                    <VStack space="md" minWidth={0}>
                      <HStack alignItems="center" space="sm" minWidth={0}>
                        <Text fontWeight="800" color={eventConfig.color} fontSize={Type.title} numberOfLines={1} ellipsizeMode="tail" flex={1}>
                          {eventConfig.label}
                        </Text>
                        <Box bg={eventConfig.bg} px="$3" py="$2" rounded="$lg" borderWidth={1} borderColor={eventConfig.color + '30'}>
                          <Text color={eventConfig.color} fontSize={Type.caption} fontWeight="700" numberOfLines={1}>
                            {event.type.replace('_', ' ')}
                          </Text>
                        </Box>
                      </HStack>

                      {/* Time Display */}
                      <HStack alignItems="center" space="sm" minWidth={0} bg={Palette.gray50} p="$3" rounded="$lg">
                        <MaterialIcons name="schedule" size={16} color={Palette.gray500} />
                        <Text color={Palette.gray800} fontSize={Type.body} fontWeight="700" numberOfLines={1} ellipsizeMode="tail" flex={1}>
                          {eventTime}
                        </Text>
                      </HStack>

                      {/* Location Display */}
                      {event.location ? (
                        <Pressable onPress={() => onLocationPress(event.location!)}>
                          <HStack alignItems="center" space="sm" minWidth={0} bg={Palette.gray50} p="$3" rounded="$lg">
                            <MaterialIcons name="location-on" size={16} color={Palette.gray500} />
                            <Text color={Palette.gray800} fontSize={Type.body} fontWeight="700" numberOfLines={1} ellipsizeMode="tail" flex={1}>
                              {event.location}
                            </Text>
                          </HStack>
                        </Pressable>
                      ) : null}
                    </VStack>

                    {/* Duration Display (if available) */}
                    {event.duration || breakDuration ? (
                      <Box bg="white" p="$4" rounded="$xl" borderWidth={2} borderColor={Palette.gray200} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 1 }} shadowOpacity={0.05} shadowRadius={3} elevation={2}>
                        <HStack alignItems="center" space="sm" justifyContent="center">
                          <MaterialIcons name="timer" size={18} color={Palette.gray500} />
                          <Text color={Palette.gray800} fontSize={Type.body} fontWeight="800" numberOfLines={1}>
                            {breakDuration || event.duration}
                          </Text>
                        </HStack>
                      </Box>
                    ) : null}

                    {/* Break Information Summary (if event is clock-out and has meaningful break time) */}
                    {event.type === 'CLOCK_OUT' && group.total_break_seconds > 60 && (
                      <Box bg="white" p="$4" rounded="$xl" borderWidth={2} borderColor={Palette.warningTint} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 1 }} shadowOpacity={0.05} shadowRadius={3} elevation={2}>
                        <HStack alignItems="center" space="sm" justifyContent="center">
                          <MaterialIcons name="coffee" size={18} color={Palette.gray500} />
                          <Text color={Palette.gray800} fontSize={Type.body} fontWeight="800" numberOfLines={1}>
                            {t('clockIn.breakSummary', { duration: formatSecondsToHMS(group.total_break_seconds) })}
                          </Text>
                        </HStack>
                      </Box>
                    )}
                  </VStack>
                </Box>
              </HStack>
            );
          })}
        </VStack>
      )}
    </Box>
  );
});

HistoryItem.displayName = 'HistoryItem';

const { width: LEAVE_SCREEN_WIDTH } = Dimensions.get('window');
const LEAVE_DAY_SIZE = Math.floor((LEAVE_SCREEN_WIDTH - 64) / 7);

const LEAVE_TYPES_CI = [
  { key: 'annual', labelKey: 'clockIn.typeAnnual', color: Palette.blue },
  { key: 'sick', labelKey: 'clockIn.typeSick', color: Palette.warning },
  { key: 'holiday', labelKey: 'clockIn.typeHoliday', color: Palette.green },
  { key: 'emergency', labelKey: 'clockIn.typeEmergency', color: Palette.violet },
  { key: 'personal', labelKey: 'clockIn.typePersonal', color: Palette.teal },
  { key: 'bereavement', labelKey: 'clockIn.typeBereavement', color: Palette.gray500 },
];

const leaveRequestSchema = z.object({
  leaveType: z.string().nonempty('Please select a leave type.'),
  leaveReason: z.string().optional(),
});

type LeaveRequestFormData = z.infer<typeof leaveRequestSchema>;

// Helper for robust date parsing (handles space instead of T)
const safeParseDate = (dateStr: string | null | undefined): Date | null => {
  if (!dateStr) return null;
  try {
    // Try standard ISO
    let date = parseISO(dateStr);
    if (!isNaN(date.getTime())) return date;

    // Try replacing space with T (common Python/SQLite format)
    if (dateStr.includes(' ')) {
      date = parseISO(dateStr.replace(' ', 'T'));
      if (!isNaN(date.getTime())) return date;
    }

    // Raw fallback (handles some Safari/iOS formats)
    date = new Date(dateStr);
    if (!isNaN(date.getTime())) return date;

    return null;
  } catch {
    return null;
  }
};

export default function ClockInPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { formatCurrency } = useCurrency();
  const primary = useToken('colors', 'primary500');
  const [isClockedIn, setIsClockedIn] = useState(false);
  const [isBreaking, setIsBreaking] = useState(false);
  // Whether the ACTIVE session has already had at least one completed
  // (started-and-ended) break. The "take a break" reminder previously only
  // checked !isBreaking (suppressed WHILE a break is active) but had no
  // memory of a break already having happened — so it reappeared the
  // instant an employee ended their break, even though they'd just taken
  // one. Set from the active TimeLog's own breaks array in
  // loadTimeLogsFromDatabase; reset to false on each new clock-in.
  const [hasCompletedBreakThisSession, setHasCompletedBreakThisSession] = useState(false);
  const [history, setHistory] = useState<DailyHistoryGroup[]>([]);
  const [activeTimeLogId, setActiveTimeLogId] = useState<number | null>(null);
  const [currentClockInTime, setCurrentClockInTime] = useState<string | null>(null);
  const [jobId, setJobId] = useState<number | null>(null);
  const [locationAuthorized, setLocationAuthorized] = useState<boolean | null>(null);
  const [currentCoordinates, setCurrentCoordinates] = useState<{ latitude: number; longitude: number } | null>(null)
  const [userDetails, setUserDetails] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Notifications and Overtime State
  const [activeOvertimeNotification, setActiveOvertimeNotification] = useState<Notification | null>(null);
  const [isOvertimeModalOpen, setIsOvertimeModalOpen] = useState(false);
  const [overtimeReason, setOvertimeReason] = useState("");

  // Break compliance state
  const [minBreakThresholdMinutes, setMinBreakThresholdMinutes] = useState(360); // default 6h
  const [overtimeThresholdMinutes, setOvertimeThresholdMinutes] = useState(480); // default 8h
  const [breakAlertDismissed, setBreakAlertDismissed] = useState(false);
  const [workStartTime, setWorkStartTime] = useState<string | null>(null);
  const [workEndTime, setWorkEndTime] = useState<string | null>(null);
  const [workDays, setWorkDays] = useState<Record<string, string> | null>(null);
  const [overtimeAlertShown, setOvertimeAlertShown] = useState(false);
  // Which prompt the shared modal shows: off-hours → "overtime", late start → "late".
  const [modalMode, setModalMode] = useState<'overtime' | 'late'>('overtime');
  const [currentTime, setCurrentTime] = useState(new Date());

  // Leave tab state (harmonised with leave.tsx design)
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [leaveTypeClockIn, setLeaveTypeClockIn] = useState('annual');
  const [leaveNotesClockIn, setLeaveNotesClockIn] = useState('');
  const [clockInLeaveTab, setClockInLeaveTab] = useState<'request' | 'history'>('request');
  const [isSubmittingLeave, setIsSubmittingLeave] = useState(false);
  const [salaryData, setSalaryData] = useState<any>(null);
  // Whether the active job has a company employer — the real decision
  // boundary for which salary source to trust (see effectiveSalaryData
  // below). Not the same question as "is salaryData present": the legacy
  // `salaries` table is self-reported by independent/personal users on
  // their own profile and has no sync with the modern SalaryStructure
  // system a company configures for its employees.
  const [jobCompanyId, setJobCompanyId] = useState<number | null>(null);
  const [resolvedSalary, setResolvedSalary] = useState<ResolvedSalary | null>(null);

  // Same fix as private_dashboard/home.tsx's payData/effectiveSalaryData:
  // a company-affiliated employee's "Earned" figure must be computed from
  // their employer's SalaryStructure, not their own (possibly years-stale)
  // legacy profile entry. Independent users are unaffected.
  const effectiveWeeklyIncome = useMemo(() => {
    if (!jobCompanyId) {
      if (!salaryData) return null;
      const salaryAny = salaryData as any;
      const revenueVal = parseFloat(salaryData.revenue || '0');
      const salaryVal = parseFloat(salaryData.salary || '0');
      const amountVal = parseFloat(salaryAny.amount || '0');
      const jobIncome = revenueVal > 0 ? revenueVal : (salaryVal > 0 ? salaryVal : (amountVal > 0 ? amountVal : 0));
      const monthlyHours = parseFloat(salaryData.monthly_hours || '160') || 160;
      return jobIncome > 0 ? { jobIncome, monthlyHours } : null;
    }
    const basicComponent = resolvedSalary?.components?.find(
      (c) => c.kind === 'earning' && c.is_basic,
    );
    // Company employee, structure not configured yet — no figure to show
    // rather than falling back to an unrelated old personal entry.
    if (!basicComponent) return null;
    const allowanceTotal = (resolvedSalary?.components ?? [])
      .filter((c) => c.kind === 'earning' && !c.is_basic)
      .reduce((sum, c) => sum + (parseFloat(String(c.amount)) || 0), 0);
    const jobIncome = (parseFloat(String(basicComponent.amount)) || 0) + allowanceTotal;
    // The structure system has no per-employee "monthly hours" field —
    // fall back to the same 160h/month default this file already used.
    return jobIncome > 0 ? { jobIncome, monthlyHours: 160 } : null;
  }, [salaryData, jobCompanyId, resolvedSalary]);

  const weeklyTotal = useMemo(() => {
    let hours = 0;
    const days = new Set<string>();

    history.forEach(day => {
      hours += day.total_hours_worked;
      if (day.total_hours_worked > 0 || day.is_active_day) {
        days.add(day.date);
      }
    });

    let earnings = 0;
    if (effectiveWeeklyIncome) {
      const hourlyRate = effectiveWeeklyIncome.jobIncome / effectiveWeeklyIncome.monthlyHours;
      earnings = hours * hourlyRate;
    }

    return {
      hours: hours,
      days: days.size,
      earnings
    };
  }, [history, effectiveWeeklyIncome]);

  const [clockInMode, setClockInMode] = useState<'clockin' | 'leave'>('clockin');

  // Calendar and time-off state
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDateRange, setSelectedDateRange] = useState<{ startDate: Date | null; endDate: Date | null }>({ startDate: null, endDate: null });
  const [timeOffModalOpen, setTimeOffModalOpen] = useState(false);
  const [timeOffRequests, setTimeOffRequests] = useState<any[]>([]);
  const [selectedLeaveRequest, setSelectedLeaveRequest] = useState<any | null>(null);
  const [isLeaveDetailModalOpen, setLeaveDetailModalOpen] = useState(false);
  const [locationModalOpen, setLocationModalOpen] = useState(false);
  const [selectedLocationAddress, setSelectedLocationAddress] = useState('');
  const [leaveQuotas, setLeaveQuotas] = useState<LeaveQuota[]>([]);

  const {
    control: leaveFormControl,
    handleSubmit: handleLeaveSubmit,
    reset: resetLeaveForm,
    formState: { errors: leaveErrors, isSubmitting: isLeaveSubmitting },
  } = useForm<LeaveRequestFormData>({
    resolver: zodResolver(leaveRequestSchema),
    defaultValues: { leaveType: '', leaveReason: '' },
  });

  const getCurrentLocation = async () => {
    let status: string = 'denied';
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      status = perm.status;
    } catch (permErr) {
      // A native permission-request fault on Android must not crash the tap —
      // surface it as a handled error the caller's try/catch turns into an alert.
      console.warn('Location permission request failed:', permErr);
      setLocationAuthorized(false);
      Alert.alert(t('clockIn.locationErrorTitle'), t('clockIn.locationErrorBody'));
      throw new Error('Location permission request failed.');
    }
    if (status !== 'granted') {
      setLocationAuthorized(false);
      Alert.alert(
        t('clockIn.locationPermissionDeniedTitle'),
        t('clockIn.locationPermissionDeniedBody'),
        [
          { text: t('clockIn.cancelAction'), style: 'cancel' },
          { text: t('clockIn.openSettingsAction'), onPress: () => Linking.openSettings() },
        ]
      );
      throw new Error('Location permission not granted.');
    }
    setLocationAuthorized(true);

    // Speed optimization: last known first, then a fresh balanced fix. Both
    // native calls can throw or return null on Android (GPS off, Play Services
    // unavailable) — guard them and null-check the result so a location failure
    // surfaces as an alert instead of a `coords`-of-null hard crash.
    let location: Location.LocationObject | null = null;
    try {
      location = await Location.getLastKnownPositionAsync();
      if (!location) {
        location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
      }
    } catch (posErr) {
      console.warn('Failed to get device position:', posErr);
    }

    if (!location || !location.coords) {
      setCurrentCoordinates(null);
      Alert.alert(t('clockIn.locationErrorTitle'), t('clockIn.locationErrorBody'));
      throw new Error('Could not determine current location.');
    }

    const coords = { latitude: location.coords.latitude, longitude: location.coords.longitude };
    setCurrentCoordinates(coords);

    // Geofencing integrity context — lets the server decide location trust
    // (accuracy gate, stale-fix, mock injection) before enforcing fences.
    let deviceId: string | undefined;
    try {
      deviceId = await getOrCreateDeviceId();
    } catch {
      // Best-effort — backend degrades open without a device id.
    }
    const geo_check = {
      accuracy_m: location.coords.accuracy ?? null,
      fix_timestamp: new Date(location.timestamp).toISOString(),
      mock_detected: !!location.mocked,
      device_id: deviceId,
      os: Platform.OS,
      app_version: Constants.expoConfig?.version,
    };

    // Move geocoding to a secondary, non-blocking step if possible, or use a faster lookup
    let addressString = `Coordinates: ${coords.latitude.toFixed(4)}, ${coords.longitude.toFixed(4)}`;
    try {
      // Faster address lookup
      const address = await Location.reverseGeocodeAsync(coords);
      if (address.length > 0) {
        addressString = `${address[0].name || ''}, ${address[0].city || ''}, ${address[0].region || ''}, ${address[0].country || ''}`.replace(/^, |, $|, , /g, ', ').replace(/^, |, $/g, '');
      }
    } catch (geocodeError) {
      console.warn('Geocoding failed:', geocodeError);
    }

    return {
      address: addressString,
      ...coords,
      geo_check,
    };
  };

  const requestAndGetLocation = useCallback(async (showAlertOnGrant = false) => {
    // This runs on mount. A native permission fault on Android must NOT become
    // an unhandled promise rejection — that hard-crashes the clock-in screen
    // (and bounces the user to home). Swallow it to a non-authorized state.
    let status: string = 'denied';
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      status = perm.status;
    } catch (permErr) {
      console.warn('Location permission request failed:', permErr);
      setLocationAuthorized(false);
      setCurrentCoordinates(null);
      return;
    }

    if (status === 'granted') {
      setLocationAuthorized(true);
      try {
        let location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setCurrentCoordinates({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
        console.log('Location obtained:', location.coords);
      } catch (error: any) {
        console.error('Error getting location:', error);
        Alert.alert(t('clockIn.locationErrorTitle'), t('clockIn.locationErrorBody'));
        setCurrentCoordinates(null);
        setLocationAuthorized(false);
      }
    } else {
      setLocationAuthorized(false);
      setCurrentCoordinates(null);
      Alert.alert(
        t('clockIn.locationPermissionDeniedTitle'),
        t('clockIn.locationPermissionDeniedBody'),
        [
          { text: t('clockIn.cancelAction'), style: 'cancel' },
          { text: t('clockIn.openSettingsAction'), onPress: () => Linking.openSettings() },
        ]
      );
    }
  }, [t]);

  useEffect(() => {
    // .catch so a mount-time location failure can't become an unhandled
    // promise rejection (which hard-crashes the screen on Android).
    requestAndGetLocation(true).catch((e) => console.warn('Initial location fetch failed:', e));
  }, [requestAndGetLocation]);

  const getTimeSheet = useCallback(async () => {
    try {
      const storedClockInTime = await AsyncStorage.getItem('currentClockInTime');
      const storedIsClockedIn = await AsyncStorage.getItem('isClockedIn');
      const storedHistory = await AsyncStorage.getItem('history');
      const storedIsBreaking = await AsyncStorage.getItem('isBreaking');
      const storedActiveLogId = await AsyncStorage.getItem('activeTimeLogId');

      // Validate storedHistory before parsing and setting
      if (storedHistory && storedHistory.length > 2) {
        try {
          const parsed: DailyHistoryGroup[] = JSON.parse(storedHistory);
          setHistory(parsed.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        } catch (e) {
          console.error('Error parsing stored history:', e);
          setHistory([]);
        }
      } else {
        setHistory([]);
      }

      if (storedIsClockedIn === 'true' && storedClockInTime) {
        setIsClockedIn(true);
        setCurrentClockInTime(storedClockInTime);
        if (storedActiveLogId) setActiveTimeLogId(Number(storedActiveLogId));
      } else {
        setIsClockedIn(false);
        setCurrentClockInTime(null);
      }

      if (storedIsBreaking === 'true') {
        setIsBreaking(true);
      } else {
        setIsBreaking(false);
      }
    } catch (error) {
      console.error('Failed to load time sheet from storage:', error);
      setHistory([]);
      setIsClockedIn(false);
      setCurrentClockInTime(null);
      setActiveTimeLogId(null);
      setIsBreaking(false);
    }
  }, []);

  const loadLeaveRequests = useCallback(async () => {
    const privateUserId = user?.private_user_id || user?.private_user?.private_user_id;
    if (!privateUserId) {
      return;
    }

    try {
      const response = await getUserLeaveRequests(Number(privateUserId));
      if (response && !('error' in response) && Array.isArray(response)) {
        const formattedRequests = response.map(req => ({
          id: req.leave_id,
          date: new Date(req.start_date).toISOString(),
          end_date: req.end_date,
          type: req.leave_type,
          reason: req.notes,
          status: req.status,
          submitted: req.created_at,
        }));
        setTimeOffRequests(formattedRequests);
        console.log('✅ Leave requests loaded from database:', formattedRequests.length);
      } else {
        if (!isPermissionDeniedError(response)) console.error('❌ Failed to load leave requests:', response);
        setTimeOffRequests([]);
      }
    } catch (error) {
      console.error('Error loading leave requests:', error);
      setTimeOffRequests([]);
    }
  }, [user]);

  const loadLeaveQuotas = useCallback(async () => {
    const privateUserId = user?.private_user_id || user?.private_user?.private_user_id;
    if (!privateUserId) return;
    try {
      const response = await getLeaveQuotas(Number(privateUserId));
      // getLeaveQuotas returns the wrapped ApiResponse shape ({status,
      // message, data}), never a bare array — this previously always
      // failed Array.isArray(response), so leaveQuotas never populated
      // and the balance block silently never rendered.
      if (response && !('error' in response) && Array.isArray((response as any).data)) {
        setLeaveQuotas((response as any).data);
      }
    } catch (error) {
      console.error('Error loading leave quotas:', error);
    }
  }, [user]);

  const loadSalaryData = useCallback(async () => {
    const privateUserId = user?.private_user_id || user?.private_user?.private_user_id;
    const targetJobId = jobId || (userDetails?.job_id);

    if (!targetJobId && privateUserId) {
      // If we don't have jobId yet, try to get it first
      try {
        const jobRes = await getJobById(Number(privateUserId));
        if (jobRes && !('error' in jobRes) && jobRes.job_id) {
          setJobId(jobRes.job_id);
          setJobCompanyId((jobRes as any).company_id ?? null);
          const threshold = (jobRes as any).minimum_break_minutes;
          if (threshold && threshold > 0) setMinBreakThresholdMinutes(threshold);
          const overtimeThreshold = (jobRes as any).overtime_threshold_minutes;
          if (overtimeThreshold && overtimeThreshold > 0) setOvertimeThresholdMinutes(overtimeThreshold);
          setWorkStartTime((jobRes as any).work_start_time || null);
          setWorkEndTime((jobRes as any).work_end_time || null);
          setWorkDays((jobRes as any).work_days || null);
          const salRes = await getSalaryByJobId(jobRes.job_id);
          if (salRes && !('error' in salRes)) {
            setSalaryData(salRes);
          }
          if ((jobRes as any).company_id) {
            const structRes = await salaryStructures.preview(Number(privateUserId));
            if (structRes && !('error' in structRes)) setResolvedSalary(structRes);
          }
        }
      } catch (err) {
        console.warn('Failed to fetch job/salary for user:', err);
      }
      return;
    }

    if (targetJobId) {
      try {
        // Always refresh job schedule fields (work_end_time, work_days) regardless of which path we took
        let companyId: number | null = null;
        if (privateUserId) {
          const jobRes = await getJobById(Number(privateUserId));
          if (jobRes && !('error' in jobRes)) {
            companyId = (jobRes as any).company_id ?? null;
            setJobCompanyId(companyId);
            const threshold = (jobRes as any).minimum_break_minutes;
            if (threshold && threshold > 0) setMinBreakThresholdMinutes(threshold);
            const overtimeThreshold = (jobRes as any).overtime_threshold_minutes;
            if (overtimeThreshold && overtimeThreshold > 0) setOvertimeThresholdMinutes(overtimeThreshold);
            setWorkStartTime((jobRes as any).work_start_time || null);
            setWorkEndTime((jobRes as any).work_end_time || null);
            setWorkDays((jobRes as any).work_days || null);
          }
        }
        const salRes = await getSalaryByJobId(targetJobId);
        if (salRes && !('error' in salRes)) {
          setSalaryData(salRes);
        }
        if (companyId && privateUserId) {
          const structRes = await salaryStructures.preview(Number(privateUserId));
          if (structRes && !('error' in structRes)) setResolvedSalary(structRes);
        }
      } catch (err) {
        console.warn('Failed to fetch salary data:', err);
      }
    }
  }, [user, jobId, userDetails]);

  const loadTimeLogsFromDatabase = useCallback(async (isMountedRef?: { current: boolean }) => {
    try {
      const privateUserId = user?.private_user_id || user?.private_user?.private_user_id;
      if (!privateUserId) {
        console.log('No private user ID available for loading time logs');
        return;
      }

      const numericPrivateUserId = Number(privateUserId);
      if (Number.isNaN(numericPrivateUserId)) {
        console.error('Invalid private user ID for time logs:', privateUserId);
        return;
      }

      console.log('Loading time logs from database for user:', numericPrivateUserId);
      if (!isMountedRef || isMountedRef.current) {
        setIsLoading(true);
      }

      const dateFrom = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const dateTo = format(new Date(), 'yyyy-MM-dd');

      const timeLogsResponse = await getUserTimeLogs(numericPrivateUserId, dateFrom, dateTo);
      let timeLogs: any[] = Array.isArray(timeLogsResponse) ? timeLogsResponse : [];
      let activeLog = timeLogs.find(log => log.start_time && !log.end_time);

      if (!activeLog) {
        const allTimeLogsResponse = await getUserTimeLogs(numericPrivateUserId);
        if (Array.isArray(allTimeLogsResponse)) {
          const activeLogFromAll = allTimeLogsResponse.find(log => log.start_time && !log.end_time);
          if (activeLogFromAll) {
            activeLog = activeLogFromAll;
            if (!timeLogs.some(log => log.timelog_id === activeLog.timelog_id)) {
              timeLogs = [activeLog, ...timeLogs];
            }
          }
        } else {
          console.warn('Unable to refresh active time log from backend:', allTimeLogsResponse);
        }
      }

      const dailyGroups: { [key: string]: DailyHistoryGroup } = {};

      timeLogs.forEach(log => {
        if (!log.start_time) return;

        const logDate = safeParseDate(log.start_time);
        if (!logDate) return;

        const dateKey = format(logDate, 'yyyy-MM-dd');
        if (!dailyGroups[dateKey]) {
          dailyGroups[dateKey] = {
            date: dateKey,
            day_of_week: format(logDate, 'EEEE'),
            events: [],
            total_hours_worked: 0,
            total_session_seconds: 0,
            total_break_seconds: 0,
            id: log.timelog_id,
            is_active_day: false,
          };
        }

        dailyGroups[dateKey].events.push({
          id: log.timelog_id,
          type: 'CLOCK_IN',
          timestamp: log.start_time,
          location: log.location?.clock_in?.address || log.location?.address,
        });

        let sessionBreakSeconds = 0;
        let hasActiveBreak = false;
        let hasCompletedBreak = false;

        if (log.breaks && Array.isArray(log.breaks) && log.breaks.length > 0) {
          log.breaks.forEach((breakLog: any) => {
            if (!breakLog.start_time) return;

            dailyGroups[dateKey].events.push({
              id: breakLog.break_id,
              type: 'BREAK_START',
              timestamp: breakLog.start_time,
            });

            const bStart = safeParseDate(breakLog.start_time);
            const bEnd = breakLog.end_time ? safeParseDate(breakLog.end_time) : new Date();
            if (bStart && bEnd) {
              const breakDuration = (bEnd.getTime() - bStart.getTime()) / 1000;
              sessionBreakSeconds += breakDuration;

              if (breakLog.end_time) {
                hasCompletedBreak = true;
                dailyGroups[dateKey].events.push({
                  id: breakLog.break_id,
                  type: 'BREAK_END',
                  timestamp: breakLog.end_time,
                  duration: formatSecondsToHMS(breakDuration),
                });
              } else {
                hasActiveBreak = true;
              }
            }
          });
        }

        const startTime = safeParseDate(log.start_time);
        if (log.end_time && startTime) {
          const endTime = safeParseDate(log.end_time);
          if (endTime) {
            const sessionDurationSeconds = (endTime.getTime() - startTime.getTime()) / 1000;
            const sessionDurationFormatted = formatSecondsToHMS(sessionDurationSeconds);

            const logHours = log.hours_worked != null ? parseFloat(String(log.hours_worked)) : (sessionDurationSeconds - sessionBreakSeconds) / 3600;
            dailyGroups[dateKey].total_hours_worked += Math.max(0, logHours);
            dailyGroups[dateKey].total_session_seconds += sessionDurationSeconds;
            dailyGroups[dateKey].total_break_seconds += sessionBreakSeconds;

            dailyGroups[dateKey].events.push({
              id: log.timelog_id,
              type: 'CLOCK_OUT',
              timestamp: log.end_time,
              duration: sessionDurationFormatted,
              location: log.location?.clock_out?.address,
            });
          }
        } else if (startTime) {
          const now = new Date();
          const activeSeconds = (now.getTime() - startTime.getTime()) / 1000;
          const activeHours = Math.max(0, (activeSeconds - sessionBreakSeconds) / 3600);

          dailyGroups[dateKey].total_hours_worked += activeHours;
          dailyGroups[dateKey].total_break_seconds += sessionBreakSeconds;
          dailyGroups[dateKey].is_active_day = true;

          if (log.timelog_id === activeTimeLogId) {
            // Reconcile the local break flag to server truth in BOTH directions.
            // Previously this only latched isBreaking -> true and never cleared
            // it, so a stale "on break" flag (e.g. an end-break whose response
            // was lost) could trap the employee on the "End Break" screen with
            // no open break server-side. Mirror the server's actual state.
            setIsBreaking(hasActiveBreak);
            AsyncStorage.setItem('isBreaking', String(hasActiveBreak));
          }
          if (hasCompletedBreak && log.timelog_id === activeTimeLogId) {
            setHasCompletedBreakThisSession(true);
          }
        }
      });

      const groupedHistory = Object.values(dailyGroups).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      groupedHistory.forEach(group => group.events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()));

      const normalizedStartTime = activeLog ? (safeParseDate(activeLog.start_time)?.toISOString() ?? activeLog.start_time) : null;

      if (!isMountedRef || isMountedRef.current) {
        setHistory(groupedHistory);
        await AsyncStorage.setItem('history', JSON.stringify(groupedHistory));
        setIsClockedIn(!!activeLog);
        setCurrentClockInTime(normalizedStartTime);
        setActiveTimeLogId(activeLog ? activeLog.timelog_id : null);
        if (!activeLog) {
          // No open session — there can't be an open break either.
          setIsBreaking(false);
          AsyncStorage.setItem('isBreaking', 'false');
        }
      }

      await AsyncStorage.setItem('isClockedIn', String(!!activeLog));
      if (activeLog) {
        if (normalizedStartTime) await AsyncStorage.setItem('currentClockInTime', normalizedStartTime);
        if (activeLog.timelog_id) await AsyncStorage.setItem('activeTimeLogId', String(activeLog.timelog_id));
      } else {
        await AsyncStorage.removeItem('currentClockInTime');
        await AsyncStorage.removeItem('activeTimeLogId');
      }
    } catch (error) {
      console.error('Error loading time logs from database:', error);
    } finally {
      if (!isMountedRef || isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [user, jobId, userDetails, activeTimeLogId]);

  const checkNotifications = useCallback(async () => {
    try {
      console.log('Checking for notifications...');
      const response = await getUserNotifications();
      
      if (Array.isArray(response)) {
        // Find overtime reminder notifications
        const overtimeReminder = response.find(
          n => !n.is_read && n.notification_type === 'clock_out_reminder'
        );
        
        if (overtimeReminder) {
          console.log('Found active overtime reminder:', overtimeReminder);
          setActiveOvertimeNotification(overtimeReminder);
          setIsOvertimeModalOpen(true);
        }
      }
    } catch (error) {
      console.error('Error checking notifications:', error);
    }
  }, []);

  const handleOvertimeSubmit = async () => {
    const timeLogId = activeOvertimeNotification?.related_entity_id ?? activeTimeLogId;
    if (!timeLogId) return;
    
    setIsLoading(true);
    try {
      // Late start: just save the reason on the time log (normal pay).
      if (modalMode === 'late') {
        const lateRes = await updateTimeLog(timeLogId, { late_reason: overtimeReason } as any);
        if (!(lateRes as any)?.error) {
          Alert.alert(t('clockIn.successTitle'), t('clockIn.lateReasonSavedBody', { defaultValue: 'Late-start reason saved.' }));
          setIsOvertimeModalOpen(false);
          setOvertimeReason("");
          await loadTimeLogsFromDatabase();
        } else {
          Alert.alert(t('clockIn.errorTitle'), (lateRes as any).error || t('clockIn.overtimeFailedBody'));
        }
        return;
      }
      // Mark as overtime
      const result = await markTimeLogAsOvertime(timeLogId, overtimeReason);
      
      if (!(result as any).error) {
        // Only mark notification as read if it exists
        if (activeOvertimeNotification?.notification_id) {
          await markNotificationAsRead(activeOvertimeNotification.notification_id);
        }
        
        Alert.alert(t('clockIn.successTitle'), t('clockIn.overtimeRegisteredBody'));
        setIsOvertimeModalOpen(false);
        setActiveOvertimeNotification(null);
        setOvertimeReason("");

        // Refresh logs to show updated status if needed
        await loadTimeLogsFromDatabase();
      } else {
        Alert.alert(t('clockIn.errorTitle'), (result as any).error || t('clockIn.overtimeFailedBody'));
      }
    } catch (error) {
      console.error("Overtime submission failed:", error);
      Alert.alert(t('clockIn.errorTitle'), t('clockIn.overtimeUnexpectedBody'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleOvertimeDismiss = async () => {
    try {
      if (activeOvertimeNotification) {
        // Mark the notification as read when dismissing
        await markNotificationAsRead(activeOvertimeNotification.notification_id);
        setActiveOvertimeNotification(null);
      }
      setIsOvertimeModalOpen(false);
      setOvertimeReason("");
    } catch (error) {
      console.error("Error dismissing notification:", error);
      setIsOvertimeModalOpen(false);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        loadTimeLogsFromDatabase(),
        loadLeaveRequests(),
        loadLeaveQuotas(),
        loadSalaryData(),
        checkNotifications()
      ]);
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  }, [loadTimeLogsFromDatabase, loadLeaveRequests, loadLeaveQuotas, checkNotifications, loadSalaryData]);

  // Automatic refresh when page comes into focus
  useFocusEffect(
    useCallback(() => {
      // Only refresh if not already loading and we have a user
      if (user && !isLoading && !refreshing) {
        console.log('🔄 ClockIn: Auto-refreshing on focus');
        onRefresh();
      }
    }, [user, onRefresh])
  );

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      if (!isMounted) return;

      try {
        await getTimeSheet();

        if (user && isMounted) {
          await Promise.all([
            loadTimeLogsFromDatabase(),
            loadLeaveRequests(),
            loadLeaveQuotas(),
            loadSalaryData()
          ]);
        }
      } catch (error) {
        if (isMounted) {
          console.error('Error loading data:', error);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
    };
  }, [getTimeSheet, user, loadTimeLogsFromDatabase, loadLeaveRequests, loadLeaveQuotas]);

  useEffect(() => {
    let isMounted = true;

    const loadUserDetails = async () => {
      if (!user?.user_id || !isMounted) return;

      try {
        console.log('Loading user details for user_id:', user.user_id);
        const userInfo = await getUserDetail(user.user_id);

        if (isMounted) {
          if (userInfo && !('error' in userInfo)) {
            setUserDetails(userInfo);
            console.log('User details loaded successfully');
          } else {
            console.error('Failed to load user details:', userInfo);
          }
        }
      } catch (error) {
        if (isMounted) {
          console.error('Error loading user details:', error);
        }
      }
    };

    loadUserDetails();

    return () => {
      isMounted = false;
    };
  }, [user?.user_id]);

  useEffect(() => {
    let isMounted = true;

    if (user) {
      const getJobId = async () => {
        try {
          const privateUserId = user?.private_user_id || user?.private_user?.private_user_id;
          if (privateUserId && isMounted) {
            const numericPrivateUserId = Number(privateUserId);
            if (isNaN(numericPrivateUserId)) {
              console.error('Invalid private_user_id - not a number:', privateUserId);
              return;
            }
            const jobResponse = await getJobById(numericPrivateUserId);
            if (isMounted) {
              if (jobResponse && !('error' in jobResponse) && jobResponse.job_id) {
                setJobId(jobResponse.job_id);
                const threshold = (jobResponse as any).minimum_break_minutes;
                if (threshold && threshold > 0) setMinBreakThresholdMinutes(threshold);
              } else if (jobResponse && 'error' in jobResponse && jobResponse.status !== 404) {
                console.error('Job API returned error:', jobResponse);
              }
            }
          }
        } catch (error) {
          if (isMounted) {
            console.error('Failed to fetch job ID:', error);
          }
        }
      };
      getJobId();
    }

    return () => {
      isMounted = false;
    };
  }, [user]);

  // Tick every minute so the break compliance check stays current
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  // Reset break alert dismissal + completed-break memory on each new
  // clock-in; reset overtime alert flag on clock-out
  useEffect(() => {
    if (isClockedIn) {
      setBreakAlertDismissed(false);
      setHasCompletedBreakThisSession(false);
    } else {
      setOvertimeAlertShown(false);
    }
  }, [isClockedIn]);

  // Compute elapsed minutes since clock-in (excludes break time as a best-effort)
  const elapsedMinutesSinceClockIn = useMemo(() => {
    if (!isClockedIn || !currentClockInTime) return 0;
    const start = safeParseDate(currentClockInTime)?.getTime() ?? 0;
    if (!start) return 0;
    return Math.floor((currentTime.getTime() - start) / 60_000);
  }, [isClockedIn, currentClockInTime, currentTime]);

  // A day is scheduled if its key is present in work_days with a non-"off" value.
  // The profile stores keys as capitalized day names ("Monday") and values as
  // per-day HOURS (e.g. "8") — NOT the literal "on". Tolerate either key case +
  // off/false/0/empty, matching the profile editor and backend _is_workday.
  const isScheduledWorkDay = (date: Date): boolean => {
    if (!workDays) return false;
    const name = format(date, 'EEEE'); // e.g. "Monday"
    const raw = workDays[name] ?? workDays[name.toLowerCase()];
    if (raw === undefined || raw === null) return false;
    const v = String(raw).trim().toLowerCase();
    return v !== '' && v !== 'off' && v !== 'false' && v !== '0';
  };

  // Is today a scheduled work day?
  const isWorkDayToday = useMemo(() => isScheduledWorkDay(currentTime), [workDays, currentTime]);

  // Minutes remaining until the scheduled clock-out time today (null = no countdown).
  // Only meaningful while clocked in on a work day; null otherwise so we render nothing.
  const minutesUntilClockOut = useMemo(() => {
    if (!isClockedIn || !isWorkDayToday || !workEndTime) return null;
    const [h, m] = workEndTime.split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) return null;
    const remaining = (h * 60 + m) - (currentTime.getHours() * 60 + currentTime.getMinutes());
    return remaining;
  }, [isClockedIn, isWorkDayToday, workEndTime, currentTime]);

  // Escalating in-app feedback for the clock-out countdown (no push needed):
  //   > 5 min  → calm teal "Xh Ym until clock-out"
  //   0–5 min  → urgent red "Clock out in Xm" + a gentle pulse (handled in JSX)
  //   ≤ 0      → amber "past clock-out"
  const clockOutPill = useMemo(() => {
    if (minutesUntilClockOut === null) return null;
    const m = minutesUntilClockOut;
    const past = m <= 0;
    const urgent = m > 0 && m <= 5;
    const time = Math.floor(m / 60) > 0 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
    return {
      urgent,
      bg: past ? Palette.warningTint : urgent ? Palette.errorTint : Palette.tealTint,
      fg: past ? Palette.warning : urgent ? Palette.error : Palette.teal,
      label: past
        ? t('clockIn.pastClockOut')
        : urgent
          ? t('clockIn.clockOutSoon', { time: `${m}m` })
          : t('clockIn.untilClockOut', { time }),
    };
  }, [minutesUntilClockOut, t]);

  // One-time gentle haptic when the countdown first enters the final 5 minutes.
  const clockOutBuzzedRef = useRef(false);
  useEffect(() => {
    const m = minutesUntilClockOut;
    if (m !== null && m > 0 && m <= 5) {
      if (!clockOutBuzzedRef.current) {
        clockOutBuzzedRef.current = true;
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      }
    } else {
      clockOutBuzzedRef.current = false; // reset for the next shift/day
    }
  }, [minutesUntilClockOut]);

  // Duration-based overtime trigger (covers on-screen, app restart, cross-device resumption)
  useEffect(() => {
    if (isClockedIn && activeTimeLogId && !overtimeAlertShown &&
        elapsedMinutesSinceClockIn >= overtimeThresholdMinutes) {
      setOvertimeAlertShown(true);
      setIsOvertimeModalOpen(true);
    }
  }, [isClockedIn, activeTimeLogId, elapsedMinutesSinceClockIn, overtimeThresholdMinutes, overtimeAlertShown]);

  // Wall-clock overtime trigger: crossing work_end_time during an active session
  useEffect(() => {
    if (!isClockedIn || !activeTimeLogId || overtimeAlertShown || !workEndTime) return;
    const now = new Date();
    const [h, m] = workEndTime.split(':').map(Number);
    if ((now.getHours() * 60 + now.getMinutes()) >= (h * 60 + m)) {
      setOvertimeAlertShown(true);
      setIsOvertimeModalOpen(true);
    }
  }, [currentTime, isClockedIn, activeTimeLogId, workEndTime, overtimeAlertShown]);

  // Auto clock-out is SERVER-AUTHORITATIVE — there is no hardcoded client limit.
  // The backend closes overdue sessions via resolve_max_shift_hours
  // (Job → PrivateUser → Company → default), i.e. the EMPLOYER's settings override
  // the employee profile. The fetch endpoint (/time-logs/user/{id}) runs
  // check_for_missed_clockouts, so refreshing both triggers and reflects the
  // auto-close. Poll while clocked in so it shows promptly even if this screen
  // stays open.
  useFocusEffect(
    useCallback(() => {
      if (!user || !isClockedIn) return;
      const id = setInterval(() => { loadTimeLogsFromDatabase(); }, 60_000);
      return () => clearInterval(id);
    }, [user, isClockedIn, loadTimeLogsFromDatabase])
  );

  // See resolveShowBreakAlert.ts for the rule + its unit tests.
  const showBreakAlert = resolveShowBreakAlert({
    isClockedIn,
    isBreaking,
    breakAlertDismissed,
    hasCompletedBreakThisSession,
    elapsedMinutesSinceClockIn,
    minBreakThresholdMinutes,
  });

  const handleClockAction = async (action: 'clockin' | 'clockout') => {
    try {
      const locationResult = await getCurrentLocation();
      const { geo_check, ...locationData } = locationResult;

      const now = new Date();
      const nowISO = now.toISOString();
      const isClockInAction = action === 'clockin';
      const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long' });

      const privateUserId = user?.private_user_id || user?.private_user?.private_user_id;
      const numericPrivateUserId = privateUserId ? Number(privateUserId) : undefined;

      if (isClockInAction) {
        await loadTimeLogsFromDatabase();
        const lastActiveTimeLogId = await AsyncStorage.getItem('activeTimeLogId');
        if (lastActiveTimeLogId) {
          Alert.alert(
            t('clockIn.alreadyClockedInTitle'),
            t('clockIn.alreadyClockedInBody'),
            [{ text: t('common.ok') }]
          );
          return;
        }
        // Clock In
        const timeLogData = {
          job_id: jobId!,
          private_user_id: numericPrivateUserId!,
          day_of_week: dayOfWeek,
          start_time: nowISO,
          location: locationData,
          geo_check,
        };
        const response = await postClockIn(timeLogData);
        if (response && !('error' in response)) {
          console.log('Clock-in successful, backend response:', response);
          setActiveTimeLogId(response.timelog_id);
          await AsyncStorage.setItem('activeTimeLogId', String(response.timelog_id));
        } else {
          throw new Error((response as any)?.error || 'Failed to clock in on server.');
        }

        setIsClockedIn(true);
        setCurrentClockInTime(nowISO);
        await AsyncStorage.setItem('currentClockInTime', nowISO);
        await AsyncStorage.setItem('isClockedIn', 'true');

        // Schedule-aware prompt. Use the same 30-min grace as the backend so
        // we don't nag for a few minutes early/late.
        const GRACE = 30;
        const nowMinutes = now.getHours() * 60 + now.getMinutes();
        const startMin = workStartTime ? (() => { const [h, m] = workStartTime.split(':').map(Number); return h * 60 + m; })() : null;
        const endMin = workEndTime ? (() => { const [h, m] = workEndTime.split(':').map(Number); return h * 60 + m; })() : null;
        const isNonWorkDay = workDays ? !isScheduledWorkDay(now) : false;
        const isEarly = startMin !== null ? nowMinutes < startMin - GRACE : false;
        const isAfterEnd = endMin !== null ? nowMinutes > endMin + GRACE : false;
        const isOffHours = isNonWorkDay || isEarly || isAfterEnd;       // → "overtime?" prompt
        const isLate = !isOffHours && startMin !== null && nowMinutes > startMin + GRACE; // → "reason?" prompt
        if (isOffHours && !overtimeAlertShown) {
          setOvertimeAlertShown(true);
          setModalMode('overtime');
          setIsOvertimeModalOpen(true);
        } else if (isLate && !overtimeAlertShown) {
          setOvertimeAlertShown(true);
          setModalMode('late');
          setIsOvertimeModalOpen(true);
        }
      } else {
        // Clock Out
        if (!activeTimeLogId) throw new Error("No active clock-in session found to clock out.");

        const timeLogData: Partial<TimeLog> = {
          end_time: nowISO,
          location: locationData,
          geo_check,
        };
        const response = await updateTimeLog(activeTimeLogId, timeLogData);

        if (response && !('error' in response)) {
          console.log('Clock-out successful, backend response:', response);
        } else {
          throw new Error((response as any)?.error || 'Failed to clock out on server.');
        }

        setIsClockedIn(false);
        setCurrentClockInTime(null);
        setIsBreaking(false);
        setActiveTimeLogId(null);
        await AsyncStorage.removeItem('currentClockInTime');
        await AsyncStorage.removeItem('isClockedIn');
        await AsyncStorage.removeItem('activeTimeLogId');
        await AsyncStorage.removeItem('breakStart');
        await AsyncStorage.removeItem('breakDurations');
        await AsyncStorage.removeItem('isBreaking');
      }

      // Refresh data from database
      await loadTimeLogsFromDatabase();

      console.log(`Performed ${action} at ${nowISO}`);
    } catch (err: any) {
      console.error('Clock-in/out failed:', err);
      Alert.alert(t('clockIn.errorTitle'), t('clockIn.operationFailedBody', { message: err.message || 'Unknown error' }));
    }
  };

  const handleClockToggle = async () => {
    if (!jobId) {
      Alert.alert(
        t('clockIn.jobRequiredTitle'),
        t('clockIn.jobRequiredBody')
      );
      return;
    }

    if (locationAuthorized === null || !currentCoordinates) {
      await requestAndGetLocation();
      if (locationAuthorized === false || !currentCoordinates) {
        Alert.alert(
          t('clockIn.locationRequiredTitle'),
          t('clockIn.locationRequiredBody')
        );
        return;
      }
    }

    if (isClockedIn) {
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          t('clockIn.clockOutConfirmTitle'),
          t('clockIn.clockOutConfirmBody'),
          [
            { text: t('clockIn.cancelAction'), style: 'cancel', onPress: () => resolve(false) },
            { text: t('clockIn.clockOutAction'), style: 'destructive', onPress: () => resolve(true) },
          ],
        );
      });
      if (!confirmed) return;
    }

    setIsLoading(true);
    try {
      const action = isClockedIn ? 'clockout' : 'clockin';
      console.log(`🕐 Starting ${action} with jobId: ${jobId}, privateUserId: ${user?.private_user_id || user?.private_user?.private_user_id}`);

      await handleClockAction(action);

      if (action === 'clockout' && currentClockInTime) {
        const clockOutTime = new Date();
        const clockOutTimeFormatted = format(clockOutTime, 'PPpp');
        const clockInTimeFormatted = format(parseISO(currentClockInTime), 'PPpp');

        Alert.alert(
          t('clockIn.clockOutSummaryTitle'),
          t('clockIn.clockOutSummaryBody', { clockIn: clockInTimeFormatted, clockOut: clockOutTimeFormatted }),
          [{ text: t('common.ok') }]
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleBreakToggle = async () => {
    if (!isClockedIn) {
      Alert.alert(t('clockIn.breakNotAllowedTitle'), t('clockIn.breakNotAllowedBody'));
      return;
    }

    if (!jobId || !activeTimeLogId) {
      Alert.alert(t('clockIn.errorTitle'), t('clockIn.breakConfigErrorBody'));
      return;
    }

    try {
      const now = new Date();
      const nowISO = now.toISOString();

      console.log(`🍽️ ${isBreaking ? 'Ending' : 'Starting'} break at ${nowISO}`);

      if (isBreaking) {
        // End break
        const response = await endBreak(activeTimeLogId);
        if (response && !('error' in response)) {
          console.log('Break end successful, backend response:', response);
          await AsyncStorage.removeItem('breakStart');
        } else if (
          (response as any)?.status === 404 ||
          /no active break/i.test((response as any)?.error || '')
        ) {
          // Self-heal: the server has no open break, so our local "on break"
          // flag is stale (e.g. a previous end-break succeeded but its response
          // was lost). The desired end state is already reached — clear the
          // local break state instead of trapping the employee in an error loop.
          console.warn('End break: server reports no active break, clearing stale local break state.');
          await AsyncStorage.removeItem('breakStart');
        } else {
          throw new Error((response as any)?.error || 'Failed to end break on server.');
        }
      } else {
        // Start break
        const response = await startBreak(activeTimeLogId);
        if (response && !('error' in response)) {
          console.log('Break start successful, backend response:', response);
          await AsyncStorage.setItem('breakStart', nowISO);
        } else {
          throw new Error((response as any)?.error || 'Failed to start break on server.');
        }
      }

      setIsBreaking(!isBreaking);
      await AsyncStorage.setItem('isBreaking', String(!isBreaking));

      // Refresh data from database
      await loadTimeLogsFromDatabase();

    } catch (err: any) {
      console.error('Break toggle failed:', err);
      Alert.alert(t('clockIn.errorTitle'), t('clockIn.operationFailedBody', { message: err.message || 'Unknown error' }));
    }
  };

  // Calendar helper functions
  const getDaysInMonth = () => {
    const start = startOfMonth(currentMonth);
    const end = endOfMonth(currentMonth);
    const days = eachDayOfInterval({ start, end });

    const startDay = start.getDay();
    const emptyDays = Array(startDay).fill(null);

    return [...emptyDays, ...days];
  };

  const getClockInDataForDate = (date: Date) => {
    const dateKey = format(date, 'yyyy-MM-dd');
    return history.filter(entry =>
      entry.date === dateKey &&
      (entry.total_hours_worked > 0 || entry.is_active_day)
    );
  };

  const getTimeOffForDate = (date: Date) => {
    return timeOffRequests.filter(request =>
      isSameDay(new Date(request.date), date)
    );
  };

  const handleDateSelect = (date: Date) => {
    if (clockInMode === 'leave') {
      setSelectedDateRange(prev => {
        if (!prev.startDate || (prev.startDate && prev.endDate)) {
          // First tap or reset: set start date
          return { startDate: date, endDate: null };
        }
        // Second tap: set end date and open modal
        const start = isBefore(date, prev.startDate) ? date : prev.startDate;
        const end = isBefore(date, prev.startDate) ? prev.startDate : date;
        setTimeout(() => setTimeOffModalOpen(true), 200);
        return { startDate: start, endDate: end };
      });
    } else {
      setSelectedDateRange({ startDate: date, endDate: null });
    }
  };

  const handleQuickSelect = (duration: '1week' | '2weeks' | '1month') => {
    const start = new Date();
    let end: Date;
    switch (duration) {
      case '1week': end = addWeeks(start, 1); break;
      case '2weeks': end = addWeeks(start, 2); break;
      case '1month': end = addMonths(start, 1); break;
    }
    setSelectedDateRange({ startDate: start, endDate: end });
    setTimeout(() => setTimeOffModalOpen(true), 200);
  };

  const isDateInRange = (date: Date) => {
    const { startDate, endDate } = selectedDateRange;
    if (!startDate) return false;
    if (!endDate) return isSameDay(date, startDate);
    return isWithinInterval(date, { start: startDate, end: endDate });
  };

  const isRangeStart = (date: Date) => selectedDateRange.startDate ? isSameDay(date, selectedDateRange.startDate) : false;
  const isRangeEnd = (date: Date) => selectedDateRange.endDate ? isSameDay(date, selectedDateRange.endDate) : false;

  // ─── Leave tab helpers (leave.tsx-style) ────────────────────────────────────

  const toggleLeaveDay = (dateStr: string) => {
    setSelectedDates(prev => prev.includes(dateStr) ? prev.filter(d => d !== dateStr) : [...prev, dateStr]);
  };

  const applyLeavePreset = (preset: 'today' | 'week' | 'next_week' | 'month') => {
    const now = new Date();
    if (preset === 'today') {
      setSelectedDates([format(now, 'yyyy-MM-dd')]);
    } else if (preset === 'week') {
      const start = startOfWeek(now, { weekStartsOn: 1 });
      const end = endOfWeek(now, { weekStartsOn: 1 });
      setSelectedDates(eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd')));
      setCurrentMonth(start);
    } else if (preset === 'next_week') {
      const start = addWeeks(startOfWeek(now, { weekStartsOn: 1 }), 1);
      const end = addWeeks(endOfWeek(now, { weekStartsOn: 1 }), 1);
      setSelectedDates(eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd')));
      setCurrentMonth(start);
    } else if (preset === 'month') {
      const start = startOfMonth(now);
      const end = endOfMonth(now);
      setSelectedDates(eachDayOfInterval({ start, end }).map(d => format(d, 'yyyy-MM-dd')));
    }
  };

  const buildLeaveCalendarGrid = (): Date[] => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
    const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  };

  const groupLeaveConsecutiveDates = (dates: string[]): { start: string; end: string }[] => {
    if (dates.length === 0) return [];
    const sorted = [...dates].sort();
    const ranges: { start: string; end: string }[] = [];
    let rangeStart = sorted[0];
    let prev = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const curr = sorted[i];
      const diffDays = (parseISO(curr).getTime() - parseISO(prev).getTime()) / (1000 * 60 * 60 * 24);
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
  };

  const submitLeaveInline = async () => {
    if (selectedDates.length === 0) {
      Alert.alert(t('clockIn.noDatesTitle'), t('clockIn.noDatesBody'));
      return;
    }
    const privateUserId = user?.private_user_id || user?.private_user?.private_user_id;
    if (!privateUserId) {
      Alert.alert(t('clockIn.errorTitle'), t('clockIn.userIdentifyError'));
      return;
    }
    const ranges = groupLeaveConsecutiveDates(selectedDates);
    setIsSubmittingLeave(true);
    try {
      const results = await Promise.all(
        ranges.map(r => createLeaveRequest({
          private_user_id: Number(privateUserId),
          leave_type: leaveTypeClockIn,
          start_date: r.start,
          end_date: r.end,
          status: 'pending',
          notes: leaveNotesClockIn.trim() || undefined,
        }))
      );
      const allOk = results.every(r => !(r as any).error);
      if (allOk) {
        setSelectedDates([]);
        setLeaveNotesClockIn('');
        await loadLeaveRequests();
        setClockInLeaveTab('history');
        Alert.alert(
          t('clockIn.successTitle'),
          ranges.length === 1
            ? t('clockIn.leaveSubmittedSingular', { count: ranges.length })
            : t('clockIn.leaveSubmittedPlural', { count: ranges.length })
        );
      } else {
        Alert.alert(t('clockIn.errorTitle'), t('clockIn.leaveSomeFailed'));
      }
    } catch {
      Alert.alert(t('clockIn.errorTitle'), t('clockIn.leaveUnexpectedError'));
    } finally {
      setIsSubmittingLeave(false);
    }
  };

  const submitTimeOffRequest = async (data: LeaveRequestFormData) => {
    const { startDate, endDate } = selectedDateRange;
    if (!startDate) {
      Alert.alert(t('clockIn.errorTitle'), t('clockIn.leaveDateRequired'));
      return;
    }

    const privateUserId = user?.private_user_id || user?.private_user?.private_user_id;
    if (!privateUserId) {
      Alert.alert(t('clockIn.errorTitle'), t('clockIn.userIdentifyError'));
      return;
    }

    const effectiveEndDate = endDate || startDate;
    const payload = {
      private_user_id: Number(privateUserId),
      leave_type: data.leaveType,
      start_date: format(startDate, 'yyyy-MM-dd'),
      end_date: format(effectiveEndDate, 'yyyy-MM-dd'),
      status: 'pending',
      submitted: new Date().toISOString(),
      notes: data.leaveReason,
    };

    try {
      const response = await createLeaveRequest(payload);

      if (response && response.status === 'success' && response.data) {
        const leaveData = response.data;
        const newRequest = {
          id: leaveData.leave_id,
          date: new Date(leaveData.start_date).toISOString(),
          end_date: leaveData.end_date,
          type: leaveData.leave_type,
          reason: leaveData.notes,
          status: leaveData.status,
          submitted: leaveData.created_at,
        };
        setTimeOffRequests(prev => [...prev, newRequest].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
        setTimeOffModalOpen(false);
        resetLeaveForm();
        setSelectedDateRange({ startDate: null, endDate: null });
        Alert.alert(t('clockIn.successTitle'), t('clockIn.leaveSubmittedSuccess'));
      } else {
        Alert.alert(t('clockIn.errorTitle'), (response as any)?.error || t('clockIn.leaveSubmitFailed'));
      }
    } catch (error) {
      console.error('An unexpected error occurred during leave submission:', error);
      Alert.alert(t('clockIn.errorTitle'), t('clockIn.overtimeUnexpectedBody'));
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }} edges={['top']}>
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
          overScrollMode="never"
          contentContainerStyle={{
            paddingTop: 12,
            paddingHorizontal: 4,
            paddingBottom: 160
          }}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={Palette.gray700}
              colors={[Palette.gray700, Palette.ink]}
              progressBackgroundColor={Palette.gray100}
            />
          }
        >
          <View>
            {/* Page Header Banner */}
            <LinearGradient
              colors={[Palette.gray100, Palette.gray50, 'white']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{
                borderRadius: 20,
                padding: 16,
                borderWidth: 1,
                borderColor: Palette.gray200,
                marginHorizontal: 8,
                marginBottom: 12,
              }}
            >
              <HStack justifyContent="space-between" alignItems="center">
                <VStack>
                  <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray700} style={{ textTransform: 'uppercase', letterSpacing: 1.2 }}>
                    {t('clockIn.pageEyebrow')}
                  </Text>
                  <Heading fontSize={Type.h1} fontWeight="800" color={Palette.ink} lineHeight={32}>
                    {t('clockIn.pageTitle')}
                  </Heading>
                </VStack>
                <Box
                  bg="white"
                  p="$3"
                  rounded="$2xl"
                  borderWidth={1}
                  borderColor={Palette.gray200}
                  style={{ shadowColor: Palette.gray700, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 8, elevation: 4 }}
                >
                  <MaterialIcons name="fingerprint" size={28} color={Palette.gray700} />
                </Box>
              </HStack>
              <HStack space="lg" mt="$3">
                <HStack alignItems="center" space="xs">
                  <MaterialIcons name="check-circle" size={13} color={Palette.success} />
                  <Text fontSize={Type.small} color={Palette.gray500}>{t('clockIn.badgeGpsTracked')}</Text>
                </HStack>
                <HStack alignItems="center" space="xs">
                  <MaterialIcons name="schedule" size={13} color={Palette.gray700} />
                  <Text fontSize={Type.small} color={Palette.gray500}>{t('clockIn.badgeRealtime')}</Text>
                </HStack>
                <HStack alignItems="center" space="xs">
                  <MaterialIcons name="event-note" size={13} color={Palette.gray700} />
                  <Text fontSize={Type.small} color={Palette.gray500}>{t('clockIn.badgeLeaveRequests')}</Text>
                </HStack>
              </HStack>
            </LinearGradient>

            {/* Clock-In Mode Tabs */}
            <ClockInModeTabs
              clockInMode={clockInMode}
              setClockInMode={(mode) => {
                // Unify leave UX: the "Leave" tab opens the single canonical
                // Leave screen (leave.tsx) — same types (Maternity/Paternity/Sick),
                // button and design — instead of a divergent inline copy.
                if (mode === 'leave') { router.push('/private_dashboard/leave'); return; }
                setClockInMode(mode);
              }}
              primary={primary}
            />

            {/* Main Clock Action Section */}
            {clockInMode === 'clockin' && (
              <Box bg="white" rounded="$3xl" p="$4" mx="$2" mb="$4" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 4 }} shadowOpacity={0.1} shadowRadius={12} elevation={8}>
                <VStack w="$full" space="lg" alignItems="center">
                  {/* Primary Clock Button */}
                  <Pressable
                    onPress={handleClockToggle}
                    disabled={!locationAuthorized || !currentCoordinates || !jobId || isLoading}
                  >
                    <Box
                      w={140}
                      h={140}
                      rounded="$full"
                      bg={(!locationAuthorized || !currentCoordinates || !jobId) ? Palette.gray300 : (isClockedIn ? Palette.success : Palette.indigo)}
                      justifyContent="center"
                      alignItems="center"
                      shadowColor={Palette.black}
                      shadowOffset={{ width: 0, height: 6 }}
                      shadowOpacity={0.25}
                      shadowRadius={8}
                      style={{ elevation: 12 }}
                    >
                      <VStack alignItems="center" space="xs">
                        {isLoading ? (
                          <Spinner size="large" color="white" />
                        ) : (
                          <>
                            <MaterialIcons
                              name={isClockedIn ? "logout" : "login"}
                              size={32}
                              color="white"
                            />
                            <Text fontSize={Type.title} fontWeight="700" color="white">
                              {!jobId ? t('clockIn.buttonNoJob') : !locationAuthorized ? t('clockIn.buttonNoLocation') : (isClockedIn ? t('clockIn.buttonClockOut') : t('clockIn.buttonClockIn'))}
                            </Text>
                          </>
                        )}
                      </VStack>
                    </Box>
                  </Pressable>

                  {/* Elapsed Time Display */}
                  {isClockedIn && (
                    <VStack alignItems="center" space="xs">
                      <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray400} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>
                        {t('clockIn.elapsedLabel')}
                      </Text>
                      <Text fontSize={Type.h1} fontWeight="800" color={Palette.gray700} style={{ letterSpacing: -0.5 }}>
                        {Math.floor(elapsedMinutesSinceClockIn / 60) > 0
                          ? `${Math.floor(elapsedMinutesSinceClockIn / 60)}h ${elapsedMinutesSinceClockIn % 60}m`
                          : `${elapsedMinutesSinceClockIn}m`}
                      </Text>
                      {currentClockInTime && (
                        <Text fontSize={Type.small} color={Palette.gray400}>
                          {t('clockIn.elapsedSince', { time: format(safeParseDate(currentClockInTime) ?? new Date(), 'h:mm a') })}
                        </Text>
                      )}
                      {/* Countdown to scheduled clock-out — calm → urgent (pulse + haptic) as it nears */}
                      {clockOutPill && (
                        <MotiView
                          animate={{ scale: clockOutPill.urgent ? 1.05 : 1 }}
                          transition={{ type: 'timing', duration: 700, loop: clockOutPill.urgent, repeatReverse: true }}
                          style={{ marginTop: 6 }}
                        >
                          <Box bg={clockOutPill.bg} px="$3" py="$1" rounded="$full">
                            <Text fontSize={Type.small} fontWeight="700" color={clockOutPill.fg}>
                              {clockOutPill.label}
                            </Text>
                          </Box>
                        </MotiView>
                      )}
                    </VStack>
                  )}

                  {/* Status Messages */}
                  {!jobId && (
                    <Box bg={Palette.warningTint} p="$3" rounded="$xl" borderWidth={1} borderColor={Palette.warningTint}>
                      <Text color={Palette.warning} fontSize={Type.body} textAlign="center">
                        {t('clockIn.warnNoJob')}
                      </Text>
                    </Box>
                  )}

                  {!locationAuthorized && (
                    <Box bg={Palette.errorTint} p="$3" rounded="$xl" borderWidth={1} borderColor={Palette.errorTint}>
                      <Text color={Palette.error} fontSize={Type.body} textAlign="center">
                        {t('clockIn.warnNoLocation')}
                      </Text>
                    </Box>
                  )}

                  {/* Break compliance alert */}
                  {showBreakAlert && (
                    <Box bg={Palette.warningTint} p="$3" rounded="$xl" borderWidth={1} borderColor={Palette.warning} w="$full">
                      <HStack justifyContent="space-between" alignItems="center">
                        <VStack flex={1} mr="$2">
                          <Text color={Palette.gold} fontSize={Type.body} fontWeight="700">
                            {t('clockIn.takeBreakTitle')}
                          </Text>
                          <Text color={Palette.warning} fontSize={Type.label} mt="$0.5">
                            {elapsedMinutesSinceClockIn % 60 > 0
                              ? t('clockIn.takeBreakBodyHM', { hours: Math.floor(elapsedMinutesSinceClockIn / 60), minutes: elapsedMinutesSinceClockIn % 60 })
                              : t('clockIn.takeBreakBodyH', { hours: Math.floor(elapsedMinutesSinceClockIn / 60) })}
                          </Text>
                        </VStack>
                        <Pressable onPress={() => setBreakAlertDismissed(true)} p="$1">
                          <MaterialIcons name="close" size={18} color={Palette.gold} />
                        </Pressable>
                      </HStack>
                    </Box>
                  )}

                  {/* Break Button - Only show when clocked in */}
                  {isClockedIn && (
                    <Pressable
                      onPress={handleBreakToggle}
                      disabled={!locationAuthorized || !currentCoordinates || !jobId || isLoading}
                    >
                      <Box
                        w={140}
                        h={50}
                        rounded="$2xl"
                        bg={(!locationAuthorized || !currentCoordinates || !jobId) ? Palette.gray300 : (isBreaking ? Palette.warning : Palette.gray700)}
                        justifyContent="center"
                        alignItems="center"
                        shadowColor={Palette.black}
                        shadowOffset={{ width: 0, height: 3 }}
                        shadowOpacity={0.15}
                        shadowRadius={4}
                        style={{ elevation: 6 }}
                      >
                        <HStack alignItems="center" space="xs">
                          <MaterialIcons
                            name={isBreaking ? "play-arrow" : "pause"}
                            size={20}
                            color="white"
                          />
                          <Text fontSize={Type.body} fontWeight="700" color="white">
                            {isBreaking ? t('clockIn.endBreak') : t('clockIn.startBreak')}
                          </Text>
                        </HStack>
                      </Box>
                    </Pressable>
                  )}

                  {/* Fallback Overtime Button - show when clocked in past standard hours */}
                  {isClockedIn && activeTimeLogId && elapsedMinutesSinceClockIn >= overtimeThresholdMinutes && (
                    <Pressable
                      onPress={() => setIsOvertimeModalOpen(true)}
                    >
                      <Box
                        w={140}
                        h={50}
                        rounded="$2xl"
                        bg="white"
                        borderWidth={2}
                        borderColor={Palette.gold}
                        justifyContent="center"
                        alignItems="center"
                        shadowColor={Palette.gold}
                        shadowOffset={{ width: 0, height: 2 }}
                        shadowOpacity={0.15}
                        shadowRadius={4}
                        style={{ elevation: 4 }}
                      >
                        <HStack alignItems="center" space="xs">
                          <MaterialIcons name="schedule" size={18} color={Palette.gold} />
                          <Text fontSize={Type.label} fontWeight="700" color={Palette.gold}>
                            {t('clockIn.overtimeButton')}
                          </Text>
                        </HStack>
                      </Box>
                    </Pressable>
                  )}

                  {/* Status Indicators */}
                  <HStack space="md" mt="$4" flexWrap="wrap" justifyContent="center">
                    <Box
                      bg={isClockedIn ? Palette.successTint : Palette.gray100}
                      px="$4"
                      py="$2"
                      rounded="$full"
                      borderWidth={1}
                      borderColor={isClockedIn ? Palette.successTint : Palette.gray200}
                      minWidth={0}
                    >
                      <Text
                        color={isClockedIn ? Palette.success : Palette.gray600}
                        fontWeight="600"
                        fontSize={Type.small}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                        textAlign="center"
                      >
                        {isClockedIn ? t('clockIn.statusClockedIn') : t('clockIn.statusClockedOut')}
                      </Text>
                    </Box>

                    {isBreaking && (
                      <Box
                        bg={Palette.warningTint}
                        px="$4"
                        py="$2"
                        rounded="$full"
                        borderWidth={1}
                        borderColor={Palette.warningTint}
                        minWidth={0}
                      >
                        <Text color={Palette.warning} fontWeight="600" fontSize={Type.small} numberOfLines={1} ellipsizeMode="tail" textAlign="center">
                          {t('clockIn.statusOnBreak')}
                        </Text>
                      </Box>
                    )}
                  </HStack>
                </VStack>
              </Box>
            )}

            {/* Punch History Section */}
            {clockInMode === 'clockin' && (
              <Box bg="white" rounded="$3xl" p="$2" mx="$2" mb="$4" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 4 }} shadowOpacity={0.1} shadowRadius={12} elevation={8}>
                <HStack alignItems="center" justifyContent="space-between" mb="$2">
                  <HStack alignItems="center" space="sm" flex={1}>
                    <Box bg={Palette.gray100} p="$3" rounded="$full">
                      <MaterialIcons name="history" size={24} color={Palette.gray700} />
                    </Box>
                    <VStack flex={1}>
                      <Heading size="lg" color={Palette.ink} fontWeight="700" numberOfLines={1} ellipsizeMode="tail">
                        {t('clockIn.weeklyDashboard')}
                      </Heading>
                      <Text color={Palette.gray600} fontSize={Type.body} numberOfLines={1} ellipsizeMode="tail">
                        {t('clockIn.weeklyDashboardSubtitle')}
                      </Text>
                    </VStack>
                  </HStack>
                  <Pressable onPress={() => router.push('/private_dashboard/clockin_history')}>
                    <HStack alignItems="center" space="xs" flex={0} minWidth={0}>
                      <Text color={Palette.gray700} fontSize={Type.small} fontWeight="600" numberOfLines={1} ellipsizeMode="tail">
                        {t('clockIn.seeMore')}
                      </Text>
                      <MaterialIcons name="arrow-forward" size={14} color={Palette.gray700} />
                    </HStack>
                  </Pressable>
                </HStack>

                {/* Weekly Summary Stats */}
                <HStack space="md" mb="$4" px="$2">
                  <Box flex={1} bg={Palette.blueTint} p="$3" rounded="$2xl" borderWidth={1} borderColor={Palette.blueTint}>
                    <VStack alignItems="center" space="xs">
                      <MaterialIcons name="timer" size={16} color={Palette.blue} />
                      <Heading size="sm" color={Palette.ink}>{formatHoursToDisplay(weeklyTotal.hours)}</Heading>
                      <Text color={Palette.gray500} fontSize={Type.tiny} fontWeight="600">{t('clockIn.statHours')}</Text>
                    </VStack>
                  </Box>
                  <Box flex={1} bg={Palette.greenTint} p="$3" rounded="$2xl" borderWidth={1} borderColor={Palette.greenTint}>
                    <VStack alignItems="center" space="xs">
                      <MaterialIcons name="event-available" size={16} color={Palette.success} />
                      <Heading size="sm" color={Palette.ink}>{weeklyTotal.days}</Heading>
                      <Text color={Palette.gray500} fontSize={Type.tiny} fontWeight="600">{t('clockIn.statDays')}</Text>
                    </VStack>
                  </Box>
                  <Box flex={1} bg={Palette.violetTint} p="$3" rounded="$2xl" borderWidth={1} borderColor={Palette.violetTint}>
                    <VStack alignItems="center" space="xs">
                      <MaterialIcons name="payments" size={16} color={Palette.violet} />
                      <Heading
                        size="xs"
                        color={Palette.ink}
                        style={{ textAlign: 'center' }}
                      >
                        {/* Earnings are in the salary's own (country-derived)
                            currency — show as-is, no display-pref conversion. */}
                        {formatCurrency(weeklyTotal.earnings, { currencyCode: (salaryData as any)?.currency, convert: false })}
                      </Heading>
                      <Text color={Palette.gray500} fontSize={Type.tiny} fontWeight="600">{t('clockIn.statEarned')}</Text>
                    </VStack>
                  </Box>
                </HStack>

                <View>
                  {history.length === 0 ? (
                    <Box py="$10" alignItems="center" justifyContent="center">
                      <MaterialIcons name="history" size={40} color={Palette.gray300} />
                      <Text color={Palette.gray500} fontSize={Type.body} textAlign="center" mt="$3" px="$10">
                        {t('clockIn.emptyHistoryTitle')}
                      </Text>
                      <Text color={Palette.gray400} fontSize={Type.small} textAlign="center" mt="$1">
                        {t('clockIn.emptyHistoryHint')}
                      </Text>
                    </Box>
                  ) : (
                    history.map((group, index) => (
                      <HistoryItem
                        key={group?.date ? `date-${group.date}` : `index-${index}`}
                        group={group}
                        t={t}
                        onLocationPress={(addr) => {
                          setSelectedLocationAddress(addr);
                          setLocationModalOpen(true);
                        }}
                      />
                    ))
                  )}
                </View>
              </Box>
            )}

            {/* Calendar Section */}
            {clockInMode === 'leave' && (
              <MotiView
                from={{ opacity: 0, translateY: 20 }}
                animate={{ opacity: 1, translateY: 0 }}
                transition={{ type: 'timing', duration: 600, delay: 300 }}
              >
                {/* Tab Switcher */}
                <HStack mx="$2" mb="$4" bg={Palette.gray100} rounded="$xl" p="$1">
                  {(['request', 'history'] as const).map((tab) => (
                    <Pressable
                      key={tab}
                      flex={1}
                      onPress={() => setClockInLeaveTab(tab)}
                      bg={clockInLeaveTab === tab ? 'white' : 'transparent'}
                      py="$2"
                      rounded="$lg"
                      alignItems="center"
                      shadowColor={clockInLeaveTab === tab ? Palette.black : 'transparent'}
                      shadowOffset={{ width: 0, height: 1 }}
                      shadowOpacity={clockInLeaveTab === tab ? 0.08 : 0}
                      shadowRadius={4}
                      elevation={clockInLeaveTab === tab ? 2 : 0}
                    >
                      <Text fontWeight="700" fontSize={Type.body} color={clockInLeaveTab === tab ? Palette.ink : Palette.gray500}>
                        {tab === 'request' ? t('clockIn.tabNewRequest') : t('clockIn.tabMyRequests')}
                      </Text>
                    </Pressable>
                  ))}
                </HStack>

                {/* Leave Balance — hoisted above both sub-tabs (was previously
                    nested only inside 'request', so it silently disappeared
                    on 'history' — same placement bug already fixed in
                    private_dashboard/leave.tsx this session). */}
                {leaveQuotas.length > 0 && (
                  <Box mx="$2" mb="$4">
                    <Text fontWeight="700" fontSize={Type.label} color={Palette.gray500} mb="$2" textTransform="uppercase" letterSpacing={1}>
                      {t('clockIn.leaveBalanceLabel')}
                    </Text>
                    <HStack space="sm" flexWrap="wrap">
                      {leaveQuotas.map((quota) => {
                        const remaining = quota.total_days - quota.used_days;
                        return (
                          <Box key={quota.quota_id} bg={remaining > 0 ? Palette.greenTint : Palette.warningTint} px="$3" py="$1.5" rounded="$full" borderWidth={1} borderColor={remaining > 0 ? Palette.greenTint : Palette.warningTint} mb="$1">
                            <Text fontSize={Type.caption} fontWeight="700" color={remaining > 0 ? Palette.green : Palette.warning}>
                              {quota.leave_type}: {remaining}/{quota.total_days}
                            </Text>
                          </Box>
                        );
                      })}
                    </HStack>
                  </Box>
                )}

                {clockInLeaveTab === 'request' ? (
                  <Box>
                    {/* Quick Select */}
                    <Box mx="$2" mb="$4">
                      <Text fontWeight="700" fontSize={Type.label} color={Palette.gray500} mb="$2" textTransform="uppercase" letterSpacing={1}>
                        {t('clockIn.quickSelectLabel')}
                      </Text>
                      <HStack space="sm" flexWrap="wrap">
                        {([
                          { label: t('clockIn.quickToday'), preset: 'today' as const },
                          { label: t('clockIn.quickThisWeek'), preset: 'week' as const },
                          { label: t('clockIn.quickNextWeek'), preset: 'next_week' as const },
                          { label: t('clockIn.quickThisMonth'), preset: 'month' as const },
                        ]).map(({ label, preset }) => (
                          <Pressable
                            key={preset}
                            onPress={() => applyLeavePreset(preset)}
                            bg={Palette.blueTint}
                            borderWidth={1}
                            borderColor={Palette.gray200}
                            px="$3"
                            py="$1"
                            rounded="$full"
                            mb="$2"
                          >
                            <Text fontWeight="700" fontSize={Type.label} color={Palette.indigo}>{label}</Text>
                          </Pressable>
                        ))}
                      </HStack>
                    </Box>

                    {/* Calendar */}
                    <Box mx="$2" bg="white" rounded="$2xl" p="$4" mb="$4"
                      shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }}
                      shadowOpacity={0.06} shadowRadius={12} elevation={4}
                      borderWidth={1} borderColor={Palette.gray100}
                    >
                      {/* Month nav */}
                      <HStack justifyContent="space-between" alignItems="center" mb="$4">
                        <Pressable onPress={() => setCurrentMonth(m => subMonths(m, 1))} p="$2">
                          <MaterialIcons name="chevron-left" size={24} color={Palette.gray700} />
                        </Pressable>
                        <Text fontWeight="800" fontSize={Type.title} color={Palette.ink}>
                          {format(currentMonth, 'MMMM yyyy')}
                        </Text>
                        <Pressable onPress={() => setCurrentMonth(m => addMonths(m, 1))} p="$2">
                          <MaterialIcons name="chevron-right" size={24} color={Palette.gray700} />
                        </Pressable>
                      </HStack>

                      {/* Day headers (Mon-based) */}
                      <HStack mb="$2">
                        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
                          <Box key={i} width={LEAVE_DAY_SIZE} alignItems="center">
                            <Text fontSize={Type.small} fontWeight="700" color={Palette.gray500}>{d}</Text>
                          </Box>
                        ))}
                      </HStack>

                      {/* Day grid */}
                      <Box flexDirection="row" flexWrap="wrap">
                        {buildLeaveCalendarGrid().map((day) => {
                          const dateStr = format(day, 'yyyy-MM-dd');
                          const isSelected = selectedDates.includes(dateStr);
                          const isCurrentMonthDay = isSameMonth(day, currentMonth);
                          const isTodayDate = isToday(day);
                          const selectedLeaveTypeDef = LEAVE_TYPES_CI.find(lt => lt.key === leaveTypeClockIn);
                          return (
                            <Pressable
                              key={dateStr}
                              width={LEAVE_DAY_SIZE}
                              height={LEAVE_DAY_SIZE}
                              alignItems="center"
                              justifyContent="center"
                              onPress={() => isCurrentMonthDay && toggleLeaveDay(dateStr)}
                              mb="$1"
                            >
                              <Box
                                style={{
                                  width: LEAVE_DAY_SIZE - 6,
                                  height: LEAVE_DAY_SIZE - 6,
                                  borderRadius: (LEAVE_DAY_SIZE - 6) / 2,
                                  alignItems: 'center' as const,
                                  justifyContent: 'center' as const,
                                  backgroundColor: isSelected
                                    ? (selectedLeaveTypeDef?.color ?? Palette.blue)
                                    : isTodayDate ? Palette.blueTint : 'transparent',
                                  borderWidth: isTodayDate && !isSelected ? 1.5 : 0,
                                  borderColor: isTodayDate ? Palette.blue : 'transparent',
                                }}
                              >
                                <Text
                                  fontSize={Type.label}
                                  fontWeight={isSelected || isTodayDate ? '800' : '500'}
                                  color={
                                    isSelected ? 'white' :
                                    !isCurrentMonthDay ? Palette.gray300 :
                                    isTodayDate ? Palette.blue : Palette.gray800
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
                              <Text fontWeight="800" color={Palette.ink}>{selectedDates.length}</Text>
                              {' '}{selectedDates.length !== 1 ? t('clockIn.daysSelectedPlural') : t('clockIn.daysSelectedSingular')}
                            </Text>
                            <Pressable onPress={() => setSelectedDates([])}>
                              <Text fontSize={Type.label} color={Palette.error} fontWeight="700">{t('clockIn.clearAction')}</Text>
                            </Pressable>
                          </HStack>
                          {groupLeaveConsecutiveDates(selectedDates).map((range, i) => (
                            <HStack key={i} bg={Palette.blueTint} px="$3" py="$2" rounded="$lg" alignItems="center" space="sm">
                              <MaterialIcons name="date-range" size={14} color={Palette.blue} />
                              <Text fontSize={Type.small} fontWeight="700" color={Palette.indigo}>
                                {format(parseISO(range.start), 'EEE, MMM d')}
                                {range.start !== range.end ? ` → ${format(parseISO(range.end), 'EEE, MMM d')}` : ''}
                              </Text>
                            </HStack>
                          ))}
                        </VStack>
                      )}
                    </Box>

                    {/* Leave Type */}
                    <Box mx="$2" mb="$4">
                      <Text fontWeight="700" fontSize={Type.label} color={Palette.gray500} mb="$2" textTransform="uppercase" letterSpacing={1}>
                        {t('clockIn.leaveTypeLabel')}
                      </Text>
                      <HStack space="sm" flexWrap="wrap">
                        {LEAVE_TYPES_CI.map((type) => {
                          const active = leaveTypeClockIn === type.key;
                          return (
                            <Pressable
                              key={type.key}
                              onPress={() => setLeaveTypeClockIn(type.key)}
                              px="$4"
                              py="$2"
                              rounded="$full"
                              mb="$2"
                              borderWidth={1.5}
                              borderColor={active ? type.color : Palette.gray200}
                              bg={active ? type.color : 'white'}
                            >
                              <Text fontWeight="700" fontSize={Type.label} color={active ? 'white' : Palette.gray600}>
                                {t(type.labelKey)}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </HStack>
                    </Box>

                    {/* Notes */}
                    <Box mx="$2" mb="$6">
                      <Text fontWeight="700" fontSize={Type.label} color={Palette.gray500} mb="$2" textTransform="uppercase" letterSpacing={1}>
                        {t('clockIn.notesLabel')}
                      </Text>
                     <TextInput
                    placeholder={t('clockIn.notesPlaceholder')}
                    value={leaveNotesClockIn}
                    onChangeText={(text) => setLeaveNotesClockIn(text)}
                    multiline={true}
                    numberOfLines={3}
                    textAlignVertical="top"
                    placeholderTextColor={Palette.gray400}
                    autoCapitalize="sentences"
                    style={{
                      borderWidth: 1,
                      borderColor:
                        leaveNotesClockIn.length > 0 ? Palette.blue : Palette.gray200,
                      borderRadius: 12,
                      padding: 12,
                      fontSize: 14,
                      lineHeight: 20,
                      color: Palette.ink,
                      minHeight: 72,
                      backgroundColor: 'white',
                    }}
                  />


                    </Box>

                    {/* Submit */}
                    <Box mx="$2" mb="$4">
                      <LinearGradient
                        colors={[LEAVE_TYPES_CI.find(lt => lt.key === leaveTypeClockIn)?.color ?? Palette.blue, LEAVE_TYPES_CI.find(lt => lt.key === leaveTypeClockIn)?.color ?? Palette.blue]}
                        style={{ borderRadius: 16 }}
                      >
                        <Pressable
                          onPress={submitLeaveInline}
                          disabled={isSubmittingLeave}
                          style={{
                            paddingVertical: 16,
                            alignItems: 'center' as const,
                            opacity: isSubmittingLeave ? 0.6 : 1,
                          }}
                        >
                          {isSubmittingLeave ? (
                            <Spinner color="white" />
                          ) : (
                            <Text color="white" fontWeight="800" fontSize={Type.title}>
                              {selectedDates.length > 0
                                ? (selectedDates.length === 1
                                    ? t('clockIn.submitWithCount', { count: selectedDates.length })
                                    : t('clockIn.submitWithCountPlural', { count: selectedDates.length }))
                                : t('clockIn.submitRequest')}
                            </Text>
                          )}
                        </Pressable>
                      </LinearGradient>
                    </Box>
                  </Box>
                ) : (
                  /* My Requests tab */
                  <Box px="$2" pb="$6">
                    {timeOffRequests.length === 0 ? (
                      <Box py="$12" alignItems="center">
                        <Box bg={Palette.blueTint} p="$5" rounded="$full" mb="$4">
                          <MaterialIcons name="event-busy" size={40} color={Palette.blue} />
                        </Box>
                        <Text fontWeight="700" fontSize={Type.title} color={Palette.ink} mb="$1">{t('clockIn.noRequestsTitle')}</Text>
                        <Text fontSize={Type.body} color={Palette.gray500} textAlign="center">
                          {t('clockIn.noRequestsHint')}
                        </Text>
                      </Box>
                    ) : (
                      <VStack space="md">
                        {timeOffRequests
                          .slice()
                          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                          .map((request) => {
                            const leaveStatusColors: Record<string, { bg: string; text: string }> = {
                              pending:  { bg: Palette.warningTint, text: Palette.gold },
                              approved: { bg: Palette.successTint, text: Palette.teal },
                              denied:   { bg: Palette.errorTint, text: Palette.error },
                            };
                            const statusStyle = leaveStatusColors[request.status] ?? leaveStatusColors.pending;
                            const typeColor = LEAVE_TYPES_CI.find(lt => lt.key === request.type)?.color ?? Palette.blue;
                            const startDate = new Date(request.date);
                            const endDate = request.end_date ? new Date(request.end_date + 'T00:00:00') : startDate;
                            const days = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
                            const isSingleDay = format(startDate, 'yyyy-MM-dd') === (request.end_date ?? format(startDate, 'yyyy-MM-dd'));
                            return (
                              <Pressable
                                key={request.id}
                                onPress={() => {
                                  setTimeout(() => {
                                    setSelectedLeaveRequest(request);
                                    setLeaveDetailModalOpen(true);
                                  }, 50);
                                }}
                              >
                                <Box
                                  bg="white"
                                  rounded="$2xl"
                                  overflow="hidden"
                                  shadowColor={Palette.black}
                                  shadowOffset={{ width: 0, height: 2 }}
                                  shadowOpacity={0.07}
                                  shadowRadius={10}
                                  elevation={3}
                                >
                                  <Box height={4} style={{ backgroundColor: typeColor }} />
                                  <Box p="$4">
                                    <HStack justifyContent="space-between" alignItems="center" mb="$3">
                                      <HStack space="xs" alignItems="center">
                                        <MaterialIcons name="event-available" size={16} color={typeColor} />
                                        <Text fontWeight="800" fontSize={Type.body} color={Palette.ink} style={{ textTransform: 'capitalize' }}>
                                          {request.type} {t('clockIn.leaveSuffix')}
                                        </Text>
                                      </HStack>
                                      <Box px="$3" py="$1" rounded="$full" style={{ backgroundColor: statusStyle.bg }}>
                                        <Text fontSize={Type.small} fontWeight="800" style={{ color: statusStyle.text, textTransform: 'capitalize' }}>
                                          {request.status === 'pending' ? t('clockIn.statusPending')
                                            : request.status === 'approved' ? t('clockIn.statusApproved')
                                            : request.status === 'denied' ? t('clockIn.statusDenied')
                                            : request.status}
                                        </Text>
                                      </Box>
                                    </HStack>
                                    <Box style={{ backgroundColor: Palette.gray50, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Palette.gray200 }}>
                                      {isSingleDay ? (
                                        <HStack alignItems="center" space="sm">
                                          <MaterialIcons name="today" size={18} color={typeColor} />
                                          <VStack>
                                            <Text fontWeight="800" fontSize={Type.body} color={Palette.ink}>
                                              {format(startDate, 'EEEE, d MMMM yyyy')}
                                            </Text>
                                            <Text fontSize={Type.small} color={Palette.gray500}>{t('clockIn.oneDay')}</Text>
                                          </VStack>
                                        </HStack>
                                      ) : (
                                        <HStack alignItems="center">
                                          <VStack flex={1}>
                                            <Text fontSize={Type.tiny} fontWeight="700" color={Palette.gray400} style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>{t('clockIn.fromLabel')}</Text>
                                            <Text fontWeight="800" fontSize={Type.h2} color={Palette.ink} lineHeight={26}>{format(startDate, 'd')}</Text>
                                            <Text fontWeight="600" fontSize={Type.label} color={Palette.gray700}>{format(startDate, 'EEE')}</Text>
                                            <Text fontSize={Type.small} color={Palette.gray500}>{format(startDate, 'MMM yyyy')}</Text>
                                          </VStack>
                                          <VStack alignItems="center" mx="$3">
                                            <Box style={{ backgroundColor: typeColor, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4, marginBottom: 4 }}>
                                              <Text fontSize={Type.small} fontWeight="800" color="white">{t('clockIn.dayCountSuffix', { count: days })}</Text>
                                            </Box>
                                            <MaterialIcons name="arrow-forward" size={16} color={typeColor} />
                                          </VStack>
                                          <VStack flex={1} alignItems="flex-end">
                                            <Text fontSize={Type.tiny} fontWeight="700" color={Palette.gray400} style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 2 }}>{t('clockIn.toLabel')}</Text>
                                            <Text fontWeight="800" fontSize={Type.h2} color={Palette.ink} lineHeight={26}>{format(endDate, 'd')}</Text>
                                            <Text fontWeight="600" fontSize={Type.label} color={Palette.gray700}>{format(endDate, 'EEE')}</Text>
                                            <Text fontSize={Type.small} color={Palette.gray500}>{format(endDate, 'MMM yyyy')}</Text>
                                          </VStack>
                                        </HStack>
                                      )}
                                    </Box>
                                  </Box>
                                </Box>
                              </Pressable>
                            );
                          })}
                      </VStack>
                    )}
                  </Box>
                )}
              </MotiView>
            )}

            {/* Leave Request Detail Modal */}
            {clockInMode === 'leave' && (
              <Modal
                isOpen={isLeaveDetailModalOpen}
                onClose={() => {
                  setLeaveDetailModalOpen(false);
                  setSelectedLeaveRequest(null);
                }}
                size="full"
                avoidKeyboard
              >
                <ModalBackdrop bg="rgba(0,0,0,0.6)" />
                <ModalContent
                  bg="white"
                  position="absolute"
                  bottom={0}
                  left={0}
                  right={0}
                  rounded="$3xl"
                  maxHeight="75%"
                  shadowColor={Palette.black}
                  shadowOffset={{ width: 0, height: -8 }}
                  shadowOpacity={0.25}
                  shadowRadius={25}
                  elevation={25}
                >
                  {/* Enhanced Handle for drag indicator */}
                  <Box alignSelf="center" mt="$3" mb="$2">
                    <Box w="$16" h="$2" bg={Palette.gray300} rounded="$full" />
                  </Box>

                  <ModalHeader bg="white" rounded="$3xl" pt="$1" pb="$5" px="$6">
                    <VStack alignItems="center" space="xs">
                      <Heading size="xl" color={Palette.ink} fontWeight="700" lineHeight={28} textAlign="center">
                        {t('clockIn.leaveDetailsTitle')}
                      </Heading>
                      {selectedLeaveRequest && (
                        <Text color={Palette.gray600} fontSize={Type.body} textAlign="center">
                          {t('clockIn.submittedOn', { date: format(new Date(selectedLeaveRequest.submitted), 'MMM dd, yyyy') })}
                        </Text>
                      )}
                    </VStack>
                  </ModalHeader>

                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: 20 }}
                    keyboardShouldPersistTaps="handled"
                  >
                    <ModalBody px="$6" pb="$2">
                      {selectedLeaveRequest && (() => {
                        const startDate = new Date(selectedLeaveRequest.date);
                        const endDate = selectedLeaveRequest.end_date
                          ? new Date(selectedLeaveRequest.end_date)
                          : startDate;
                        const isSingle = format(startDate, 'yyyy-MM-dd') === format(endDate, 'yyyy-MM-dd');
                        const dayCount = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
                        const statusColor =
                          selectedLeaveRequest.status === 'approved' ? Palette.success :
                          selectedLeaveRequest.status === 'denied' ? Palette.error : Palette.gold;
                        const statusBg =
                          selectedLeaveRequest.status === 'approved' ? Palette.successTint :
                          selectedLeaveRequest.status === 'denied' ? Palette.errorTint : Palette.warningTint;
                        const statusTextColor =
                          selectedLeaveRequest.status === 'approved' ? Palette.teal :
                          selectedLeaveRequest.status === 'denied' ? Palette.error : Palette.gold;
                        return (
                          <VStack space="lg">
                            {/* Leave type + status row */}
                            <HStack justifyContent="space-between" alignItems="center">
                              <Text fontWeight="800" fontSize={Type.h3} color={Palette.ink} style={{ textTransform: 'capitalize' }}>
                                {selectedLeaveRequest.type} {t('clockIn.leaveSuffix')}
                              </Text>
                              <Box px="$3" py="$1.5" rounded="$full" style={{ backgroundColor: statusBg }}>
                                <Text fontSize={Type.label} fontWeight="800" style={{ color: statusTextColor, textTransform: 'capitalize' }}>
                                  {selectedLeaveRequest.status === 'pending' ? t('clockIn.statusPending')
                                    : selectedLeaveRequest.status === 'approved' ? t('clockIn.statusApproved')
                                    : selectedLeaveRequest.status === 'denied' ? t('clockIn.statusDenied')
                                    : selectedLeaveRequest.status}
                                </Text>
                              </Box>
                            </HStack>

                            {/* Date timeline */}
                            <Box style={{ backgroundColor: Palette.gray50, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Palette.gray200 }}>
                              {isSingle ? (
                                <VStack alignItems="center" space="xs">
                                  <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray400} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{t('clockIn.dateLabel')}</Text>
                                  <Text fontWeight="800" fontSize={Type.display} color={Palette.ink} lineHeight={32}>
                                    {format(startDate, 'd')}
                                  </Text>
                                  <Text fontWeight="700" fontSize={Type.title} color={Palette.gray700}>
                                    {format(startDate, 'EEEE')}
                                  </Text>
                                  <Text fontSize={Type.body} color={Palette.gray500}>
                                    {format(startDate, 'MMMM yyyy')}
                                  </Text>
                                </VStack>
                              ) : (
                                <HStack alignItems="center">
                                  {/* FROM */}
                                  <VStack flex={1}>
                                    <Text fontSize={Type.tiny} fontWeight="700" color={Palette.gray400} style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{t('clockIn.fromLabel')}</Text>
                                    <Text fontWeight="800" fontSize={Type.display} color={Palette.ink} lineHeight={32}>{format(startDate, 'd')}</Text>
                                    <Text fontWeight="700" fontSize={Type.body} color={Palette.gray700}>{format(startDate, 'EEE')}</Text>
                                    <Text fontSize={Type.label} color={Palette.gray500}>{format(startDate, 'MMM yyyy')}</Text>
                                  </VStack>

                                  {/* Badge + arrow */}
                                  <VStack alignItems="center" mx="$4">
                                    <Box style={{ backgroundColor: statusColor, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 6 }}>
                                      <Text fontSize={Type.label} fontWeight="800" color="white">{t('clockIn.dayCountSuffix', { count: dayCount })}</Text>
                                    </Box>
                                    <MaterialIcons name="arrow-forward" size={18} color={statusColor} />
                                  </VStack>

                                  {/* TO */}
                                  <VStack flex={1} alignItems="flex-end">
                                    <Text fontSize={Type.tiny} fontWeight="700" color={Palette.gray400} style={{ textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>{t('clockIn.toLabel')}</Text>
                                    <Text fontWeight="800" fontSize={Type.display} color={Palette.ink} lineHeight={32}>{format(endDate, 'd')}</Text>
                                    <Text fontWeight="700" fontSize={Type.body} color={Palette.gray700}>{format(endDate, 'EEE')}</Text>
                                    <Text fontSize={Type.label} color={Palette.gray500}>{format(endDate, 'MMM yyyy')}</Text>
                                  </VStack>
                                </HStack>
                              )}
                            </Box>

                            {/* Submitted */}
                            <Text fontSize={Type.label} color={Palette.gray400} textAlign="center">
                              {t('clockIn.submittedOn', { date: format(new Date(selectedLeaveRequest.submitted), 'MMMM d, yyyy') })}
                            </Text>

                            {/* Reason */}
                            {selectedLeaveRequest.reason ? (
                              <VStack space="xs">
                                <Text fontWeight="700" color={Palette.gray700} fontSize={Type.body}>{t('clockIn.noteLabel')}</Text>
                                <Box style={{ backgroundColor: Palette.gray50, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Palette.gray200 }}>
                                  <Text color={Palette.gray500} fontSize={Type.body} lineHeight={20}>{selectedLeaveRequest.reason}</Text>
                                </Box>
                              </VStack>
                            ) : null}
                          </VStack>
                        );
                      })()}
                    </ModalBody>
                  </ScrollView>

                  <ModalFooter
                    pt="$4"
                    pb="$8"
                    px="$6"
                    borderTopWidth={1}
                    borderTopColor={Palette.gray200}
                    bg="white"
                    rounded="$3xl"
                  >
                    <StandardButton.Secondary
                      onPress={() => {
                        setLeaveDetailModalOpen(false);
                        setSelectedLeaveRequest(null);
                      }}
                    >
                      {t('clockIn.closeDetails')}
                    </StandardButton.Secondary>
                  </ModalFooter>
                </ModalContent>
              </Modal>
            )}


            {/* Overtime Reminder Modal */}
            <Modal
              isOpen={isOvertimeModalOpen}
              onClose={handleOvertimeDismiss}
            >
              <ModalBackdrop />
              <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                style={{ flex: 1, width: '100%', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 0 }}
              >
                <ModalContent maxHeight="85%" bg="white" rounded="$3xl" mx="$0" width="100%" overflow="hidden">

                  {/* Gradient Header */}
                  <LinearGradient
                    colors={[Palette.gold, Palette.gold]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20 }}
                  >
                    <HStack alignItems="center" space="md">
                      <Box
                        w={44}
                        h={44}
                        rounded="$2xl"
                        bg="rgba(255,255,255,0.25)"
                        justifyContent="center"
                        alignItems="center"
                      >
                        <MaterialIcons name="schedule" size={24} color="white" />
                      </Box>
                      <VStack>
                        <Text color="white" fontSize={Type.h3} fontWeight="800" letterSpacing={-0.3}>
                          {modalMode === 'late' ? t('clockIn.lateSessionTitle', { defaultValue: 'Late clock-in' }) : t('clockIn.overtimeSessionTitle')}
                        </Text>
                        <Text color="rgba(255,255,255,0.85)" fontSize={Type.small} mt="$0.5">
                          {modalMode === 'late' ? t('clockIn.lateSessionSubtitle', { defaultValue: 'You started after your scheduled time' }) : t('clockIn.overtimeSessionSubtitle')}
                        </Text>
                      </VStack>
                    </HStack>
                  </LinearGradient>

                  {/* Body */}
                  <VStack px="$5" pt="$4" pb="$2" space="md">
                    <HStack space="sm" alignItems="flex-start" bg={Palette.warningTint} p="$3" rounded="$xl">
                      <MaterialIcons name="info-outline" size={16} color={Palette.gold} style={{ marginTop: 1 }} />
                      <Text color={Palette.gold} fontSize={Type.label} lineHeight={20} flex={1}>
                        {modalMode === 'late' ? t('clockIn.lateSessionInfo', { defaultValue: 'Add a reason for starting late (optional). This is recorded for your employer — it does not change your pay.' }) : t('clockIn.overtimeSessionInfo')}
                      </Text>
                    </HStack>

                    <VStack space="xs">
                      <Text color={Palette.gray700} fontSize={Type.label} fontWeight="600">{t('clockIn.reasonLabel')}
                        <Text color={Palette.gray400} fontWeight="400"> {t('clockIn.reasonOptional')}</Text>
                      </Text>
                      <TextInput
                        placeholder={t('clockIn.reasonPlaceholder')}
                        // value={overtimeReason}
                        onChangeText={ (text) => setOvertimeReason(text) }
                        multiline
                        textAlignVertical="top"
                        placeholderTextColor={Palette.gray400}
                        autoCorrect={false}
                        editable={true}
                        style={{
                          borderWidth: 1.5,
                          borderColor: overtimeReason.length > 0 ? Palette.gold : Palette.gray200,
                          borderRadius: 14,
                          padding: 14,
                          fontSize: 14,
                          lineHeight: 21,
                          color: Palette.ink,
                          height: 96,
                          backgroundColor: Palette.white,
                          fontFamily: 'System',
                          textAlignVertical: 'top',
                        }}
                      />
                    </VStack>
                  </VStack>

                  {/* Footer */}
                  <VStack px="$5" pt="$3" pb="$6" space="sm">
                    <Pressable
                      onPress={handleOvertimeSubmit}
                      disabled={isLoading}
                      style={{ opacity: isLoading ? 0.7 : 1 }}
                    >
                      <LinearGradient
                        colors={[Palette.gold, Palette.gold]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 0 }}
                        style={{
                          borderRadius: 14,
                          paddingVertical: 14,
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexDirection: 'row',
                          gap: 8,
                        }}
                      >
                        {isLoading
                          ? <Spinner color="white" size="small" />
                          : <>
                              <MaterialIcons name="check-circle" size={18} color="white" />
                              <Text color="white" fontSize={Type.body} fontWeight="700">{modalMode === 'late' ? t('clockIn.submitLateReason', { defaultValue: 'Save reason' }) : t('clockIn.markAsOvertime')}</Text>
                            </>
                        }
                      </LinearGradient>
                    </Pressable>

                    <Pressable onPress={handleOvertimeDismiss} style={{ alignItems: 'center', paddingVertical: 10 }}>
                      <Text color={Palette.gray400} fontSize={Type.body} fontWeight="500">{t('clockIn.dismiss')}</Text>
                    </Pressable>
                  </VStack>

                </ModalContent>
              </KeyboardAvoidingView>
            </Modal>

            {/* Location Address Detail Modal */}
            <Modal
              isOpen={locationModalOpen}
              onClose={() => setLocationModalOpen(false)}
            >
              <ModalBackdrop />
              <ModalContent maxHeight="85%" bg="white" rounded="$2xl" p="$6" mx="$0">
                <ModalHeader>
                  <HStack space="md" alignItems="center">
                    <MaterialIcons name="location-pin" size={24} color={Palette.blue} />
                    <Heading size="md" color={Palette.ink}>{t('clockIn.locationAddressTitle')}</Heading>
                  </HStack>
                </ModalHeader>
                <ModalBody py="$4">
                  <Text color={Palette.gray700} fontSize={Type.title} lineHeight={24}>
                    {selectedLocationAddress}
                  </Text>
                </ModalBody>
                <ModalFooter borderTopWidth={0}>
                  <Button
                    variant="outline"
                    action="secondary"
                    onPress={() => setLocationModalOpen(false)}
                    rounded="$xl"
                  >
                    <ButtonText>{t('clockIn.closeAction')}</ButtonText>
                  </Button>
                </ModalFooter>
              </ModalContent>
            </Modal>
          </View>
        </ScrollView>
    </SafeAreaView >
  );
}