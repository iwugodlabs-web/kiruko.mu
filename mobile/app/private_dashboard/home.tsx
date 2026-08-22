import { MaterialIcons } from "@expo/vector-icons";
import { Palette, Type } from '@/app/constants/theme';
import {
  Avatar,
  AvatarFallbackText,
  Box,
  Button,
  ButtonText,
  HStack,
  Pressable,
  Spinner,
  Text,
  VStack,
  Alert,
  AlertIcon,
  AlertText,
  InfoIcon,
} from "@gluestack-ui/themed";
import {
  format,
  parseISO,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subMonths,
  subYears,
  isThisWeek,
  isToday,
  isThisMonth,
  isSameDay,
  isSameMonth,
} from "date-fns";
import { LinearGradient } from "expo-linear-gradient";
import * as Notifications from "expo-notifications";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deriveHourlyRateFromSalary, deriveAllowanceHourlyFromSalary } from '@/utils/payroll';
import {
  Alert as RNAlert,
  AppState,
  RefreshControl,
  ScrollView,
  Dimensions,
  StatusBar,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
export interface ClockData {
  day: string;
  date: string;
  time: string;
  hours: number;
  status: string;
  breakTime: number;
  isOvertime?: boolean;
  isHoliday?: boolean;
  location?: string;
}
import Animated, {
  FadeInUp,
  FadeInDown,
  SlideInRight,
  withSpring,
} from '@/app/utils/animated';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import i18n from "@/app/utils/i18n";
import { activeLocale } from "@/app/utils/intl";

// Import services and types
import {
  getDashboardDataResilient,
  getJobById,
  getSalaryByJobId,
  getUserNotifications,
  markNotificationAsRead,
  dismissNotification,
  type Notification,
  getSchedulesForUser,
  updateMyScheduleStatus,
  getUserTimeLogs,
  markTimeLogAsOvertime,
  isPermissionDeniedError,
  getFinancials,
  isApiError,
  type Job,
  type Salary,
  type Schedule,
  type TimeLog,
  type PayrollFormulaPayload,
  type FinancialsData,
} from "@/services/api";
import { qualifiesForModeChoice, setEntryMode } from "@/services/entryMode";

// Import hooks and utilities
import { payroll, salaryStructures } from "@/services/payroll-api";
import type { PayslipEstimate, ResolvedSalary } from "@/services/payroll-api";
import ProfileErrorBoundary from "../components/ProfileErrorBoundary";
import ProfileValidator from "../components/ProfileValidator";
import useAuth from "../hooks/useAuth";
import useCurrency from "../hooks/useCurrency";
// import { applyFormula, getPeriodRange } from "@/utils/payrollFormula";

// Import fragmented components
import {
  ClockHistory,
  DashboardHeader,
  PaySummary,
  QuickActions,
  TasksManagement,
  EarningsVsExpenses,
  ProfileProgress,
  SavingsGoal,
  type PayrollData,
  type TaskData,
  type UserData,
} from "@/components/private_home";

// M7 — sponsored card slot. The hook fires /serve in parallel with the rest
// of the dashboard fetches; the card renders only when a payload comes back
// and the user hasn't dismissed it within the 24h TTL.
import SponsoredCard from "@/components/SponsoredCard";
import { useSponsoredSlot } from "@/app/hooks/useSponsoredSlot";
import { logClickAndResolveUrl } from "@/api/sponsored";
import AdsConsentModal from "@/components/AdsConsentModal";
import { Linking } from "react-native";
import CurrencyIndicator from "@/components/private_home/CurrencyIndicator";
import CountryStatusChip from "@/components/private_home/CountryStatusChip";
import { router, useFocusEffect } from "expo-router";

// Helper for robust date parsing (handles space instead of T)
const safeParseDate = (dateStr: string | null | undefined): Date | null => {
  if (!dateStr) return null;
  try {
    // Try standard ISO
    let date = parseISO(dateStr);
    if (!isNaN(date.getTime())) return date;

    // Try replacing space with T (common Python/SQLite format)
    if (dateStr.includes(" ")) {
      date = parseISO(dateStr.replace(" ", "T"));
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

const computeLogHours = (log: TimeLog): number => {
  const start = log.start_time ? safeParseDate(log.start_time) : null;
  if (!start) return 0;

  const end = log.end_time ? safeParseDate(log.end_time) : new Date();
  if (!end) return 0;

  let hours = 0;
  if (log.end_time && log.hours_worked != null) {
    hours = parseFloat(String(log.hours_worked));
  } else {
    hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
  }

  if ((log.end_time == null || log.hours_worked == null) && log.breaks && Array.isArray(log.breaks)) {
    log.breaks.forEach((b: any) => {
      const bStart = b.start_time ? safeParseDate(b.start_time) : null;
      const bEnd = b.end_time ? safeParseDate(b.end_time) : !log.end_time ? new Date() : null;
      if (bStart && bEnd) {
        hours -= Math.max(0, (bEnd.getTime() - bStart.getTime()) / (1000 * 60 * 60));
      }
    });
  }

  return Math.max(0, hours);
};

const normalizeStartOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
const normalizeEndOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

const getFilterRange = (filter: string, now: Date) => {
  switch (filter) {
    case "today":
      return { start: normalizeStartOfDay(now), end: normalizeEndOfDay(now) };
    case "7days":
      return { start: startOfWeek(now, { weekStartsOn: 0 }), end: endOfWeek(now, { weekStartsOn: 0 }) };
    case "month":
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case "6months":
      return { start: normalizeStartOfDay(subMonths(now, 6)), end: normalizeEndOfDay(now) };
    case "1year":
      return { start: normalizeStartOfDay(subYears(now, 1)), end: normalizeEndOfDay(now) };
    default:
      return null;
  }
};

const doesLogOverlapPeriod = (log: TimeLog, periodStart: Date, periodEnd: Date) => {
  const start = log.start_time ? safeParseDate(log.start_time) : null;
  if (!start) return false;

  const end = log.end_time ? safeParseDate(log.end_time) : new Date();
  if (!end) return false;

  return start <= periodEnd && end >= periodStart;
};

const getRangeOverlapMs = (
  start: Date,
  end: Date,
  periodStart: Date,
  periodEnd: Date,
) => {
  const overlapStart = start > periodStart ? start : periodStart;
  const overlapEnd = end < periodEnd ? end : periodEnd;
  return overlapEnd > overlapStart ? overlapEnd.getTime() - overlapStart.getTime() : 0;
};

type TimeInterval = {
  start: Date;
  end: Date;
};

const computeBreakHoursInRange = (
  log: TimeLog,
  periodStart: Date,
  periodEnd: Date,
) => {
  if (!log.breaks || !Array.isArray(log.breaks)) return 0;

  return log.breaks.reduce((sum: number, b: any) => {
    const breakStart = b.start_time ? safeParseDate(b.start_time) : null;
    if (!breakStart) return sum;

    const breakEnd = b.end_time
      ? safeParseDate(b.end_time)
      : log.end_time
      ? safeParseDate(log.end_time)
      : new Date();
    if (!breakEnd) return sum;

    const overlapMs = getRangeOverlapMs(breakStart, breakEnd, periodStart, periodEnd);
    return sum + overlapMs / (1000 * 60 * 60);
  }, 0);
};

const subtractInterval = (base: TimeInterval, sub: TimeInterval): TimeInterval[] => {
  if (sub.end <= base.start || sub.start >= base.end) {
    return [base];
  }

  const segments: TimeInterval[] = [];
  if (sub.start > base.start) {
    segments.push({ start: base.start, end: sub.start });
  }
  if (sub.end < base.end) {
    segments.push({ start: sub.end, end: base.end });
  }
  return segments;
};

const getWorkIntervalsForLogInRange = (
  log: TimeLog,
  periodStart: Date,
  periodEnd: Date,
): TimeInterval[] => {
  const start = log.start_time ? safeParseDate(log.start_time) : null;
  if (!start) return [];

  const end = log.end_time ? safeParseDate(log.end_time) : new Date();
  if (!end) return [];

  const overlapStart = start > periodStart ? start : periodStart;
  const overlapEnd = end < periodEnd ? end : periodEnd;
  if (overlapEnd <= overlapStart) return [];

  let intervals: TimeInterval[] = [{ start: overlapStart, end: overlapEnd }];

  if (log.breaks && Array.isArray(log.breaks)) {
    intervals = log.breaks.reduce((currentIntervals: TimeInterval[], b: any) => {
      const breakStart = b.start_time ? safeParseDate(b.start_time) : null;
      if (!breakStart) return currentIntervals;

      const breakEnd = b.end_time
        ? safeParseDate(b.end_time)
        : log.end_time
        ? safeParseDate(log.end_time)
        : new Date();
      if (!breakEnd) return currentIntervals;

      const breakOverlapStart = breakStart > periodStart ? breakStart : periodStart;
      const breakOverlapEnd = breakEnd < periodEnd ? breakEnd : periodEnd;
      if (breakOverlapEnd <= breakOverlapStart) return currentIntervals;

      return currentIntervals.flatMap((interval) =>
        subtractInterval(interval, { start: breakOverlapStart, end: breakOverlapEnd }),
      );
    }, intervals);
  }

  return intervals;
};

const mergeIntervals = (intervals: TimeInterval[]) => {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged: TimeInterval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i += 1) {
    const current = merged[merged.length - 1];
    const next = sorted[i];
    if (next.start <= current.end) {
      current.end = new Date(Math.max(current.end.getTime(), next.end.getTime()));
    } else {
      merged.push({ ...next });
    }
  }

  return merged;
};

const getTimeLogEffectiveEnd = (log: TimeLog, now: Date): Date | null => {
  const start = log.start_time ? safeParseDate(log.start_time) : null;
  if (!start) return null;
  const end = log.end_time ? safeParseDate(log.end_time) : now;
  return end || null;
};

const getTimeLogCanonicalKey = (log: TimeLog, now: Date): string | null => {
  const start = log.start_time ? safeParseDate(log.start_time) : null;
  if (!start) return null;
  const end = getTimeLogEffectiveEnd(log, now);
  if (!end) return null;
  return `${start.toISOString()}|${end.toISOString()}`;
};

const dedupeTimeLogs = (logs: TimeLog[], now: Date): TimeLog[] => {
  const unique = new Map<string, { log: TimeLog; durationMs: number }>();

  logs.forEach((log) => {
    const key = getTimeLogCanonicalKey(log, now);
    if (!key) return;

    const end = getTimeLogEffectiveEnd(log, now);
    if (!end) return;
    const start = safeParseDate(log.start_time!);
    if (!start) return;

    const durationMs = end.getTime() - start.getTime();
    const existing = unique.get(key);

    if (!existing || durationMs > existing.durationMs) {
      unique.set(key, { log, durationMs });
    }
  });

  return Array.from(unique.values()).map((entry) => entry.log);
};

const splitIntervalByDay = (interval: TimeInterval): TimeInterval[] => {
  const segments: TimeInterval[] = [];
  let segmentStart = interval.start;

  while (segmentStart < interval.end) {
    const segmentEndOfDay = normalizeEndOfDay(segmentStart);
    const segmentEnd = interval.end < segmentEndOfDay ? interval.end : segmentEndOfDay;
    segments.push({ start: segmentStart, end: segmentEnd });
    const nextDay = new Date(segmentEnd.getTime() + 1);
    segmentStart = nextDay;
  }

  return segments;
};

const computeLogHoursInRange = (
  log: TimeLog,
  periodStart: Date,
  periodEnd: Date,
) => {
  const intervals = getWorkIntervalsForLogInRange(log, periodStart, periodEnd);
  return intervals.reduce(
    (sum, interval) => sum + (interval.end.getTime() - interval.start.getTime()) / (1000 * 60 * 60),
    0,
  );
};

const calculatePayrollData = (
  timeLogs: TimeLog[],
  filter: string,
  salaryData: Salary | null,
  formula?: PayrollFormulaPayload | null,
): PayrollData => {
  try {
    // Start calculations
    const now = new Date();
    let filteredTimeLogs: TimeLog[] = [];

    const filterRange = getFilterRange(filter, now);

    // Deduplicate logs before filtering. Some users can receive repeated active/end entries for the same time window.
    const dedupedLogs = dedupeTimeLogs(timeLogs, now);

    filteredTimeLogs = dedupedLogs.filter((log) => {
      if (!log?.start_time) return false;
      const logDate = safeParseDate(log.start_time);
      if (!logDate) return false;
      if (!filterRange) return true;
      return doesLogOverlapPeriod(log, filterRange.start, filterRange.end);
    });

    // Calculate totals using merged intervals across all logs to avoid double-counting overlapping time
    let totalBreakHours = 0;
    const allWorkIntervals = filterRange
      ? filteredTimeLogs.flatMap((log) => getWorkIntervalsForLogInRange(log, filterRange.start, filterRange.end))
      : [];
    const mergedWorkIntervals = mergeIntervals(allWorkIntervals);
    const totalHours = mergedWorkIntervals.reduce(
      (sum, interval) => sum + (interval.end.getTime() - interval.start.getTime()) / (1000 * 60 * 60),
      0,
    );

    if (filterRange) {
      totalBreakHours = filteredTimeLogs.reduce(
        (sum, log) => sum + computeBreakHoursInRange(log, filterRange.start, filterRange.end),
        0,
      );
    }

    console.log("📊 Dashboard: merge debug", {
      selectedFilter: filter,
      range: filterRange,
      rawTimeLogs: timeLogs.length,
      dedupedTimeLogs: dedupedLogs.length,
      filteredTimeLogs: filteredTimeLogs.length,
      allWorkIntervals: allWorkIntervals.map((interval) => ({
        start: interval.start.toISOString(),
        end: interval.end.toISOString(),
      })),
      mergedWorkIntervals: mergedWorkIntervals.map((interval) => ({
        start: interval.start.toISOString(),
        end: interval.end.toISOString(),
      })),
      totalHours,
      totalBreakHours,
    });

    const completedDays = new Set(
      filteredTimeLogs
        .map((log) => {
          const d = safeParseDate(log.start_time);
          return d ? format(d, "yyyy-MM-dd") : null;
        })
        .filter(Boolean),
    ).size;

    // If no salary configured, return hours/days but zero out pay fields
    if (!salaryData) {
      return {
        estimatedPay: 0,
        totalHours,
        overtimeHours: 0,
        regularPay: 0,
        overtimePay: 0,
        bonuses: 0,
        deductions: 0,
        netPay: 0,
        payPeriod: filter,
        lastPayDate: new Date().toISOString(),
        completedDays,
        hourlyRate: 0,
        breakTime: totalBreakHours,
        regularHours: totalHours,
        holidayHours: 0,
        holidayPay: 0,
        allowances: 0,
      };
    }

    // Harmonized Calculation Logic - derive hourly rates from salaryData using shared helpers
    const hourlyRateBase = deriveHourlyRateFromSalary(salaryData);
    const hourlyRateAllowance = deriveAllowanceHourlyFromSalary(salaryData);
    // Hourly rate should be based on basic salary only, not including allowances
    const hourlyRateTotal = hourlyRateBase;

    // Calculate dynamic daily threshold (standard depends on configured monthly_hours and days_of_work_per_month)
    const monthlyHrs = parseFloat((salaryData as any)?.monthly_hours || String(195)) || 195;
    const workingDays = parseFloat((salaryData as any)?.days_of_work_per_month || "22") || 22;
    const dailyThreshold = monthlyHrs / workingDays;

    let totalRegularPay = 0;
    let totalOvertimePay = 0;
    let totalHolidayPay = 0;
    let totalAllowances = 0;
    
    let totalOvertimeHours = 0;
    let totalHolidayHours = 0;
    let totalRegularHours = 0;

    // Build a unique set of work intervals by day to avoid double-counting overlapping logs
    const dayIntervals: { [key: string]: TimeInterval[] } = {};
    mergedWorkIntervals.forEach((interval) => {
      splitIntervalByDay(interval).forEach((dayInterval) => {
        const key = format(dayInterval.start, "yyyy-MM-dd");
        if (!dayIntervals[key]) dayIntervals[key] = [];
        dayIntervals[key].push(dayInterval);
      });
    });

    Object.keys(dayIntervals).forEach((date) => {
      const mergedDayIntervals = mergeIntervals(dayIntervals[date]);
      const dayTotalHours = mergedDayIntervals.reduce(
        (sum, interval) => sum + (interval.end.getTime() - interval.start.getTime()) / (1000 * 60 * 60),
        0,
      );

      // Use merged unique hours for allowances and overtime calculation
      totalAllowances += dayTotalHours * hourlyRateAllowance;

      const regHrs = Math.min(dayTotalHours, dailyThreshold);
      const otHrs = Math.max(0, dayTotalHours - dailyThreshold);

      totalRegularHours += regHrs;
      totalRegularPay += regHrs * hourlyRateBase;

      if (otHrs > 0) {
        const otMultiplier = formula?.multiplier_overtime || 1.5;
        totalOvertimeHours += otHrs;
        totalOvertimePay += otHrs * (hourlyRateTotal * otMultiplier - hourlyRateAllowance);
      }
    });

    // Keep holiday pay from explicit holiday logs if present
    filteredTimeLogs.forEach((log) => {
      if (log.is_holiday) {
        const hrs = computeLogHours(log);
        const holidayMultiplier = formula?.multiplier_public_holiday || 2.0;
        totalHolidayPay += hrs * (hourlyRateTotal * holidayMultiplier - hourlyRateAllowance);
        totalHolidayHours += hrs;
      }
    });

    const totalEstimatedPay = totalRegularPay + totalOvertimePay + totalHolidayPay + totalAllowances;

    return {
      estimatedPay: totalEstimatedPay,
      totalHours: totalHours,
      overtimeHours: totalOvertimeHours,
      regularPay: totalRegularPay,
      overtimePay: totalOvertimePay,
      bonuses: 0,
      deductions: 0,
      netPay: totalEstimatedPay,
      payPeriod: filter,
      lastPayDate: new Date().toISOString(),
      completedDays,
      hourlyRate: hourlyRateTotal,
      breakTime: totalBreakHours,
      regularHours: totalRegularHours,
      holidayHours: totalHolidayHours,
      holidayPay: totalHolidayPay,
      allowances: totalAllowances,
      filteredTimeLogs,
    };
  } catch (error) {
    console.error("Error in calculatePayrollData:", error);
    return {
      estimatedPay: 0,
      totalHours: 0,
      overtimeHours: 0,
      regularPay: 0,
      overtimePay: 0,
      bonuses: 0,
      deductions: 0,
      netPay: 0,
      payPeriod: filter,
      lastPayDate: new Date().toISOString(),
      completedDays: 0,
      hourlyRate: 0,
      breakTime: 0,
      regularHours: 0,
      holidayHours: 0,
      holidayPay: 0,
      allowances: 0,
      filteredTimeLogs: [],
    };
  }
};

// Helper function to transform time logs to clock data
const transformTimeLogsToClockHistory = (timeLogs: TimeLog[]): ClockData[] => {
  type ClockHistoryEntry = ClockData & { _sortTime: number };

  return timeLogs
    .map((log): ClockHistoryEntry => {
      try {
        if (!log.start_time) {
          return {
            day: i18n.t('common.unknown'),
            date: i18n.t('common.invalid'),
            time: i18n.t('common.notAvailable'),
            hours: 0,
            status: "error",
            breakTime: 0,
            _sortTime: 0,
          };
        }

        const logDate = new Date(log.start_time);
        const clockInTime = log.start_time ? new Date(log.start_time) : null;
        const clockOutTime = log.end_time ? new Date(log.end_time) : null;

        const formatTime = (date: Date | null) => {
          if (!date) return i18n.t('common.notRecorded');
          return date.toLocaleTimeString(activeLocale(), {
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
          });
        };

        const timeString =
          clockInTime && clockOutTime
            ? `${formatTime(clockInTime)} - ${formatTime(clockOutTime)}`
            : clockInTime
              ? `${formatTime(clockInTime)} - ${i18n.t('clockIn.stillWorking')}`
              : i18n.t('clockIn.notClockedIn');

        let logStatus = "completed";
        const hours = computeLogHours(log);
        if (!log.end_time) {
          logStatus = "in-progress";
        } else if (hours < 4) {
          logStatus = "incomplete";
        }

        return {
          day: logDate.toLocaleDateString(activeLocale(), { weekday: "long" }),
          time: timeString,
          hours,
          status: logStatus,
          date: logDate.toLocaleDateString(activeLocale(), {
            month: "short",
            day: "numeric",
          }),
          breakTime: log.breaks ? log.breaks.length : 0,
          isOvertime: log.is_overtime || false,
          isHoliday: log.is_holiday || false,
          location: log.location?.clock_in?.address || log.location?.address || "",
          _sortTime: logDate.getTime(),
        };
      } catch (error) {
        console.warn("Error processing log data:", error);
        return {
          day: i18n.t('common.unknown'),
          date: i18n.t('common.invalid'),
          time: i18n.t('common.notAvailable'),
          hours: 0,
          status: "error",
          breakTime: 0,
          _sortTime: 0,
        };
      }
    })
    .sort((a, b) => b._sortTime - a._sortTime)
    .map(({ _sortTime, ...rest }) => rest);
};

const Dashboard = () => {
  const { t } = useTranslation();
  const {
    user,
    isAuthenticated,
    checkAuth,
    isLoading: authLoading,
    logout,
  } = useAuth();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const getInitials = (name?: string) => {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
  };

  // M17 — sponsored slots. Two independent /serve calls, one per surface,
  // so employer announcements and paid/contextual ads stop competing in a
  // single ranked slot. Fired in parallel; neither blocks render.
  //   home_banner → kind='employer' (HR/payroll comms strip at top of feed)
  //   home_card   → kind='ad' or 'house' (hero card mid-feed)
  // Both surfaces honor the same 24h client-side dismissal individually.
  const sponsoredBanner = useSponsoredSlot("home_banner");
  const sponsoredCard = useSponsoredSlot("home_card");

  // State
  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [jobData, setJobData] = useState<Job | null>(null);
  const [salaryData, setSalaryData] = useState<Salary | null>(null);
  // The authoritative payroll-engine estimate for the current period — same
  // figure the web employer profile shows. Used as the source of truth for
  // the "Payroll Breakdown" card instead of the local clock-in calculation,
  // which showed Rs0.00 whenever there were no matching local time logs even
  // though the backend already had a real, non-zero number.
  const [payslipEstimate, setPayslipEstimate] = useState<PayslipEstimate | null>(null);
  // The employee's CURRENT recurring salary structure (basic + recurring
  // allowances, no one-offs, no period-specific docking) — the authoritative
  // source for "Salary" mode. Deliberately NOT the legacy salaryData below:
  // that's a disconnected, independently-editable table (GET /job/salary/
  // {job_id}) with no sync to the SalaryStructure/EmployeeSalaryAssignment
  // system real payroll actually runs on, so it can silently go stale the
  // moment an admin edits pay through the modern salary-structure UI instead
  // of the old job/salary flow.
  const [resolvedSalary, setResolvedSalary] = useState<ResolvedSalary | null>(null);
  const [assignedTasksData, setAssignedTasksData] = useState<Schedule[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(false);

  // Use a secondary loading state to ensure we don't render content before data is ready
  const [isInitialLoadDone, setIsInitialLoadDone] = useState(false);
  const [overtimeLogs, setOvertimeLogs] = useState<TimeLog[]>([]);
  // Track IDs that the employee has already notified or dismissed so the 60s
  // interval never re-surfaces them during the same session.
  const dismissedOvertimeIds = useRef<Set<number>>(new Set());
  const [overtimeFeedback, setOvertimeFeedback] = useState<Notification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [payrollFormula, setPayrollFormula] =
    useState<PayrollFormulaPayload | null>(null);
  const [isNotifying, setIsNotifying] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [recentExpenses, setRecentExpenses] = useState<{ label: string; amount: number; date?: string }[]>([]);
  // Unified filter for all data (pay, time, tasks)
  const [selectedFilter, setSelectedFilter] = useState<
    "today" | "7days" | "month" | "6months" | "1year"
  >("7days");
  const [selectedTaskFilter, setSelectedTaskFilter] = useState<
    "all" | "pending" | "started" | "completed"
  >("all");

  // Currency settings using the currency hook
  const {
    currency: userCurrency,
    baseCurrency,
    formatCurrency,
    convertCurrency,
    getExchangeRate,
  } = useCurrency();

  // Add logging to track currency changes
  useEffect(() => {
    console.log(
      "🏠 Dashboard: Current display currency:",
      userCurrency,
      "Base currency:",
      baseCurrency,
    );
    if (userCurrency !== baseCurrency) {
      const rate = getExchangeRate(baseCurrency, userCurrency);
      console.log(
        `💱 Dashboard: Exchange rate ${baseCurrency} → ${userCurrency}: ${rate}`,
      );
    }
  }, [userCurrency, baseCurrency, getExchangeRate]);

  // Load dashboard data
  // Extracted so it can also be called on its own when the user switches
  // back to the "This Month" filter — payslipEstimate is otherwise only
  // fetched on mount/focus/pull-to-refresh, so its `period` (which follows
  // the company's open payroll run, not just the calendar) can go stale if
  // a run opens or closes while this screen is sitting idle.
  const refreshPayslipEstimate = useCallback(async () => {
    try {
      const est = await payroll.getEstimate();
      if (isMounted.current) {
        setPayslipEstimate('error' in est ? null : est);
      }
    } catch (e) {
      console.warn('Failed to fetch payslip estimate for dashboard:', e);
    }
  }, []);

  // Cheap — a handful of indexed queries, no cascade into leave/attendance/
  // overtime/one-off resolution (unlike payslipEstimate) — safe to call
  // on every dashboard load.
  const refreshResolvedSalary = useCallback(async (privateUserId: number) => {
    try {
      const res = await salaryStructures.preview(privateUserId);
      if (isMounted.current) {
        setResolvedSalary('error' in res ? null : res);
      }
    } catch (e) {
      console.warn('Failed to fetch resolved salary structure for dashboard:', e);
    }
  }, []);

  const loadDashboardData = useCallback(
    async (isRefresh = false) => {
      console.log("🔄 Dashboard: loadDashboardData called", {
        privateUserId: user?.private_user_id,
        authLoading,
        isAuthenticated,
        isRefresh,
      });

      // Dual-identity owners can enter employee mode; the id lives on the
      // nested private_user when the top-level field isn't populated yet.
      const rawPrivateUserId = user?.private_user_id || user?.private_user?.private_user_id;

      if (!rawPrivateUserId || authLoading) {
        console.log(
          "⏸️ Dashboard: Skipping data load - missing user ID or auth loading",
        );
        return;
      }

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setIsDataLoading(true);
      }

      try {
        if (isMounted.current) setError(null);
        const privateUserId = Number(rawPrivateUserId);
        console.log(
          "📊 Dashboard: Starting data fetch for user ID:",
          privateUserId,
        );

        const data = await getDashboardDataResilient(privateUserId);

        if (!isMounted.current) return;

        console.log(
          "✅ Dashboard: All data processed via resilient fetcher",
          data,
        );

        if (data.timeLogs && Array.isArray(data.timeLogs)) {
          console.log("📥 Dashboard: Raw API time logs", {
            count: data.timeLogs.length,
            sample: data.timeLogs.slice(0, 8).map((log: any) => ({
              id: log.timelog_id,
              start_time: log.start_time,
              end_time: log.end_time,
              hours_worked: log.hours_worked,
              breaks: Array.isArray(log.breaks) ? log.breaks.length : 0,
            })),
          });
          setTimeLogs(data.timeLogs);
        }

        if (data.job) {
          setJobData(data.job);
        }

        if (data.schedules && Array.isArray(data.schedules)) {
          setAssignedTasksData(data.schedules);
        }

        if (data.salary) {
          setSalaryData(data.salary);
        }

        // Authoritative pay estimate from the payroll engine (same figure
        // the web employer profile shows) — best-effort, non-blocking.
        await refreshPayslipEstimate();
        await refreshResolvedSalary(privateUserId);

        // Fetch financials for earnings vs expenses widget
        try {
          const financials = await getFinancials(privateUserId);
          if (!isApiError(financials) && isMounted.current) {
            const fin = financials as FinancialsData;
            const expenses =
              (fin.purchases?.reduce((s, p) => s + p.amount, 0) || 0) +
              (fin.subscriptions?.reduce((s, s2) => s + s2.amount, 0) || 0) +
              (fin.rents?.reduce((s, r) => s + r.amount, 0) || 0) +
              (fin.loans?.reduce((s, l) => s + (l.repaid_amount || 0), 0) || 0) +
              (fin.transfers?.filter(tr => tr.status !== 'incoming').reduce((s, tr) => s + tr.amount, 0) || 0);
            setTotalExpenses(expenses);

            // Unified recent-expenses list for the home card (3 shown + view more).
            const items: { label: string; amount: number; date?: string }[] = [
              ...(fin.purchases || []).map(p => ({ label: p.description || 'Purchase', amount: p.amount, date: p.created_at })),
              ...(fin.subscriptions || []).map(s => ({ label: s.description || 'Subscription', amount: s.amount, date: s.subscription_date })),
              ...(fin.rents || []).map(r => ({ label: r.description || r.landlord_name || 'Rent', amount: r.amount, date: r.created_at })),
              ...(fin.transfers || []).filter(tr => tr.status !== 'incoming').map(tr => ({ label: `Transfer to ${tr.to_user}`, amount: tr.amount, date: tr.created_at })),
            ];
            items.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
            setRecentExpenses(items);
          }
        } catch (e) {
          console.warn('Failed to fetch financials for dashboard:', e);
        }

        // Formulas fetched separately if needed in future
      } catch (error: any) {
        console.error("💥 Dashboard: Data loading error:", error);
        if (!isMounted.current) return;
        if (error.response?.status === 401 || error.response?.status === 403) {
          checkAuth();
          setError(t('privateHome.sessionExpired'));
        } else if (error.response?.status === 500) {
          setError(t('privateHome.profileIncompleteError'));
        } else {
          setError(error.message || t('privateHome.failedToLoad'));
        }
      } finally {
        if (isMounted.current) {
          console.log("🏁 Dashboard: Data loading finished");
          setIsDataLoading(false);
          setRefreshing(false);
          setIsInitialLoadDone(true);
        }
      }
    },
    [user?.private_user_id, authLoading, checkAuth, refreshPayslipEstimate, refreshResolvedSalary],
  );

  // Monitor for overtime (active sessions > 8 hours)
  useEffect(() => {
    const checkOvertime = () => {
      const now = new Date();
      // Calculate dynamic threshold from salary data (e.g. 195/22 = 8.8h)
      const normalDailyHours =
        salaryData?.monthly_hours && salaryData?.days_of_work_per_month
          ? parseFloat(salaryData.monthly_hours) /
            (salaryData.days_of_work_per_month || 22)
          : 8;

      const threshold = payrollFormula?.overtime_threshold_hours || normalDailyHours;
      const overtime = timeLogs.filter((log) => {
        if (log.end_time) return false;
        // Already notified the employer — backend has is_overtime = true, skip permanently
        if (log.is_overtime) return false;
        // Dismissed this session (covers dismiss-without-notify within same lifecycle)
        if (dismissedOvertimeIds.current.has(log.timelog_id)) return false;
        const start = safeParseDate(log.start_time);
        if (!start) return false;
        // Only check sessions started today — skip zombie sessions from previous days
        if (start.toDateString() !== now.toDateString()) return false;
        const hours = (now.getTime() - start.getTime()) / (1000 * 60 * 60);
        return hours > threshold;
      });

      // Simple deep compare to avoid unnecessary state updates
      if (
        JSON.stringify(overtime.map((l) => l.timelog_id)) !==
        JSON.stringify(overtimeLogs.map((l) => l.timelog_id))
      ) {
        setOvertimeLogs(overtime);
      }
    };

    checkOvertime();
    const interval = setInterval(checkOvertime, 60000); // Check every minute
    return () => clearInterval(interval);
  }, [timeLogs, overtimeLogs]);

  // Poll for overtime approval/rejection feedback from employer
  useFocusEffect(
    React.useCallback(() => {
      let active = true;
      const fetchFeedback = async () => {
        const result = await getUserNotifications();
        if (!active || !Array.isArray(result)) return;
        const feedback = result.filter(
          (n) =>
            !n.is_read &&
            (n.notification_type === 'overtime_approved' ||
              n.notification_type === 'overtime_rejected'),
        );
        setOvertimeFeedback(feedback);
        setUnreadNotificationCount(result.filter((n) => !n.is_read).length);
      };
      fetchFeedback();
      return () => { active = false; };
    }, []),
  );

  // Listen for foreground push notifications — instantly surface overtime decisions
  useEffect(() => {
    const sub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, any>;
      const type = data?.notification_type as string | undefined;
      // Fetch fresh list so we get the real DB record (with notification_id etc.)
      getUserNotifications().then((result) => {
        if (!Array.isArray(result)) return;
        const feedback = result.filter(
          (n) =>
            !n.is_read &&
            (n.notification_type === 'overtime_approved' ||
              n.notification_type === 'overtime_rejected'),
        );
        setOvertimeFeedback(feedback);
        setUnreadNotificationCount(result.filter((n) => !n.is_read).length);
      });
    });
    return () => sub.remove();
  }, []);

  const dismissFeedback = async (notificationId: number) => {
    // Optimistically remove from UI, then delete from server
    setOvertimeFeedback((prev) => prev.filter((n) => n.notification_id !== notificationId));
    setUnreadNotificationCount((c) => Math.max(0, c - 1));
    await dismissNotification(notificationId);
  };

  const handleDismissOvertime = (logId: number) => {
    dismissedOvertimeIds.current.add(logId);
    setOvertimeLogs((prev) => prev.filter((l) => l.timelog_id !== logId));
  };

  const handleNotifyEmployer = async (logId: number) => {
    setIsNotifying(logId);
    try {
      const normalDailyHours =
        salaryData?.monthly_hours && salaryData?.days_of_work_per_month
          ? parseFloat(salaryData.monthly_hours) /
            (salaryData.days_of_work_per_month || 22)
          : 8;
      const threshold = payrollFormula?.overtime_threshold_hours || normalDailyHours;
      const result = await markTimeLogAsOvertime(
        logId,
        t('privateHome.overtimeNotifiedEmployerMessage', {
          hours: threshold.toFixed(1),
        }),
      );
      if (result && !("error" in result)) {
        // Mark as handled so the 60s interval never re-adds it
        dismissedOvertimeIds.current.add(logId);
        setOvertimeLogs((prev) => prev.filter((l) => l.timelog_id !== logId));
      } else if (!isPermissionDeniedError(result)) {
        console.error("Failed to notify employer:", result);
      }
    } catch (err) {
      console.error("Error in handleNotifyEmployer:", err);
    } finally {
      setIsNotifying(null);
    }
  };

  // IsMounted ref to prevent memory leaks
  const isMounted = React.useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  // Currency is now handled by the useCurrency hook

  // Load data on mount
  useEffect(() => {
    console.log("🎯 Dashboard: useEffect triggered", {
      authLoading,
      privateUserId: user?.private_user_id,
      isAuthenticated,
      userObject: user,
    });

    const hasPrivateId = !!user?.private_user_id || !!user?.private_user?.private_user_id;

    if (!authLoading && hasPrivateId && isAuthenticated) {
      console.log("✅ Dashboard: Conditions met, loading dashboard data");
      loadDashboardData();
    } else {
      console.log("⏸️ Dashboard: Conditions not met for data loading", {
        authLoading,
        hasPrivateUserId: hasPrivateId,
        isAuthenticated,
      });
    }
  }, [authLoading, user?.private_user_id, user?.private_user?.private_user_id, isAuthenticated, loadDashboardData]);

  // Live ticker to update "Today" stats every minute — paused when app is backgrounded
  const [ticker, setTicker] = useState(0);
  useEffect(() => {
    let interval: NodeJS.Timeout | null = null;

    const startTicker = () => {
      if (interval) clearInterval(interval);
      interval = setInterval(() => {
        const hasActiveLog = timeLogs.some(
          (log) => log.start_time && !log.end_time,
        );
        if (hasActiveLog && selectedFilter === "today") setTicker((prev) => prev + 1);
      }, 60000);
    };

    const stopTicker = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    if (AppState.currentState === "active") startTicker();

    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") startTicker();
      else if (nextState === "background" || nextState === "inactive")
        stopTicker();
    });

    return () => {
      stopTicker();
      subscription.remove();
    };
  }, [timeLogs, selectedFilter]);

  // Track loading state in ref to avoid dependency cycles in useFocusEffect
  const isLoadingRef = React.useRef(false);
  useEffect(() => {
    isLoadingRef.current = isDataLoading || refreshing;
  }, [isDataLoading, refreshing]);

  // Auto-refresh when page comes into focus (fixing sync issues with Clock-In page)
  useFocusEffect(
    useCallback(() => {
      // Only refresh if we have a user and data isn't currently loading
      if (user?.private_user_id && !isLoadingRef.current) {
        console.log("🔄 Dashboard: Auto-refreshing on focus");
        loadDashboardData(true);
      }
    }, [user?.private_user_id, loadDashboardData]),
  );

  // The salary amount + hours config calculatePayrollData actually needs —
  // for a company-affiliated employee this must come from the modern
  // SalaryStructure system, not their own legacy profile entry. Same
  // principle as PaySummary's Salary-mode fix (isCompanyEmployee decides
  // the source, not "does the structure happen to have data"), applied
  // here to the LOCAL hours-based estimate that drives Live mode for every
  // filter except a matching "This Month". Independent (no-company) users
  // are unaffected — their own profile entry is exactly the right source
  // for them and is used as-is.
  const effectiveSalaryData = useMemo((): Salary | null => {
    if (!jobData?.company_id) return salaryData;
    const basicComponent = resolvedSalary?.components?.find(
      (c) => c.kind === "earning" && c.is_basic,
    );
    // Company employee, structure not configured yet — show "not set up"
    // (calculatePayrollData's own null-guard already renders that
    // gracefully as zeros) rather than falling back to old personal data
    // that predates joining a company.
    if (!basicComponent) return null;
    const allowanceTotal = (resolvedSalary?.components ?? [])
      .filter((c) => c.kind === "earning" && !c.is_basic)
      .reduce((sum, c) => sum + (parseFloat(String(c.amount)) || 0), 0);
    const basicAmount = parseFloat(String(basicComponent.amount)) || 0;
    return {
      job_id: jobData.job_id,
      salary: String(basicAmount),
      allowance: String(allowanceTotal),
      revenue: String(basicAmount + allowanceTotal),
      // Intentionally NOT sourced from resolvedSalary — the structure
      // system has no per-employee "monthly hours" field at all (it's a
      // legacy-table-only concept). Omitting lets deriveHourlyRateFromSalary
      // fall back to its own DEFAULT_MONTHLY_HOURS constant, the same
      // 195h/month the backend's own notional overtime rate uses.
      monthly_hours: "",
      days_of_work_per_month: 0,
      break_in_minutes_per_day: 0,
      // pay_basis (hourly/daily/monthly designation) is a separate
      // architecture wrinkle not covered by today's fixes: the real
      // payroll engine itself still reads pay_basis off this same legacy
      // Salary row regardless of company affiliation (see
      // payroll_engine._active_job_with_salary), not from SalaryStructure.
      // Preserving it here — rather than dropping it — keeps PaySummary's
      // isHourly fallback consistent with what the backend actually does,
      // even though the AMOUNT fields above are correctly structure-sourced.
      pay_basis: (salaryData as any)?.pay_basis,
    } as Salary;
  }, [salaryData, jobData, resolvedSalary]);

  // Process data for components
  const payData = useMemo(() => {
    // ticker dependency ensures re-calculation every minute for active sessions
    return calculatePayrollData(
      timeLogs,
      selectedFilter,
      effectiveSalaryData,
      payrollFormula,
    );
  }, [timeLogs, selectedFilter, effectiveSalaryData, payrollFormula, ticker]);

  // The selected Time Period pill's actual resolved date range — passed to
  // PaySummary so it can check whether payslipEstimate's period really is
  // the window the user has selected (see periodMatchesBackendPeriod).
  const selectedPeriodRange = useMemo(
    () => getFilterRange(selectedFilter, new Date()),
    [selectedFilter],
  );

  // payslipEstimate is otherwise only fetched on mount/focus/pull-to-refresh.
  // Re-fetch on returning to "This Month" so a payroll run that opened or
  // closed while this screen was idle doesn't leave PaySummary comparing
  // against a stale period.
  useEffect(() => {
    if (selectedFilter === "month") {
      refreshPayslipEstimate();
    }
  }, [selectedFilter, refreshPayslipEstimate]);

  const filteredClockData = useMemo(() => {
    const now = new Date();

    const dedupedLogs = dedupeTimeLogs(timeLogs, now);
    const filteredLogs = dedupedLogs.filter((log) => {
      const range = getFilterRange(selectedFilter, now);
      if (!range) return true;
      return doesLogOverlapPeriod(log, range.start, range.end);
    });

    console.log(
      `📊 Dashboard: Filtered clock data for ${selectedFilter}:`,
      filteredLogs.length,
      "logs",
    );
    return transformTimeLogsToClockHistory(filteredLogs);
  }, [timeLogs, selectedFilter]);

  const transformedTasks: TaskData[] = useMemo(() => {
    const now = new Date();

    // Normalize tasks first to handle missing status
    const normalizedTasks = assignedTasksData.map((task) => ({
      ...task,
      status: (task.status || "pending").toLowerCase(), // Default to pending and lower case
    }));

    // Filter schedules
    console.log("📊 Debug Dashboard Tasks:", normalizedTasks.length, "tasks");

    const filteredSchedules = normalizedTasks.filter((schedule) => {
      // Always show active tasks
      if (
        schedule.status === "started" ||
        schedule.status === "pending" ||
        schedule.status === "assigned"
      ) {
        return true;
      }

      // Filter by date for ALL tasks (active or completed)
      // Use end_time (due date) or start_time as the reference date
      const referenceDateStr = schedule.end_time || schedule.start_time;
      if (!referenceDateStr) return true; // Show undated tasks? Or hide? Let's show them.

      const referenceDate = new Date(referenceDateStr);
      switch (selectedFilter) {
        case "today":
          return isToday(referenceDate);
        case "7days":
          return isThisWeek(referenceDate, { weekStartsOn: 1 });
        case "month":
          return isThisMonth(referenceDate);
        case "6months":
          const sixMonthsAgo = new Date(
            now.getTime() - 6 * 30 * 24 * 60 * 60 * 1000,
          );
          return referenceDate >= sixMonthsAgo;
        case "1year":
          const yearStart = new Date(now.getFullYear(), 0, 1);
          return referenceDate >= yearStart;
        default:
          return true;
      }
    });

    return filteredSchedules.map((schedule) => ({
      id: schedule.schedule_id.toString(),
      title: schedule.title,
      description: schedule.notes,
      due_date: schedule.end_time,
      status:
        schedule.status === "completed"
          ? "completed"
          : schedule.status === "started"
            ? "in-progress"
            : "assigned",
      priority: "medium" as const,
      estimated_hours: parseInt(schedule.hours || "0"),
      completed_hours:
        schedule.status === "completed" ? parseInt(schedule.hours || "0") : 0,
      assignedDate: schedule.start_time,
    }));
  }, [assignedTasksData, selectedFilter]);

  const userData: UserData = useMemo(() => {
    const privateUser = user?.private_user;
    return {
      firstName: privateUser?.first_name || user?.user_name || t('privateHome.employeeFallbackName'),
      lastName: privateUser?.last_name || "",
      email: user?.email || "",
      employeeId: user?.private_user_id?.toString(),
      workingStatus: "offline",
    };
  }, [user]);

  // Filter handlers
  const handleFilterChange = useCallback((filter: string) => {
    setSelectedFilter(
      filter as "today" | "7days" | "month" | "6months" | "1year",
    );
  }, []);

  const handleTaskFilterChange = useCallback((filter: string) => {
    setSelectedTaskFilter(filter as any);
  }, []);

  const handleTaskUpdate = useCallback(
    async (taskId: string, status: string) => {
      try {
        console.log("🔄 Updating task from dashboard:", taskId, status);

        // Per-assignee status so the employer can see WHO started/completed.
        const result = await updateMyScheduleStatus(
          parseInt(taskId),
          status as any
        );

        if ("error" in result) {
          if (!isPermissionDeniedError(result)) console.error("❌ Dashboard task update failed:", result.error);
          // You might want to show a toast here, but for now we log it
        } else {
          console.log("✅ Task updated successfully, refreshing dashboard...");
          // Refresh data to show new status
          await loadDashboardData();
        }
      } catch (e) {
        console.error("❌ Error updating task:", e);
      }
    },
    [loadDashboardData],
  );

  // Loading state - wait for initial data load to complete
  if (authLoading || !isInitialLoadDone) {
    return (
      <Box
        flex={1}
        justifyContent="center"
        alignItems="center"
        py="$20"
        bg={Palette.gray50}
      >
        <VStack space="lg" alignItems="center">
          <Spinner size="large" color={Palette.gold} />
          <Text color={Palette.gray700} fontSize={Type.title} fontWeight="600">
            {t('privateHome.loadingDashboard')}
          </Text>
        </VStack>
      </Box>
    );
  }

  // Error state
  if (!isAuthenticated || !user?.private_user_id || error) {
    return (
      <Box flex={1} justifyContent="center" alignItems="center" py="$20">
        <VStack space="lg" alignItems="center" maxWidth="80%">
          <Box bg={Palette.errorTint} p="$4" rounded="$full">
            <MaterialIcons name="error-outline" size={48} color={Palette.errorAlt} />
          </Box>
          <VStack space="sm" alignItems="center">
            <Text
              color={Palette.error}
              fontSize={Type.h3}
              fontWeight="700"
              textAlign="center"
            >
              {!isAuthenticated
                ? t('privateHome.authRequired')
                : t('privateHome.unableToLoad')}
            </Text>
            <Text color={Palette.gray600} fontSize={Type.body} textAlign="center">
              {error || t('privateHome.pleaseLogIn')}
            </Text>
          </VStack>
          {isAuthenticated && !!user?.private_user_id && (
            <Button
              onPress={() => loadDashboardData(true)}
              bg={Palette.blue}
              size="lg"
            >
              <ButtonText color={Palette.white}>{t('privateHome.retry')}</ButtonText>
            </Button>
          )}
        </VStack>
      </Box>
    );
  }

  // Incomplete profile state - show limited dashboard
  const isProfileIncomplete =
    !Boolean(jobData) &&
    !Boolean(salaryData) &&
    !error &&
    !isDataLoading &&
    !authLoading &&
    Boolean(user?.private_user_id) &&
    isAuthenticated;

  return (
    <SafeAreaView
      style={{ flex: 1, backgroundColor: Palette.gray50 }}
      edges={["top"]}
    >
      <StatusBar barStyle="dark-content" backgroundColor={Palette.gray50} />
      <LinearGradient
        colors={[Palette.gray50, Palette.gray100, Palette.gray200]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        overScrollMode="never"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => loadDashboardData(true)}
            tintColor={Palette.blue}
            colors={[Palette.blue, Palette.blue, Palette.blue]}
            progressBackgroundColor={Palette.blueTint}
          />
        }
        contentContainerStyle={{
          paddingBottom: 160,
          paddingTop: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Box px="$3" pb="$6">
          {isProfileIncomplete && (
            <Pressable onPress={() => router.push('/private_dashboard/profile')}>
              <Box
                bg={Palette.blueTint}
                p="$4"
                borderRadius={18}
                mb="$4"
                borderWidth={1}
                borderColor={Palette.gray100}
              >
                <HStack space="md" alignItems="center">
                  <MaterialIcons name="person" size={24} color={Palette.blue} />
                  <VStack flex={1}>
                    <Text fontWeight="700" color={Palette.indigo} fontSize={Type.body}>
                      {t('privateHome.completeSetupTitle')}
                    </Text>
                    <Text color={Palette.blue} fontSize={Type.small}>
                      {t('privateHome.completeSetupBody')}
                    </Text>
                  </VStack>
                  <MaterialIcons name="chevron-right" size={20} color={Palette.blue} />
                </HStack>
              </Box>
            </Pressable>
          )}

          {/* Overtime approval / rejection feedback from employer */}
          {overtimeFeedback.map((notif) => {
            const isApproved = notif.notification_type === 'overtime_approved';
            return (
              <Animated.View key={notif.notification_id} entering={FadeInDown.duration(600)}>
                <Alert
                  action={isApproved ? 'success' : 'error'}
                  variant="solid"
                  mb="$4"
                  borderRadius={18}
                  py="$3"
                  px="$4"
                  bg={isApproved ? Palette.greenTint : Palette.errorTint}
                  borderWidth={1}
                  borderColor={isApproved ? Palette.greenTint : Palette.errorTint}
                >
                  <HStack space="md" alignItems="center" w="100%">
                    <Box bg={isApproved ? Palette.successTint : Palette.errorTint} p="$2" rounded="$full">
                      <MaterialIcons
                        name={isApproved ? 'check-circle' : 'cancel'}
                        size={24}
                        color={isApproved ? Palette.success : Palette.error}
                      />
                    </Box>
                    <VStack flex={1} space="xs">
                      <Text fontWeight="700" color={isApproved ? Palette.teal : Palette.error} fontSize={Type.body}>
                        {isApproved ? t('privateHome.overtimeApproved') : t('privateHome.overtimeRejected')}
                      </Text>
                      <Text color={isApproved ? Palette.teal : Palette.error} fontSize={Type.label}>
                        {notif.message}
                      </Text>
                    </VStack>
                    <Pressable onPress={() => dismissFeedback(notif.notification_id)} p="$1" hitSlop={10}>
                      <MaterialIcons name="close" size={18} color={isApproved ? Palette.success : Palette.error} />
                    </Pressable>
                  </HStack>
                </Alert>
              </Animated.View>
            );
          })}

          {overtimeLogs.map((log) => (
            <Animated.View
              key={log.timelog_id}
              entering={FadeInDown.duration(800)}
            >
              <Alert
                action="warning"
                variant="solid"
                mb="$4"
                borderRadius={18}
                py="$3"
                px="$4"
                bg={Palette.warningTint}
                borderWidth={1}
                borderColor={Palette.gold}
              >
                <HStack space="md" alignItems="center" w="100%">
                  <Box bg={Palette.warningTint} p="$2" rounded="$full">
                    <MaterialIcons
                      name="warning-amber"
                      size={24}
                      color={Palette.gold}
                    />
                  </Box>
                  <VStack flex={1} space="xs">
                    <Text fontWeight="700" color={Palette.gold} fontSize={Type.body}>
                      {t('privateHome.overtimeWarning')}
                    </Text>
                    <Text color={Palette.gold} fontSize={Type.label}>
                      {t('privateHome.overtimeWarningBody', {
                        hours: payrollFormula?.overtime_threshold_hours || 8,
                      })}
                    </Text>
                  </VStack>
                  <HStack space="sm" alignItems="center">
                    <Button
                      size="sm"
                      bg={Palette.gold}
                      onPress={() => handleNotifyEmployer(log.timelog_id)}
                      isDisabled={isNotifying === log.timelog_id}
                    >
                      {isNotifying === log.timelog_id ? (
                        <Spinner color={Palette.white} size="small" />
                      ) : (
                        <ButtonText color={Palette.white} fontSize={Type.small}>
                          {t('privateHome.notify')}
                        </ButtonText>
                      )}
                    </Button>
                    <Pressable
                      onPress={() => handleDismissOvertime(log.timelog_id)}
                      p="$1"
                      hitSlop={10}
                    >
                      <MaterialIcons name="close" size={18} color={Palette.gold} />
                    </Pressable>
                  </HStack>
                </HStack>
              </Alert>
            </Animated.View>
          ))}

          {/* M17 — Employer-announcement banner slot. Top-of-feed strip
              for HR/payroll comms (kind='employer'). Uses the same
              SponsoredCard component as the card slot below — the visual
              treatment is identical for now; we can split into a
              banner-specific variant later if the strip needs to be
              thinner. Important: this is its OWN /serve call against
              surface='home_banner', so it never competes with the
              kind='ad'/'house' card below for rank. */}
          {sponsoredBanner.content && (
            <SponsoredCard
              kind={sponsoredBanner.content.kind}
              fundingCompanyName={sponsoredBanner.content.funding_company_name ?? undefined}
              externalAdvertiserName={sponsoredBanner.content.external_advertiser_name}
              title={sponsoredBanner.content.title}
              body={sponsoredBanner.content.body}
              imageUrl={sponsoredBanner.content.image_url}
              ctaLabel={sponsoredBanner.content.cta_label}
              ctaUrl={sponsoredBanner.content.cta_url}
              onView={sponsoredBanner.recordView}
              onDismiss={sponsoredBanner.dismiss}
              onClickThrough={async () => {
                const content = sponsoredBanner.content;
                if (!content) return;
                const url = await logClickAndResolveUrl({
                  sponsored_content_id: content.sponsored_content_id,
                  version_id: content.version_id,
                  click_token: content.click_token,
                });
                if (url) {
                  Linking.openURL(url).catch(() => {});
                }
              }}
            />
          )}

          {/* Enhanced Welcome Header */}
          <Animated.View entering={FadeInUp.duration(800).delay(100)}>
            <Box
              bg={Palette.white}
              borderRadius={18}
              p="$6"
              mb="$4"
              borderWidth={1}
              borderColor={Palette.gray100}
              shadowColor={Palette.black}
              shadowOffset={{ width: 0, height: 2 }}
              shadowOpacity={0.04}
              shadowRadius={8}
              elevation={2}
            >
              <HStack
                alignItems="center"
                justifyContent="space-between"
                mb="$4"
              >
                <VStack flex={1}>
                  <Text color={Palette.ink} fontSize={Type.h1} fontWeight="800" letterSpacing={-0.5}>
                    {t('privateHome.welcomeBack', { name: userData.firstName })}
                  </Text>
                  <Text color={Palette.gray600} fontSize={Type.body}>
                    {format(new Date(), "EEEE, MMMM d, yyyy")}
                  </Text>
                </VStack>
                <HStack alignItems="center" space="sm">
                  {/* Notification bell with unread badge */}
                  <Pressable
                    onPress={() => router.push('/private_dashboard/notifications')}
                  >
                    <Box position="relative" p="$2" bg={Palette.gray100} borderRadius="$full">
                      <MaterialIcons name="notifications-none" size={24} color={Palette.gray700} />
                      {unreadNotificationCount > 0 && (
                        <Box
                          position="absolute"
                          top={0}
                          right={0}
                          w={16}
                          h={16}
                          rounded="$full"
                          bg={Palette.gold}
                          justifyContent="center"
                          alignItems="center"
                        >
                          <Text fontSize={Type.tiny} fontWeight="800" color={Palette.white}>
                            {unreadNotificationCount > 9 ? '9+' : unreadNotificationCount}
                          </Text>
                        </Box>
                      )}
                    </Box>
                  </Pressable>
                  {/* Avatar → account menu (Switch / Settings / Log out). Mirrors
                      the company dashboard so both sides behave the same. */}
                  <Pressable accessibilityLabel="Account menu" onPress={() => setMenuOpen(true)}>
                    <Box
                      p="$0.5"
                      rounded="$full"
                      borderWidth={2}
                      borderColor="rgba(242, 183, 5, 0.15)"
                      bg="white"
                    >
                      <Avatar size="sm" bgColor={Palette.indigo}>
                        <AvatarFallbackText>{getInitials(userData.firstName)}</AvatarFallbackText>
                      </Avatar>
                    </Box>
                  </Pressable>
                </HStack>
              </HStack>

              {/* Quick Stats Row */}
              <HStack space="md" alignItems="center">
                <VStack
                  flex={1}
                  alignItems="center"
                  p="$3"
                  bg={Palette.greenTint}
                  borderRadius={18}
                >
                  <Text color={Palette.ink} fontSize={Type.h1} fontWeight="800">
                    {(() => {
                      const totalMins = Math.round(payData.totalHours * 60);
                      const h = Math.floor(totalMins / 60);
                      const m = totalMins % 60;
                      if (h === 0) return `${m}m`;
                      if (m === 0) return `${h}h`;
                      return `${h}h ${m}m`;
                    })()}
                  </Text>
                  <Text color={Palette.gray500} fontSize={Type.tiny}>
                    {t('privateHome.totalHours')}
                  </Text>
                </VStack>
                <VStack
                  flex={1}
                  alignItems="center"
                  p="$3"
                  bg={Palette.violetTint}
                  borderRadius={18}
                >
                  <Text color={Palette.ink} fontSize={Type.h1} fontWeight="800">
                    {/* Pay is computed in the salary's own currency (country-
                        derived); show it as-is, not converted to a display pref. */}
                    {formatCurrency(payData.estimatedPay, { currencyCode: (salaryData as any)?.currency, convert: false })}
                  </Text>
                  <Text color={Palette.gray500} fontSize={Type.tiny}>
                    {selectedFilter === "today"
                      ? t('privateHome.earningsToday')
                      : selectedFilter === "7days"
                        ? t('privateHome.earningsWeek')
                        : selectedFilter === "month"
                          ? t('privateHome.earningsMonth')
                          : selectedFilter === "6months"
                            ? t('privateHome.earnings6Months')
                            : t('privateHome.earningsYear')}
                  </Text>
                </VStack>
                <VStack
                  flex={1}
                  alignItems="center"
                  p="$3"
                  bg={Palette.goldTint}
                  borderRadius={18}
                >
                  <Text color={Palette.ink} fontSize={Type.h1} fontWeight="800">
                    {transformedTasks.length}
                  </Text>
                  <Text color={Palette.gray500} fontSize={Type.tiny}>
                    {t('privateHome.tasks')}
                  </Text>
                </VStack>
              </HStack>
            </Box>
          </Animated.View>

          {/* Currency Indicator */}
          <Animated.View entering={FadeInUp.duration(500).delay(100)}>
            <CurrencyIndicator />
          </Animated.View>

          {/* Effective country / active mission — employee-facing country context */}
          <Animated.View entering={FadeInUp.duration(500).delay(100)}>
            <CountryStatusChip />
          </Animated.View>

          {/* Unified Filter Selector */}
          <Animated.View entering={FadeInUp.duration(600).delay(150)}>
            <Box
              bg={Palette.white}
              p="$4"
              borderRadius={18}
              mb="$4"
              borderWidth={1}
              borderColor={Palette.gray100}
              shadowColor={Palette.black}
              shadowOffset={{ width: 0, height: 2 }}
              shadowOpacity={0.04}
              shadowRadius={8}
              elevation={2}
            >
              <VStack space="sm">
                <HStack alignItems="center" space="sm">
                  <MaterialIcons name="filter-list" size={20} color={Palette.gray500} />
                  <Text color={Palette.gray700} fontSize={Type.body} fontWeight="600">
                    {t('privateHome.timePeriod')}
                  </Text>
                </HStack>
                <HStack space="xs" flexWrap="wrap">
                  {[
                    { key: "today", label: t('privateHome.filterToday') },
                    { key: "7days", label: t('privateHome.filterThisWeek') },
                    { key: "month", label: t('privateHome.filterThisMonth') },
                    { key: "6months", label: t('privateHome.filter6Months') },
                    { key: "1year", label: t('privateHome.filter1Year') },
                  ].map((filter) => (
                    <Button
                      key={filter.key}
                      size="sm"
                      variant={
                        selectedFilter === filter.key ? "solid" : "outline"
                      }
                      bg={
                        selectedFilter === filter.key
                          ? Palette.ink
                          : "transparent"
                      }
                      borderColor={
                        selectedFilter === filter.key
                          ? Palette.ink
                          : Palette.gray300
                      }
                      onPress={() => handleFilterChange(filter.key)}
                      disabled={isDataLoading}
                      opacity={isDataLoading ? 0.6 : 1}
                    >
                      <ButtonText
                        color={
                          selectedFilter === filter.key ? Palette.white : Palette.gray600
                        }
                        fontSize={Type.small}
                        fontWeight="500"
                      >
                        {filter.label}
                      </ButtonText>
                    </Button>
                  ))}
                </HStack>
              </VStack>
            </Box>
          </Animated.View>

          <VStack space="md">
            <Animated.View entering={SlideInRight.duration(800).delay(400)}>
              <PaySummary
                payData={payData as any}
                selectedPeriodRange={selectedPeriodRange}
                isDataLoading={isDataLoading}
                authLoading={authLoading}
                salaryData={effectiveSalaryData}
                timeLogs={timeLogs}
                currency={userCurrency}
                payslipEstimate={payslipEstimate}
                resolvedSalary={resolvedSalary}
                isCompanyEmployee={!!jobData?.company_id}
              />
            </Animated.View>

            {/* M17 — Sponsored card slot (kind='ad' or 'house').
                Sits between PaySummary and ProfileProgress so it surfaces high
                in the feed without crowding pay/financial data. The card has
                its own FadeInUp entry animation at delay 500 (matches the
                cascade between PaySummary's delay 400 and ClockHistory's
                delay 600 further down the page). The employer-announcement
                banner lives separately at the top of the feed — see
                sponsoredBanner render block above. */}
            {sponsoredCard.content && (
              <SponsoredCard
                kind={sponsoredCard.content.kind}
                fundingCompanyName={sponsoredCard.content.funding_company_name ?? undefined}
                externalAdvertiserName={sponsoredCard.content.external_advertiser_name}
                title={sponsoredCard.content.title}
                body={sponsoredCard.content.body}
                imageUrl={sponsoredCard.content.image_url}
                ctaLabel={sponsoredCard.content.cta_label}
                ctaUrl={sponsoredCard.content.cta_url}
                onView={sponsoredCard.recordView}
                onDismiss={sponsoredCard.dismiss}
                onClickThrough={async () => {
                  // Server resolves the redirect URL from version_id (NOT
                  // current_version_id), so an admin edit between view and
                  // click can't hijack where the user lands. We open the URL
                  // ourselves because /clicks is a same-origin POST that
                  // returns 302 to a public destination.
                  const content = sponsoredCard.content;
                  if (!content) return;
                  const url = await logClickAndResolveUrl({
                    sponsored_content_id: content.sponsored_content_id,
                    version_id: content.version_id,
                    click_token: content.click_token,
                  });
                  if (url) {
                    Linking.openURL(url).catch(() => {});
                  }
                }}
              />
            )}

            {/* Profile Completion */}
            <ProfileProgress
              profileData={user?.private_user ? { gender: user.private_user.gender, date_of_birth: user.private_user.date_of_birth, pass_port_number: user.private_user.pass_port_number } : null}
              jobData={jobData ? { job_title: jobData.job_title, employer_name: jobData.employer_name, work_start_time: jobData.work_start_time as any, work_end_time: jobData.work_end_time as any, work_days: jobData.work_days } : null}
            />

            {/* Earnings vs Expenses */}
            <EarningsVsExpenses
              estimatedPay={payData.estimatedPay}
              totalExpenses={totalExpenses}
              recentExpenses={recentExpenses}
              hourlyRate={payData.hourlyRate || 0}
              formatCurrency={formatCurrency}
            />

            {/* Savings Goal */}
            {user?.private_user_id && (
              <SavingsGoal
                privateUserId={Number(user.private_user_id)}
                estimatedPay={payData.estimatedPay}
                totalExpenses={totalExpenses}
                formatCurrency={formatCurrency}
              />
            )}

            {/* Clock History */}
            <Animated.View entering={FadeInUp.duration(800).delay(600)} style={{ marginBottom: 16 }}>
              <ClockHistory
                filteredClockData={filteredClockData}
                selectedTimeFilter={selectedFilter}
                isDataLoading={isDataLoading}
                authLoading={authLoading}
                currentlyWorking={false}
              />
            </Animated.View>

            {/* Tasks Management */}
            <Animated.View entering={FadeInUp.duration(800).delay(800)}>
              <TasksManagement
                tasks={transformedTasks as any}
                selectedTaskFilter={selectedTaskFilter}
                onTaskFilterChange={handleTaskFilterChange}
                isTasksLoading={isDataLoading}
                authLoading={authLoading}
                onTaskUpdate={handleTaskUpdate}
              />
            </Animated.View>

            {/* Enhanced Quick Actions */}
            <Animated.View entering={FadeInUp.duration(800).delay(1000)}>
              <Box
                bg={Palette.white}
                borderRadius={18}
                p="$5"
                borderWidth={1}
                borderColor={Palette.gray100}
                shadowColor={Palette.black}
                shadowOffset={{ width: 0, height: 2 }}
                shadowOpacity={0.04}
                shadowRadius={8}
                elevation={2}
                mb="$4"
              >
                <HStack
                  alignItems="center"
                  justifyContent="space-between"
                  mb="$4"
                >
                  <Text color={Palette.ink} fontSize={Type.h2} fontWeight="800" letterSpacing={-0.5}>
                    {t('privateHome.quickActions')}
                  </Text>
                  <MaterialIcons name="flash-on" size={24} color={Palette.gold} />
                </HStack>

                {/* Uniform 3-column grid: neutral tile + colored icon chip +
                    ink label. Replaces the ragged pastel-pill rows so every
                    action is the same size and the colour is an accent, not a
                    whole-pill fill (tokenized to theme.ts, home as reference). */}
                <HStack flexWrap="wrap" justifyContent="space-between">
                  {[
                    { key: 'clock', label: t('privateHome.clockIn'), icon: 'access-time', color: Palette.blue, tint: Palette.blueTint, onPress: () => router.push('/private_dashboard/clock-in') },
                    { key: 'tasks', label: t('privateHome.quickTasks'), icon: 'assignment', color: Palette.green, tint: Palette.greenTint, onPress: () => router.push('/private_dashboard/tasks') },
                    { key: 'expenses', label: t('privateHome.expenses'), icon: 'receipt-long', color: Palette.teal, tint: Palette.tealTint, onPress: () => router.push('/private_dashboard/expenses') },
                    { key: 'transfers', label: t('privateHome.transfers'), icon: 'swap-horiz', color: Palette.blue, tint: Palette.blueTint, onPress: () => router.push('/private_dashboard/transfers') },
                    { key: 'calculator', label: t('privateHome.calculator'), icon: 'calculate', color: Palette.violet, tint: Palette.violetTint, onPress: () => {
                        // Calculator needs salary + working-hours data from the
                        // profile. If those aren't set, bounce to profile.
                        if (isProfileIncomplete) {
                          RNAlert.alert(
                            t('privateHome.completeSetupTitle'),
                            t('privateHome.completeSetupBody'),
                            [
                              { text: t('common.cancel'), style: 'cancel' },
                              { text: t('privateHome.openProfile'), onPress: () => router.push('/private_dashboard/profile') },
                            ],
                          );
                          return;
                        }
                        router.push('/private_dashboard/calculator');
                      } },
                    { key: 'settings', label: t('privateHome.settings'), icon: 'settings', color: Palette.gold, tint: Palette.goldTint, onPress: () => router.push('/private_dashboard/settings') },
                    { key: 'payslips', label: t('privateHome.payslips'), icon: 'payments', color: Palette.green, tint: Palette.greenTint, onPress: () => router.push('/private_dashboard/payslips') },
                    { key: 'documents', label: t('privateHome.documentVault'), icon: 'lock', color: Palette.teal, tint: Palette.tealTint, onPress: () => router.push('/private_dashboard/documents') },
                    { key: 'leave', label: t('privateHome.leaveRequest'), icon: 'event-available', color: Palette.gold, tint: Palette.goldTint, onPress: () => router.push('/private_dashboard/leave') },
                  ].map((a) => (
                    <Pressable key={a.key} onPress={a.onPress} style={{ width: '31.5%', marginBottom: 12 }}>
                      <VStack
                        alignItems="center"
                        justifyContent="center"
                        space="xs"
                        bg={Palette.gray50}
                        borderRadius={16}
                        borderWidth={1}
                        borderColor={Palette.gray100}
                        py="$3"
                        px="$2"
                        minHeight={100}
                      >
                        <Box width={44} height={44} borderRadius={22} bg={a.tint} alignItems="center" justifyContent="center">
                          <MaterialIcons name={a.icon as any} size={20} color={a.color} />
                        </Box>
                        <Text color={Palette.ink} fontSize={Type.small} fontWeight="600" numberOfLines={2} textAlign="center" lineHeight={15}>
                          {a.label}
                        </Text>
                      </VStack>
                    </Pressable>
                  ))}
                </HStack>
              </Box>
            </Animated.View>
          </VStack>
        </Box>
      </ScrollView>

      {/* M12 — First-launch ads consent modal. Mounted at the top level so
          it overlays the home content. Self-suppresses once the user has
          answered (AsyncStorage flag, keyed by policy_version). */}
      <AdsConsentModal />

      {/* Account menu — opened from the avatar. Absolute overlay (not a
          react-native Modal, which freezes on Android in this app). Mirrors the
          company dashboard: name, then Switch / Settings / Log out. */}
      {menuOpen ? (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000, elevation: 1000 }}>
          <Pressable style={{ flex: 1 }} onPress={() => setMenuOpen(false)}>
            <View style={{ position: 'absolute', top: insets.top + 64, right: 16, minWidth: 232 }}>
              <Pressable onPress={() => {}}>
                <Box bg="white" rounded="$2xl" borderWidth={1} borderColor={Palette.gray100} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 8 }} shadowOpacity={0.15} shadowRadius={16} elevation={14} overflow="hidden">
                  <Box px="$4" pt="$3" pb="$2">
                    <Text fontWeight="800" color={Palette.ink} fontSize={Type.body} numberOfLines={1}>
                      {userData.firstName || 'Account'}
                    </Text>
                    {(user?.company?.company_name || (user as any)?.private_user?.company?.company_name) ? (
                      <Text fontSize={Type.tiny} color={Palette.gray400} numberOfLines={1}>
                        {user?.company?.company_name || (user as any)?.private_user?.company?.company_name}
                      </Text>
                    ) : null}
                  </Box>
                  <View style={{ height: 1, backgroundColor: Palette.gray100 }} />
                  {qualifiesForModeChoice(user) && (
                    <Pressable onPress={async () => { setMenuOpen(false); await setEntryMode('employer'); router.replace('/company_dashboard/home'); }}>
                      <HStack alignItems="center" space="md" px="$4" py="$3">
                        <MaterialIcons name="swap-horiz" size={20} color={Palette.indigo} />
                        <Text color={Palette.gray800} fontWeight="600">Switch</Text>
                      </HStack>
                    </Pressable>
                  )}
                  <Pressable onPress={() => { setMenuOpen(false); router.push('/private_dashboard/settings'); }}>
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

const DashboardWithValidation = () => {
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuth();

  return (
    <ProfileErrorBoundary>
      <ProfileValidator
        user={user as any}
        isAuthenticated={isAuthenticated}
        authLoading={authLoading}
      >
        <Dashboard />
      </ProfileValidator>
    </ProfileErrorBoundary>
  );
};

export default DashboardWithValidation;
