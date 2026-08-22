import useAuth from '@/app/hooks/useAuth';
import { Palette, Type } from '@/app/constants/theme';
import { getUsersByCompany, getJobById, getSalaryByJobId, getTimeLogsByJob, getDepartmentsByCompany, patchUserDepartment, resendClaimLink, isApiError, User, ShowDepartment } from '@/services/api';
import { salaryStructures, countryAssignments } from '@/services/payroll-api';
import type { EmployeeCountryAssignment } from '@/services/payroll-api';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Box, HStack, Spinner, Text, VStack, Pressable, ScrollView,
  Avatar, AvatarFallbackText, Badge, BadgeText
} from '@gluestack-ui/themed';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, Platform, Dimensions, Alert, Share } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, FadeIn, SlideInRight } from '@/app/utils/animated';
import { format } from 'date-fns';
import PermissionGate from '@/components/PermissionGate';
import { hasCompanyPermission } from '@/services/permissions';

const { width } = Dimensions.get('window');

export default function EmployeeDetailPage() {
  return (
    <PermissionGate permission="view_employee" label="employee profiles">
      <EmployeeDetailPageInner />
    </PermissionGate>
  );
}

function EmployeeDetailPageInner() {
  const { id } = useLocalSearchParams();
  const router = useRouter();
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const insets = useSafeAreaInsets();

  const [employee, setEmployee] = useState<User | null>(null);
  const [job, setJob] = useState<any>(null);
  const [salary, setSalary] = useState<any>(null);
  const [timeLogs, setTimeLogs] = useState<any[]>([]);
  const [departments, setDepartments] = useState<ShowDepartment[]>([]);
  const [activeLocation, setActiveLocation] = useState<EmployeeCountryAssignment | null>(null);
  const [selectedDeptId, setSelectedDeptId] = useState<number | null>(null);
  const [savingDept, setSavingDept] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  // Re-issue the account set-up link for an employee who hasn't claimed yet,
  // then offer to share it (WhatsApp/email/copy). Gated by onboard_employee.
  const handleResendClaim = useCallback(async () => {
    if (!employee || resending) return;
    setResending(true);
    const res = await resendClaimLink(employee.user_id);
    setResending(false);
    if (isApiError(res)) {
      Alert.alert(t('common.errorTitle'), res.error);
      return;
    }
    Alert.alert(
      t('employeeDetail.claimLinkReadyTitle', 'Set-up link ready'),
      t('employeeDetail.claimLinkReadyBody', 'Send this link to the employee so they can set their password. It expires in 14 days.'),
      [
        { text: t('common.close', 'Close'), style: 'cancel' },
        { text: t('employeeDetail.shareLink', 'Share link'), onPress: () => Share.share({ message: res.claim_link }) },
      ],
    );
  }, [employee, resending, t]);

  const loadEmployeeDetails = useCallback(async (isRefreshing = false) => {
    if (!id) return;
    if (!isRefreshing) setLoading(true);
    setError(null);

    // Clear previous data to prevent leakage between users
    if (!isRefreshing) {
      setEmployee(null);
      setJob(null);
      setSalary(null);
      setTimeLogs([]);
    }

    try {
      const companyId = currentUser?.company?.company_id ||
        currentUser?.private_user?.company_id ||
        (currentUser as any)?.company_id;

      if (!companyId) {
        throw new Error(t('employeeDetail.errNoCompany'));
      }

      const usersRes = await getUsersByCompany(companyId);
      if (isApiError(usersRes)) {
        throw new Error(t('employeeDetail.errFetchUsers'));
      }

      const emp = usersRes.find((u: User) => u.user_id === Number(id));
      if (!emp) {
        throw new Error(t('employeeDetail.errNotInCompany'));
      }
      setEmployee(emp);

      // Load departments + current assignment
      const deptsRes = await getDepartmentsByCompany(companyId);
      if (!isApiError(deptsRes)) {
        setDepartments(deptsRes as ShowDepartment[]);
      }
      setSelectedDeptId((emp.private_user as any)?.department_id ?? null);

      if (emp.private_user?.private_user_id) {
        const jobRes = await getJobById(emp.private_user.private_user_id);
        if (!isApiError(jobRes)) {
          setJob(jobRes);
          if (jobRes.job_id) {
            // Only pull salary / time logs the role is allowed to see, so a
            // view_employee-only manager doesn't trip 403s on this profile.
            if (hasCompanyPermission(currentUser, ['view_salary', 'view_payslip'])) {
              // Every employee on THIS screen is, by definition, affiliated
              // with the current company — this is the company's own
              // employee roster. So unlike the employee-facing screens
              // (home.tsx/clock-in.tsx/calculator.tsx, which also serve
              // independent/personal users), there's no "use the legacy
              // table" branch here at all: the modern SalaryStructure
              // system is always the right source. The legacy `salaries`
              // table (self-reported by employees on their own profile,
              // no sync to structure changes an employer makes) was never
              // the right source for THIS admin-facing compensation card.
              // `payType` tells the card how to present this employee's pay:
              // 'monthly' — paid a fixed monthly amount from the structure;
              // 'hourly'/'daily' — paid per unit of worked time, so we show the
              // per-day rate and the monthly equivalent instead of force-
              // labelling everything MONTHLY (the old hardcoded behaviour that
              // hid hourly/daily assignments).
              // Try the structure for EVERY employee on this company roster
              // (they are, by definition, affiliated with the current company
              // here), not just those whose Job.company_id happens to be set.
              // Employees auto-added via BRN or linked only through
              // private_user.company_id can still have a Job.company_id of
              // NULL — gating on it would silently skip their assigned
              // structure and show stale legacy data. The preview endpoint
              // tenant-scopes server-side by the employee's company, so this
              // is safe.
              let structureCompensation: {
                revenue: number;
                monthly_hours: number;
                payType: 'monthly' | 'hourly' | 'daily';
                rate?: number | null;
              } | null = null;
              if (hasCompanyPermission(currentUser, 'view_salary')) {
                const structRes = await salaryStructures.preview(emp.private_user.private_user_id);
                if (!('error' in structRes)) {
                  const basicComponent = structRes.components?.find(
                    (c) => c.kind === 'earning' && c.is_basic,
                  );
                  if (basicComponent) {
                    const allowanceTotal = (structRes.components ?? [])
                      .filter((c) => c.kind === 'earning' && !c.is_basic)
                      .reduce((sum, c) => sum + (parseFloat(String(c.amount)) || 0), 0);
                    // A daily-frequency structure resolves its basic pay at
                    // frequency 'daily' and exposes the per-day rate in meta.
                    const isDaily =
                      basicComponent.frequency === 'daily' ||
                      (basicComponent.meta as any)?.frequency === 'daily';
                    structureCompensation = {
                      revenue: (parseFloat(String(basicComponent.amount)) || 0) + allowanceTotal,
                      // No per-employee "monthly hours" field in the
                      // structure system — DEFAULT_MONTHLY_HOURS-equivalent.
                      monthly_hours: 195,
                      payType: isDaily ? 'daily' : 'monthly',
                      rate: isDaily
                        ? parseFloat(String((basicComponent.meta as any)?.rate)) || null
                        : null,
                    };
                  }
                }
              }
              // Active country assignment (mission / transfer) — display only.
              if (hasCompanyPermission(currentUser, 'view_salary')) {
                const locRes = await countryAssignments.active(emp.private_user.private_user_id);
                setActiveLocation(locRes && !('error' in locRes) ? locRes : null);
              } else {
                setActiveLocation(null);
              }
              if (structureCompensation) {
                setSalary(structureCompensation);
              } else if (!jobRes.company_id) {
                const salaryRes = await getSalaryByJobId(jobRes.job_id);
                if (!isApiError(salaryRes)) {
                  const legacy = salaryRes as any;
                  const pb = String(legacy.pay_basis || 'monthly').toLowerCase();
                  const rate =
                    pb === 'hourly'
                      ? legacy.hourly_rate != null ? parseFloat(legacy.hourly_rate) : null
                      : pb === 'daily'
                      ? legacy.daily_rate != null ? parseFloat(legacy.daily_rate) : null
                      : null;
                  setSalary({
                    ...salaryRes,
                    payType: pb === 'hourly' ? 'hourly' : pb === 'daily' ? 'daily' : 'monthly',
                    rate,
                  });
                } else {
                  setSalary(null);
                }
              } else {
                // Company employee with no structure configured yet — "not
                // set up" (renders the existing empty state below), not the
                // employee's own unrelated old profile entry.
                setSalary(null);
              }
            } else {
              setSalary(null);
            }
            // Fetch time logs
            if (hasCompanyPermission(currentUser, 'view_attendance')) {
              const timeLogsRes = await getTimeLogsByJob(jobRes.job_id);
              if (!isApiError(timeLogsRes)) {
                setTimeLogs(Array.isArray(timeLogsRes) ? timeLogsRes.slice(0, 10) : []);
              } else {
                setTimeLogs([]);
              }
            } else {
              setTimeLogs([]);
            }
          } else {
            setSalary(null);
            setTimeLogs([]);
          }
        } else {
          setJob(null);
          setSalary(null);
          setTimeLogs([]);
        }
      } else {
        setJob(null);
        setSalary(null);
        setTimeLogs([]);
      }
    } catch (err: any) {
      setError(err.message || t('employeeDetail.errLoadFailed'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [id, currentUser]);

  useEffect(() => {
    loadEmployeeDetails();
  }, [loadEmployeeDetails]);

  const onRefresh = () => {
    setRefreshing(true);
    loadEmployeeDetails(true);
  };

  const handleDeptChange = async (deptId: number) => {
    if (!employee || savingDept || selectedDeptId === deptId) return;
    setSavingDept(true);
    setSelectedDeptId(deptId);
    await patchUserDepartment(employee.user_id, deptId);
    setSavingDept(false);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('employeeDetail.goodMorning');
    if (hour < 18) return t('employeeDetail.goodAfternoon');
    return t('employeeDetail.goodEvening');
  };

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase() || 'U';
  };

  if (loading && !refreshing) {
    // Keep a back affordance mounted while data loads.
    return (
      <LinearGradient colors={[Palette.gray50, Palette.gray100]} style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }} edges={['top']}>
          <Box px="$5" pt="$2" pb="$4">
            <Pressable onPress={() => router.push('/company_dashboard/employees')}>
              <Box bg={Palette.gray100} p="$2" rounded="$full" borderWidth={1} borderColor={Palette.gray200} alignSelf="flex-start">
                <MaterialIcons name="arrow-back" size={24} color={Palette.ink} />
              </Box>
            </Pressable>
          </Box>
          <Box flex={1} justifyContent="center" alignItems="center">
            <Spinner size="large" color={Palette.gold} />
            <Text mt="$4" color={Palette.gray700} fontSize={Type.title} fontWeight="500">{t('employeeDetail.loading')}</Text>
          </Box>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  if (error || !employee) {
    return (
      <LinearGradient colors={[Palette.gray50, Palette.gray100]} style={{ flex: 1 }}>
        <SafeAreaView style={{ flex: 1 }}>
          <Box p="$6" flex={1} justifyContent="center" alignItems="center">
            <Box bg={Palette.white} p="$8" rounded={18} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2} borderWidth={1} borderColor={Palette.gray100} alignItems="center">
              <MaterialIcons name="error-outline" size={48} color={Palette.gray400} />
              <Text color={Palette.ink} fontSize={Type.h3} fontWeight="700" mt="$4" textAlign="center">
                {error || t('employeeDetail.errNotInCompany')}
              </Text>
              <Pressable mt="$6" onPress={() => router.back()} bg={Palette.ink} px="$6" py="$3" rounded={12}>
                <Text color={Palette.white} fontWeight="700">{t('employeeDetail.goBack')}</Text>
              </Pressable>
            </Box>
          </Box>
        </SafeAreaView>
      </LinearGradient>
    );
  }

  const employeeName = employee.private_user ? `${employee.private_user.first_name} ${employee.private_user.last_name}` : t('common.notAvailable');

  // Currency for the compensation card: the salary's own stored currency (now
  // correct per country), falling back to the company's operating currency —
  // no longer a hardcoded "MUR" prefix that was wrong for every non-MU company.
  const salaryCurrency = salary?.currency || currentUser?.company?.currency || 'MUR';

  // Pay type (monthly vs hourly/daily) is read from the assigned salary
  // structure (or the legacy salary's pay_basis as a fallback) so the card
  // always reflects what the employee is ACTUALLY paid, never a hardcoded
  // "MONTHLY" label.
  const payType: 'monthly' | 'hourly' | 'daily' = salary?.payType || 'monthly';
  const payIsHourly = payType === 'hourly';
  const payIsDaily = payType === 'daily';
  const payBadgeLabel = payIsHourly
    ? t('employeeDetail.hourly')
    : payIsDaily
    ? t('employeeDetail.daily')
    : t('employeeDetail.monthly');
  const payBadgeStyle =
    payIsHourly
      ? { bg: Palette.blueTint, text: Palette.blue }
      : payIsDaily
      ? { bg: Palette.tealTint, text: Palette.teal }
      : { bg: Palette.successTint, text: Palette.success };
  const perUnitRate = salary?.rate != null ? Number(salary.rate) : null;
  const payRateLabel = payIsHourly
    ? t('employeeDetail.hourlyRate')
    : payIsDaily
    ? t('employeeDetail.dailyRate')
    : t('employeeDetail.calculatedHourlyRate');

  return (
    <LinearGradient
      colors={[Palette.gray50, Palette.gray100, Palette.white]}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
        {/* Sticky Header */}
        <Box zIndex={50} overflow="hidden" borderBottomLeftRadius="$3xl" borderBottomRightRadius="$3xl">
          <BlurView intensity={Platform.OS === 'ios' ? 80 : 0} tint="light" style={{ width: '100%' }}>
            <Box bg={Platform.OS === 'android' ? Palette.white : 'rgba(255,255,255,0.6)'} px="$5" pt="$2" pb="$4">
              <HStack justifyContent="space-between" alignItems="center">
                <HStack space="md" alignItems="center" flex={1}>
                  <Pressable
                    onPress={() => router.push('/company_dashboard/employees')}
                    style={({ pressed }) => ({
                      opacity: pressed ? 0.7 : 1,
                      transform: [{ scale: pressed ? 0.95 : 1 }]
                    })}
                  >
                    <Box
                      bg={Palette.gray100}
                      p="$2"
                      rounded="$full"
                      borderWidth={1}
                      borderColor={Palette.gray200}
                    >
                      <MaterialIcons name="arrow-back" size={24} color={Palette.ink} />
                    </Box>
                  </Pressable>

                  <VStack flex={1}>
                    <HStack alignItems="center" space="xs" mb="$0.5">
                      <Text fontSize={Type.title} fontWeight="600" color={Palette.gray400}>
                        {getGreeting()},
                      </Text>
                      <Text fontSize={Type.title} fontWeight="700" color={Palette.ink} numberOfLines={1}>
                        {employee.private_user?.first_name || t('employeeDetail.employeeFallback')}
                      </Text>
                    </HStack>
                    <HStack alignItems="center" space="xs">
                      <Box bg={Palette.goldTint} px="$1.5" py="$0.5" rounded="$sm">
                        <Text fontSize={Type.tiny} fontWeight="700" color={Palette.gold} numberOfLines={1}>
                          {job?.job_title || t('employeeDetail.staff')}
                        </Text>
                      </Box>
                      <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="500" numberOfLines={1}>
                        • {departments.find(d => d.department_id === selectedDeptId)?.name || job?.department || t('employeeDetail.member')}
                      </Text>
                    </HStack>
                  </VStack>
                </HStack>

                {/* Right side - Avatar */}
                <Box
                  p="$0.5"
                  rounded="$full"
                  borderWidth={1.5}
                  borderColor={Palette.gray100}
                  bg={Palette.white}
                >
                  <Avatar size="sm" bgColor={Palette.indigo}>
                    <AvatarFallbackText>{getInitials(employee.private_user?.first_name || 'U', employee.private_user?.last_name || 'B')}</AvatarFallbackText>
                  </Avatar>
                </Box>
              </HStack>
            </Box>
          </BlurView>
        </Box>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Palette.gold} />
          }
        >
          <Animated.View entering={FadeInUp.duration(600).springify()}>
            {/* Quick Metrics */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 20, paddingVertical: 20 }}
            >
              <HStack space="md">
                <Box bg={Palette.white} p="$4" rounded={18} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2} borderWidth={1} borderColor={Palette.gray100} borderLeftWidth={4} borderLeftColor={Palette.blue} w={140}>
                  <MaterialIcons name="event-available" size={20} color={Palette.blue} />
                  <Text fontSize={Type.caption} color={Palette.gray500} mt="$2" fontWeight="700">{t('employeeDetail.joined')}</Text>
                  <Text fontSize={Type.body} fontWeight="700" color={Palette.ink} mt="$1">
                    {employee.private_user?.created_at ? format(new Date(employee.private_user.created_at), 'MMM d, yyyy') : t('common.notAvailable')}
                  </Text>
                </Box>

                <Box bg={Palette.white} p="$4" rounded={18} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2} borderWidth={1} borderColor={Palette.gray100} borderLeftWidth={4} borderLeftColor={Palette.violet} w={140}>
                  <MaterialIcons name="verified-user" size={20} color={Palette.violet} />
                  <Text fontSize={Type.caption} color={Palette.gray500} mt="$2" fontWeight="700">{t('employeeDetail.loginId')}</Text>
                  <Text fontSize={Type.body} fontWeight="700" color={Palette.ink} mt="$1">#{employee.user_id}</Text>
                </Box>

                <Box bg={Palette.white} p="$4" rounded={18} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2} borderWidth={1} borderColor={Palette.gray100} borderLeftWidth={4} borderLeftColor={Palette.success} w={140}>
                  <MaterialIcons name="category" size={20} color={Palette.success} />
                  <Text fontSize={Type.caption} color={Palette.gray500} mt="$2" fontWeight="700">{t('employeeDetail.department')}</Text>
                  <Text fontSize={Type.body} fontWeight="700" color={Palette.ink} mt="$1" numberOfLines={1}>
                    {departments.find(d => d.department_id === selectedDeptId)?.name || job?.department || t('employeeDetail.general')}
                  </Text>
                </Box>
              </HStack>
            </ScrollView>

            <VStack space="xl" px="$5">
              {/* Account not set up yet — re-issue the claim link (onboard_employee) */}
              {employee.user_verified === false && hasCompanyPermission(currentUser, 'onboard_employee') && (
                <Box bg={Palette.goldTint} px="$5" py="$4" rounded={18} borderWidth={1} borderColor={Palette.gold}>
                  <HStack space="md" alignItems="center" justifyContent="space-between">
                    <HStack space="sm" alignItems="center" flex={1}>
                      <MaterialIcons name="lock-clock" size={20} color={Palette.gold} />
                      <VStack flex={1}>
                        <Text fontSize={Type.body} fontWeight="700" color={Palette.ink}>
                          {t('employeeDetail.notClaimedTitle', "Hasn't set up their account")}
                        </Text>
                        <Text fontSize={Type.caption} color={Palette.gray600}>
                          {t('employeeDetail.notClaimedBody', 'Send a link to set a password and log in.')}
                        </Text>
                      </VStack>
                    </HStack>
                    <Pressable onPress={handleResendClaim} disabled={resending} bg={Palette.gold} px="$3" py="$2.5" rounded={12} opacity={resending ? 0.6 : 1}>
                      <Text fontSize={Type.caption} fontWeight="800" color={Palette.white}>
                        {resending ? t('common.sending', 'Sending…') : t('employeeDetail.resendLink', 'Resend link')}
                      </Text>
                    </Pressable>
                  </HStack>
                </Box>
              )}

              {/* Personal Information */}
              <Box bg={Palette.white} px="$5" py="$4" rounded={18} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2} borderWidth={1} borderColor={Palette.gray100}>
                <HStack justifyContent="space-between" alignItems="center" mb="$4">
                  <HStack space="sm" alignItems="center">
                    <Box style={{ backgroundColor: Palette.blue, borderRadius: 10, padding: 7 }}>
                      <MaterialIcons name="person" size={16} color={Palette.white} />
                    </Box>
                    <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink} letterSpacing={-0.3}>{t('employeeDetail.personalDetails')}</Text>
                  </HStack>
                </HStack>

                <VStack space="md">
                  <VStack>
                    <Text fontSize={Type.small} color={Palette.gray500} fontWeight="600">{t('employeeDetail.fullName')}</Text>
                    <Text fontSize={Type.body} fontWeight="600" color={Palette.ink} mt="$1">{employeeName}</Text>
                  </VStack>
                  <VStack>
                    <Text fontSize={Type.small} color={Palette.gray500} fontWeight="600">{t('employeeDetail.emailAddress')}</Text>
                    <Text fontSize={Type.body} fontWeight="600" color={Palette.ink} mt="$1">{employee.email}</Text>
                  </VStack>
                  <VStack>
                    <Text fontSize={Type.small} color={Palette.gray500} fontWeight="600">{t('employeeDetail.userType')}</Text>
                    <Badge bg={Palette.gray100} rounded="$full" alignSelf="flex-start" mt="$1" px="$3">
                      <BadgeText color={Palette.gray600} fontSize={Type.caption} fontWeight="700">{employee.user_type?.toUpperCase()}</BadgeText>
                    </Badge>
                  </VStack>
                </VStack>
              </Box>

              {/* Employment Information */}
              <Box bg={Palette.white} px="$5" py="$4" rounded={18} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2} borderWidth={1} borderColor={Palette.gray100}>
                <HStack justifyContent="space-between" alignItems="center" mb="$4">
                  <HStack space="sm" alignItems="center">
                    <Box style={{ backgroundColor: Palette.violet, borderRadius: 10, padding: 7 }}>
                      <MaterialIcons name="work" size={16} color={Palette.white} />
                    </Box>
                    <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink} letterSpacing={-0.3}>{t('employeeDetail.employment')}</Text>
                  </HStack>
                </HStack>

                <VStack space="md">
                  <VStack>
                    <Text fontSize={Type.small} color={Palette.gray500} fontWeight="600">{t('employeeDetail.jobTitle')}</Text>
                    <Text fontSize={Type.body} fontWeight="700" color={Palette.gold} mt="$1">{job?.job_title || t('employeeDetail.noJobDefined')}</Text>
                  </VStack>
                  <VStack>
                    <HStack justifyContent="space-between" alignItems="center" mb="$2">
                      <Text fontSize={Type.small} color={Palette.gray500} fontWeight="600">{t('employeeDetail.department')}</Text>
                      {savingDept && <Spinner size="small" color={Palette.success} />}
                    </HStack>
                    {departments.length > 0 ? (
                      <HStack flexWrap="wrap" space="sm">
                        {departments.map(dept => {
                          const active = selectedDeptId === dept.department_id;
                          return (
                            <Pressable key={dept.department_id} onPress={() => handleDeptChange(dept.department_id)}>
                              <Box
                                px="$3" py="$1.5" mb="$2" rounded="$full" borderWidth={1.5}
                                bg={active ? Palette.success : Palette.white}
                                borderColor={active ? Palette.success : Palette.gray200}
                              >
                                <Text fontSize={Type.label} fontWeight="700" color={active ? Palette.white : Palette.gray600}>
                                  {dept.name}
                                </Text>
                              </Box>
                            </Pressable>
                          );
                        })}
                      </HStack>
                    ) : (
                      <Text fontSize={Type.body} fontWeight="600" color={Palette.ink}>{job?.department || t('common.notAvailable')}</Text>
                    )}
                  </VStack>
                  {job?.location && (
                    <VStack>
                      <Text fontSize={Type.small} color={Palette.gray500} fontWeight="600">{t('employeeDetail.primaryLocation')}</Text>
                      <HStack space="xs" alignItems="center" mt="$1">
                        <MaterialIcons name="location-on" size={16} color={Palette.gray400} />
                        <Text fontSize={Type.body} fontWeight="600" color={Palette.ink} flex={1}>{job.location}</Text>
                      </HStack>
                    </VStack>
                  )}
                </VStack>
              </Box>

              {/* Active mission / transfer banner */}
              {activeLocation ? (
                <Box bg={Palette.blueTint} px="$5" py="$4" rounded={18} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2} borderWidth={1} borderColor={Palette.blue}>
                  <HStack space="sm" alignItems="center">
                    <Box style={{ backgroundColor: Palette.blue, borderRadius: 10, padding: 7 }}>
                      <MaterialIcons name="flight-takeoff" size={16} color={Palette.white} />
                    </Box>
                    <VStack flex={1}>
                      <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink} letterSpacing={-0.3}>{t('employeeDetail.activeMission')}</Text>
                      <Text fontSize={Type.body} fontWeight="600" color={Palette.ink} mt="$1">
                        {activeLocation.country_name || activeLocation.country_code}
                        {activeLocation.country_currency ? ` · ${activeLocation.country_currency}` : ''}
                      </Text>
                      {activeLocation.effective_from && (
                        <Text fontSize={Type.tiny} color={Palette.gray500} mt="$1">
                          {t('employeeDetail.missionSince')} {format(new Date(activeLocation.effective_from), 'dd MMM yyyy')}
                        </Text>
                      )}
                    </VStack>
                  </HStack>
                </Box>
              ) : null}

              {/* Financial Information */}
              {salary ? (
                <Box bg={Palette.white} px="$5" py="$4" rounded={18} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2} borderWidth={1} borderColor={Palette.gray100}>
                  <HStack justifyContent="space-between" alignItems="center" mb="$4">
                    <HStack space="sm" alignItems="center">
                      <Box style={{ backgroundColor: Palette.success, borderRadius: 10, padding: 7 }}>
                        <MaterialIcons name="payments" size={16} color={Palette.white} />
                      </Box>
                      <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink} letterSpacing={-0.3}>{t('employeeDetail.compensation')}</Text>
                    </HStack>
                    <Badge bg={payBadgeStyle.bg} rounded="$full">
                      <BadgeText color={payBadgeStyle.text} fontSize={Type.tiny} fontWeight="700">{payBadgeLabel}</BadgeText>
                    </Badge>
                  </HStack>

                  <VStack space="md">
                    {payIsHourly || payIsDaily ? (
                      <>
                        <Box bg={Palette.gray50} p="$4" rounded={14} borderLeftWidth={4} borderLeftColor={payBadgeStyle.text}>
                          <HStack justifyContent="space-between" alignItems="center">
                            <VStack>
                              <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="700">{payRateLabel}</Text>
                              <Text fontSize={Type.h2} fontWeight="700" color={Palette.ink} mt="$1">
                                {salaryCurrency} {perUnitRate != null ? perUnitRate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                              </Text>
                            </VStack>
                            <MaterialIcons name="trending-up" size={24} color={payBadgeStyle.text} />
                          </HStack>
                        </Box>

                        <Box bg={Palette.gray50} p="$4" rounded={14} borderLeftWidth={4} borderLeftColor={Palette.teal}>
                          <HStack justifyContent="space-between" alignItems="center">
                            <VStack>
                              <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="700">{t('employeeDetail.monthlyEquivalent')}</Text>
                              <Text fontSize={Type.h2} fontWeight="700" color={Palette.ink} mt="$1">
                                {salaryCurrency} {Number(salary.revenue || 0).toLocaleString()}
                              </Text>
                            </VStack>
                            <MaterialIcons name="account-balance-wallet" size={24} color={Palette.teal} />
                          </HStack>
                        </Box>
                      </>
                    ) : (
                      <>
                        <Box bg={Palette.gray50} p="$4" rounded={14} borderLeftWidth={4} borderLeftColor={Palette.success}>
                          <HStack justifyContent="space-between" alignItems="center">
                            <VStack>
                              <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="700">{t('employeeDetail.monthlyRevenue')}</Text>
                              <Text fontSize={Type.h2} fontWeight="700" color={Palette.ink} mt="$1">
                                {salaryCurrency} {Number(salary.revenue || 0).toLocaleString()}
                              </Text>
                            </VStack>
                            <MaterialIcons name="account-balance-wallet" size={24} color={Palette.success} />
                          </HStack>
                        </Box>

                        <Box bg={Palette.gray50} p="$4" rounded={14} borderLeftWidth={4} borderLeftColor={Palette.teal}>
                          <HStack justifyContent="space-between" alignItems="center">
                            <VStack>
                              <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="700">{t('employeeDetail.targetWorkHours')}</Text>
                              <Text fontSize={Type.h2} fontWeight="700" color={Palette.ink} mt="$1">
                                {Number(salary.monthly_hours || 0).toLocaleString()} {t('employeeDetail.hrs')}
                              </Text>
                            </VStack>
                            <MaterialIcons name="timer" size={24} color={Palette.teal} />
                          </HStack>
                        </Box>

                        <Box bg={Palette.successTint} p="$5" rounded={14} borderStyle="dashed" borderWidth={1} borderColor={Palette.success}>
                          <VStack space="xs">
                            <HStack justifyContent="space-between" alignItems="center">
                              <Text fontSize={Type.label} color={Palette.success} fontWeight="600">{t('employeeDetail.calculatedHourlyRate')}</Text>
                              <MaterialIcons name="trending-up" size={18} color={Palette.success} />
                            </HStack>
                            <Text fontSize={Type.h1} fontWeight="700" color={Palette.success} mt="$1">
                              {salaryCurrency} {salary.revenue && salary.monthly_hours ? (salary.revenue / salary.monthly_hours).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0.00'}
                              <Text fontSize={Type.body} color={Palette.success} fontWeight="500"> {t('employeeDetail.perHr')}</Text>
                            </Text>
                            <Text fontSize={Type.tiny} color={Palette.gray400}>{t('employeeDetail.rateDerived')}</Text>
                          </VStack>
                        </Box>
                      </>
                    )}
                  </VStack>
                </Box>
              ) : (
                <Box bg={Palette.white} p="$6" rounded={18} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2} borderWidth={1} borderColor={Palette.gray100} alignItems="center">
                  <MaterialIcons name="money-off" size={32} color={Palette.gray300} />
                  <Text color={Palette.gray500} mt="$2" fontSize={Type.body}>{t('employeeDetail.noCompensation')}</Text>
                </Box>
              )}

              {/* Clock-In Records */}
              {timeLogs.length > 0 && (
                <Box bg={Palette.white} px="$5" py="$4" rounded={18} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2} borderWidth={1} borderColor={Palette.gray100}>
                  <HStack justifyContent="space-between" alignItems="center" mb="$4">
                    <HStack space="sm" alignItems="center">
                      <Box style={{ backgroundColor: Palette.gold, borderRadius: 10, padding: 7 }}>
                        <MaterialIcons name="access-time" size={16} color={Palette.white} />
                      </Box>
                      <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink} letterSpacing={-0.3}>{t('employeeDetail.recentAttendance')}</Text>
                    </HStack>
                    <Badge bg={Palette.goldTint} rounded="$full">
                      <BadgeText color={Palette.gold} fontSize={Type.tiny} fontWeight="700">{t('employeeDetail.lastNDays', { count: timeLogs.length })}</BadgeText>
                    </Badge>
                  </HStack>

                  <VStack space="sm">
                    {timeLogs.map((log, index) => {
                      const startTime = log.start_time ? new Date(log.start_time) : null;
                      const endTime = log.end_time ? new Date(log.end_time) : null;
                      const duration = startTime && endTime ? ((endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60)).toFixed(1) : null;

                      return (
                        <Box
                          key={log.time_log_id || index}
                          bg={Palette.gray50}
                          p="$4"
                          rounded={14}
                          borderLeftWidth={3}
                          borderLeftColor={endTime ? Palette.success : Palette.gold}
                        >
                          <HStack justifyContent="space-between" alignItems="center">
                            <VStack flex={1}>
                              <Text fontSize={Type.label} fontWeight="700" color={Palette.ink}>
                                {startTime ? format(startTime, 'MMM d, yyyy') : t('common.notAvailable')}
                              </Text>
                              <HStack space="md" mt="$1">
                                <HStack space="xs" alignItems="center">
                                  <MaterialIcons name="login" size={14} color={Palette.success} />
                                  <Text fontSize={Type.small} color={Palette.gray600}>
                                    {startTime ? format(startTime, 'h:mm a') : t('common.notAvailable')}
                                  </Text>
                                </HStack>
                                {endTime && (
                                  <>
                                    <Text fontSize={Type.small} color={Palette.gray400}>→</Text>
                                    <HStack space="xs" alignItems="center">
                                      <MaterialIcons name="logout" size={14} color={Palette.error} />
                                      <Text fontSize={Type.small} color={Palette.gray600}>
                                        {format(endTime, 'h:mm a')}
                                      </Text>
                                    </HStack>
                                  </>
                                )}
                              </HStack>
                            </VStack>
                            {duration && (
                              <Box bg={Palette.goldTint} px="$3" py="$1.5" rounded={10}>
                                <Text fontSize={Type.caption} fontWeight="700" color={Palette.gold}>
                                  {duration}h
                                </Text>
                              </Box>
                            )}
                            {!endTime && (
                              <Badge bg={Palette.goldTint} rounded="$full" px="$2">
                                <BadgeText color={Palette.gold} fontSize={Type.tiny} fontWeight="700">{t('employeeDetail.inProgress')}</BadgeText>
                              </Badge>
                            )}
                          </HStack>
                        </Box>
                      );
                    })}
                  </VStack>
                </Box>
              )}
            </VStack>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}