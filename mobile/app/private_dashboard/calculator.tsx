import { PayrollFormulaPayload, Salary, SectorCategory, SectorCategorySalary, SectorGrade, TimeLog, getAllSectors, getCategoriesForSector, getJobById, getSalaryByJobId, getUserDetail, getUserTimeLogs, isApiError, isPermissionDeniedError } from '@/services/api';
import { salaryStructures } from '@/services/payroll-api';
import { Palette, Type } from '@/app/constants/theme';
// import { applyFormula, getPeriodRange } from '@/utils/payrollFormula';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Box,
  Button,
  ButtonText,
  Divider,
  HStack,
  Heading,
  Input,
  InputField,
  InputIcon,
  InputSlot,
  Pressable,
  Select,
  SelectBackdrop,
  SelectContent,
  SelectInput,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  SelectIcon,
  SelectDragIndicator,
  SelectDragIndicatorWrapper,
  Text,
  Toast,
  ToastDescription,
  ToastTitle,
  VStack,
  useToast,
  useToken,
  Spinner,
} from '@gluestack-ui/themed';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { zodResolver } from '@hookform/resolvers/zod';
import { startOfMonth, startOfWeek, endOfWeek, differenceInMinutes, subWeeks, subDays, parseISO, isWithinInterval, format, isAfter, isBefore } from 'date-fns';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { LinearGradient } from 'expo-linear-gradient';
import { Controller, useForm } from 'react-hook-form';
import { Platform, Modal as RNModal, ScrollView, Switch, Keyboard, StatusBar } from 'react-native';
import Animated, { FadeIn, FadeInUp } from '@/app/utils/animated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { z } from 'zod';
import ProfileErrorBoundary from '../components/ProfileErrorBoundary';
import useAuth from '../hooks/useAuth';
import useCurrency from '../hooks/useCurrency';
import { StandardButton } from '@/app/design-system';
import { DEFAULT_MONTHLY_HOURS, computeHourlyFromMonthly, computeMonthlyFromHourly, deriveHourlyRateFromSalary } from '@/utils/payroll';
// Extracted components
import ProfileSummaryCard from '../../components/calculator/ProfileSummaryCard';
import CalculatorModeTabs from '../../components/calculator/CalculatorModeTabs';
import ManualCalculator from '../../components/calculator/ManualCalculator';
import ClockInCalculator from '../../components/calculator/ClockInCalculator';
import ShiftPayPreview from '../../components/calculator/ShiftPayPreview';
import DatePickerModal from '../../components/calculator/DatePickerModal';
import SalarySummary from '../../components/calculator/SalarySummary';
import ClockInSummary from '../../components/calculator/ClockInSummary';
// ==================== MOCK PUBLIC HOLIDAYS ====================
// In a real app, this would come from an API or a more robust source.
const publicHolidays: Set<string> = new Set([
  '2025-01-01', // New Year's Day
  '2025-05-01', // Labour Day
]);

// ==================== NEW SALARY CALCULATION UTILITY ====================

interface CalculationConfig {
  normalHours: number;
  overtimeMultiplier: number;
  sundayMultiplier: number;
  publicHolidayMultiplier: number;
  nightMultiplier?: number;
}

const defaultConfig: CalculationConfig = {
  normalHours: 8,
  overtimeMultiplier: 1.5,
  sundayMultiplier: 2,
  publicHolidayMultiplier: 2,
  // night multiplier added for night shift pay
  nightMultiplier: 2.0,
};

// Helper: derive a representative gross salary (number) from a selected salary band
const salaryBandRepresentative = (band?: string) => {
  if (!band) return 0;
  switch (band) {
    case '0-20000':
      return 10000;
    case '20001-40000':
      return 30000;
    case '40001-80000':
      return 60000;
    case '80000+':
      return 80000;
    default:
      // try parse as number fallback
      const n = parseFloat(band as any);
      return isNaN(n) ? 0 : n;
  }
};

const salaryBandLabel = (band?: string) => {
  if (!band) return '';
  switch (band) {
    case '0-20000':
      return '0 - 20,000';
    case '20001-40000':
      return '20,001 - 40,000';
    case '40001-80000':
      return '40,001 - 80,000';
    case '80000+':
      return '80,000+';
    default:
      return band;
  }
};

// Primary colors will come from theme tokens (primary500 / primary600)

const calculatePayForDay = (
  dailyHours: number,
  normalHourlyRate: number,
  isSunday: boolean,
  isPublicHoliday: boolean,
  formula?: PayrollFormulaPayload | null
) => {
  let multiplier = 1;
  if (isPublicHoliday) {
    multiplier = formula?.multiplier_public_holiday ?? 2.0;
  } else if (isSunday) {
    multiplier = formula?.multiplier_sunday ?? 2.0;
  }
  return dailyHours * normalHourlyRate * multiplier;
};

// Zod schema for salary form
const SalarySchema = z.object({
  paymentFrequency: z
    .string()
    .nonempty('Payment frequency is required'),
  allowances: z
    .string()
    .optional()
    .refine((val) => !val || (!isNaN(parseFloat(val)) && parseFloat(val) >= 0), 'Enter a valid positive number'),
  deductions: z
    .string()
    .optional()
    .refine((val) => !val || (!isNaN(parseFloat(val)) && parseFloat(val) >= 0), 'Enter a valid positive number'),
  hourlyRate: z
    .string()
    .optional()
    .refine((val) => !val || (!isNaN(parseFloat(val)) && parseFloat(val) >= 0), 'Enter a valid positive number'),
  basicSalary: z
    .string()
    .optional()
    .refine((val) => !val || (!isNaN(parseFloat(val)) && parseFloat(val) >= 0), 'Enter a valid positive number'),
  // New selection fields
  sector: z.string().optional(),
  category: z.string().optional(),
  serviceYears: z.string().optional().refine((val) => {
    if (!val) return true;
    // Accept special string values '<1' and any '+X' format from reference data
    if (val === '<1') return true;
    if (val.endsWith('+') && !isNaN(parseFloat(val.slice(0, -1)))) return true;
    const n = Number(val);
    return !isNaN(n) && Number.isInteger(n) && n >= 1 && n <= 50;
  }, 'Enter years of service as "<1", "X+" or an integer between 1 and 50'),
  grade: z.string().optional(),
  salaryBand: z.string().optional(),
  numberOfHoursWorkedMode: z
    .enum(['195', '180', '80', 'custom'] as const)
    .optional(),
  numberOfHoursWorked: z
    .string()
    .optional()
    .refine((val) => !val || (!isNaN(parseFloat(val)) && parseFloat(val) >= 0), 'Enter a valid positive number'),
  startDate: z.date().nullable(),
  endDate: z.date().nullable(),
  timeframe: z.enum(['weekly', 'biweekly', 'monthly', 'custom']).optional(),
  // UI-only form fields used by the calculator
  daysPerMonthMode: z
    .enum(['profile', '22', '26'] as const)
    .optional(),
  derivedSalary: z
    .string()
    .optional()
});

const validationSchema = SalarySchema.refine(data => {
  if (data.timeframe === 'custom' && data.startDate && data.endDate) {
    return data.endDate >= data.startDate;
  }
  return true;
}, { message: "End date cannot be before start date.", path: ["endDate"] });

type SalaryFormData = z.infer<typeof SalarySchema>;

interface UserProfile {
  salary: number;
  revenue: number;
  allowances: number;
}

const SalaryCalculatorScreen = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { currencyInfo } = useCurrency();
  // Theme primary tokens (falls back to strings provided by theme)
  const primary = useToken('colors', 'primary500');
  const primary600 = useToken('colors', 'primary600');
  const router = useRouter();
  const toast = useToast(); // Initialize useToast
  const [showClockIns, setShowClockIns] = useState(false);
  // Calculator mode: 'manual' or 'clockin'
  const [calculatorMode, setCalculatorMode] = useState<'manual' | 'clockin'>('manual');
  const [showManualSummary, setShowManualSummary] = useState(false);
  const [showClockInSummary, setShowClockInSummary] = useState(false);
  const [results, setResults] = useState<{
    hourly: number;
    weekly: number;
    biweekly: number;
    monthly: number;
    net: number;
    gross: number;
    allowance: number;
    deduction: number;
  } | null>(null);
  const [clockInTotal, setClockInTotal] = useState<{
    totalHours: number;
    totalPay: number;
    totalSalary?: number;
    monthlySalary?: number;
    workingDays?: number;
    hourlyRate?: number;
    avgHoursPerDay?: number;
    avgPayPerDay?: number;
    projectedMonthlyHours?: number;
  } | null>(null);

  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);

  const [prefilledProfileData, setPrefilledProfileData] = useState<UserProfile | null>(null);

  const [timeLogs, setTimeLogs] = useState<TimeLog[]>([]);
  const [salaryDetails, setSalaryDetails] = useState<Salary | null>(null);
  const [basicSalaryPrefilledFromProfile, setBasicSalaryPrefilledFromProfile] = useState(false);
  const [isComputingEstimate, setIsComputingEstimate] = useState(false);
  // Used to disable Calculate button and prevent multiple clicks
  const [isCalculating, setIsCalculating] = useState(false);
  // Flag to track when we're auto-selecting categories/grades to avoid showing estimation toast
  const [isAutoSelecting, setIsAutoSelecting] = useState(false);
  // Flag to prevent toast during initial component load
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Automatic calculator constants (will become configurable in profile)
  // Use shared default so hourly <-> monthly conversions are consistent across the app
  const AUTO_STANDARD_HOURS = DEFAULT_MONTHLY_HOURS;
  const AUTO_WORKING_DAYS_PER_MONTH = 22; // Default working days per month

  // Normalize a numeric or profile-provided hours value into one of the preset modes
  const hoursModeFromNumber = (v?: number | string) => {
    const n = Number(v);
    if (!isNaN(n)) {
      if (n === 195) return '195';
      if (n === 180) return '180';
      if (n === 80) return '80';
      if (n > 0) return 'custom';
    }
    return '195';
  };



  const fetchUserProfile = useCallback(async (): Promise<UserProfile> => {
    try {
      // Safe access to user data with defensive checks
      if (!user?.private_user_id) {
        return { salary: 0, revenue: 0, allowances: 0 };
      }

      // Safely attempt to fetch job information
      let jobResponse;
      try {
        jobResponse = await getJobById(Number(user.private_user_id));
      } catch (jobError) {
        console.warn("Failed to fetch job details:", jobError);
        return { salary: 0, revenue: 0, allowances: 0 };
      }

      if (!jobResponse || 'error' in jobResponse) {
        console.warn("Could not fetch job for salary details:", jobResponse?.error || 'Unknown error');
        return { salary: 0, revenue: 0, allowances: 0 };
      }

      // Company-affiliated employee (Job.company_id set) — the employer's
      // SalaryStructure is authoritative, never the legacy `salaries` table
      // (self-reported by the employee on their own profile, with no sync
      // to structure changes an employer makes). Same fix already applied
      // to private_dashboard/home.tsx and clock-in.tsx.
      const companyId = (jobResponse as any)?.company_id;
      if (companyId) {
        try {
          const structRes = await salaryStructures.preview(Number(user.private_user_id));
          if (!structRes || 'error' in structRes) {
            console.warn("Could not fetch salary structure for company employee:", (structRes as any)?.error);
            setSalaryDetails(null);
            return { salary: 0, revenue: 0, allowances: 0 };
          }
          const basicComponent = structRes.components?.find(
            (c) => c.kind === 'earning' && c.is_basic,
          );
          if (!basicComponent) {
            // Company hasn't configured this employee's structure yet —
            // show "not set up", not an unrelated old personal entry.
            setSalaryDetails(null);
            return { salary: 0, revenue: 0, allowances: 0 };
          }
          const allowanceTotal = (structRes.components ?? [])
            .filter((c) => c.kind === 'earning' && !c.is_basic)
            .reduce((sum, c) => sum + (parseFloat(String(c.amount)) || 0), 0);
          const salary = parseFloat(String(basicComponent.amount)) || 0;
          const revenue = salary + allowanceTotal;
          // Keep salaryDetails as a Salary-shaped object so every existing
          // downstream reader (computeDaysPerMonth, isEstimateFromSalaryRecord,
          // ProfileSummaryCard, …) keeps working unchanged — just sourced
          // correctly now. monthly_hours/days_of_work_per_month have no
          // per-employee equivalent in the structure system, so they're
          // left unset and fall through to those readers' own defaults.
          setSalaryDetails({
            job_id: jobResponse.job_id,
            salary: String(salary),
            allowance: String(allowanceTotal),
            revenue: String(revenue),
            monthly_hours: "",
            days_of_work_per_month: 0,
            break_in_minutes_per_day: 0,
          } as Salary);
          return { salary, revenue, allowances: allowanceTotal };
        } catch (structError) {
          console.warn("Failed to fetch salary structure for company employee:", structError);
          setSalaryDetails(null);
          return { salary: 0, revenue: 0, allowances: 0 };
        }
      }

      // Independent/personal user (no company) — their own self-reported
      // legacy profile entry is exactly the right source for them.
      let salaryResponse;
      try {
        salaryResponse = await getSalaryByJobId(jobResponse.job_id);
      } catch (salaryError) {
        console.warn("Failed to fetch salary details:", salaryError);
        return { salary: 0, revenue: 0, allowances: 0 };
      }

      if (!salaryResponse || 'error' in salaryResponse) {
        console.warn("Could not fetch salary details:", salaryResponse?.error || 'Unknown error');
        return { salary: 0, revenue: 0, allowances: 0 };
      }

      setSalaryDetails(salaryResponse);

      // Formulas fetched separately if needed in future

      // Safe parsing with fallback values
      const salary = parseFloat((salaryResponse as any)?.salary || '0') || 0;
      const revenue = parseFloat((salaryResponse as any)?.revenue || '0') || 0;
      const allowances = parseFloat((salaryResponse as any)?.allowance || '0') || 0;

      return { salary, revenue, allowances };

    } catch (err) {
      console.error("Error in fetchUserProfile for calculator:", err);
      return { salary: 0, revenue: 0, allowances: 0 };
    }
  }, [user?.user_id]);

  const [userDetails, setUserDetails] = useState<any>(null);
  const [payrollFormula, setPayrollFormula] = useState<PayrollFormulaPayload | null>(null);
  const [sectors, setSectors] = useState<{ id: number; name: string }[]>([]);
  const [categories, setCategories] = useState<SectorCategory[]>([]);
  const [grades, setGrades] = useState<SectorGrade[]>([]);
  const [yearsOptions, setYearsOptions] = useState<Array<number | string>>([]);
  const [salaryBasis, setSalaryBasis] = useState<'monthly' | 'daily' | 'none'>('none');
  const [salaryDailyValue, setSalaryDailyValue] = useState<number | null>(null);

  // Helper to compute days-per-month given a source object (grade/category/salary)
  const computeDaysPerMonth = (src?: any) => {
    // Canonical precedence for determining days-per-month (important for deriving monthly from daily):
    // 1) explicit `days_of_work_per_month` on the source (category/grade/salary record)
    // 2) `work_days_per_week` (or similar aliases) on the source -> days = work_days_per_week * (52/12)
    // 3) salaryDetails fetched for the user's job (check same fields there)
    // 4) fallback constant AUTO_WORKING_DAYS_PER_MONTH
    const WEEKS_PER_MONTH = 52 / 12; // canonical weeks-per-month conversion

    // 1) explicit days_of_work_per_month
    const explicitDays = src?.days_of_work_per_month ?? src?.days_of_work_per_month;
    if (explicitDays != null && !isNaN(Number(explicitDays)) && Number(explicitDays) > 0) return Number(explicitDays);

    // 2) prefer work_days_per_week (many APIs call this by different names; check common aliases)
    const workDaysPerWeek = src?.work_days_per_week ?? src?.days_of_work_per_week ?? src?.working_days_per_week ?? src?.work_week_days ?? src?.work_days_per_week;
    if (workDaysPerWeek != null && !isNaN(Number(workDaysPerWeek)) && Number(workDaysPerWeek) > 0) {
      return Number(workDaysPerWeek) * WEEKS_PER_MONTH;
    }

    // 3) fallback to salaryDetails (user's job record) if present
    const sd_explicitDays = salaryDetails?.days_of_work_per_month;
    if (sd_explicitDays != null && !isNaN(Number(sd_explicitDays)) && Number(sd_explicitDays) > 0) return Number(sd_explicitDays);
    const sd_workDaysPerWeek = (salaryDetails as any)?.work_days_per_week ?? (salaryDetails as any)?.days_of_work_per_week ?? (salaryDetails as any)?.working_days_per_week ?? (salaryDetails as any)?.work_week_days;
    if (sd_workDaysPerWeek != null && !isNaN(Number(sd_workDaysPerWeek)) && Number(sd_workDaysPerWeek) > 0) {
      return Number(sd_workDaysPerWeek) * WEEKS_PER_MONTH;
    }

    // 4) fallback to app constant
    return (AUTO_WORKING_DAYS_PER_MONTH || 22);
  };

  // Helper to return days-per-month plus a human-readable source explanation
  const getDaysPerMonthInfo = (src?: any) => {
    const WEEKS_PER_MONTH = 52 / 12;
    const explicitDays = src?.days_of_work_per_month ?? src?.days_of_work_per_month;
    if (explicitDays != null && !isNaN(Number(explicitDays)) && Number(explicitDays) > 0) {
      return { value: Number(explicitDays), reason: 'explicit days_of_work_per_month (source)' };
    }

    const workDaysPerWeek = src?.work_week_days ?? src?.days_of_work_per_week ?? src?.working_days_per_week ?? src?.work_days_per_week;
    if (workDaysPerWeek != null && !isNaN(Number(workDaysPerWeek)) && Number(workDaysPerWeek) > 0) {
      return { value: Number(workDaysPerWeek) * WEEKS_PER_MONTH, reason: `work_days_per_week = ${Number(workDaysPerWeek)} (source)` };
    }

    // try salaryDetails
    const sd_explicitDays = salaryDetails?.days_of_work_per_month;
    if (sd_explicitDays != null && !isNaN(Number(sd_explicitDays)) && Number(sd_explicitDays) > 0) return { value: Number(sd_explicitDays), reason: 'days_of_work_per_month (salary record)' };
    const sd_workDaysPerWeek = (salaryDetails as any)?.work_days_per_week ?? (salaryDetails as any)?.working_days_per_week ?? (salaryDetails as any)?.days_of_work_per_week;
    if (sd_workDaysPerWeek != null && !isNaN(Number(sd_workDaysPerWeek)) && Number(sd_workDaysPerWeek) > 0) {
      return { value: Number(sd_workDaysPerWeek) * WEEKS_PER_MONTH, reason: `work_days_per_week = ${Number(sd_workDaysPerWeek)} (salary record)` };
    }

    return { value: (AUTO_WORKING_DAYS_PER_MONTH || 22), reason: `fallback AUTO_WORKING_DAYS_PER_MONTH = ${AUTO_WORKING_DAYS_PER_MONTH || 22}` };
  };

  // Initialize form early so effects that call setValue can access it
  const form = useForm<SalaryFormData>({
    resolver: zodResolver(SalarySchema),
    defaultValues: {
      paymentFrequency: 'monthly',
      // Preset for number of hours and days-per-month selector
      numberOfHoursWorkedMode: '195',
      numberOfHoursWorked: String(AUTO_STANDARD_HOURS),
      daysPerMonthMode: '22',
      // New default values for selects
      sector: '',
      category: '',
      serviceYears: '',
      salaryBand: '',
      allowances: '',
      deductions: '',
      hourlyRate: '',
      basicSalary: '',
      startDate: null,
      endDate: null,
      timeframe: 'monthly',
    },
    mode: 'onChange',
  });

  // Destructure needed methods from form
  const { control, handleSubmit, reset, getValues, setValue, watch, formState: { errors, isValid } } = form;

  // Watch form values needed by components
  const watchedSector = watch('sector');
  const watchedCategory = watch('category');
  const watchedGrade = watch('grade');
  const watchedServiceYears = watch('serviceYears');
  const watchedBasicSalary = watch('basicSalary');
  const watchedDaysMode = watch('daysPerMonthMode');
  const watchedHoursMode = watch('numberOfHoursWorkedMode');
  const watchedNumberOfHoursWorked = watch('numberOfHoursWorked');
  const watchedStartDate = watch('startDate');
  const watchedEndDate = watch('endDate');

  // Watch basicSalary so we can update the readonly salaryBand display when salary changes
  const basicSalaryValue = watch('basicSalary');

  // Keep salaryBand in sync with derived salary/basis so it shows a human label and is non-editable
  useEffect(() => {
    try {
      // Keep salaryBand human label in sync with derived salary/basis.
      let label = '';
      if (salaryBasis === 'monthly') {
        label = t('calculatorScreen.monthlyRsLabel', { amount: basicSalaryValue || '', symbol: currencyInfo.symbol });
      } else if (salaryBasis === 'daily') {
        label = t('calculatorScreen.dailyRsLabel', { amount: salaryDailyValue ?? '', symbol: currencyInfo.symbol });
      } else {
        label = '';
      }
      setValue('salaryBand', label);
    } catch (err) {
      console.warn('[salaryBand sync] failed to set salaryBand', err);
    }
  }, [salaryBasis, salaryDailyValue, basicSalaryValue, setValue, t, currencyInfo.symbol]);

  // If the user edits basicSalary manually (or it's updated from a selection),
  // clear the "prefilled from profile" flag so manual calculations will use it.
  useEffect(() => {
    if (basicSalaryValue && basicSalaryPrefilledFromProfile) {
      setBasicSalaryPrefilledFromProfile(false);
    }
  }, [basicSalaryValue, basicSalaryPrefilledFromProfile]);

  // Stepper functions for custom hours
  const decrementHours = useCallback(() => {
    const current = Number(watchedNumberOfHoursWorked) || 0;
    const newValue = Math.max(current - 1, 0);
    setValue('numberOfHoursWorked', newValue.toString());
  }, [watchedNumberOfHoursWorked, setValue]);

  const incrementHours = useCallback(() => {
    const current = Number(watchedNumberOfHoursWorked) || 0;
    const newValue = Math.min(current + 1, 500);
    setValue('numberOfHoursWorked', newValue.toString());
  }, [watchedNumberOfHoursWorked, setValue]);

  const handleLongPressStart = useCallback((direction: 'increment' | 'decrement') => {
    // Implementation for long press stepper - can be added later
  }, []);

  const handleLongPressEnd = useCallback(() => {
    // Implementation for long press end - can be added later
  }, []);

  // Close result modals whenever the user switches calculator mode
  useEffect(() => {
    setShowManualSummary(false);
    setShowClockInSummary(false);
  }, [calculatorMode]);

  // Consolidated Initial Data Loading
  useEffect(() => {
    let cancelled = false;
    const initializeData = async () => {
      // Set global loading true - blocks UI rendering
      setIsInitialLoad(true);
      if (!user?.user_id) {
        setIsInitialLoad(false);
        return;
      }

      try {
        // Parallel fetch of independent reference data
        const [userInfo, allSectors, timeLogs] = await Promise.all([
          getUserDetail(user.user_id),
          getAllSectors(),
          user.private_user_id ? getUserTimeLogs(Number(user.private_user_id)) : Promise.resolve([])
        ]);

        if (cancelled) return;

        // 1. Process User Info
        if (userInfo && !('error' in userInfo)) {
          setUserDetails(userInfo);
        } else {
          console.warn('Failed to load user details:', userInfo);
        }

        // 2. Process Sectors
        let sectorsList: any[] = [];
        if (Array.isArray(allSectors)) {
          setSectors(allSectors as any);
          sectorsList = allSectors as any;
        } else {
          console.warn('[prefill] getAllSectors did not return an array:', allSectors);
        }

        // 3. Process Time Logs
        if (Array.isArray(timeLogs)) {
          setTimeLogs(timeLogs);
        } else if (!isPermissionDeniedError(timeLogs)) {
          console.error("Failed to fetch time logs:", timeLogs);
        }

        // 4. Job Prefill Logic (Dependent on job fetch)
        if (user?.private_user_id) {
          const job = await getJobById(Number(user.private_user_id));
          if (job && !(job as any).error) {
            const sectorId = (job as any).sector_id;

            if (sectorId) {
              // Find and set Sector
              const sectorObj = sectorsList.find((x: any) => x.id === sectorId);
              if (sectorObj) {
                setValue('sector', String(sectorObj.id));
              } else {
                setValue('sector', String(sectorId));
              }

              // Load Categories for this Sector
              try {
                const cats = await getCategoriesForSector(Number(sectorId));
                if (Array.isArray(cats) && cats.length > 0) {
                  setCategories(cats as SectorCategory[]);

                  // Auto-select first Category
                  const first = (cats as SectorCategory[])[0];
                  setValue('category', String(first.id));

                  // Set Years Options
                  const years = first.years_array || [];
                  setYearsOptions(years);
                  if (years.length > 0) setValue('serviceYears', String(years[0]));

                  // Set Grades
                  setGrades(first.grades || []);
                  if (first.grades && first.grades.length > 0) {
                    setValue('grade', String(first.grades[0].id));
                  }

                  // === Derive Salary Estimate Logic (Ported from original effect) ===
                  try {
                    const defaultGrade = (first.grades && first.grades.length > 0) ? (first.grades[0] as any) : null;
                    let source: any = null;
                    let salaryRange: SectorCategorySalary | null = null;

                    if (defaultGrade) {
                      source = defaultGrade;
                    } else if (first.salary_ranges && first.salary_ranges.length > 0) {
                      const defaultYears = years.length > 0 ? String(years[0]) : undefined;
                      salaryRange = findSalaryRangeForYears(first.salary_ranges, defaultYears);
                      source = salaryRange;
                    }

                    if (source) {
                      setIsComputingEstimate(true);
                      const monthlyVal = parseSourceToMonthly(source, (getValues as any)('daysPerMonthMode'));

                      if (monthlyVal !== null) {
                        // Detect daily basis
                        const dailyCandidate = Number(String((source as any)?.basic_daily_salary ?? (source as any)?.daily_rate ?? (source as any)?.daily_salary ?? (source as any)?.salary_per_day ?? '').replace(/,/g, '').trim());
                        if (!isNaN(dailyCandidate) && dailyCandidate > 0) {
                          setSalaryBasis('daily');
                          setSalaryDailyValue(dailyCandidate);
                        } else {
                          setSalaryBasis('monthly');
                          setSalaryDailyValue(null);
                        }

                        const monthly = monthlyVal;
                        setValue('basicSalary', String(Math.round(monthly)));
                        setBasicSalaryPrefilledFromProfile(false);
                        const hourly = computeHourlyFromMonthly(monthly) || 0;
                        setValue('hourlyRate', String(hourly.toFixed(2)));
                        try { setValue('derivedSalary' as any, String(Math.round(monthly))); } catch (e) { /* ignore */ }
                        try { setValue('salaryBand', t('calculatorScreen.monthlyRsLabel', { amount: Math.round(monthly), symbol: currencyInfo.symbol })); } catch (e) { /* ignore */ }
                      } else {
                        setSalaryBasis('none');
                        setSalaryDailyValue(null);
                      }
                      setIsComputingEstimate(false);
                    }
                  } catch (e) {
                    console.warn('[prefill] failed to derive salary', e);
                    setIsComputingEstimate(false);
                  }
                  // === End Derive Logic ===

                }
              } catch (catErr) {
                console.warn('Failed to load job categories:', catErr);
              }
            }
          }
        }

      } catch (err) {
        console.error("Critical error initializing calculator data:", err);
      } finally {
        // Enforce a minimum loading time to prevent flicker
        if (!cancelled) setTimeout(() => setIsInitialLoad(false), 300);
      }
    };

    initializeData();
    return () => { cancelled = true; };
  }, [user?.user_id, setValue, currencyInfo.symbol]);

  // Load categories when sector changes (user selection or prefill)
  useEffect(() => {
    let cancelled = false;
    const loadCategoriesForSector = async () => {
      if (!watchedSector) {
        // Clear categories and grades when no sector selected
        setCategories([]);
        setGrades([]);
        setYearsOptions([]);
        setValue('category', '');
        setValue('grade', '');
        setValue('serviceYears', '');
        setValue('basicSalary', '');
        return;
      }

      try {
        // Mark this as not initial load since user is actively selecting
        setIsInitialLoad(false);
        const cats = await getCategoriesForSector(Number(watchedSector));
        if (cancelled) return;
        if (Array.isArray(cats) && cats.length > 0) {
          setCategories(cats as SectorCategory[]);

          // Set flag to prevent toast during auto-selection
          setIsAutoSelecting(true);

          // Auto-select first category
          const first = (cats as SectorCategory[])[0];
          setValue('category', String(first.id));

          // Set years options and default to first option
          const years = first.years_array || [];
          setYearsOptions(years);
          if (years.length > 0) {
            setValue('serviceYears', String(years[0]));
          }

          // Set grades from category and auto-select first
          setGrades(first.grades || []);
          if (first.grades && first.grades.length > 0) {
            setValue('grade', String(first.grades[0].id));
          } else {
            setValue('grade', '');
          }

          // Clear auto-selecting flag after a short delay to allow useEffects to complete
          setTimeout(() => setIsAutoSelecting(false), 100);
        } else {
          console.warn('[sector-change] No categories found for sector:', watchedSector);
          setCategories([]);
          setGrades([]);
          setYearsOptions([]);
          setValue('category', '');
          setValue('grade', '');
          setValue('serviceYears', '');
        }
      } catch (err) {
        console.error('[sector-change] Failed to load categories:', err);
        setCategories([]);
        setGrades([]);
        setYearsOptions([]);
        setValue('category', '');
        setValue('grade', '');
        setValue('serviceYears', '');
        setValue('basicSalary', '');
        setValue('basicSalary', '');
      }
    };

    loadCategoriesForSector();
    return () => { cancelled = true; };
  }, [watchedSector, setValue]);

  // Load grades when category changes
  useEffect(() => {
    if (!watchedCategory || categories.length === 0) {
      setGrades([]);
      setValue('grade', '');
      setValue('basicSalary', '');
      return;
    }

    const selectedCategory = categories.find(cat => cat.id === Number(watchedCategory));
    if (selectedCategory) {
      setGrades(selectedCategory.grades || []);

      // Set flag to prevent toast during auto-selection
      setIsAutoSelecting(true);

      // Auto-select first grade if available
      if (selectedCategory.grades && selectedCategory.grades.length > 0) {
        setValue('grade', String(selectedCategory.grades[0].id));
      } else {
        setValue('grade', '');
        setValue('basicSalary', '');
      }

      // Clear auto-selecting flag after a short delay
      setTimeout(() => setIsAutoSelecting(false), 100);

      // Update years options for this category
      const years = selectedCategory.years_array || [];
      setYearsOptions(years);
      if (years.length > 0) {
        setValue('serviceYears', String(years[0]));
      }
    } else {
      setGrades([]);
      setValue('grade', '');
      setValue('basicSalary', '');
    }
  }, [watchedCategory, categories, setValue]);



  const timeframe = watch('timeframe');

  // Helper to find the appropriate salary range based on years of service.
  // When multiple rows match the same service band (different effective_from years),
  // prefer the row with the highest effective_from that is on or before today.
  // gradeId: when provided, prefer salary ranges specific to that grade (sector_grade_id === gradeId)
  // and exclude ranges tied to a different grade. Ranges with sector_grade_id === null apply to all grades.
  const findSalaryRangeForYears = (salaryRanges?: SectorCategorySalary[], yearsOfService?: string, gradeId?: number): SectorCategorySalary | null => {
    if (!salaryRanges || !yearsOfService) return null;

    // Convert yearsOfService string to number for comparison
    let yearsNum: number;
    if (yearsOfService === '<1') {
      yearsNum = 0;
    } else if (yearsOfService.endsWith('+')) {
      // Handle "X+" format - treat as open-ended starting from X
      const minYears = parseInt(yearsOfService.slice(0, -1), 10);
      if (!isNaN(minYears)) {
        yearsNum = minYears;
      } else {
        return null;
      }
    } else {
      yearsNum = parseInt(yearsOfService, 10);
      if (isNaN(yearsNum)) return null;
    }

    const today = new Date().toISOString().slice(0, 10);

    // Find all ranges that cover this years-of-service AND are live (effective_from <= today).
    const candidates = salaryRanges.filter(range => {
      const min = range.min_years_of_service;
      const max = range.max_years_of_service;
      if (min === null && max === null) return false;
      const minMatch = min === null || yearsNum >= min;
      const maxMatch = max === null || yearsNum <= max;
      if (!minMatch || !maxMatch) return false;
      // Live-date gate
      if (range.effective_from !== null && range.effective_from > today) return false;
      // Grade filter: exclude ranges locked to a different grade
      if (gradeId != null && range.sector_grade_id != null && range.sector_grade_id !== gradeId) return false;
      return true;
    });

    if (candidates.length === 0) return null;

    // Prefer ranges that carry an actual monthly/daily/hourly figure over
    // productivity-only records (per_kg, per_show, per_bag). This prevents
    // Cinema-style categories (monthly row + per_show row with the same year band)
    // from accidentally resolving to the per_show row and showing no salary.
    const preferredCandidates = candidates.filter(r =>
      (r.basic_monthly_salary != null && r.basic_monthly_salary > 0) ||
      (r.basic_daily_salary != null && r.basic_daily_salary > 0) ||
      (r.hourly_rate != null && r.hourly_rate > 0)
    );

    // When a gradeId is given, further prefer grade-specific rows over generic (sector_grade_id === null) rows.
    const gradeCandidates = gradeId != null
      ? preferredCandidates.filter(r => r.sector_grade_id === gradeId)
      : [];
    const finalCandidates = gradeCandidates.length > 0
      ? gradeCandidates
      : (preferredCandidates.length > 0 ? preferredCandidates : candidates);

    // Pick the candidate with the most-recent effective_from (null sorts as oldest)
    finalCandidates.sort((a, b) => {
      if (a.effective_from === null && b.effective_from === null) return 0;
      if (a.effective_from === null) return -1;
      if (b.effective_from === null) return 1;
      return b.effective_from.localeCompare(a.effective_from);
    });

    return finalCandidates[0];
  };

  // Derived salary shown near the Salary Band input.
  // Prefer the selected category/grade source (basic_monthly_salary or basic_daily_salary -> monthly) when available.
  const getSelectedSourceMonthly = () => {
    // Find the appropriate salary range based on selected category, grade, and years of service
    if (selectedCategory && watchedServiceYears) {
      const gradeId = selectedGrade ? selectedGrade.id : undefined;
      const salaryRange = findSalaryRangeForYears(selectedCategory.salary_ranges, watchedServiceYears || undefined, gradeId);
      if (salaryRange) {
        return parseSourceToMonthly(salaryRange, (getValues as any)('daysPerMonthMode'));
      }
    }

    return null;
  };

  // Helper to parse an arbitrary source object (category/grade/salary record) into a monthly number.
  // Accepts an optional daysMode override: '22' | '26' | 'profile' (or undefined).
  const parseSourceToMonthly = (source?: any, daysMode?: string) => {
    if (!source) return null;

    const dailyAliases = [
      'basic_daily_salary',
      'basic_daily_rate',
      'daily_salary',
      'daily_rate',
      'salary_per_day',
      'salary_daily',
      'daily',
      'basic_daily',
      'daily_salary_in_mur'
    ];
    const hourlyAliases = [
      'hourly_rate',
      'hourly',
      'rate_per_hour',
      'per_hour',
      'hour_rate'
    ];
    const monthlyAliases = [
      'basic_monthly_salary',
      'basic_monthly',
      'monthly_salary',
      'monthly',
      'salary',
      'monthlySalary'
    ];

    const findNumeric = (obj: any, keys: string[]) => {
      for (const k of keys) {
        let v = obj?.[k];
        if (v == null) continue;

        // If value is an object (e.g., { salary: { basic_daily_salary: '810.89' } }) try nested keys
        if (typeof v === 'object') {
          // Try direct nested lookups first
          for (const nk of keys) {
            const nv = v?.[nk];
            if (nv != null) {
              const asStrNested = String(nv).replace(/[^0-9.\-]/g, '').trim();
              const nn = Number(asStrNested);
              if (!isNaN(nn) && nn > 0) return nn;
            }
          }
          // Fallback: inspect primitive values inside the object
          const primitive = Object.values(v).find((x: any) => typeof x === 'string' || typeof x === 'number');
          if (primitive != null) {
            const asStrPrim = String(primitive).replace(/[^0-9.\-]/g, '').trim();
            const np = Number(asStrPrim);
            if (!isNaN(np) && np > 0) return np;
          }
          continue;
        }

        // strip currency symbols, letters and commas, keep digits, dot and minus
        const asStr = String(v).replace(/[^0-9.\-]/g, '').trim();
        const n = Number(asStr);
        if (!isNaN(n) && n > 0) return n;
      }
      return NaN;
    };

    const dailyNum = findNumeric(source, dailyAliases);
    if (!isNaN(dailyNum) && dailyNum > 0) {
      // If the user explicitly selected 22/26, honor that override; otherwise fall back to computed days
      if (daysMode === '22') return dailyNum * 22;
      if (daysMode === '26') return dailyNum * 26;
      return dailyNum * computeDaysPerMonth(source);
    }

    const hourlyNum = findNumeric(source, hourlyAliases);
    if (!isNaN(hourlyNum) && hourlyNum > 0) {
      // Convert hourly rate to monthly using standard hours per month
      const monthlyFromHourly = hourlyNum * AUTO_STANDARD_HOURS;
      if (daysMode === '22') return monthlyFromHourly;
      if (daysMode === '26') return monthlyFromHourly * 26 / 22;
      return monthlyFromHourly * (computeDaysPerMonth(source) / 22);
    }

    const monthlyNum = findNumeric(source, monthlyAliases);
    if (!isNaN(monthlyNum) && monthlyNum > 0) {
      if (daysMode === '22') return monthlyNum;
      if (daysMode === '26') return monthlyNum * 26 / 22;
      return monthlyNum * (computeDaysPerMonth(source) / 22);
    }

    return null;
  };

  // `derivedSalary` is an internal value we write via setValue; getValues typing doesn't include it,
  // so read basicSalary first and fall back to 0. If derivedSalary exists, prefer it by reading via safe any access.
  const rawDerived: any = (getValues as any)('derivedSalary');
  const rawBasic: any = getValues('basicSalary');
  const formDerived = Number((rawDerived || rawBasic || '0')) || 0;
  const selectedSourceMonthly = getSelectedSourceMonthly();
  const derivedMonthlyValue = selectedSourceMonthly != null ? selectedSourceMonthly : (formDerived || 0);

  // Watch the days-per-month selector so the UI and calculations honor the user's choice (22/26/profile)
  const selectedCategoryId = watchedCategory;
  const selectedGradeId = watchedGrade;
  const selectedSectorId = watchedSector;
  const selectedCategory = categories.find(c => String(c.id) === String(selectedCategoryId));
  const selectedGrade = grades.find(g => String(g.id) === String(selectedGradeId));
  const workSource: any = selectedGrade || selectedCategory || null;

  // Whether the required minimal selection is present (sector AND category)
  const hasRequiredSelection = Boolean(selectedSectorId && selectedCategoryId);

  // Always clear displayed estimate until sector+category are both selected.
  // estimateMonthly is null when unavailable; only show a numeric estimate when not null.
  let estimateMonthly: number | null = null;
  if (hasRequiredSelection) {
    // If the basic salary was prefilled from the user's profile and there
    // is no selected source (category/grade) and no explicit derived value
    // produced by selection, do NOT show the profile amount as an estimate.
    const hasExplicitDerived = (rawDerived != null && Number(rawDerived) > 0);
    // Also consider the case where the current basicSalary equals the
    // profile salary value but the `basicSalaryPrefilledFromProfile` flag
    // hasn't been flipped yet (race conditions during onChange handlers).
    const basicEqualsProfile = prefilledProfileData && Number(prefilledProfileData.salary || 0) > 0 && Number(rawBasic || 0) === Number(prefilledProfileData.salary || 0);

    if ((basicSalaryPrefilledFromProfile || basicEqualsProfile) && !selectedSourceMonthly && !hasExplicitDerived && !(salaryDailyValue && Number(salaryDailyValue) > 0)) {
      // keep null to show empty state unless the selected source actually
      // provides a daily salary value — in that case we should show the
      // converted monthly estimate even while avoiding showing the raw
      // profile-prefilled basicSalary.
      estimateMonthly = null;
    } else {
      // Prefer the selected category/grade source first.
      if (selectedSourceMonthly != null && Number(selectedSourceMonthly) > 0) {
        estimateMonthly = Number(selectedSourceMonthly);
      } else if (salaryDailyValue && Number(salaryDailyValue) > 0) {
        // honor user's explicit 22/26 selection when converting daily -> monthly for visible estimate
        if (watchedDaysMode === '22') estimateMonthly = Number(salaryDailyValue) * 22;
        else if (watchedDaysMode === '26') estimateMonthly = Number(salaryDailyValue) * 26;
        else estimateMonthly = Number(salaryDailyValue) * computeDaysPerMonth(workSource);
      } else if (formDerived && Number(formDerived) > 0) {
        // Fall back to any derived value present in the form (e.g., derivedSalary
        // or basicSalary) only when that value was not prefilled from the user's
        // profile. If derivedSalary (explicit selection-derived value) exists,
        // prefer that even when a profile-prefilled basicSalary is present.
        // Accept derived only if it was explicitly set (rawDerived) or the basic
        // salary was not a profile prefill.
        if (hasExplicitDerived || (!basicSalaryPrefilledFromProfile && !basicEqualsProfile)) {
          estimateMonthly = Number(formDerived);
        } else {
          estimateMonthly = null;
        }
      } else {
        // No valid source available — keep null so UI shows empty state
        estimateMonthly = null;
      }
    }
  } else {
    estimateMonthly = null;
  }

  const salaryEstimateLabel = timeframe === 'weekly' ? 'Weekly estimated salary' : timeframe === 'biweekly' ? 'Biweekly estimated salary' : 'Monthly estimated salary';
  const salaryEstimateAmount = estimateMonthly != null ? (timeframe === 'weekly' ? estimateMonthly / 4 : timeframe === 'biweekly' ? estimateMonthly / 2 : estimateMonthly) : 0;

  // Explicit days-per-month used for the visible estimate (helps make the formula clear in the UI)
  const daysPerMonthUsed = watchedDaysMode === '22' ? 22 : watchedDaysMode === '26' ? 26 : computeDaysPerMonth(workSource);

  // Clear prior calculation results when the user changes sector or category so the UI shows '-' until user intentionally calculates.
  useEffect(() => {
    // when selection changes, hide previous results/clock-in totals and clear salary
    setResults(null);
    setClockInTotal(null);
    // Clear basic salary when sector/category changes
    setValue('basicSalary', '');
  }, [watchedSector, watchedCategory, setValue]);

  // Recompute derived monthly salary and form fields when the days-per-month selector
  // changes or when the selected category/grade changes. This ensures toggling between
  // 'profile' / '22' / '26' immediately updates estimates and readonly fields.
  useEffect(() => {
    try {
      // Salary data lives in salary_ranges, not on the grade object.
      // Resolve the salary range using the grade (if selected) and service years.
      let source: any = null;
      if (selectedCategory) {
        const gradeId = selectedGrade ? selectedGrade.id : undefined;
        const currentYears = (getValues as any)('serviceYears') || undefined;
        const salaryRange = findSalaryRangeForYears(selectedCategory.salary_ranges, currentYears, gradeId);
        source = salaryRange;
      }
      if (!source) {
        return;
      }

      setIsComputingEstimate(true);
      const currentDaysMode = (getValues as any)('daysPerMonthMode') || watchedDaysMode;
      const monthlyVal = parseSourceToMonthly(source, currentDaysMode);
      if (monthlyVal !== null) {
        const dailyCandidate = Number(String((source as any)?.basic_daily_salary ?? (source as any)?.daily_rate ?? (source as any)?.daily_salary ?? (source as any)?.salary_per_day ?? '').replace(/[^0-9.\-]/g, '').trim());
        if (!isNaN(dailyCandidate) && dailyCandidate > 0) {
          setSalaryBasis('daily');
          setSalaryDailyValue(dailyCandidate);
        } else {
          setSalaryBasis('monthly');
          setSalaryDailyValue(null);
        }

        // write into form fields so the UI reflects the recalculated monthly value
        const monthly = monthlyVal;
        setValue('basicSalary', String(Math.round(monthly)));
        setBasicSalaryPrefilledFromProfile(false);
        const hoursDenom = Number((getValues as any)('numberOfHoursWorked') || AUTO_STANDARD_HOURS) || AUTO_STANDARD_HOURS;
        const hourly = (monthly / hoursDenom) || 0;
        setValue('hourlyRate', String(hourly.toFixed(2)));
        try { setValue('derivedSalary' as any, String(Math.round(monthly))); } catch (e) { }
        try { setValue('salaryBand', t('calculatorScreen.monthlyRsLabel', { amount: Math.round(monthly), symbol: currencyInfo.symbol })); } catch (e) { }

        // If the user toggled the days-per-month selector (22/26/profile) and the
        // numeric monthly estimate actually changed from the previous estimate, show
        // a small non-intrusive toast asking them to press Calculate to apply it.
        try {
          const prevDays = prevDaysModeRef.current;
          const prevEstimate = previousEstimateRef.current;
          const rounded = Math.round(monthly);
          const daysLabel = currentDaysMode === '22' ? '22 days' : currentDaysMode === '26' ? '26 days' : 'profile days'; // structural; surfaced verbatim through estimateUpdatedBody interpolation

          // Only show toast when there was a previous days-mode (i.e. not initial mount)
          // and the days-mode actually changed, and the numeric estimate changed, and not auto-selecting, and not initial load.
          if (prevDays != null && prevDays !== String(currentDaysMode) && rounded > 0 && rounded !== prevEstimate && !isAutoSelecting && !isInitialLoad) {
            if (toastRef.current) toast.close(toastRef.current);
            toastRef.current = toast.show({
              placement: 'top',
              render: ({ id }) => (
                <Toast nativeID={id} action="info" variant="solid">
                  <VStack space="xs">
                    <ToastTitle>{t('calculatorScreen.estimateUpdatedTitle')}</ToastTitle>
                    <ToastDescription>{t('calculatorScreen.estimateUpdatedBody', { amount: rounded.toLocaleString(), daysLabel, symbol: currencyInfo.symbol })}</ToastDescription>
                  </VStack>
                </Toast>
              ),
            });
          }

          // update refs for next change detection
          previousEstimateRef.current = Math.round(monthly);
          prevDaysModeRef.current = String(currentDaysMode);
        } catch (e) {
          // non-fatal
        }
      }
      setIsComputingEstimate(false);
    } catch (err) {
      console.warn('[daysPerMonthMode effect] failed to set salary from category', err);
      setIsComputingEstimate(false);
    }
  }, [watchedDaysMode, selectedCategoryId, selectedGradeId, currencyInfo.symbol]);

  // Update salary when serviceYears changes (for salary_ranges)
  useEffect(() => {
    if (!selectedCategory || !watchedServiceYears) return;

    try {
      const gradeId = selectedGrade ? selectedGrade.id : undefined;
      const salaryRange = findSalaryRangeForYears(selectedCategory.salary_ranges, watchedServiceYears || undefined, gradeId);

      if (salaryRange) {
        setIsComputingEstimate(true);
        const monthlyVal = parseSourceToMonthly(salaryRange, (getValues as any)('daysPerMonthMode') || '22');

        if (monthlyVal !== null) {
          // Detect whether the source actually had a daily value
          const dailyCandidate = Number(String((salaryRange as any)?.basic_daily_salary ?? (salaryRange as any)?.daily_rate ?? (salaryRange as any)?.daily_salary ?? (salaryRange as any)?.salary_per_day ?? '').replace(/[^0-9.\-]/g, '').trim());
          if (!isNaN(dailyCandidate) && dailyCandidate > 0) {
            setSalaryBasis('daily');
            setSalaryDailyValue(dailyCandidate);
          } else {
            setSalaryBasis('monthly');
            setSalaryDailyValue(null);
          }

          // Update form fields
          const monthly = monthlyVal;
          setValue('basicSalary', String(Math.round(monthly)));
          setBasicSalaryPrefilledFromProfile(false);
          const hoursDenom = Number((getValues as any)('numberOfHoursWorked') || AUTO_STANDARD_HOURS) || AUTO_STANDARD_HOURS;
          const hourly = (monthly / hoursDenom) || 0;
          setValue('hourlyRate', String(hourly.toFixed(2)));
          try { setValue('derivedSalary' as any, String(Math.round(monthly))); } catch (e) { }
          try { setValue('salaryBand', t('calculatorScreen.monthlyRsLabel', { amount: Math.round(monthly), symbol: currencyInfo.symbol })); } catch (e) { }
        }
        setIsComputingEstimate(false);
      }
    } catch (err) {
      console.warn('[serviceYears effect] failed to update salary', err);
      setIsComputingEstimate(false);
    }
  }, [watchedServiceYears, selectedCategory, setValue, currencyInfo.symbol]);

  // Days-per-month provenance to help style salary estimates coming from salary records
  const daysInfo = getDaysPerMonthInfo(workSource);
  const isDaysFromSalaryRecord = typeof daysInfo?.reason === 'string' && daysInfo.reason.includes('salary record');
  const isEstimateFromSalaryRecord = salaryDetails && estimateMonthly != null && Math.round(Number((salaryDetails as any)?.salary || 0)) === Math.round(estimateMonthly);

  // Day/Night shift estimation for bakery-like roles
  // Find selected category/grade (prefer grade-level config)

  // Determine work days per week (try multiple possible field names), default to 6 for bakery
  const workDaysPerWeek = Number(
    workSource?.work_week_days ?? workSource?.days_of_work_per_week ?? workSource?.working_days_per_week ?? workSource?.work_days_per_week ?? 6
  ) || 6;

  const isSixDayWeek = hasRequiredSelection && workDaysPerWeek === 6;

  // Note: Manual control of daysPerMonthMode - no auto-triggering based on sector selection

  const AVG_WEEKS_PER_MONTH = 52 / 12; // ≈ 4.3333
  const dayShiftsPerWeek = workDaysPerWeek; // assume one day shift per working day



  // Initial Setup: Fetch User Profile and Set Defaults
  useEffect(() => {
    const loadProfileAndDefaults = async () => {
      const profile = await fetchUserProfile();
      setPrefilledProfileData(profile); // Set the fetched profile data
      // Decide default days-per-month mode based on salaryDetails if available
      let daysModeDefault: 'profile' | '22' | '26' = 'profile';
      try {
        const sdDays = computeDaysPerMonth(salaryDetails);
        // Prefer exact 22 or 26 where applicable
        if (sdDays && Math.abs(sdDays - 22) <= 1) daysModeDefault = '22';
        else if (sdDays && Math.abs(sdDays - 26) <= 1) daysModeDefault = '26';
        else daysModeDefault = 'profile';
      } catch (e) {
        daysModeDefault = 'profile';
      }

      reset({
        paymentFrequency: 'monthly',
        allowances: profile?.allowances ? String(profile.allowances) : '', 
        deductions: '',
        // Calculate hourly rate from basic salary only (not including allowances)
        hourlyRate: computeHourlyFromMonthly(Number(profile?.salary ?? 0)).toFixed(2), // Harmonized default monthly hours
        // Default the working hours to the profile value when present, otherwise use AUTO_STANDARD_HOURS
        numberOfHoursWorkedMode: hoursModeFromNumber((profile as any)?.numberOfHoursWorked ?? (profile as any)?.number_of_hours ?? AUTO_STANDARD_HOURS),
        numberOfHoursWorked: String((profile as any)?.numberOfHoursWorked ?? (profile as any)?.number_of_hours ?? AUTO_STANDARD_HOURS),
        // Default days-per-month selector to profile-derived days when available
        daysPerMonthMode: daysModeDefault,
        basicSalary: (profile?.salary ?? 0).toFixed(2),
        // Dates will be set by the timeframe effect below
        startDate: null,
        endDate: null,
        timeframe: 'monthly',
      });
      // mark that the basicSalary form value was prefilled from profile so manual
      // Calculate does not treat it as an authoritative derived value.
      if (profile?.salary && Number(profile.salary) > 0) setBasicSalaryPrefilledFromProfile(true);
    };

    // loadProfileAndDefaults will set profile defaults; calculations are handled by top-level handlers.
    loadProfileAndDefaults();
  }, [fetchUserProfile, reset]);

  // NOTE: days-per-month can be explicitly toggled by the user (22 vs 26) via the UI below.

  // Effect to Update Dates based on Timeframe Selection
  useEffect(() => {
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    let newStartDate: Date | null = null;
    let newEndDate: Date | null = today;

    // Only set dates automatically if timeframe is NOT 'custom'
    if (timeframe !== 'custom') {
      switch (timeframe) {
        case 'monthly':
          newStartDate = startOfMonth(today);
          break;
        case 'weekly':
          newStartDate = subDays(today, 5); // Last 6 days including today (Dec 7-12)
          newEndDate = today; // Today
          break;
        case 'biweekly':
          newStartDate = startOfWeek(subWeeks(today, 1), { weekStartsOn: 1 }); // Monday of previous week
          newEndDate = endOfWeek(today, { weekStartsOn: 1 }); // Sunday of current week
          break;
        default:
          newStartDate = startOfMonth(today);
          break;
      }
      setValue('startDate', newStartDate);
      setValue('endDate', newEndDate);
    } else {
      // For 'custom', if dates are not yet set, default them.
      // If they are already set by user, leave them.
      if (!watchedStartDate) setValue('startDate', startOfMonth(today));
      if (!watchedEndDate) setValue('endDate', today);
    }

  }, [timeframe, setValue]); // This effect should only re-run when `timeframe` changes

  const toastRef = useRef<string | null>(null);
  // Track the previous days-mode so we only show the "estimate updated" toast when the
  // user explicitly toggles the days-per-month selector (and not on initial mount).
  const prevDaysModeRef = useRef<string | null>(null);
  // Track the last numeric estimate we showed so we can avoid duplicate toasts for no-op changes
  const previousEstimateRef = useRef<number | null>(null);

  const calculate = useCallback(() => {
    const data = getValues();

    // Recompute the monthly gross using the live form values so changes to
    // the days-per-month selector (22/26/profile) are immediately respected.
    // Prefer selected category/grade -> derived form value. Do NOT fall back
    // to profile salary for manual calculation.
    const currentDaysMode = getValues('daysPerMonthMode') || '22';
    // Read fresh selection IDs from the form to avoid stale closure values
    const liveCategoryId = (data as any).category || '';
    const liveGradeId = (data as any).grade || '';
    const liveCategory = categories.find(c => String(c.id) === String(liveCategoryId));
    const liveGrade = grades.find(g => String(g.id) === String(liveGradeId));

    let liveSource: any = null;
    if (liveCategory) {
      // Salary data lives in salary_ranges, not on the grade object itself.
      // Filter by both the selected grade (if any) and years of service.
      const gradeId = liveGrade ? liveGrade.id : undefined;
      const salaryRange = findSalaryRangeForYears(liveCategory.salary_ranges, (data as any).serviceYears || undefined, gradeId);
      if (salaryRange) {
        liveSource = salaryRange;
      }
    }

    let gross = 0;

    // Prioritize deriving from the current live selected source to ensure calculations
    // always reflect the latest user selections, rather than potentially stale estimates.
    try {
      const liveSelectedMonthly = parseSourceToMonthly(liveSource, currentDaysMode as any);
      if (liveSelectedMonthly != null && Number(liveSelectedMonthly) > 0) {
        gross = Number(liveSelectedMonthly);
      }
    } catch (e) {
      // ignore and try fallback
    }

    // If live derivation failed, fall back to any derivedSalary/basicSalary present in the form
    // Do NOT fall back to estimateMonthly to ensure dynamic recalculation
    if (!gross) {
      const derivedSalaryField: any = (getValues as any)('derivedSalary');
      const basicSalaryField: any = getValues('basicSalary');
      const parsedDerived = Number(derivedSalaryField || basicSalaryField || 0) || 0;
      // Only accept the form-provided basicSalary when it was not prefilled from profile,
      // or when an explicit derivedSalary exists (set by selection-derived logic).
      const hasExplicitDerived = (derivedSalaryField != null && Number(derivedSalaryField) > 0);
      if (parsedDerived > 0 && (!basicSalaryPrefilledFromProfile || hasExplicitDerived)) {
        gross = parsedDerived;
        // Scale for days mode since basicSalary is for 22 days
        if (currentDaysMode === '26') {
          gross *= 26 / 22;
        }
      }
    }
    if (isNaN(gross) || gross <= 0) {
      setResults({ hourly: 0, weekly: 0, biweekly: 0, monthly: 0, net: 0, gross: 0, allowance: 0, deduction: 0 });
      return;
    }
    // Enforce stricter rule: require both sector AND category selected before computing.
    if (!hasRequiredSelection) {
      setResults({ hourly: 0, weekly: 0, biweekly: 0, monthly: 0, net: 0, gross: 0, allowance: 0, deduction: 0 });
      return;
    }
    const allowance = parseFloat(data.allowances || '0') || 0;
    const deduction = parseFloat(data.deductions || '0') || 0;
    const net = gross + allowance - deduction;

    // Determine selected standard hours (hours-per-month). If user chose a preset, use it; if 'custom', read numeric value.
    const selectedMode = (data as any).numberOfHoursWorkedMode || String(AUTO_STANDARD_HOURS);
    let selectedStandardHours = AUTO_STANDARD_HOURS;
    if (selectedMode === 'custom') {
      const custom = parseFloat((data as any).numberOfHoursWorked || '') || 0;
      selectedStandardHours = custom > 0 ? custom : AUTO_STANDARD_HOURS;
    } else {
      const parsed = parseFloat(String(selectedMode)) || AUTO_STANDARD_HOURS;
      selectedStandardHours = parsed > 0 ? parsed : AUTO_STANDARD_HOURS;
    }

    // Adjust hours based on days mode

    // Apply overtime and special rules based on hours worked
    let effectiveHours = selectedStandardHours;
    let overtimeMultiplier = 1.0;

    if (selectedMode === 'custom' && selectedStandardHours > AUTO_STANDARD_HOURS) {
      // Custom hours > 195 get 1.5x rate
      overtimeMultiplier = 1.5;
    } else if (selectedMode === 'custom' && selectedStandardHours >= 120) {
      // Custom hours >= 120 use same formula as 80 hours (semi-monthly)
      effectiveHours = 80;
    }

    const WEEKS_PER_MONTH = 52 / 12;

    // Hourly rate is defined as (monthly gross/basic salary) / effectiveHours, then apply overtime multiplier
    const baseHourly = effectiveHours > 0 ? (gross / effectiveHours) : computeHourlyFromMonthly(gross);
    const hourly = baseHourly * overtimeMultiplier;
    // Weekly and biweekly are derived from net using canonical weeks-per-month
    const weekly = net / WEEKS_PER_MONTH;
    const biweekly = weekly * 2;
    const monthly = net; setResults({
      hourly,
      weekly,
      biweekly,
      monthly,
      net,
      gross,
      allowance,
      deduction,
    });

    if (toastRef.current) {
      toast.close(toastRef.current);
    }
    // toastRef.current = toast.show({
    //   placement: "top",
    //   render: ({ id }) => {
    //     return (
    //       <Toast nativeID={id} action="success" variant="solid">
    //         <VStack space="xs">
    //           <ToastTitle>Manual Calculation Triggered</ToastTitle>
    //           <ToastDescription>Salary breakdown updated successfully!</ToastDescription>
    //         </VStack>
    //       </Toast>
    //     );
    //   },
    // });


  }, [getValues, toast, hasRequiredSelection, categories, grades, parseSourceToMonthly, basicSalaryPrefilledFromProfile, setResults]);

  const calculateFromClockIns = useCallback(() => {
    try {
      const data = getValues();
      // For Clock-In calculator, use profile salary as the primary source
      const currentDaysMode = getValues('daysPerMonthMode') || '22';

      // Use profile basic salary only for hourly rate calculation (not including allowances)
      let salaryMonthly = Number(prefilledProfileData?.salary || 0);

      // If no profile salary, show appropriate error
      if (!salaryMonthly || salaryMonthly <= 0) {
        // Nothing to calculate without profile salary
        if (toastRef.current) toast.close(toastRef.current);
        toastRef.current = toast.show({
          placement: 'top',
          render: ({ id }) => (
            <Toast nativeID={id} action="warning" variant="solid">
              <VStack space="xs">
                <ToastTitle>{t('calculatorScreen.noProfileSalaryTitle')}</ToastTitle>
                <ToastDescription>{t('calculatorScreen.noProfileSalaryBody')}</ToastDescription>
              </VStack>
            </Toast>
          ),
        });
        return;
      }

      // Calculate normal hourly rate from basic salary only
      const normalHourlyRate = computeHourlyFromMonthly(salaryMonthly);
      const allowances = parseFloat(getValues('allowances') || '0') || 0;

      // Validate that we have a valid hourly rate
      if (!normalHourlyRate || isNaN(normalHourlyRate) || normalHourlyRate <= 0) {
        if (toastRef.current) toast.close(toastRef.current);
        toastRef.current = toast.show({
          placement: 'top',
          render: ({ id }) => (
            <Toast nativeID={id} action="error" variant="solid">
              <VStack space="xs">
                <ToastTitle>{t('calculatorScreen.invalidHourlyRateTitle')}</ToastTitle>
                <ToastDescription>{t('calculatorScreen.invalidHourlyRateBody', { amount: salaryMonthly, symbol: currencyInfo.symbol })}</ToastDescription>
              </VStack>
            </Toast>
          ),
        });
        return;
      }

      let start: Date | null = data.startDate;
      let end: Date | null = data.endDate;

      // If dates are not set, set them based on current timeframe
      if (!start || !end) {
        const today = new Date();
        today.setHours(23, 59, 59, 999);

        const currentTimeframe = data.timeframe || 'monthly';

        if (currentTimeframe === 'monthly') {
          start = startOfMonth(today);
          end = today;
        } else if (currentTimeframe === 'weekly') {
          start = startOfWeek(today, { weekStartsOn: 1 });
          end = today;
        } else if (currentTimeframe === 'biweekly') {
          // Reference date: July 14, 2025 (Monday) - This is a Monday
          const referenceMonday = new Date(2025, 6, 14);
          const startOfCurrentWeek = startOfWeek(today, { weekStartsOn: 1 });
          const weeksBetween = Math.floor(differenceInMinutes(startOfCurrentWeek, referenceMonday) / (7 * 24 * 60));

          if (weeksBetween % 2 === 0) {
            start = startOfCurrentWeek;
          } else {
            start = subWeeks(startOfCurrentWeek, 1);
          }
          end = today;
        } else {
          // Default to monthly
          start = startOfMonth(today);
          end = today;
        }

        // Update the form with the calculated dates
        setValue('startDate', start);
        setValue('endDate', end);
      }

      // Now proceed with calculation since dates are guaranteed to be set

      // Group clock-ins by day
      const dailyHours: { [key: string]: number } = {};

      // Filter time logs and aggregate hours per day
      timeLogs.forEach((log) => {
        if (!log.start_time || !log.hours_worked) {
          return;
        }

        const entryTime = parseISO(log.start_time);
        const isInRange = isWithinInterval(entryTime, { start: start!, end: end! });

        if (isInRange) {
          const dayKey = format(entryTime, 'yyyy-MM-dd');
          if (!dailyHours[dayKey]) dailyHours[dayKey] = 0;
          dailyHours[dayKey] += log.hours_worked;
        }
      });

      let totalBasePay = 0;
      let totalHours = 0;
      const daysWorked = Object.keys(dailyHours).length;

      // Calculate pay for each day considering overtime and special rates

      // Final Payroll Harmonization (using local logic)
      // Always filter to the resolved date range — never use all logs regardless of timeframe
      const filteredLogsInRange = timeLogs.filter(log => {
        if (!log.start_time) return false;
        const entryTime = parseISO(log.start_time);
        return isWithinInterval(entryTime, { start: start!, end: end! });
      });

      // Basic calculation for the summary
      filteredLogsInRange.forEach(log => {
        const hours = log.hours_worked || 0;
        totalHours += hours;
        
        let multiplier = 1;
        if (log.is_holiday) multiplier = payrollFormula?.multiplier_public_holiday ?? 2.0;
        else if (log.start_time) {
          const date = parseISO(log.start_time);
          if (date.getDay() === 0) multiplier = payrollFormula?.multiplier_sunday ?? 2.0;
        }
        totalBasePay += (hours * normalHourlyRate * multiplier);
      });

      const totalPay = totalBasePay; // Allowances handled by formula if configured

      // Calculate projections for different periods
      const WEEKS_PER_MONTH = 52 / 12; // ≈ 4.3333
      const workingDaysInPeriod = daysWorked;
      const avgHoursPerDay = workingDaysInPeriod > 0 ? totalHours / workingDaysInPeriod : 0;
      const avgPayPerDay = workingDaysInPeriod > 0 ? totalPay / workingDaysInPeriod : 0;

      // Project to monthly assuming 22 working days per month
      const projectedMonthlyHours = avgHoursPerDay * 22;
      const projectedMonthlySalary = avgPayPerDay * 22;

      setClockInTotal({
        totalHours,
        totalPay,
        totalSalary: totalPay, // Period total
        monthlySalary: projectedMonthlySalary, // Monthly projection (avgPayPerDay × 22)
        workingDays: workingDaysInPeriod,
        hourlyRate: normalHourlyRate,
        avgHoursPerDay,
        avgPayPerDay,   // Required for correct weekly/bi-weekly projections
        projectedMonthlyHours,
      });

      // Open the Clock-In summary panel so the user sees the results
      setShowClockInSummary(true);

      // Show success toast with detailed feedback
      if (toastRef.current) {
        toast.close(toastRef.current);
      }

      if (totalHours > 0) {
        // Removed success toast as requested
      } else {
        // Check if there are any clock-ins at all to give better guidance
        const hasClockIns = timeLogs.length > 0;
        toastRef.current = toast.show({
          placement: "top",
          render: ({ id }) => (
            <Toast nativeID={id} action="warning" variant="solid">
              <VStack space="xs">
                <ToastTitle>{t('calculatorScreen.noClockInsTitle')}</ToastTitle>
                <ToastDescription>
                  {hasClockIns
                    ? t('calculatorScreen.noClockInsBodyRange', { start: format(start!, 'MMM dd'), end: format(end!, 'MMM dd') })
                    : t('calculatorScreen.noClockInsBodyEmpty')}
                </ToastDescription>
              </VStack>
            </Toast>
          ),
        });
      }

    } catch (error) {
      console.error("Error in calculateFromClockIns:", error);
      if (toastRef.current) {
        toast.close(toastRef.current);
      }
      toastRef.current = toast.show({
        placement: "top",
        render: ({ id }) => (
          <Toast nativeID={id} action="error" variant="solid">
            <VStack space="xs">
              <ToastTitle>{t('calculatorScreen.calculationErrorTitle')}</ToastTitle>
              <ToastDescription>{t('calculatorScreen.calculationErrorBody')}</ToastDescription>
            </VStack>
          </Toast>
        ),
      });
    }

  }, [getValues, prefilledProfileData, toast, timeLogs, setShowClockInSummary, setValue]);

  // Automatic calculation (uses profile or fallback values)
  const calculateAutomatic = useCallback(async () => {
    try {
      // For Clock-In calculator, use profile salary directly (already validated above)
      const basicSalary = (prefilledProfileData?.salary || 0);

      // Allowances
      // Use the single allowance value from profile/form only.
      const profileAllowance = Number(prefilledProfileData?.allowances || 0);
      const allowanceFromForm = parseFloat(getValues('allowances') || '') || profileAllowance;
      const allowance = allowanceFromForm;
      const daysMultiplier = watchedDaysMode === '26' ? 26 / 22 : 1;
      // Calculate hourly rate from basic salary only (not including allowances)
      const monthlyHoursForDays = AUTO_STANDARD_HOURS * daysMultiplier;
      const hourlyRate = computeHourlyFromMonthly(basicSalary, monthlyHoursForDays);

      // Deductions
      const deductions = parseFloat(getValues('deductions') || '0') || 0;

      const totalRemuneration = basicSalary + allowance;
      const net = totalRemuneration - deductions;
      const gross = basicSalary;
      const hourly = hourlyRate || computeHourlyFromMonthly(basicSalary); // Use default monthly hours
      const weekly = hourly * 40;
      const biweekly = weekly * 2;

      const res = {
        gross: Math.round(gross),
        net: Math.round(net),
        hourly: Math.round(hourly),
        weekly: Math.round(weekly),
        biweekly: Math.round(biweekly),
        monthly: Math.round(net), // Monthly is the final net pay
        allowance: Math.round(allowance),
        deduction: Math.round(deductions),
      };

      setResults(res);
      if (toastRef.current) {
        toast.close(toastRef.current);
      }
      toastRef.current = toast.show({
        placement: 'top',
        render: ({ id }) => (
          <Toast nativeID={id} action="success" variant="solid">
            <ToastTitle>{t('calculatorScreen.automaticCalculationUpdated')}</ToastTitle>
          </Toast>
        ),
      });

    } catch (error) {
      console.error("Error in calculateAutomatic:", error);
      if (toastRef.current) {
        toast.close(toastRef.current);
      }
      toastRef.current = toast.show({
        placement: 'top',
        render: ({ id }) => (
          <Toast nativeID={id} action="error" variant="solid">
            <VStack space="xs">
              <ToastTitle>{t('calculatorScreen.calculationErrorTitle')}</ToastTitle>
              <ToastDescription>{t('calculatorScreen.calculationErrorBody')}</ToastDescription>
            </VStack>
          </Toast>
        ),
      });
    }
  }, [getValues, prefilledProfileData, toast, selectedSourceMonthly]);

  const handleCalculate = useCallback(() => {
    if (isCalculating) return; // already calculating
    // Ensure the Salary Summary panel is visible when user requests a calculation
    setShowManualSummary(true);
    try {
      setIsCalculating(true);
      // Run calculation (calculate() has its own reentrancy guard too)
      calculate();
    } finally {
      // Allow UI updates after a short grace period matching calculate's debounce
      setTimeout(() => setIsCalculating(false), 800);
    }
  }, [isCalculating, calculate]);

  const handleCalculateFromClockIns = useCallback(() => {
    if (isCalculating) return;
    setIsCalculating(true);
    try {
      calculateFromClockIns();
    } finally {
      setTimeout(() => setIsCalculating(false), 800);
    }
  }, [calculateFromClockIns, isCalculating]);


  // When the days-per-month selector changes, auto-apply the new estimate to the
  // Salary Summary only in a safe, well-scoped way:
  // - Only when the calculator is in 'manual' mode and a Salary Summary (results)
  //   is already visible (user previously pressed Calculate).
  // - Only when there is a selected category/grade (the estimate comes from a
  //   selectable source) or an explicit derivedSalary present.
  // - Only when the newly computed monthly value differs from the currently
  //   displayed results.gross (to avoid loops and redundant work).
  // This preserves manual edits (we won't overwrite a user-typed basicSalary)
  // while still keeping the summary in sync when the estimate legitimately
  // changes because the user toggled 22/26/profile.
  useEffect(() => {
    try {
      if (calculatorMode !== 'manual') return;
      if (!results) return; // nothing to update
      if (!hasRequiredSelection) return; // require sector+category

      const data = getValues();
      const currentDaysMode = getValues('daysPerMonthMode') || '22';
      const liveCategoryId = (data as any).category || '';
      const liveGradeId = (data as any).grade || '';
      const liveCategory = categories.find(c => String(c.id) === String(liveCategoryId));
      const liveGrade = grades.find(g => String(g.id) === String(liveGradeId));

      let liveSource: any = null;
      if (liveGrade) {
        liveSource = liveGrade;
      } else if (liveCategory && (data as any).serviceYears) {
        // For categories, find the salary range for the selected years
        const salaryRange = findSalaryRangeForYears(liveCategory.salary_ranges, (data as any).serviceYears || undefined);
        liveSource = salaryRange;
      }

      // Compute the fresh monthly value from the selected source using the
      // current days-mode. If that's available, prefer it as the source that
      // can trigger an auto-apply.
      let newSelectedMonthly: number | null = null;
      try {
        newSelectedMonthly = parseSourceToMonthly(liveSource, currentDaysMode as any);
      } catch (e) {
        newSelectedMonthly = null;
      }

      // Also consider an explicit derived value in the form (derivedSalary/basicSalary)
      const derivedSalaryField: any = (getValues as any)('derivedSalary');
      const basicSalaryField: any = getValues('basicSalary');
      const parsedDerived = Number(derivedSalaryField || basicSalaryField || 0) || 0;
      const hasExplicitDerived = (derivedSalaryField != null && Number(derivedSalaryField) > 0);

      let shouldAutoApply = false;
      if (newSelectedMonthly != null && Number(newSelectedMonthly) > 0) {
        // If the selected source provides a monthly, auto-apply when it differs from results.gross
        shouldAutoApply = Math.round(Number(newSelectedMonthly)) !== Math.round(results.gross);
      } else if (hasExplicitDerived) {
        // Otherwise, if an explicit derivedSalary exists (was set programmatically by selection),
        // auto-apply when it differs.
        shouldAutoApply = Math.round(parsedDerived) !== Math.round(results.gross);
      }

      if (shouldAutoApply) {
        // Re-run the manual calculation to update Salary Summary.
        calculate();
      }
    } catch (err) {
      console.warn('[auto-apply days toggle] failed to refresh salary summary', err);
    }
  }, [watchedDaysMode, calculatorMode, hasRequiredSelection, categories, grades]);

  // Always keep the Salary Summary in sync with the current estimate when the
  // user has selected a sector/category and is in manual mode. This effect
  // forces the Salary Summary items (gross/net/hourly/weekly/biweekly) to
  // reflect the estimate derived from the selected source and current
  // days-per-month, per the user's request.
  useEffect(() => {
    try {
      if (calculatorMode !== 'manual') return;
      if (!hasRequiredSelection) return;

      // Recompute the canonical monthly estimate from the selected source
      const selectedMonthly = getSelectedSourceMonthly();
      // If no selection-derived monthly, fallback to any derived/basic salary in form
      let monthly = selectedMonthly != null ? Number(selectedMonthly) : 0;
      if (!monthly) {
        const derivedSalaryField: any = (getValues as any)('derivedSalary');
        const basicSalaryField: any = getValues('basicSalary');
        monthly = Number(derivedSalaryField || basicSalaryField || 0) || 0;
      }

      if (isNaN(monthly) || monthly <= 0) {
        // Nothing to update — clear results to make it obvious
        setResults(null);
        return;
      }

      // Compute allowance/deduction and net/hourly/week values using same logic as calculate()
      const allowance = parseFloat(getValues('allowances') || '0') || 0;
      const deduction = parseFloat(getValues('deductions') || '0') || 0;
      const gross = Number(monthly);
      const net = gross + allowance - deduction;

      // Determine selected standard hours
      const data = getValues();
      const selectedMode = (data as any).numberOfHoursWorkedMode || String(AUTO_STANDARD_HOURS);
      let selectedStandardHours = AUTO_STANDARD_HOURS;
      if (selectedMode === 'custom') {
        const custom = parseFloat((data as any).numberOfHoursWorked || '') || 0;
        selectedStandardHours = custom > 0 ? custom : AUTO_STANDARD_HOURS;
      } else {
        const parsed = parseFloat(String(selectedMode)) || AUTO_STANDARD_HOURS;
        selectedStandardHours = parsed > 0 ? parsed : AUTO_STANDARD_HOURS;
      }

      // Adjust hours based on days mode

      // Apply overtime and special rules based on hours worked
      let effectiveHours = selectedStandardHours;
      let overtimeMultiplier = 1.0;

      if (selectedMode === 'custom' && selectedStandardHours > AUTO_STANDARD_HOURS) {
        // Custom hours > 195 get 1.5x rate
        overtimeMultiplier = 1.5;
      } else if (selectedMode === 'custom' && selectedStandardHours >= 120) {
        // Custom hours >= 120 use same formula as 80 hours (semi-monthly)
        effectiveHours = 80;
      }

      const WEEKS_PER_MONTH = 52 / 12;
      const baseHourly = effectiveHours > 0 ? (net / effectiveHours) : (net / AUTO_STANDARD_HOURS);
      const hourly = baseHourly * overtimeMultiplier;
      const weekly = net / WEEKS_PER_MONTH;
      const biweekly = weekly * 2;

      setResults({
        hourly,
        weekly,
        biweekly,
        monthly: net,
        net,
        gross,
        allowance,
        deduction,
      });
    } catch (err) {
      console.warn('[sync estimate -> summary] failed', err);
    }
    // Intentionally depend on selection and days-mode so toggling 22/26 updates immediately
  }, [selectedCategoryId, selectedGradeId, watchedDaysMode, calculatorMode, watch('basicSalary'), watch('allowances'), watch('deductions')]);


  // Temporary date state for modal
  const [tempSelectedDate, setTempSelectedDate] = useState<Date | null>(null);

  // Date change handler for DateTimePicker (only for 'custom' timeframe now)
  const onDateChange = useCallback((event: DateTimePickerEvent, selectedDate?: Date, fieldName?: 'startDate' | 'endDate') => {
    // On Android, apply immediately (native behavior)
    if (Platform.OS === 'android') {
      setShowStartDatePicker(false);
      setShowEndDatePicker(false);

      if (selectedDate && fieldName) {
        let finalDate = selectedDate;
        const today = new Date();
        today.setHours(23, 59, 59, 999); // Set to end of day for range inclusivity

        // Prevent future dates for endDate
        if (fieldName === 'endDate' && isAfter(selectedDate, today)) {
          finalDate = today;
        }

        // Enforce start <= end date constraint
        const currentStartDate = getValues('startDate');
        const currentEndDate = getValues('endDate');

        if (fieldName === 'startDate') {
          // If the selected start date is after the current end date, cap it at the end date
          if (currentEndDate && isAfter(finalDate, currentEndDate)) {
            finalDate = currentEndDate;
          }
        } else if (fieldName === 'endDate') {
          // If the selected end date is before the current start date, cap it at the start date
          if (currentStartDate && isBefore(finalDate, currentStartDate)) {
            finalDate = currentStartDate;
          }
        }
        setValue(fieldName, finalDate);
      }
    } else {
      // On iOS, store in temp state for Done button confirmation
      if (selectedDate) {
        setTempSelectedDate(selectedDate);
      }
    }
  }, [getValues, setValue]);

  // Confirm date selection (iOS Done button)
  const confirmDateSelection = useCallback(() => {
    const fieldName = showStartDatePicker ? 'startDate' : 'endDate';
    const selectedDate = tempSelectedDate;

    if (selectedDate && fieldName) {
      let finalDate = selectedDate;
      const today = new Date();
      today.setHours(23, 59, 59, 999); // Set to end of day for range inclusivity

      // Prevent future dates for endDate
      if (fieldName === 'endDate' && isAfter(selectedDate, today)) {
        finalDate = today;
      }

      // Enforce start <= end date constraint
      const currentStartDate = getValues('startDate');
      const currentEndDate = getValues('endDate');

      if (fieldName === 'startDate') {
        // If the selected start date is after the current end date, cap it at the end date
        if (currentEndDate && isAfter(finalDate, currentEndDate)) {
          finalDate = currentEndDate;
        }
      } else if (fieldName === 'endDate') {
        // If the selected end date is before the current start date, cap it at the start date
        if (currentStartDate && isBefore(finalDate, currentStartDate)) {
          finalDate = currentStartDate;
        }
      }
      setValue(fieldName, finalDate);
    }

    setShowStartDatePicker(false);
    setShowEndDatePicker(false);
    setTempSelectedDate(null);
  }, [showStartDatePicker, tempSelectedDate, getValues, setValue]);

  const selectedStandardHours = useMemo(() => {
    const data = getValues();
    const selectedMode = (data as any).numberOfHoursWorkedMode || String(AUTO_STANDARD_HOURS);
    let hours = AUTO_STANDARD_HOURS;
    if (selectedMode === 'custom') {
      const custom = parseFloat((data as any).numberOfHoursWorked || '') || 0;
      hours = custom > 0 ? custom : AUTO_STANDARD_HOURS;
    } else {
      const parsed = parseFloat(String(selectedMode)) || AUTO_STANDARD_HOURS;
      hours = parsed > 0 ? parsed : AUTO_STANDARD_HOURS;
    }
    return hours;
  }, [watch('numberOfHoursWorkedMode'), watch('numberOfHoursWorked')]);

  // Update basicSalary when hourlyRate changes in manual mode
  useEffect(() => {
    if (calculatorMode === 'manual') {
      const hr = parseFloat(watch('hourlyRate') || '0');
      if (hr > 0 && selectedStandardHours > 0) {
        const monthly = hr * selectedStandardHours;
        setValue('basicSalary', String(Math.round(monthly)));
        setSalaryBasis('monthly');
        setBasicSalaryPrefilledFromProfile(false);
      }
    }
  }, [watch('hourlyRate'), calculatorMode, selectedStandardHours]);

  // Update basicSalary when hours change and salaryBasis is manual
  useEffect(() => {
    if (calculatorMode === 'manual' && salaryBasis === 'monthly') {
      const hr = parseFloat(watch('hourlyRate') || '0');
      if (hr > 0 && selectedStandardHours > 0) {
        const monthly = hr * selectedStandardHours;
        setValue('basicSalary', String(Math.round(monthly)));
      }
    }
  }, [selectedStandardHours, calculatorMode, salaryBasis, watch('hourlyRate')]);

  const iosPickerButtons = useMemo(() => (
    <HStack space="md" justifyContent="center" p="$2">
      <StandardButton.Secondary onPress={() => { setShowStartDatePicker(false); setShowEndDatePicker(false); }} flex={1}>
        {t('calculatorScreen.cancel')}
      </StandardButton.Secondary>
      <StandardButton.Primary onPress={() => {
        setShowStartDatePicker(false);
        setShowEndDatePicker(false);
      }} flex={1}>
        {t('calculatorScreen.done')}
      </StandardButton.Primary>
    </HStack>
  ), [t]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }} edges={['top']}>
      <StatusBar barStyle="dark-content" backgroundColor={Palette.white} />
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        decelerationRate="fast"
        overScrollMode="never"
        contentContainerStyle={{
          paddingBottom: 160,
          paddingTop: 20,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Box px="$1" pb="$6">
            {isInitialLoad ? (
              <Box flex={1} justifyContent="center" alignItems="center" minHeight={400}>
                <Spinner size="large" color={Palette.gold} />
                <Text mt="$4" color={Palette.gray700} fontSize={Type.title}>{t('calculatorScreen.loadingData')}</Text>
              </Box>
            ) : (
              <Animated.View entering={FadeInUp.duration(500)}>
                <VStack space="lg">

                  {/* ── Page Header Banner ── */}
                  <LinearGradient
                  
                    colors={[Palette.gray100, Palette.gray50, Palette.white]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      borderRadius: 20,
                      padding: 16, borderWidth: 1, borderColor: Palette.gray200, marginRight: 4, marginLeft: 4,
                    }}
                  >
                    <HStack justifyContent="space-between" alignItems="center">
                      <VStack>
                        <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray700} textTransform="uppercase" letterSpacing={1.2}>
                          {t('calculatorScreen.pageEyebrow')}
                        </Text>
                        <Heading fontSize={Type.h1} fontWeight="800" color={Palette.ink} lineHeight={32}>
                          {t('calculatorScreen.pageTitle')}
                        </Heading>
                      </VStack>
                      <Box
                        bg={Palette.gold} p="$3" rounded="$2xl"
                        style={{ shadowColor: Palette.gold, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 8, elevation: 4 }}
                      >
                        <MaterialIcons name="wb-sunny" size={28} color={Palette.white} />
                      </Box>
                    </HStack>
                    <HStack space="lg" mt="$3">
                      <HStack alignItems="center" space="xs">
                        <MaterialIcons name="check-circle" size={13} color={Palette.success} />
                        <Text fontSize={Type.small} color={Palette.gray500}>{t('calculatorScreen.badgeIndustryRates')}</Text>
                      </HStack>
                      <HStack alignItems="center" space="xs">
                        <MaterialIcons name="schedule" size={13} color={Palette.gray700} />
                        <Text fontSize={Type.small} color={Palette.gray500}>{t('calculatorScreen.badgeClockInData')}</Text>
                      </HStack>
                      <HStack alignItems="center" space="xs">
                        <MaterialIcons name="bolt" size={13} color={Palette.gray700} />
                        <Text fontSize={Type.small} color={Palette.gray500}>{t('calculatorScreen.badgeRealtime')}</Text>
                      </HStack>
                    </HStack>
                  </LinearGradient>

                  {/* Profile Summary */}
                  <ProfileSummaryCard
                    prefilledProfileData={prefilledProfileData}
                    salaryDetails={salaryDetails as any}
                    computeDaysPerMonth={computeDaysPerMonth}
                  />

                  {/* Calculator Mode Tabs */}
                  <CalculatorModeTabs
                    calculatorMode={calculatorMode}
                    setCalculatorMode={setCalculatorMode}
                    primary={primary}
                  />

                  {/* Manual Salary Calculator */}
                  <ManualCalculator
                    calculatorMode={calculatorMode}
                    primary={primary}
                    Select={Select}
                    SelectTrigger={SelectTrigger}
                    SelectInput={SelectInput}
                    SelectIcon={SelectIcon}
                    SelectPortal={SelectPortal}
                    SelectBackdrop={SelectBackdrop}
                    SelectContent={SelectContent}
                    SelectDragIndicatorWrapper={SelectDragIndicatorWrapper}
                    SelectDragIndicator={SelectDragIndicator}
                    SelectItem={SelectItem}
                    form={form}
                    categories={categories}
                    grades={grades}
                    sectors={sectors}
                    watchedSector={watchedSector || ''}
                    watchedCategory={watchedCategory || ''}
                    watchedGrade={watchedGrade || ''}
                    watchedServiceYears={watchedServiceYears || ''}
                    watchedBasicSalary={watchedBasicSalary || ''}
                    watchedDaysMode={watchedDaysMode || 'profile'}
                    watchedHoursMode={watchedHoursMode || '195'}
                    watchedNumberOfHoursWorked={watchedNumberOfHoursWorked || '195'}
                    watchedTimeframe={timeframe || 'monthly'}
                    yearsOptions={yearsOptions}
                    hasRequiredSelection={hasRequiredSelection}
                    isCalculating={isCalculating}
                    handleCalculate={handleCalculate}
                    daysPerMonthUsed={daysPerMonthUsed}
                    decrementHours={decrementHours}
                    incrementHours={incrementHours}
                    handleLongPressStart={handleLongPressStart}
                    handleLongPressEnd={handleLongPressEnd}
                    errors={errors}
                  />

                  {/* Clock-In Calculator */}
                  <ClockInCalculator
                    calculatorMode={calculatorMode}
                    primary={primary}
                    prefilledProfileData={prefilledProfileData}
                    Select={Select}
                    SelectTrigger={SelectTrigger}
                    SelectInput={SelectInput}
                    SelectIcon={SelectIcon}
                    SelectPortal={SelectPortal}
                    SelectBackdrop={SelectBackdrop}
                    SelectContent={SelectContent}
                    SelectDragIndicatorWrapper={SelectDragIndicatorWrapper}
                    SelectDragIndicator={SelectDragIndicator}
                    SelectItem={SelectItem}
                    Pressable={Pressable}
                    form={form}
                    timeframe={timeframe || 'monthly'}
                    watchedStartDate={watchedStartDate ?? undefined}
                    watchedEndDate={watchedEndDate ?? undefined}
                    showClockIns={showClockIns}
                    setShowClockIns={setShowClockIns}
                    setShowStartDatePicker={setShowStartDatePicker}
                    setShowEndDatePicker={setShowEndDatePicker}
                    isCalculating={isCalculating}
                    handleCalculateFromClockIns={handleCalculateFromClockIns}
                    clockInTotal={clockInTotal}
                    showClockInSummary={showClockInSummary}
                    setShowClockInSummary={setShowClockInSummary}
                    timeLogs={timeLogs}
                  />

                  {/* Forward-looking single-shift pay preview (bucketed engine) */}
                  {calculatorMode === 'clockin' && (
                    <ShiftPayPreview
                      privateUserId={user?.private_user_id ? Number(user.private_user_id) : undefined}
                      primary={primary}
                    />
                  )}

                  {/* Summary Modals */}
                  {results && showManualSummary && calculatorMode === 'manual' ? (
                    <SalarySummary
                      showSalarySummary={showManualSummary}
                      calculatedSalary={{
                        // Main values for display
                        monthly: results.monthly || 0,
                        weekly: results.weekly || 0,
                        biweekly: results.biweekly || 0,
                        hourly: results.hourly || 0,
                        net: results.net || 0,
                        gross: results.gross || 0,
                        allowance: results.allowance || 0,
                        deduction: results.deduction || 0,
                        // Legacy field names for compatibility
                        totalSalary: results.monthly || 0,
                        baseSalary: results.gross || 0,
                        workingHours: watchedNumberOfHoursWorked || '0',
                        allowances: results.allowance || 0,
                        deductions: results.deduction || 0
                      }}
                      primary={primary}
                      setShowSalarySummary={setShowManualSummary}
                    />
                  ) : null}

                  {clockInTotal && showClockInSummary ? (
                    <ClockInSummary
                      showClockInSummary={showClockInSummary}
                      clockInTotal={clockInTotal}
                      primary={primary}
                      setShowClockInSummary={setShowClockInSummary}
                      watchedStartDate={watchedStartDate ?? undefined}
                      watchedEndDate={watchedEndDate ?? undefined}
                      format={format}
                    />
                  ) : null}

                  <DatePickerModal
                    showStartDatePicker={showStartDatePicker}
                    showEndDatePicker={showEndDatePicker}
                    setShowStartDatePicker={setShowStartDatePicker}
                    setShowEndDatePicker={setShowEndDatePicker}
                    watchedStartDate={watchedStartDate ?? undefined}
                    watchedEndDate={watchedEndDate ?? undefined}
                    form={{ setValue }}
                    DateTimePicker={DateTimePicker}
                    primary={primary}
                    format={format}
                  />
                </VStack>
              </Animated.View>
            )}
        </Box>
      </ScrollView>
    </SafeAreaView>
  );
};

const SalaryCalculatorWithErrorBoundary = () => {
  return (
    <ProfileErrorBoundary>
      <SalaryCalculatorScreen />
    </ProfileErrorBoundary>
  );
};

export default SalaryCalculatorWithErrorBoundary;
