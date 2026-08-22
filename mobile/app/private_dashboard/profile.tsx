import { createOnboardJob, getUserDetail, getJobById, getCountries, updateUserProfile, type Country } from '@/services/api';
import { Palette, Type } from '@/app/constants/theme';
import { profileLock } from '@/services/payroll-api';
import type { ProfileLockState } from '../../../shared/types/payroll';
import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { Box, Button, ButtonText, Checkbox, CheckboxIcon, CheckboxIndicator, CheckboxLabel, CheckIcon, FormControl, FormControlHelper, FormControlHelperText, FormControlLabel, FormControlLabelText, HStack, Heading, Input, InputField, Select, SelectBackdrop, SelectContent, SelectDragIndicator, SelectDragIndicatorWrapper, SelectIcon, SelectInput, SelectItem, SelectPortal, SelectTrigger, Switch, Text, VStack } from '@gluestack-ui/themed';
import { zodResolver } from '@hookform/resolvers/zod';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter, useFocusEffect } from 'expo-router';
import * as React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { Alert, AppState, KeyboardAvoidingView, Modal, Platform, Pressable, Text as RNText, TouchableOpacity as RNTouchableOpacity, SafeAreaView, ScrollView, StyleSheet, View, ActivityIndicator, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { z } from 'zod';
import useAuth from '../hooks/useAuth';
import useCurrency from '../hooks/useCurrency';
import { StandardButton } from '@/app/design-system';
import { PremiumHeader } from '@/components/PremiumHeader';
import CountryStatusChip from '@/components/private_home/CountryStatusChip';

const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const COUNTRY_FLAGS: Record<string, string> = { MU: '🇲🇺', TZ: '🇹🇿' };
// Steps array holds the visual identity (icon + a translation key); the
// human-facing title is resolved at render time via t() so it switches
// when the user changes language.
const steps = [
  { titleKey: 'profile.stepPersonal', icon: 'person' },
  { titleKey: 'profile.stepSchedule', icon: 'schedule' },
  { titleKey: 'profile.stepEmployer', icon: 'business' },
  { titleKey: 'profile.stepLegal', icon: 'description' },
] as const;

const profileSchema = z.object({
  gender: z.enum(['Male', 'Female', 'Other', '']).optional(),
  dateOfBirth: z.string().min(1, 'Date of birth is required'),
  passportNumber: z.string().min(1, 'Passport number is required'),
  phone: z.string().min(6, 'A valid phone number is required'),
  startDate: z.string().min(1, 'Start date is required'),
  startTime: z.string().min(1, 'Start time is required'),
  endTime: z.string().min(1, 'End time is required'),
  workDays: z.record(z.string(), z.string()),
  employer: z.string().min(1, 'Employer is required'),
  employerBrn: z.string().min(1, 'Employer BRN is required'),
  employerEmail: z.string().email('Invalid email'),
  employerPhone: z.string().min(1, 'Employer phone is required'),
  employerAddress: z.string().min(1, 'Employer address is required'),
  job: z.string().min(1, 'Job title is required'),
  hasContract: z.enum(['true', 'false', '']).optional(),
  hasPermit: z.enum(['true', 'false', '']).optional(),
  permitType: z.enum(['occupational', 'work', 'none', '']).optional(),
  isWorkingOnTouristVisa: z.enum(['true', 'false', '']).optional(),
  salaryDeductions: z.enum(['true', 'false', '']).optional(),
  deductionReasons: z.record(z.enum(['Food', 'Lodging', 'Transport', 'Uniform']), z.boolean()),
  housingCovered: z.enum(['true', 'false', '']).optional(),
  isDormitory: z.enum(['true', 'false', '']).optional(),
  isDecentHousing: z.enum(['true', 'false', '']).optional(),
  passportHeld: z.enum(['true', 'false', '']).optional(),
  workMatchPromise: z.enum(['true', 'false', '']).optional(),
  monthlyHours: z.string().min(1, 'Monthly hours is required'),
  breakMinutes: z.string().min(1, 'Break minutes is required'),
  workingDays: z.string().min(1, 'Working days is required'),
  monthlySalary: z.string().min(1, 'Monthly salary is required'),
  monthlyAllowance: z.string().min(1, 'Monthly allowance is required'),
  monthlyRevenue: z.string().optional(),
  doubtsAboutCompensation: z.enum(['true', 'false', '']).optional(),
  autoClockIn: z.enum(['true', 'false', '']).optional(),
});

type ProfileForm = z.infer<typeof profileSchema>;

function formatTime(date: Date | string | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDate(date: Date | string | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  return d.toISOString().split('T')[0];
}

function getNextDay(day: string): string | null {
  const idx = daysOfWeek.indexOf(day);
  return idx >= 0 && idx < 6 ? daysOfWeek[idx + 1] : null;
}

// Hoisted out of <Profile/> so identity is stable across renders. Previously
// these were declared inside the component body, which gave each render a
// new component reference and caused React to unmount/remount the entire
// subtree on every keystroke — that's what dismissed the keyboard on
// salary/allowance inputs and made the screen "flicker like a reload."
const PillButton = ({
  label,
  value,
  current,
  onSelect,
  color = Palette.gold,
  disabled = false,
}: any) => {
  const active = current === value;
  return (
    <RNTouchableOpacity
      onPress={() => !disabled && onSelect(value)}
      activeOpacity={disabled ? 1 : 0.7}
      style={[
        styles.pillButton,
        active && { borderColor: color, backgroundColor: color + '10' },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text fontSize={Type.body} fontWeight="700" color={active ? color : Palette.gray500}>
        {label}
      </Text>
    </RNTouchableOpacity>
  );
};

const LockedHint = () => {
  const { t } = useTranslation();
  return (
    <HStack space="xs" alignItems="center" mt="$1">
      <MaterialIcons name="lock" size={11} color={Palette.gold} />
      <Text fontSize={Type.caption} color={Palette.gold} fontWeight="600">
        {t('profile.lockedHint')}
      </Text>
    </HStack>
  );
};

const SectionLock = ({ active, children }: { active: boolean; children: React.ReactNode }) => {
  const { t } = useTranslation();
  if (!active) return <>{children}</>;
  return (
    <>
      <Box bg={Palette.warningTint} borderLeftWidth={3} borderLeftColor={Palette.gold} rounded="$lg" p="$3" mb="$4">
        <HStack space="sm" alignItems="center">
          <MaterialIcons name="lock" size={16} color={Palette.gold} />
          <Text fontSize={Type.small} color={Palette.gold} fontWeight="700" flex={1}>
            {t('profile.lockedHint')}
          </Text>
        </HStack>
      </Box>
      <Box pointerEvents="none" opacity={0.5}>{children}</Box>
    </>
  );
};

const Profile = () => {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoadingDetails, setIsLoadingDetails] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showEndTimePicker, setShowEndTimePicker] = useState(false);

  const [tempDateOfBirth, setTempDateOfBirth] = useState<Date>(new Date());
  const [tempStartDate, setTempStartDate] = useState<Date>(new Date());
  const [tempStartTime, setTempStartTime] = useState<Date>(new Date());
  const [tempEndTime, setTempEndTime] = useState<Date>(new Date());

  const [visibleDays, setVisibleDays] = useState<string[]>(['Monday']);
  const [refreshing, setRefreshing] = useState(false);
  const [lockState, setLockState] = useState<ProfileLockState | null>(null);

  const { user, isLoading: isAuthLoading, checkAuth, login } = useAuth();
  const { currencyInfo } = useCurrency();
  const router = useRouter();

  // Country edit — only independent (no-employer) users, editable until the
  // profile locks (identity_verified / is_locked). Company employees' country
  // is employer/assignment-derived and never user-set (see the chip below).
  const isIndependentUser = !user?.private_user?.company_id;
  const [showCountryModal, setShowCountryModal] = useState(false);
  const [countries, setCountries] = useState<Country[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [isSavingCountry, setIsSavingCountry] = useState(false);
  const currentCountryCode =
    user?.private_user?.country_code || user?.private_user?.effective_country_code;

  useEffect(() => {
    if (!isIndependentUser) return;
    let cancelled = false;
    setCountriesLoading(true);
    (async () => {
      const result = await getCountries();
      if (!cancelled && Array.isArray(result)) setCountries(result);
      if (!cancelled) setCountriesLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isIndependentUser]);

  const currentCountryName = countries.find((c) => c.code === currentCountryCode)?.name
    ?? (currentCountryCode ? currentCountryCode : undefined);

  const saveCountry = async (code: string) => {
    if (!user?.user_id) return;
    setIsSavingCountry(true);
    try {
      // country_code is a top-level field on UpdateUser (schema/user_schema.py),
      // not nested under private_user, even though it's stored on the PrivateUser.
      const result = await updateUserProfile(Number(user.user_id), { country_code: code } as any);
      if ((result as any)?.error) {
        Alert.alert(t('common.errorTitle'), (result as any).error);
        return;
      }
      await checkAuth({ silent: true });
      setShowCountryModal(false);
    } catch (e) {
      Alert.alert(t('common.errorTitle'), t('settings.countryUpdateFailed'));
    } finally {
      setIsSavingCountry(false);
    }
  };

  const handleCountryChange = (code: string) => {
    const selected = countries.find((c) => c.code === code);
    const usesNonMUR = !!selected && selected.currency.toUpperCase() !== 'MUR';
    if (usesNonMUR) {
      Alert.alert(
        t('settings.confirmNonMURTitle', { currency: selected.currency }),
        t('settings.confirmNonMURBody', { name: selected.name, currency: selected.currency }),
        [
          { text: t('common.cancel', 'Cancel'), style: 'cancel' },
          { text: t('settings.confirmContinue', 'Continue'), onPress: () => saveCountry(code) },
        ],
      );
      return;
    }
    saveCountry(code);
  };

  const { control, handleSubmit, setValue, watch, formState: { errors }, reset, trigger } = useForm<ProfileForm>({
    resolver: zodResolver(profileSchema),
    mode: 'onChange',
    defaultValues: {
      gender: '',
      dateOfBirth: '',
      passportNumber: '',
      phone: '',
      startDate: '',
      startTime: '',
      endTime: '',
      workDays: {},
      employer: '',
      employerBrn: '',
      employerEmail: '',
      employerPhone: '',
      employerAddress: '',
      job: '',
      hasContract: '',
      hasPermit: '',
      permitType: '',
      isWorkingOnTouristVisa: '',
      salaryDeductions: '',
      deductionReasons: { Food: false, Lodging: false, Transport: false, Uniform: false },
      housingCovered: '',
      isDormitory: '',
      isDecentHousing: '',
      passportHeld: '',
      workMatchPromise: '',
      monthlyHours: '',
      breakMinutes: '',
      workingDays: '',
      monthlySalary: '',
      monthlyAllowance: '',
      monthlyRevenue: '',
      doubtsAboutCompensation: '',
      autoClockIn: '',
    },
  });

  const watchedSalary = watch('monthlySalary');
  const watchedAllowance = watch('monthlyAllowance');

  React.useEffect(() => {
    const salaryVal = parseFloat(watchedSalary || '0') || 0;
    const allowanceVal = parseFloat(watchedAllowance || '0') || 0;
    setValue('monthlyRevenue', String(salaryVal + allowanceVal));
  }, [watchedSalary, watchedAllowance, setValue]);

  useEffect(() => {
    const initializeProfile = async () => {
      if (!user) {
        await checkAuth();
        setIsLoadingDetails(false);
        return;
      }

      if (user.private_user) {
        const privateUser = user.private_user;

        // Fetch job data separately to ensure we get work_days and other details
        let job = null;
        let salary = null;

        if (privateUser.private_user_id) {
          try {
            const jobData = await getJobById(privateUser.private_user_id);
            if (jobData && !('error' in jobData)) {
              job = jobData;
              salary = job?.salaries?.[0];
            }
          } catch (e) {
            console.warn('Failed to fetch job data:', e);
          }
        }

        if (job?.work_days && Object.keys(job.work_days).length > 0) {
          const workDays = job.work_days;
          const existingDays = daysOfWeek.filter(day => day in workDays);
          if (existingDays.length > 0) {
            setVisibleDays(existingDays);
          }
        }

        const toStr = (val: any): string => (val !== null && val !== undefined) ? String(val) : '';
        const toBoolStr = (val: any): 'true' | 'false' | '' => val === true ? 'true' : val === false ? 'false' : '';
        const computeAllowance = (): string => {
          if (salary?.allowance !== undefined && salary?.allowance !== null && salary.allowance !== '') {
            return String(salary.allowance);
          }
          if (salary?.revenue && salary?.salary) {
            const revenueVal = parseFloat(String(salary.revenue || '0')) || 0;
            const salaryVal = parseFloat(String(salary.salary || '0')) || 0;
            return String(Math.max(0, revenueVal - salaryVal));
          }
          return '';
        };

        const formData: Partial<ProfileForm> = {
          gender: (privateUser?.gender as any) || '',
          dateOfBirth: privateUser.date_of_birth ? formatDate(privateUser.date_of_birth) : '',
          passportNumber: privateUser.pass_port_number || '',
          phone: privateUser.phone || '',
          startDate: job?.first_date_of_employment ? formatDate(job.first_date_of_employment) : '',
          startTime: job?.work_start_time || '',
          endTime: job?.work_end_time || '',
          workDays: job?.work_days || {},
          autoClockIn: toBoolStr(job?.auto_clockin_enabled),
          employer: job?.employer_name || '',
          employerBrn: job?.employer_brn || '',
          employerEmail: job?.employer_email || '',
          employerPhone: job?.employer_phone || '',
          employerAddress: job?.employer_address || '',
          job: job?.job_title || '',
          hasContract: toBoolStr(job?.has_contract),
          hasPermit: toBoolStr(job?.has_permission_to_work),
          permitType: (job?.work_permit_type as any) || '',
          isWorkingOnTouristVisa: toBoolStr(job?.working_on_tourist_visa),
          salaryDeductions: toBoolStr(job?.is_salary_deducted),
          deductionReasons: job?.reason_for_deduction || { Food: false, Lodging: false, Transport: false, Uniform: false },
          housingCovered: toBoolStr(job?.is_accommodation_covered_by_employer),
          isDormitory: toBoolStr(job?.is_accommodation_a_dormitory),
          isDecentHousing: toBoolStr(job?.is_accommodation_decent),
          passportHeld: toBoolStr(job?.is_passport_retained),
          workMatchPromise: toBoolStr(job?.is_job_execution_same_as_description),
          monthlyHours: toStr(salary?.monthly_hours),
          breakMinutes: toStr(salary?.break_in_minutes_per_day),
          workingDays: toStr(salary?.days_of_work_per_month),
          monthlySalary: toStr(salary?.salary),
          monthlyAllowance: toStr(computeAllowance()),
          monthlyRevenue: toStr(salary?.revenue ?? (salary?.salary && computeAllowance() ? String((parseFloat(String(salary?.salary || '0')) || 0) + (parseFloat(computeAllowance()) || 0)) : '')),
          doubtsAboutCompensation: toBoolStr(job?.doubts_about_compensation),
        };
        reset(formData);
      }
      setIsLoadingDetails(false);
    };
    console.log('Profile Init: Starting...', { userId: user?.user_id });
    initializeProfile();
  }, [user?.user_id]);
  useEffect(() => {
    console.log('Profile Step Change:', { currentStep });
  }, [currentStep]);

  // Profile lock — when locked, the backend rejects edits to the frozen
  // fields; the UI mirrors that read-only state with disabled inputs and a
  // banner. We keep the lock state fresh WITHOUT an app restart by re-checking
  // it on screen focus, on a short interval while the screen is open, and when
  // the app returns to the foreground — so a lock/unlock applied by an admin
  // elsewhere reflects here within seconds.
  const refreshLock = useCallback(async () => {
    const pid = (user as any)?.private_user?.private_user_id ?? Number((user as any)?.private_user_id);
    if (!pid) return;
    const r = await profileLock.get(pid);
    if (!('error' in r)) setLockState(r);
  }, [user?.user_id]);

  useFocusEffect(
    useCallback(() => {
      refreshLock();
      const interval = setInterval(refreshLock, 15000);
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') refreshLock();
      });
      return () => {
        clearInterval(interval);
        sub.remove();
      };
    }, [refreshLock]),
  );

  // Two-lock model (mirrors backend core/profile_lock.py):
  //   identity_verified → freezes IDENTITY_FIELDS (Step 0 Personal)
  //   is_locked         → freezes COMPANY_FIELDS (Steps 2 + 3)
  // A *manual* lock (employer sealing the profile) also freezes identity; an
  // *auto* lock (stamped AUTO_LOCK_REASON when an admin edits a company field)
  // does not, so KYC entry stays open during onboarding. Schedule (Step 1) is
  // always editable.
  const AUTO_LOCK_REASON = 'Auto-locked on admin company-edit';
  const identityVerified = !!lockState?.identity_verified;
  const companyLocked = !!lockState?.is_locked;
  const manualLock = companyLocked && lockState?.lock_reason !== AUTO_LOCK_REASON;
  // Identity inputs (Step 0) are read-only when verified OR manually locked.
  const identityLocked = identityVerified || manualLock;
  // Back-compat: existing JSX references isLocked for the Step 0 identity inputs.
  const isLocked = identityLocked;

  const onRefresh = async () => {
    setRefreshing(true);
    // Refresh user data (incl. verification_note) and the lock state together.
    await Promise.all([checkAuth(), refreshLock()]);
    setRefreshing(false);
  };

  const nextStep = async () => {
    let fieldsToValidate: any[] = [];
    if (currentStep === 0) fieldsToValidate = ['gender', 'dateOfBirth', 'passportNumber', 'phone', 'startDate'];
    if (currentStep === 1) fieldsToValidate = ['startTime', 'endTime', 'workDays'];
    if (currentStep === 2) fieldsToValidate = ['employer', 'employerBrn', 'employerEmail', 'employerPhone', 'employerAddress', 'job'];
    if (currentStep === 3) fieldsToValidate = ['hasContract', 'hasPermit', 'permitType', 'isWorkingOnTouristVisa', 'monthlySalary', 'monthlyAllowance', 'monthlyHours', 'breakMinutes', 'workingDays'];

    const isStepValid = await trigger(fieldsToValidate as any);
    if (isStepValid) {
      setCurrentStep((prev) => prev + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setCurrentStep((prev) => prev - 1);
    }
  };

  const onSubmit = async (data: ProfileForm) => {
    setIsSubmitting(true);
    const privateUserId = user?.private_user?.private_user_id ?? (user as any)?.private_user_id ?? user?.user_id;
    if (privateUserId === undefined) {
      setIsSubmitting(false);
      Alert.alert('Error', 'User profile not found. Please log out and log back in.');
      return;
    }

    const toBool = (val: "" | "true" | "false" | undefined): boolean =>
      val === "true" ? true : false;

    const payload = {
      user_data: {
        private_user_id: Number(privateUserId),
        gender: data.gender,
        date_of_birth: data.dateOfBirth,
        pass_port_number: data.passportNumber,
        phone: data.phone,
        // Plan Phase 12.A — `onboard_complete` is now server-authoritative.
        // Backend's job/profile endpoint runs `refresh_user_onboard_state`
        // and flips the flag iff the persisted data satisfies the rule.
        // The client never gets to lie its way through the gate.
      },
      job_data: {
        private_user_id: Number(privateUserId),
        job_title: data.job,
        employer_name: data.employer,
        employer_brn: data.employerBrn,
        first_date_of_employment: data.startDate,
        work_start_time: data.startTime,
        work_end_time: data.endTime,
        work_days: data.workDays,
        employer_email: data.employerEmail.toLocaleLowerCase(),
        employer_phone: data.employerPhone,
        employer_address: data.employerAddress,
        has_contract: toBool(data.hasContract),
        has_permission_to_work: toBool(data.hasPermit),
        work_permit_type: data.permitType,
        working_on_tourist_visa: toBool(data.isWorkingOnTouristVisa),
        auto_clockin_enabled: toBool(data.autoClockIn),
        is_salary_deducted: toBool(data.salaryDeductions),
        reason_for_deduction: data.deductionReasons,
        is_accommodation_covered_by_employer: toBool(data.housingCovered),
        is_accommodation_a_dormitory: toBool(data.isDormitory),
        is_accommodation_decent: toBool(data.isDecentHousing),
        is_passport_retained: toBool(data.passportHeld),
        is_job_execution_same_as_description: toBool(data.workMatchPromise),
        doubts_about_compensation: toBool(data.doubtsAboutCompensation),
      },
      salary_data: {
        monthly_hours: data.monthlyHours || '0',
        break_in_minutes_per_day: Number(data.breakMinutes) || 0,
        days_of_work_per_month: Number(data.workingDays) || 0,
        // Currency is derived server-side from the employee's country — no longer
        // hardcoded 'MUR' here (that stamped every salary MUR regardless of country).
        salary: data.monthlySalary || '0',
        allowance: data.monthlyAllowance || '0',
        revenue: data.monthlyRevenue && data.monthlyRevenue.trim().length > 0
          ? data.monthlyRevenue
          : String(
              (parseFloat(data.monthlySalary || '0') || 0) +
              (parseFloat(data.monthlyAllowance || '0') || 0)
            ),
      }
    };

    try {
      const onboardRes = await createOnboardJob(payload);
      if ('error' in onboardRes) {
        Alert.alert('Submission Failed', (onboardRes as any).error || 'Failed to save profile. Please try again.');
        return;
      }
      if (onboardRes.status === 'success') {
        // Clock-in/out reminders are delivered SERVER-SIDE now (backend
        // jobs/clock_reminders.py reads auto_clockin_enabled + the work
        // schedule and sends an Expo push at start/end on work days). The
        // toggle is persisted above via auto_clockin_enabled — no fragile
        // on-device local-notification scheduling needed here.

        // Capture onboarding state BEFORE refreshing local auth — this tells
        // us whether the user was already onboarded (editing from Settings)
        // or completing initial onboarding, which determines where we
        // navigate on success.
        const wasAlreadyOnboarded = Boolean(user?.onboard_complete);

        // The SERVER decides whether onboarding is now complete — `status:
        // "success"` only means the write persisted, NOT that the profile
        // satisfies the onboarding rule. Trust the recomputed flag (and the
        // `missing` list) the backend returned; never redirect off the form
        // while the server still considers onboarding incomplete, or the
        // dashboard layout guard will just bounce the user straight back here.
        const serverOnboardComplete = Boolean(
          (onboardRes as any).data?.onboard_complete,
        );
        const missing: string[] = Array.isArray((onboardRes as any).missing)
          ? (onboardRes as any).missing
          : [];

        // Best-effort: refresh local auth state — if this fails, data is already saved on server
        try {
          if (login && user) {
            const latestUserDataResponse = await getUserDetail(user.user_id);
            if (latestUserDataResponse && !('error' in latestUserDataResponse)) {
              await login(latestUserDataResponse as any, (user as any).token);
            }
          }
        } catch {
          // Silent — profile was saved successfully; stale local state is fine
        }

        if (!serverOnboardComplete) {
          // Saved, but still missing required data. Tell the user exactly what
          // is outstanding and KEEP them on the form instead of redirecting
          // into a bounce loop.
          const labelFor = (key: string): string => {
            switch (key) {
              case 'profile.first_name':
                return t('profile.missingFirstName', { defaultValue: 'First name' });
              case 'profile.last_name':
                return t('profile.missingLastName', { defaultValue: 'Last name' });
              case 'profile.phone':
                return t('profile.missingPhone', { defaultValue: 'Phone number' });
              case 'profile.employer_link':
                return t('profile.missingEmployer', { defaultValue: 'Employer / job details' });
              default:
                return key;
            }
          };
          const list = missing.map(labelFor).join('\n• ');
          Alert.alert(
            t('profile.incompleteTitle', { defaultValue: 'Almost there' }),
            list
              ? t('profile.incompleteWithList', {
                  defaultValue: 'Your changes were saved, but a few required details are still needed:\n\n• {{list}}',
                  list,
                })
              : t('profile.incompleteGeneric', {
                  defaultValue: 'Your changes were saved, but some required details are still needed to finish setting up your profile.',
                }),
          );
          return;
        }

        const nextRoute = wasAlreadyOnboarded
          ? '/private_dashboard/settings'
          : '/private_dashboard/home';
        Alert.alert(
          t('profile.saveSuccessTitle', { defaultValue: 'Profile saved' }),
          t('profile.saveSuccessMessage', { defaultValue: 'Your profile has been updated successfully.' }),
          [{ text: 'OK', onPress: () => router.replace(nextRoute) }],
          { cancelable: false },
        );
      } else {
        Alert.alert('Submission Failed', 'Unexpected response from server. Please try again.');
      }
    } catch (error: any) {
      console.error("Error during onboarding submission:", error);
      Alert.alert('Error', 'Failed to save profile. Please check your connection and try again.');
    } finally {
      setIsSubmitting(false);
    }
  };


  if (isAuthLoading || isLoadingDetails) {
    // Keep the header mounted while data loads — otherwise the nav header
    // (back button + title) is missing until the page finishes loading.
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
        <PremiumHeader
          title={user?.onboard_complete ? 'Update Profile' : 'Complete Profile'}
          onBack={() => router.push('/private_dashboard/settings')}
        />
        <Box flex={1} justifyContent="center" alignItems="center" bg={Palette.gray50}>
          <ActivityIndicator size="large" color={Palette.gold} />
        </Box>
      </SafeAreaView>
    );
  }

  // PillButton, LockedHint, SectionLock are hoisted to module scope above —
  // see comment there. Do not re-declare here.

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <PremiumHeader
        title={user?.onboard_complete ? 'Update Profile' : 'Complete Profile'}
        onBack={() => router.push('/private_dashboard/settings')}
      />
      <Box position="absolute" top={-50} right={-50} w={200} h={200} rounded="$full" bg={Palette.goldTint} opacity={0.4} />
      <Box position="absolute" bottom={-100} left={-50} w={300} h={300} rounded="$full" bg={Palette.blueTint} opacity={0.4} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: 10, paddingBottom: 160, paddingHorizontal: 16 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Palette.gold}
            colors={[Palette.gold, Palette.blue]}
          />
        }
      >
        {/* Profile lock banner — fires for either lock. The banner explains
            both states clearly; the inputs themselves remain disabled per-section. */}
        {(companyLocked || identityLocked) && (
          <Box mb="$4" mx="$2">
            <Box bg={Palette.warningTint} borderLeftWidth={4} borderLeftColor={Palette.gold} rounded="$xl" p="$4" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.05} shadowRadius={4} elevation={2}>
              <HStack space="md" alignItems="flex-start">
                <Box mt="$0.5">
                  <MaterialIcons name="lock" size={20} color={Palette.gold} />
                </Box>
                <VStack flex={1} space="xs">
                  <Text fontSize={Type.label} fontWeight="800" color={Palette.gold}>{t('profile.lockedBanner')}</Text>
                  <Text fontSize={Type.small} color={Palette.gold} lineHeight={17}>
                    {identityLocked
                      ? t('profile.lockedDescription')
                      : "Your employment details are managed by your company and can't be edited here."}
                  </Text>
                  {identityVerified && (
                    <Text fontSize={Type.caption} color={Palette.gold} mt="$1">
                      Identity verified by admin — Personal info is read-only. Contact HR to change.
                    </Text>
                  )}
                  {companyLocked && lockState?.lock_reason ? (
                    <Text fontSize={Type.caption} color={Palette.gold} fontStyle="italic" mt="$1">
                      {t('profile.lockedReason', { reason: lockState.lock_reason })}
                    </Text>
                  ) : null}
                </VStack>
              </HStack>
            </Box>
          </Box>
        )}

        {/* Verification Note Banner */}
        {user?.verification_note && (
          <Box mb="$4" mx="$2">
            <Box bg={Palette.blueTint} borderLeftWidth={4} borderLeftColor={Palette.blue} rounded="$xl" p="$4" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.05} shadowRadius={4} elevation={2}>
              <HStack space="md" alignItems="flex-start">
                <Box mt="$0.5">
                  <MaterialIcons name="info" size={20} color={Palette.blue} />
                </Box>
                <VStack flex={1} space="xs">
                  <Text fontSize={Type.label} fontWeight="700" color={Palette.blue}>{t('profile.messageFromEmployer')}</Text>
                  <Text fontSize={Type.label} color={Palette.blue} lineHeight={18}>{user.verification_note}</Text>
                </VStack>
              </HStack>
            </Box>
          </Box>
        )}

        {/* Branch / site badge — read-only, shown on every step */}
        {user?.private_user?.home_site_name && (
          <Box mb="$4" mx="$2">
            <Box bg={Palette.tealTint} borderLeftWidth={4} borderLeftColor={Palette.teal} rounded="$xl" p="$4" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.05} shadowRadius={4} elevation={2}>
              <HStack space="md" alignItems="center">
                <Box bg={Palette.teal} p="$2" rounded="$lg">
                  <MaterialIcons name="storefront" size={20} color={Palette.white} />
                </Box>
                <VStack flex={1} space="xs">
                  <Text fontSize={Type.caption} color={Palette.teal} fontWeight="700">{t('payslip.homeSiteLabel')}</Text>
                  <Text fontSize={Type.label} color={Palette.ink} fontWeight="700">{user.private_user.home_site_name}</Text>
                </VStack>
              </HStack>
            </Box>
          </Box>
        )}

        {/* Tab bar — replaces the previous stepper. Tapping a tab jumps to
            that section; the Next/Back buttons at the bottom still work for
            users who prefer linear flow. */}
        <Box mb="$6" px="$2">
          <Box
            bg={Palette.white}
            rounded="$2xl"
            p="$1"
            shadowColor={Palette.black}
            shadowOffset={{ width: 0, height: 2 }}
            shadowOpacity={0.05}
            shadowRadius={6}
            elevation={2}
          >
            <HStack space="xs">
              {steps.map((step, index) => {
                const isActive = index === currentStep;
                return (
                  <Pressable
                    key={index}
                    onPress={() => setCurrentStep(index)}
                    style={{ flex: 1 }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={t(step.titleKey)}
                  >
                    <Box
                      bg={isActive ? Palette.gold : "transparent"}
                      rounded="$xl"
                      py="$2.5"
                      px="$2"
                      alignItems="center"
                    >
                      <MaterialIcons
                        name={step.icon as any}
                        size={18}
                        color={isActive ? Palette.white : Palette.gray400}
                      />
                      <Text
                        fontSize={Type.caption}
                        fontWeight={isActive ? '700' : '500'}
                        color={isActive ? Palette.white : Palette.gray500}
                        mt="$1"
                      >
                        {t(step.titleKey)}
                      </Text>
                    </Box>
                  </Pressable>
                );
              })}
            </HStack>
          </Box>
        </Box>

        <Box minHeight={500}>
          {currentStep === 0 && (
            <View>
              <Box bg={Palette.white} rounded="$3xl" p="$6" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 4 }} shadowOpacity={0.08} shadowRadius={12} elevation={6}>
                <HStack space="md" alignItems="center" mb="$6"><Box bg={Palette.blue} p="$2" rounded="$lg"><MaterialIcons name="person" size={24} color={Palette.white} /></Box><Heading size="sm">{t('profile.sectionPersonalDetails')}</Heading></HStack>
                {isIndependentUser ? (
                  <FormControl isDisabled={identityLocked}>
                    <FormControlLabel>
                      <HStack space="xs" alignItems="center">
                        <FormControlLabelText>{t('settings.country')}</FormControlLabelText>
                        {identityLocked && <MaterialIcons name="lock" size={12} color={Palette.gold} />}
                      </HStack>
                    </FormControlLabel>
                    <RNTouchableOpacity
                      onPress={() => !identityLocked && setShowCountryModal(true)}
                      activeOpacity={identityLocked ? 1 : 0.7}
                      style={[styles.modernInput, identityLocked && { opacity: 0.5 }]}
                    >
                      <HStack flex={1} space="sm" alignItems="center">
                        <Text color={currentCountryName ? Palette.ink : Palette.gray400}>
                          {currentCountryName || 'select country'}
                        </Text>
                      </HStack>
                      <MaterialIcons name={identityLocked ? 'lock' : 'arrow-drop-down'} size={20} color={Palette.gold} />
                    </RNTouchableOpacity>
                    {identityLocked && <LockedHint />}
                  </FormControl>
                ) : (
                  <CountryStatusChip variant="field" />
                )}
                <VStack space="lg">
                  <FormControl isDisabled={isLocked}>
                    <FormControlLabel>
                      <HStack space="xs" alignItems="center">
                        <FormControlLabelText>{t('profile.labelGender')}</FormControlLabelText>
                        {isLocked && <MaterialIcons name="lock" size={12} color={Palette.gold} />}
                      </HStack>
                    </FormControlLabel>
                    <Controller control={control} name="gender" render={({ field: { onChange, value } }) => (
                      <HStack space="sm">
                        {['Male', 'Female', 'Other'].map(g => <PillButton key={g} label={g} value={g} current={value} onSelect={onChange} disabled={isLocked} />)}
                      </HStack>
                    )} />
                    {isLocked && <LockedHint />}
                  </FormControl>

                  <FormControl isInvalid={!!errors.dateOfBirth} isDisabled={isLocked}>
                    <FormControlLabel>
                      <HStack space="xs" alignItems="center">
                        <FormControlLabelText>{t('profile.labelDateOfBirth')}</FormControlLabelText>
                        {isLocked && <MaterialIcons name="lock" size={12} color={Palette.gold} />}
                      </HStack>
                    </FormControlLabel>
                    <RNTouchableOpacity
                      onPress={() => !isLocked && setShowDatePicker(true)}
                      activeOpacity={isLocked ? 1 : 0.7}
                      style={[styles.modernInput, isLocked && { opacity: 0.5 }]}
                    >
                      <Text color={watch('dateOfBirth') ? Palette.ink : Palette.gray400}>{watch('dateOfBirth') || 'YYYY-MM-DD'}</Text>
                      <MaterialIcons name={isLocked ? 'lock' : 'calendar-today'} size={20} color={isLocked ? Palette.gold : Palette.gold} />
                    </RNTouchableOpacity>
                    {errors.dateOfBirth && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.dateOfBirth.message}</Text>}
                    {isLocked && <LockedHint />}
                  </FormControl>

                  <FormControl isInvalid={!!errors.passportNumber} isDisabled={isLocked}>
                    <FormControlLabel>
                      <HStack space="xs" alignItems="center">
                        <FormControlLabelText>{t('profile.labelPassportOrId')}</FormControlLabelText>
                        {isLocked && <MaterialIcons name="lock" size={12} color={Palette.gold} />}
                      </HStack>
                    </FormControlLabel>
                    <Controller control={control} name="passportNumber" render={({ field: { onChange, value } }) => (
                      <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} isDisabled={isLocked}>
                        <InputField placeholder={t('profile.placeholderEnterNumber')} value={value} onChangeText={onChange} editable={!isLocked} />
                      </Input>
                    )} />
                    {errors.passportNumber && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.passportNumber.message}</Text>}
                    {isLocked && <LockedHint />}
                  </FormControl>

                  <FormControl isInvalid={!!errors.phone}>
                    <FormControlLabel>
                      <FormControlLabelText>{t('profile.labelYourPhone', { defaultValue: 'Your phone number' })}</FormControlLabelText>
                    </FormControlLabel>
                    <Controller control={control} name="phone" render={({ field: { onChange, value } }) => (
                      <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                        <InputField keyboardType="phone-pad" placeholder={t('profile.placeholderYourPhone', { defaultValue: 'e.g. +230 5 712 3456' })} value={value} onChangeText={onChange} />
                      </Input>
                    )} />
                    {errors.phone && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.phone.message}</Text>}
                  </FormControl>

                  <FormControl isInvalid={!!errors.startDate} isDisabled={companyLocked}>
                    <FormControlLabel>
                      <HStack space="xs" alignItems="center">
                        <FormControlLabelText>{t('profile.labelEmploymentStartDate')}</FormControlLabelText>
                        {companyLocked && <MaterialIcons name="lock" size={12} color={Palette.gold} />}
                      </HStack>
                    </FormControlLabel>
                    <RNTouchableOpacity
                      onPress={() => !companyLocked && setShowStartDatePicker(true)}
                      activeOpacity={companyLocked ? 1 : 0.7}
                      style={[styles.modernInput, companyLocked && { opacity: 0.5 }]}
                    >
                      <Text color={watch('startDate') ? Palette.ink : Palette.gray400}>{watch('startDate') || 'YYYY-MM-DD'}</Text>
                      <MaterialIcons name={companyLocked ? 'lock' : 'event'} size={20} color={Palette.gold} />
                    </RNTouchableOpacity>
                    {errors.startDate && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.startDate.message}</Text>}
                    {companyLocked && <LockedHint />}
                  </FormControl>
                </VStack>
              </Box>
            </View>
          )}

          {currentStep === 1 && (
            <View>
              <Box bg={Palette.white} rounded="$3xl" p="$6" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 4 }} shadowOpacity={0.08} shadowRadius={12} elevation={6}>
                <HStack space="md" alignItems="center" mb="$6"><Box bg={Palette.teal} p="$2" rounded="$lg"><MaterialIcons name="schedule" size={24} color={Palette.white} /></Box><Heading size="sm">{t('profile.sectionWorkingHours')}</Heading></HStack>
                <VStack space="lg">
                  <HStack space="md">
                    {/* Start Time Card */}
                    <VStack flex={1}>
                      <RNTouchableOpacity onPress={() => setShowTimePicker(true)} activeOpacity={0.7}>
                        <Box bg={watch('startTime') ? Palette.gray50 : Palette.goldTint} borderWidth={2} borderColor={errors.startTime ? Palette.error : watch('startTime') ? Palette.green : Palette.goldTint} rounded="$2xl" p="$3">
                          <HStack space="sm" alignItems="flex-start">
                            <Box w={36} h={36} rounded="$full" bg={watch('startTime') ? Palette.green : Palette.gold} justifyContent="center" alignItems="center" flexShrink={0}>
                              <MaterialIcons name={watch('startTime') ? 'check-circle' : 'schedule'} size={20} color={Palette.white} />
                            </Box>
                            <VStack flex={1}>
                              <Text fontSize={Type.small} fontWeight="600" color={Palette.gray500} mb="$0.5">START TIME</Text>
                              <Text fontSize={Type.body} fontWeight="700" color={watch('startTime') ? Palette.ink : Palette.gray400} lineHeight={20}>{watch('startTime') || 'Not set'}</Text>
                              <Text fontSize={Type.caption} color={watch('startTime') ? Palette.success : Palette.gold} mt="$0.5" fontWeight="500">{watch('startTime') ? 'Tap to change' : 'Tap to select'}</Text>
                            </VStack>
                          </HStack>
                        </Box>
                      </RNTouchableOpacity>
                      {errors.startTime && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.startTime.message}</Text>}
                    </VStack>

                    {/* End Time Card */}
                    <VStack flex={1}>
                      <RNTouchableOpacity onPress={() => setShowEndTimePicker(true)} activeOpacity={0.7}>
                        <Box bg={watch('endTime') ? Palette.gray50 : Palette.goldTint} borderWidth={2} borderColor={errors.endTime ? Palette.error : watch('endTime') ? Palette.green : Palette.goldTint} rounded="$2xl" p="$3">
                          <HStack space="sm" alignItems="flex-start">
                            <Box w={36} h={36} rounded="$full" bg={watch('endTime') ? Palette.green : Palette.gold} justifyContent="center" alignItems="center" flexShrink={0}>
                              <MaterialIcons name={watch('endTime') ? 'check-circle' : 'schedule'} size={20} color={Palette.white} />
                            </Box>
                            <VStack flex={1}>
                              <Text fontSize={Type.small} fontWeight="600" color={Palette.gray500} mb="$0.5">END TIME</Text>
                              <Text fontSize={Type.body} fontWeight="700" color={watch('endTime') ? Palette.ink : Palette.gray400} lineHeight={20}>{watch('endTime') || 'Not set'}</Text>
                              <Text fontSize={Type.caption} color={watch('endTime') ? Palette.success : Palette.gold} mt="$0.5" fontWeight="500">{watch('endTime') ? 'Tap to change' : 'Tap to select'}</Text>
                            </VStack>
                          </HStack>
                        </Box>
                      </RNTouchableOpacity>
                      {errors.endTime && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.endTime.message}</Text>}
                    </VStack>
                  </HStack>

                  <Heading size="xs" mt="$2">{t('profile.sectionWeeklySchedule')}</Heading>
                  {visibleDays.map((day, index) => (
                    <VStack key={day} space="xs">
                      <HStack justifyContent="space-between" alignItems="center">
                        <HStack space="sm" alignItems="center">
                          <Text fontWeight="600" fontSize={Type.body}>{day}</Text>
                          {index > 0 && index === visibleDays.length - 1 && (
                            <RNTouchableOpacity onPress={() => {
                              const newVisible = visibleDays.filter(d => d !== day);
                              setVisibleDays(newVisible);
                              const currentWorkDays = watch('workDays');
                              const { [day]: _, ...rest } = currentWorkDays;
                              setValue('workDays', rest);
                            }}>
                              <MaterialIcons name="remove-circle-outline" size={18} color={Palette.gray400} />
                            </RNTouchableOpacity>
                          )}
                        </HStack>
                        <Controller control={control} name="workDays" render={({ field: { onChange, value } }) => (
                          <Input size="sm" w={80} variant="outline" rounded="$lg" bg={Palette.gray50}>
                            <InputField keyboardType="numeric" placeholder={t('profile.placeholderHours')} value={value?.[day] || ''} onChangeText={text => onChange({ ...value, [day]: text })} />
                          </Input>
                        )} />
                      </HStack>
                      {index === visibleDays.length - 1 && day !== 'Sunday' && watch('workDays')?.[day] && (
                        <Button variant="link" size="xs" onPress={() => { const next = getNextDay(day); if (next) setVisibleDays([...visibleDays, next]); }}>
                          <ButtonText color={Palette.gold} fontSize={Type.small}>+ Add {getNextDay(day)}</ButtonText>
                        </Button>
                      )}
                    </VStack>
                  ))}

                  {/* Auto Clock-In Toggle */}
                  <Box bg={Palette.blueTint} p="$4" rounded="$xl" borderWidth={1} borderColor={Palette.gray200} mt="$2">
                    <HStack justifyContent="space-between" alignItems="center">
                      <VStack flex={1} mr="$3">
                        <Text fontWeight="700" fontSize={Type.body} color={Palette.ink}>{t('profile.sectionAutoClock')}</Text>
                        <Text fontSize={Type.small} color={Palette.gray500} mt="$1">
                          {watch('startTime') && watch('endTime')
                            ? `Reminds you to clock in at ${watch('startTime')} and out at ${watch('endTime')} on work days`
                            : 'Set start and end times above to enable reminders'}
                        </Text>
                      </VStack>
                      <Controller
                        control={control}
                        name="autoClockIn"
                        render={({ field: { onChange, value } }) => (
                          <Switch
                            value={value === 'true'}
                            onToggle={(val: boolean) => onChange(val ? 'true' : 'false')}
                            trackColor={{ false: Palette.gray300, true: Palette.blue }}
                            thumbColor={value === 'true' ? Palette.indigo : Palette.gray100}
                          />
                        )}
                      />
                    </HStack>
                  </Box>
                </VStack>
              </Box>
            </View>
          )}

          {currentStep === 2 && (
            <View>
              <Box bg={Palette.white} rounded="$3xl" p="$6" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 4 }} shadowOpacity={0.08} shadowRadius={12} elevation={6}>
                <HStack space="md" alignItems="center" mb="$6"><Box bg={Palette.violet} p="$2" rounded="$lg"><MaterialIcons name="business" size={24} color={Palette.white} /></Box><Heading size="sm">{t('profile.sectionEmployerJob')}</Heading></HStack>
                <SectionLock active={companyLocked}>
                <VStack space="lg">
                  <FormControl isInvalid={!!errors.employer}><FormControlLabel><FormControlLabelText>{t('profile.labelEmployerName')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="employer" render={({ field: { onChange, value } }) => (
                      <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><InputField placeholder={t('profile.placeholderCompanyName')} value={value} onChangeText={onChange} /></Input>
                    )} />
                    {errors.employer && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.employer.message}</Text>}
                  </FormControl>
                  <FormControl isInvalid={!!errors.employerBrn}><FormControlLabel><FormControlLabelText>{t('profile.labelEmployerBrn')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="employerBrn" render={({ field: { onChange, value } }) => (
                      <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><InputField placeholder={t('profile.placeholderBrn')} value={value} onChangeText={onChange} /></Input>
                    )} />
                    {errors.employerBrn && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.employerBrn.message}</Text>}
                  </FormControl>
                  <FormControl isInvalid={!!errors.job}><FormControlLabel><FormControlLabelText>{t('profile.labelJobTitle')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="job" render={({ field: { onChange, value } }) => (
                      <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><InputField placeholder={t('profile.placeholderJobTitle')} value={value} onChangeText={onChange} /></Input>
                    )} />
                    {errors.job && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.job.message}</Text>}
                  </FormControl>
                  <FormControl isInvalid={!!errors.employerEmail}><FormControlLabel><FormControlLabelText>{t('profile.labelEmployerEmail')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="employerEmail" render={({ field: { onChange, value } }) => (
                      <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><InputField keyboardType="email-address" placeholder="email@company.com" value={value} onChangeText={onChange} /></Input>
                    )} />
                    {errors.employerEmail && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.employerEmail.message}</Text>}
                  </FormControl>
                  <FormControl isInvalid={!!errors.employerPhone}><FormControlLabel><FormControlLabelText>{t('profile.labelEmployerPhone')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="employerPhone" render={({ field: { onChange, value } }) => (
                      <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><InputField keyboardType="phone-pad" placeholder={t('profile.placeholderPhoneNumber')} value={value} onChangeText={onChange} /></Input>
                    )} />
                    {errors.employerPhone && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.employerPhone.message}</Text>}
                  </FormControl>
                  <FormControl isInvalid={!!errors.employerAddress}><FormControlLabel><FormControlLabelText>{t('profile.labelWorkAddress')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="employerAddress" render={({ field: { onChange, value } }) => (
                      <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><InputField placeholder={t('profile.placeholderFullAddress')} value={value} onChangeText={onChange} /></Input>
                    )} />
                    {errors.employerAddress && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.employerAddress.message}</Text>}
                  </FormControl>
                </VStack>
                </SectionLock>
              </Box>
            </View>
          )}

          {currentStep === 3 && (
            <View>
              <Box bg={Palette.white} rounded="$3xl" p="$6" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 4 }} shadowOpacity={0.08} shadowRadius={12} elevation={6}>
                <HStack space="md" alignItems="center" mb="$6"><Box bg={Palette.green} p="$2" rounded="$lg"><MaterialIcons name="verified-user" size={24} color={Palette.white} /></Box><Heading size="sm">{t('profile.sectionLegalCompensation')}</Heading></HStack>
                <SectionLock active={companyLocked}>
                <VStack space="lg">
                  <HStack space="md">
                    <FormControl flex={1}><FormControlLabel><FormControlLabelText>{t('profile.labelContract')}</FormControlLabelText></FormControlLabel>
                      <Controller control={control} name="hasContract" render={({ field: { onChange, value } }) => (
                        <HStack space="xs"><PillButton label={t('common.yes')} value="true" current={value} onSelect={onChange} color={Palette.success} /><PillButton label={t('common.no')} value="false" current={value} onSelect={onChange} color={Palette.success} /></HStack>
                      )} />
                    </FormControl>
                    <FormControl flex={1}><FormControlLabel><FormControlLabelText>{t('profile.labelPermit')}</FormControlLabelText></FormControlLabel>
                      <Controller control={control} name="hasPermit" render={({ field: { onChange, value } }) => (
                        <HStack space="xs"><PillButton label={t('common.yes')} value="true" current={value} onSelect={onChange} color={Palette.success} /><PillButton label={t('common.no')} value="false" current={value} onSelect={onChange} color={Palette.success} /></HStack>
                      )} />
                    </FormControl>
                  </HStack>

                  {watch('hasPermit') === 'true' && (
                    <FormControl>
                      <FormControlLabel><FormControlLabelText>{t('profile.labelPermitType')}</FormControlLabelText></FormControlLabel>
                      <Select onValueChange={(val) => setValue('permitType', val as any)} selectedValue={watch('permitType')}>
                        <SelectTrigger variant="outline" size="xl" rounded="$xl" bg={Palette.gray50}>
                          <SelectInput placeholder={t('profile.placeholderPermitType')} />
                          <SelectIcon {...({ mr: '$3', as: MaterialIcons, name: 'arrow-drop-down' } as any)} />
                        </SelectTrigger>
                        <SelectPortal>
                          <SelectBackdrop />
                          <SelectContent>
                            <SelectDragIndicatorWrapper><SelectDragIndicator /></SelectDragIndicatorWrapper>
                            <SelectItem label={t('profile.permitOccupational')} value="occupational" />
                            <SelectItem label={t('profile.permitWork')} value="work" />
                            <SelectItem label={t('profile.permitNone')} value="none" />
                          </SelectContent>
                        </SelectPortal>
                      </Select>
                    </FormControl>
                  )}

                  <FormControl><FormControlLabel><FormControlLabelText>{t('profile.labelTouristVisa')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="isWorkingOnTouristVisa" render={({ field: { onChange, value } }) => (
                      <HStack space="sm"><PillButton label={t('common.yes')} value="true" current={value} onSelect={onChange} color={Palette.error} /><PillButton label={t('common.no')} value="false" current={value} onSelect={onChange} color={Palette.success} /></HStack>
                    )} />
                  </FormControl>

                  <FormControl isInvalid={!!errors.monthlySalary}><FormControlLabel><FormControlLabelText>{t('profile.labelMonthlySalary', { currency: currencyInfo.code })}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="monthlySalary" render={({ field: { onChange, value } }) => (
                      <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><InputField keyboardType="numeric" placeholder={t('profile.placeholderSalary')} value={value} onChangeText={onChange} /></Input>
                    )} />
                    {errors.monthlySalary && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.monthlySalary.message}</Text>}
                  </FormControl>

                  <FormControl isInvalid={!!errors.monthlyAllowance}><FormControlLabel><FormControlLabelText>{t('profile.labelMonthlyAllowance', { currency: currencyInfo.code })}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="monthlyAllowance" render={({ field: { onChange, value } }) => (
                      <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><InputField keyboardType="numeric" placeholder={t('profile.placeholderSalary')} value={value} onChangeText={onChange} /></Input>
                    )} />
                    {errors.monthlyAllowance && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.monthlyAllowance.message}</Text>}
                  </FormControl>

                  <FormControl>
                    <FormControlLabel>
                      <FormControlLabelText>{t('profile.labelMonthlyRevenue', { currency: currencyInfo.code })}</FormControlLabelText>
                    </FormControlLabel>
                    <Controller
                      control={control}
                      name="monthlyRevenue"
                      render={({ field: { value } }) => (
                        <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                          <InputField
                            value={value || ''}
                            editable={false}
                            placeholder={t('profile.placeholderAutoCalculated')}
                          />
                        </Input>
                      )}
                    />
                    <Text fontSize={Type.small} color={Palette.gray600} mt="$1">
                      This value updates automatically when salary or allowance changes.
                    </Text>
                  </FormControl>

                  <HStack space="md">
                    <FormControl flex={1} isInvalid={!!errors.monthlyHours}><FormControlLabel><FormControlLabelText>{t('profile.labelHoursPerMonth')}</FormControlLabelText></FormControlLabel>
                      <Controller control={control} name="monthlyHours" render={({ field: { onChange, value } }) => (
                        <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><InputField keyboardType="numeric" placeholder={t('profile.placeholderHoursMonth')} value={value} onChangeText={onChange} /></Input>
                      )} />
                      {errors.monthlyHours && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.monthlyHours.message}</Text>}
                    </FormControl>
                    <FormControl flex={1} isInvalid={!!errors.workingDays}><FormControlLabel><FormControlLabelText>{t('profile.labelDaysPerMonth')}</FormControlLabelText></FormControlLabel>
                      <Controller control={control} name="workingDays" render={({ field: { onChange, value } }) => (
                        <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><InputField keyboardType="numeric" placeholder={t('profile.placeholderDaysMonth')} value={value} onChangeText={onChange} /></Input>
                      )} />
                      {errors.workingDays && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.workingDays.message}</Text>}
                    </FormControl>
                  </HStack>

                  <FormControl isInvalid={!!errors.breakMinutes}><FormControlLabel><FormControlLabelText>{t('profile.labelBreakMinutes')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="breakMinutes" render={({ field: { onChange, value } }) => (
                      <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}><InputField keyboardType="numeric" placeholder={t('profile.placeholderBreakMins')} value={value} onChangeText={onChange} /></Input>
                    )} />
                    {errors.breakMinutes && <Text fontSize={Type.small} color={Palette.error} mt="$1">{errors.breakMinutes.message}</Text>}
                  </FormControl>

                  <FormControl><FormControlLabel><FormControlLabelText>{t('profile.labelSalaryDeductions')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="salaryDeductions" render={({ field: { onChange, value } }) => (
                      <VStack space="md">
                        <HStack space="sm"><PillButton label={t('common.yes')} value="true" current={value} onSelect={onChange} color={Palette.error} /><PillButton label={t('common.no')} value="false" current={value} onSelect={onChange} color={Palette.success} /></HStack>
                        {value === 'true' && (
                          <Box bg={Palette.gray50} p="$4" rounded="$xl" borderWidth={1} borderColor={Palette.gray200}>
                            <Text fontSize={Type.small} color={Palette.gray600} mb="$2">{t('profile.reasonsForDeduction')}</Text>
                            <HStack space="md" flexWrap="wrap">
                              {(['Food', 'Lodging', 'Transport', 'Uniform'] as const).map((reason) => (
                                <Controller key={reason} control={control} name="deductionReasons" render={({ field: { onChange: onCheck, value: reasons } }) => (
                                  <Checkbox size="sm" isChecked={reasons?.[reason]} value={reason} onChange={(checked) => onCheck({ ...reasons, [reason]: checked })}>
                                    <CheckboxIndicator mr="$2"><CheckboxIcon as={CheckIcon} /></CheckboxIndicator>
                                    <CheckboxLabel>{t(`profile.deduction${reason}`)}</CheckboxLabel>
                                  </Checkbox>
                                )} />
                              ))}
                            </HStack>
                          </Box>
                        )}
                      </VStack>
                    )} />
                  </FormControl>

                  <FormControl><FormControlLabel><FormControlLabelText>{t('profile.labelAccommodationCovered')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="housingCovered" render={({ field: { onChange, value } }) => (
                      <VStack space="md">
                        <HStack space="sm"><PillButton label={t('profile.yesCovered')} value="true" current={value} onSelect={onChange} color={Palette.success} /><PillButton label={t('common.no')} value="false" current={value} onSelect={onChange} color={Palette.success} /></HStack>
                        {value === 'true' && (
                          <HStack space="md">
                            <VStack flex={1} space="xs">
                              <Text fontSize={Type.small}>Dormitory?</Text>
                              <Controller control={control} name="isDormitory" render={({ field: { onChange: onDorm, value: dormVal } }) => (
                                <HStack space="xs"><PillButton label="Y" value="true" current={dormVal} onSelect={onDorm} color={Palette.success} /><PillButton label="N" value="false" current={dormVal} onSelect={onDorm} color={Palette.success} /></HStack>
                              )} />
                            </VStack>
                            <VStack flex={1} space="xs">
                              <Text fontSize={Type.small}>Decent?</Text>
                              <Controller control={control} name="isDecentHousing" render={({ field: { onChange: onDecent, value: decentVal } }) => (
                                <HStack space="xs"><PillButton label="Y" value="true" current={decentVal} onSelect={onDecent} color={Palette.success} /><PillButton label="N" value="false" current={decentVal} onSelect={onDecent} color={Palette.success} /></HStack>
                              )} />
                            </VStack>
                          </HStack>
                        )}
                      </VStack>
                    )} />
                  </FormControl>

                  <FormControl><FormControlLabel><FormControlLabelText>{t('profile.labelPassportHeld')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="passportHeld" render={({ field: { onChange, value } }) => (
                      <HStack space="sm"><PillButton label={t('common.yes')} value="true" current={value} onSelect={onChange} color={Palette.error} /><PillButton label={t('common.no')} value="false" current={value} onSelect={onChange} color={Palette.success} /></HStack>
                    )} />
                  </FormControl>

                  <FormControl><FormControlLabel><FormControlLabelText>{t('profile.labelJobMatchesPromise')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="workMatchPromise" render={({ field: { onChange, value } }) => (
                      <HStack space="sm"><PillButton label={t('common.yes')} value="true" current={value} onSelect={onChange} color={Palette.success} /><PillButton label={t('common.no')} value="false" current={value} onSelect={onChange} color={Palette.error} /></HStack>
                    )} />
                  </FormControl>

                  <FormControl><FormControlLabel><FormControlLabelText>{t('profile.labelDoubtsCompensation')}</FormControlLabelText></FormControlLabel>
                    <Controller control={control} name="doubtsAboutCompensation" render={({ field: { onChange, value } }) => (
                      <HStack space="sm"><PillButton label={t('common.yes')} value="true" current={value} onSelect={onChange} color={Palette.error} /><PillButton label={t('common.no')} value="false" current={value} onSelect={onChange} color={Palette.success} /></HStack>
                    )} />
                  </FormControl>
                </VStack>
                </SectionLock>
              </Box>
            </View>
          )}
        </Box>

        <HStack space="md" mt="$8" px="$2">
          {currentStep > 0 && (
            <Button flex={1} variant="outline" borderColor={Palette.gray200} rounded="$2xl" h="$16" onPress={prevStep} isDisabled={isSubmitting}>
              <ButtonText color={Palette.gray600} fontWeight="700">Back</ButtonText>
            </Button>
          )}
          {currentStep < steps.length - 1 ? (
            <Button flex={2} bg={Palette.gold} rounded="$2xl" h="$16" onPress={nextStep} shadowColor={Palette.gold} shadowOffset={{ width: 0, height: 4 }} shadowOpacity={0.2} shadowRadius={8} elevation={6}>
              <HStack space="md" alignItems="center"><ButtonText color={Palette.white} fontWeight="700">Continue</ButtonText><MaterialIcons name="arrow-forward" size={20} color={Palette.white} /></HStack>
            </Button>
          ) : (
            <Button flex={2} bg={Palette.gold} rounded="$2xl" h="$16" onPress={handleSubmit(onSubmit, (fieldErrors) => {
                const step0 = ['gender', 'dateOfBirth', 'passportNumber', 'phone', 'startDate'];
                const step1 = ['startTime', 'endTime', 'workDays'];
                const step2 = ['employer', 'employerBrn', 'employerEmail', 'employerPhone', 'employerAddress', 'job'];
                if (step0.some(f => fieldErrors[f as keyof typeof fieldErrors])) setCurrentStep(0);
                else if (step1.some(f => fieldErrors[f as keyof typeof fieldErrors])) setCurrentStep(1);
                else if (step2.some(f => fieldErrors[f as keyof typeof fieldErrors])) setCurrentStep(2);
                Alert.alert('Incomplete Form', 'Please fill in all required fields before submitting.');
              })} isDisabled={isSubmitting} shadowColor={Palette.gold} shadowOffset={{ width: 0, height: 4 }} shadowOpacity={0.2} shadowRadius={8} elevation={6}>
              <HStack space="md" alignItems="center">
                {isSubmitting ? <ActivityIndicator size="small" color={Palette.white} /> : <MaterialIcons name="check-circle" size={20} color={Palette.white} />}
                <ButtonText color={Palette.white} fontWeight="700">{isSubmitting ? 'Saving...' : (user?.onboard_complete ? 'Update Profile' : 'Complete Profile')}</ButtonText>
              </HStack>
            </Button>
          )}
        </HStack>
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Modals for pickers */}
      {Platform.OS === 'ios' && showDatePicker && (
        <Modal visible={true} transparent animationType="slide" onRequestClose={() => setShowDatePicker(false)}>
          <View style={styles.modalOverlay}>
            <RNTouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowDatePicker(false)} />
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
              <Box bg={Palette.white} borderTopLeftRadius={16} borderTopRightRadius={16} overflow="hidden">
                {/* Header */}
                <HStack justifyContent="space-between" alignItems="center" p="$4" borderBottomWidth={1} borderBottomColor={Palette.gray200}>
                  <Box w={60} />
                  <Heading size="sm" color={Palette.ink}>Date of Birth</Heading>
                  <Button variant="link" onPress={() => { setValue('dateOfBirth', formatDate(tempDateOfBirth)); setShowDatePicker(false); }}>
                    <ButtonText color={Palette.blue} fontSize={Type.title} fontWeight="600">Done</ButtonText>
                  </Button>
                </HStack>
                {/* Picker */}
                <Box bg={Palette.white}>
                  <DateTimePicker value={tempDateOfBirth} mode="date" display="spinner" textColor={Palette.black} onChange={(e, d) => { if (e.type === 'set' && d) setTempDateOfBirth(d); }} />
                </Box>
              </Box>
            </View>
          </View>
        </Modal>
      )}
      {Platform.OS === 'android' && showDatePicker && (
        <DateTimePicker
          value={tempDateOfBirth}
          mode="date"
          display="default"
          onChange={(e, d) => { if (d) { setTempDateOfBirth(d); setValue('dateOfBirth', formatDate(d)); } setShowDatePicker(false); }}
        />
      )}

      {Platform.OS === 'ios' && showStartDatePicker && (
        <Modal visible={true} transparent animationType="slide" onRequestClose={() => setShowStartDatePicker(false)}>
          <View style={styles.modalOverlay}>
            <RNTouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowStartDatePicker(false)} />
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
              <Box bg={Palette.white} borderTopLeftRadius={16} borderTopRightRadius={16} overflow="hidden">
                {/* Header */}
                <HStack justifyContent="space-between" alignItems="center" p="$4" borderBottomWidth={1} borderBottomColor={Palette.gray200}>
                  <Box w={60} />
                  <Heading size="sm" color={Palette.ink}>Start Date</Heading>
                  <Button variant="link" onPress={() => { setValue('startDate', formatDate(tempStartDate)); setShowStartDatePicker(false); }}>
                    <ButtonText color={Palette.blue} fontSize={Type.title} fontWeight="600">Done</ButtonText>
                  </Button>
                </HStack>
                {/* Picker */}
                <Box bg={Palette.white}>
                  <DateTimePicker value={tempStartDate} mode="date" display="spinner" textColor={Palette.black} onChange={(e, d) => { if (e.type === 'set' && d) setTempStartDate(d); }} />
                </Box>
              </Box>
            </View>
          </View>
        </Modal>
      )}
      {Platform.OS === 'android' && showStartDatePicker && (
        <DateTimePicker
          value={tempStartDate}
          mode="date"
          display="default"
          onChange={(e, d) => { if (d) { setTempStartDate(d); setValue('startDate', formatDate(d)); } setShowStartDatePicker(false); }}
        />
      )}

      {Platform.OS === 'ios' && showTimePicker && (
        <Modal visible={true} transparent animationType="slide" onRequestClose={() => setShowTimePicker(false)}>
          <View style={styles.modalOverlay}>
            <RNTouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowTimePicker(false)} />
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
              <Box bg={Palette.white} borderTopLeftRadius={16} borderTopRightRadius={16} overflow="hidden">
                {/* Header */}
                <HStack justifyContent="space-between" alignItems="center" p="$4" borderBottomWidth={1} borderBottomColor={Palette.gray200}>
                  <Box w={60} />
                  <Heading size="sm" color={Palette.ink}>Start Time</Heading>
                  <Button variant="link" onPress={() => { setValue('startTime', formatTime(tempStartTime)); setShowTimePicker(false); }}>
                    <ButtonText color={Palette.blue} fontSize={Type.title} fontWeight="600">Done</ButtonText>
                  </Button>
                </HStack>
                {/* Picker */}
                <Box bg={Palette.white}>
                  <DateTimePicker value={tempStartTime} mode="time" display="spinner" is24Hour={true} textColor={Palette.black} onChange={(e, d) => { if (e.type === 'set' && d) setTempStartTime(d); }} />
                </Box>
              </Box>
            </View>
          </View>
        </Modal>
      )}
      {Platform.OS === 'android' && showTimePicker && (
        <DateTimePicker
          value={tempStartTime}
          mode="time"
          display="default"
          is24Hour={true}
          onChange={(e, d) => { if (d) { setTempStartTime(d); setValue('startTime', formatTime(d)); } setShowTimePicker(false); }}
        />
      )}

      {Platform.OS === 'ios' && showEndTimePicker && (
        <Modal visible={true} transparent animationType="slide" onRequestClose={() => setShowEndTimePicker(false)}>
          <View style={styles.modalOverlay}>
            <RNTouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowEndTimePicker(false)} />
            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
              <Box bg={Palette.white} borderTopLeftRadius={16} borderTopRightRadius={16} overflow="hidden">
                {/* Header */}
                <HStack justifyContent="space-between" alignItems="center" p="$4" borderBottomWidth={1} borderBottomColor={Palette.gray200}>
                  <Box w={60} />
                  <Heading size="sm" color={Palette.ink}>End Time</Heading>
                  <Button variant="link" onPress={() => { setValue('endTime', formatTime(tempEndTime)); setShowEndTimePicker(false); }}>
                    <ButtonText color={Palette.blue} fontSize={Type.title} fontWeight="600">Done</ButtonText>
                  </Button>
                </HStack>
                {/* Picker */}
                <Box bg={Palette.white}>
                  <DateTimePicker value={tempEndTime} mode="time" display="spinner" is24Hour={true} textColor={Palette.black} onChange={(e, d) => { if (e.type === 'set' && d) setTempEndTime(d); }} />
                </Box>
              </Box>
            </View>
          </View>
        </Modal>
      )}
      {Platform.OS === 'android' && showEndTimePicker && (
        <DateTimePicker
          value={tempEndTime}
          mode="time"
          display="default"
          is24Hour={true}
          onChange={(e, d) => { if (d) { setTempEndTime(d); setValue('endTime', formatTime(d)); } setShowEndTimePicker(false); }}
        />
      )}

      {/* Country picker — independent users only, editable until the profile locks */}
      <Modal visible={showCountryModal} transparent animationType="slide" onRequestClose={() => setShowCountryModal(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <View style={{ backgroundColor: Palette.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 28 }}>
            <Pressable style={{ alignSelf: 'center', padding: 8 }} onPress={() => setShowCountryModal(false)}>
              <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: Palette.gray200 }} />
            </Pressable>
            <HStack justifyContent="space-between" alignItems="center" px="$4" py="$2">
              <Text fontWeight="700" fontSize={Type.h2} color={Palette.ink}>{t('settings.countryModalTitle')}</Text>
              <Pressable onPress={() => setShowCountryModal(false)}>
                <MaterialIcons name="close" size={22} color={Palette.gray500} />
              </Pressable>
            </HStack>
            {countriesLoading ? (
              <View style={{ alignItems: 'center', paddingVertical: 24, backgroundColor: Palette.white }}>
                <ActivityIndicator size="small" color={Palette.teal} />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 380 }}>
                <VStack px="$4" space="sm" pb="$6">
                  {countries.map((c) => (
                    <RNTouchableOpacity key={c.code} onPress={() => handleCountryChange(c.code)} disabled={isSavingCountry} activeOpacity={0.7}>
                      <Box
                        p="$4"
                        rounded="$2xl"
                        bg={currentCountryCode === c.code ? Palette.tealTint : Palette.white}
                        borderWidth={currentCountryCode === c.code ? 2 : 1}
                        borderColor={currentCountryCode === c.code ? Palette.teal : Palette.gray100}
                      >
                        <HStack justifyContent="space-between" alignItems="center">
                          <HStack space="md" alignItems="center" flex={1}>
                            <Text fontSize={Type.display}>{COUNTRY_FLAGS[c.code] ?? '🌍'}</Text>
                            <VStack flex={1}>
                              <Text fontWeight="700" color={Palette.ink} numberOfLines={1}>{c.name}</Text>
                              <Text fontSize={Type.small} color={Palette.gray500}>{c.code} · {c.currency}</Text>
                            </VStack>
                          </HStack>
                          {currentCountryCode === c.code && <MaterialIcons name="check-circle" size={22} color={Palette.teal} />}
                        </HStack>
                      </Box>
                    </RNTouchableOpacity>
                  ))}
                </VStack>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  modernInput: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Palette.gray200,
    borderRadius: 16,
    paddingHorizontal: 16,
    height: 60,
    backgroundColor: Palette.gray50,
  },
  pillButton: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Palette.gray200,
    backgroundColor: Palette.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pickerContainer: {
    width: '90%',
    maxWidth: 400,
    alignItems: 'center',
  },
});

export default Profile;