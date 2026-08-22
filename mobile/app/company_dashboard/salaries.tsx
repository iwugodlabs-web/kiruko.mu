import PermissionGate from '@/components/PermissionGate';
import { hasCompanyPermission } from '@/services/permissions';
import { Palette, Type } from '@/app/constants/theme';
import {
  getCompanySalaryEarnings,
  getUserTimeLogs,
  isApiError,
  isPermissionDeniedError,
  User,
  type PayrollFormulaPayload
} from '@/services/api';
// import { applyFormula, getPeriodRange } from '@/utils/payrollFormula';

import { MaterialIcons } from '@expo/vector-icons';
import {
  Badge,
  BadgeText,
  Box,
  Button,
  ButtonText,
  Heading,
  HStack,
  Input,
  InputField,
  InputSlot,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalContent,
  Pressable,
  ScrollView,
  Spinner,
  Text,
  Toast,
  ToastDescription,
  ToastTitle,
  useToast,
  VStack,
  Avatar,
  AvatarFallbackText
} from '@gluestack-ui/themed';
import { useFocusEffect } from '@react-navigation/native';
import { format } from 'date-fns';
import * as FileSystem from 'expo-file-system';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import * as Sharing from 'expo-sharing';
import { MotiView } from 'moti';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, FlatList, RefreshControl, Platform, LayoutAnimation, UIManager } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import useAuth from '../hooks/useAuth';
import useCurrency from '../hooks/useCurrency';
import { useTranslation } from 'react-i18next';
import PayrollGuide, { hasSeenPayrollGuide } from '@/components/PayrollGuide';

// Enable LayoutAnimation for Android
if (Platform.OS === 'android') {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

interface EmployeeFinancials {
  id: number;
  jobId: number;
  name: string;
  department: string;
  position: string;
  totalIncome: number;
  estimatedEarnings: number;
  totalHoursWorked?: number;
  hourlyRate?: number;
  monthlyHours?: number;
  // Breakdown
  regularPay: number;
  overtimePay: number;
  holidayPay: number;
  overtimeHours: number;
}

interface TimeLogForDetails {
  timelog_id: number;
  start_time?: string | null;
  end_time?: string | null;
  hours_worked?: number | null;
  created_at: string;
}

// Function to determine border color based on financial health
const getBorderColor = (income: number, estimated: number) => {
  if (income === 0) return Palette.gray500;
  const ratio = estimated / income;
  if (ratio >= 0.9) return Palette.success;
  if (ratio >= 0.7) return Palette.gold;
  return Palette.error;
};


const getInitials = (name: string) => {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
};

// Toggle for the salary "Dashboard Locked" gate. true = require the tap-to-unlock
// confirmation before revealing pay data (privacy: stops shoulder-surfing). Set
// to false to open the screen directly (e.g. during the pilot) — flip back to
// re-enable, no other changes needed.
const SALARY_LOCK_ENABLED = true;

export default function Salaries() {
  return (
    <PermissionGate permission={['view_salary', 'view_payslip', 'manage_payroll']} label="salaries">
      <SalariesInner />
    </PermissionGate>
  );
}

function SalariesInner() {
  const router = useRouter();
  const { user } = useAuth();
  const { formatCurrency } = useCurrency();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [guideVisible, setGuideVisible] = useState(false);

  // Show payroll figures in the company's own operating currency (MUR, TZS, …),
  // NOT the device display-currency preference — and with NO FX conversion, so
  // amounts stay exactly what payroll computed. `user.company.currency` is
  // derived server-side from the company's country; falls back to the formatter
  // default only for delegated accounts whose User has no nested company record.
  const companyCurrency = user?.company?.currency || undefined;
  const money = useCallback(
    (amount: number, opts?: { minimumFractionDigits?: number; maximumFractionDigits?: number }) =>
      formatCurrency(amount, { currencyCode: companyCurrency, convert: false, ...opts }),
    [formatCurrency, companyCurrency],
  );

  // Greeting — localized, matches the pattern in company_dashboard/time_logs.tsx.
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('companyTimeLogs.greetingMorning');
    if (hour < 18) return t('companyTimeLogs.greetingAfternoon');
    return t('companyTimeLogs.greetingEvening');
  };

  // Company-admin accounts have no `private_user` — check company_name too,
  // not just the (nonexistent) top-level user.first_name.
  const displayName = user?.private_user?.first_name || user?.company?.company_name || 'User';

  useEffect(() => {
    void (async () => {
      if (!(await hasSeenPayrollGuide())) setGuideVisible(true);
    })();
  }, []);
  const [unlocked, setUnlocked] = useState(!SALARY_LOCK_ENABLED);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('');
  const [sortBy, setSortBy] = useState('name');
  const [employees, setEmployees] = useState<EmployeeFinancials[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const [selectedEmployee, setSelectedEmployee] = useState<EmployeeFinancials | null>(null);
  const [isDetailModalVisible, setDetailModalVisible] = useState(false);
  const [employeeTimeLogs, setEmployeeTimeLogs] = useState<TimeLogForDetails[]>([]);
  const [isFetchingLogs, setIsFetchingLogs] = useState(false);

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    if (employees.length === 0) {
      return {
        totalEmployees: 0,
        totalPayroll: 0,
        totalEstimated: 0,
        onTrack: 0,
        atRisk: 0,
        critical: 0,
      };
    }

    const totalPayroll = employees.reduce((sum, emp) => sum + emp.totalIncome, 0);
    const totalEstimated = employees.reduce((sum, emp) => sum + emp.estimatedEarnings, 0);

    let onTrack = 0, atRisk = 0, critical = 0;

    employees.forEach(emp => {
      if (emp.totalIncome === 0) return;
      const ratio = emp.estimatedEarnings / emp.totalIncome;
      if (ratio >= 0.9) onTrack++;
      else if (ratio >= 0.7) atRisk++;
      else critical++;
    });

    return { totalEmployees: employees.length, totalPayroll, totalEstimated, onTrack, atRisk, critical };
  }, [employees]);

  // Get unique departments for filter dropdown
  const departments = useMemo(() => {
    const uniqueDepts = [...new Set(employees.map(emp => emp.department))];
    return uniqueDepts.sort();
  }, [employees]);

  // Filter and sort employees based on search and filters
  const filteredEmployees = useMemo(() => {
    let filtered = employees.filter(emp => {
      const matchesSearch = emp.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.department.toLowerCase().includes(searchQuery.toLowerCase()) ||
        emp.position.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesDepartment = filterDepartment === '' || emp.department === filterDepartment;
      return matchesSearch && matchesDepartment;
    });

    // Sort employees
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'income':
          return b.totalIncome - a.totalIncome;
        case 'expenses':
          return b.estimatedEarnings - a.estimatedEarnings;
        case 'department':
          return a.department.localeCompare(b.department);
        default:
          return 0;
      }
    });

    return filtered;
  }, [employees, searchQuery, filterDepartment, sortBy]);

  const handleEmployeePress = async (employee: EmployeeFinancials) => {
    if (!employee) return;
    setSelectedEmployee(employee);
    setDetailModalVisible(true);
    setIsFetchingLogs(true);
    setEmployeeTimeLogs([]);

    try {
      // Time logs need view_attendance; a salary-only role doesn't have it, so
      // skip the fetch (and the 403 + error toast) and just show salary detail.
      if (!hasCompanyPermission(user, 'view_attendance')) {
        setEmployeeTimeLogs([]);
        return;
      }
      const response = await getUserTimeLogs(employee.id);
      if (isApiError(response)) {
        if (isPermissionDeniedError(response)) {
          // Backend denied attendance despite the client check (e.g. a stale
          // grant) — show empty time logs quietly, no alarming error toast.
          setEmployeeTimeLogs([]);
          return;
        }
        console.error("Failed to fetch time logs:", response.error);
        toast.show({
          placement: 'top',
          render: ({ id }) => (
            <Toast nativeID={id} action="error" variant="solid">
              <VStack space="xs">
                <ToastTitle>{t('common.errorTitle')}</ToastTitle>
                <ToastDescription>{t('payroll.toastFetchLogsFailedBody')}</ToastDescription>
              </VStack>
            </Toast>
          ),
        });
        setEmployeeTimeLogs([]);
      } else {
        const logs = response as unknown as TimeLogForDetails[];
        const sortedLogs = logs.sort((a, b) =>
          new Date(b.start_time || b.created_at).getTime() - new Date(a.start_time || a.created_at).getTime()
        );
        setEmployeeTimeLogs(sortedLogs);
      }
    } catch (e) {
      console.error("Error in handleEmployeePress:", e);
    } finally {
      setIsFetchingLogs(false);
    }
  };

  const handleExport = async () => {
    if (filteredEmployees.length === 0) {
      toast.show({
        placement: 'top',
        render: ({ id }) => (
          <Toast nativeID={id} action="warning" variant="solid">
            <VStack space="xs">
              <ToastTitle>{t('payroll.toastNoDataTitle')}</ToastTitle>
              <ToastDescription>{t('payroll.toastNoDataBody')}</ToastDescription>
            </VStack>
          </Toast>
        ),
      });
      return;
    }

    // Uses the component-scope `companyCurrency` (the company's operating
    // currency, e.g. MUR/TZS). A delegated employee's User object has no nested
    // company record today, so this falls back to an unlabeled column rather
    // than guessing — an honest "no unit shown" beats a wrong one.
    const currencyLabel = companyCurrency ? ` (${companyCurrency})` : '';
    const header = `ID,Name,Department,Position,Total Income${currencyLabel},Estimated Earnings${currencyLabel}\n`;
    const rows = filteredEmployees
      .map(emp =>
        [
          emp.id,
          `"${emp.name.replace(/"/g, '""')}"`, // Handle quotes in names
          `"${emp.department.replace(/"/g, '""')}"`,
          `"${emp.position.replace(/"/g, '""')}"`,
          emp.totalIncome,
          emp.estimatedEarnings.toFixed(2),
        ].join(',')
      )
      .join('\n');

    const csvString = `${header}${rows}`;
    const filename = `salaries_export_${new Date().toISOString().split('T')[0]}.csv`;
    const fileUri = FileSystem.cacheDirectory + filename;

    try {
      await FileSystem.writeAsStringAsync(fileUri, csvString, {
        encoding: FileSystem.EncodingType.UTF8,
      });

      if (!(await Sharing.isAvailableAsync())) {
        throw new Error('Sharing is not available on this device.');
      }

      await Sharing.shareAsync(fileUri, {
        mimeType: 'text/csv',
        dialogTitle: 'Export Salary Data',
        UTI: 'public.comma-separated-values-text',
      });
    } catch (error: any) {
      console.error('Failed to export CSV', error);
      toast.show({
        placement: 'top',
        render: ({ id }) => (
          <Toast nativeID={id} action="error" variant="solid">
            <VStack space="xs">
              <ToastTitle>{t('payroll.toastExportFailedTitle')}</ToastTitle>
              <ToastDescription>{error.message || t('payroll.toastExportFailedBody')}</ToastDescription>
            </VStack>
          </Toast>
        ),
      });
    }
  };

  const fetchEmployeeData = useCallback(async (isRefresh = false) => {
    if (__DEV__) console.log('[SALARIES] fetchEmployeeData called', { unlocked, isRefresh });

    if (!unlocked) {
      if (__DEV__) console.log('[SALARIES] Blocked: not unlocked');
      return;
    }

    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setIsLoading(true);
      }

      setError(null);

      // Fetch all necessary data in parallel
      // For company-type users, get company_id from user.company
      // For employee-type users, get company_id from user.private_user
      const companyId = user?.user_type === 'company'
        ? user?.company?.company_id
        : user?.private_user?.company_id;

      if (__DEV__) console.log('[SALARIES] Company ID:', companyId, 'User type:', user?.user_type);

      if (!companyId) {
        if (__DEV__) console.log('[SALARIES] Blocked: no company ID');
        setEmployees([]);
        setIsLoading(false);
        setRefreshing(false);
        return;
      }

      // Was previously: 3 setup calls + a per-employee salary-structure
      // preview call + a per-job salary/time-log call each — 60-90+ HTTP
      // requests for a 30-employee company, queued behind RN's ~6
      // concurrent-connections-per-host cap (the actual cause of the slow
      // load). Now one call: the backend resolves structure/legacy income,
      // department, and time-log-based regular/OT/holiday pay for every
      // employee in one request (GET /job/salary/company/{id}/earnings).
      const earningsRes = await getCompanySalaryEarnings(companyId);
      if (isApiError(earningsRes)) throw new Error(earningsRes.error);

      // Previously excluded `user?.private_user?.private_user_id` here,
      // intending to hide the OWNER's own row. That was always a no-op for a
      // real owner (user_type='company' accounts have no private_user at
      // all, so private_user_id is undefined and never matches any row) —
      // its only real effect was hiding a delegated employee's OWN
      // legitimate salary row when they view this screen after switching
      // into employer mode (e.g. an HR-role employee searching for
      // themselves and getting "No employees found"). Removed.
      setEmployees(earningsRes as EmployeeFinancials[]);

    } catch (e: any) {
      setError(e.message || 'Failed to fetch employee data.');
      console.error(e);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [unlocked]);

  // Fetch when unlocked changes to true
  useEffect(() => {
    if (unlocked) fetchEmployeeData();
  }, [unlocked, fetchEmployeeData]);

  // Refresh when screen gains focus
  useFocusEffect(
    useCallback(() => {
      if (unlocked) fetchEmployeeData();
    }, [unlocked, fetchEmployeeData])
  );

  const renderEmployeeItem = ({ item: emp, index: i }: { item: EmployeeFinancials; index: number }) => {
    const borderColor = getBorderColor(emp.totalIncome, emp.estimatedEarnings);
    const healthStatus = emp.totalIncome === 0 ? 'info' :
      (emp.estimatedEarnings / emp.totalIncome >= 0.9) ? 'success' :
        (emp.estimatedEarnings / emp.totalIncome >= 0.7) ? 'warning' : 'error';

    const healthLabel = emp.totalIncome === 0 ? 'NO DATA' :
      (emp.estimatedEarnings / emp.totalIncome >= 0.9) ? 'ON TRACK' :
        (emp.estimatedEarnings / emp.totalIncome >= 0.7) ? 'AT RISK' : 'CRITICAL';

    return (
      <MotiView
        key={emp.id}
        from={{ opacity: 0, translateY: 20 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ type: 'timing', duration: 400, delay: i * 50 }}
      >
        <Pressable onPress={() => handleEmployeePress(emp)}>
          <Box
            bg={Palette.white}
            mx="$5"
            mb="$4"
            p="$4"
            rounded="$3xl"
            borderWidth={1}
            borderColor={Palette.gray100}
            shadowColor={Palette.black}
            shadowOffset={{ width: 0, height: 4 }}
            shadowOpacity={0.04}
            shadowRadius={12}
            elevation={3}
          >
            <VStack space="md">
              <HStack justifyContent="space-between" alignItems="center">
                <HStack space="md" alignItems="center">
                  <Box
                    p="$0.5"
                    rounded="$full"
                    borderWidth={1.5}
                    borderColor={Palette.gray100}
                  >
                    <Avatar size="md" bg={Palette.gold}>
                      <AvatarFallbackText>{getInitials(emp.name)}</AvatarFallbackText>
                    </Avatar>
                  </Box>
                  <VStack>
                    <Heading size="sm" color={Palette.ink} fontWeight="700">
                      {emp.name}
                    </Heading>
                    <Text fontSize={Type.small} color={Palette.gray500} fontWeight="500">
                      {emp.position}
                    </Text>
                  </VStack>
                </HStack>
                <Badge
                  action={healthStatus}
                  variant="solid"
                  rounded="$full"
                  size="sm"
                  px="$3"
                >
                  <BadgeText fontSize={Type.tiny} fontWeight="700">
                    {healthLabel}
                  </BadgeText>
                </Badge>
              </HStack>

              {/* Financial Progress Section */}
              <Box bg={Palette.gray50} p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.gray100}>
                <VStack space="md">
                  <HStack justifyContent="space-between" alignItems="flex-end">
                    <VStack space="xs">
                      <Text fontSize={Type.caption} fontWeight="600" color={Palette.gray500} letterSpacing={0.5}>
                        {t('payroll.estimatedEarnings').toUpperCase()}
                      </Text>
                      <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink}>
                        {money(Math.round(emp.estimatedEarnings))}
                      </Text>
                    </VStack>
                    <VStack alignItems="flex-end" space="xs">
                      <Pressable
                        onPress={() => Alert.alert(t('payroll.profileRevenue'), t('payroll.profileRevenueHint'))}
                        hitSlop={8}
                      >
                        <HStack alignItems="center" space="xs">
                          <Text fontSize={Type.caption} fontWeight="600" color={Palette.gray500} letterSpacing={0.5}>
                            {t('payroll.profileRevenue').toUpperCase()}
                          </Text>
                          <Text fontSize={Type.tiny} color={Palette.gray400}>ⓘ</Text>
                        </HStack>
                      </Pressable>
                      <Text fontSize={Type.title} fontWeight="700" color={healthStatus === 'error' ? Palette.error : healthStatus === 'warning' ? Palette.gold : Palette.success}>
                        {money(Math.round(emp.totalIncome))}
                      </Text>
                    </VStack>
                  </HStack>

                  <Box h="$2" bg={Palette.gray200} rounded="$full" overflow="hidden">
                    <Box
                      h="100%"
                      w={`${Math.min((emp.estimatedEarnings / (emp.totalIncome || 1)) * 100, 100)}%`}
                      bg={healthStatus === 'error' ? Palette.error : healthStatus === 'warning' ? Palette.warning : Palette.teal}
                    />
                  </Box>

                  {/* Breakdown Section */}
                  {(emp.overtimePay > 0 || emp.holidayPay > 0) && (
                    <VStack space="xs" bg={Palette.gray50} p="$2" rounded="$lg">
                      <HStack justifyContent="space-between">
                        <Text fontSize={Type.tiny} color={Palette.gray500}>Regular Pay</Text>
                        <Text fontSize={Type.tiny} fontWeight="600" color={Palette.gray700}>{money(Math.round(emp.regularPay))}</Text>
                      </HStack>
                      {emp.overtimePay > 0 && (
                        <HStack justifyContent="space-between">
                          <Text fontSize={Type.tiny} color={Palette.gray500}>Overtime Pay ({emp.overtimeHours.toFixed(1)}h)</Text>
                          <Text fontSize={Type.tiny} fontWeight="600" color={Palette.warning}>+ {money(Math.round(emp.overtimePay))}</Text>
                        </HStack>
                      )}
                      {emp.holidayPay > 0 && (
                        <HStack justifyContent="space-between">
                          <Text fontSize={Type.tiny} color={Palette.gray500}>Holiday Pay</Text>
                          <Text fontSize={Type.tiny} fontWeight="600" color={Palette.violet}>+ {money(Math.round(emp.holidayPay))}</Text>
                        </HStack>
                      )}
                    </VStack>
                  )}

                  <HStack justifyContent="space-between">
                    <HStack space="xs" alignItems="center">
                      <MaterialIcons name="schedule" size={14} color={Palette.gray500} />
                      <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="500">
                        {emp.totalHoursWorked?.toFixed(1) || '0'} hrs clocked
                      </Text>
                    </HStack>
                    <HStack space="xs" alignItems="center">
                      <MaterialIcons name="payments" size={14} color={Palette.gray500} />
                      <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="500">
                        {money(Number((emp.hourlyRate || 0).toFixed(1)))}/hr
                      </Text>
                    </HStack>
                  </HStack>
                </VStack>
              </Box>
            </VStack>
          </Box>
        </Pressable>
      </MotiView>
    );
  };

  return (
    <LinearGradient
      colors={[Palette.gray50, Palette.gray100, Palette.white]}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        {/* Sticky Header */}
        <Box zIndex={50} overflow="hidden" borderBottomLeftRadius="$3xl" borderBottomRightRadius="$3xl">
          <BlurView intensity={Platform.OS === 'ios' ? 80 : 0} tint="light" style={{ width: '100%' }}>
            <Box bg={Platform.OS === 'android' ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.6)'} px="$5" pt="$2" pb="$4">
              <HStack justifyContent="space-between" alignItems="center">
                <VStack>
                  <HStack alignItems="center" space="xs" mb="$1">
                    <Text fontSize={Type.h3} fontWeight="600" color={Palette.gray400}>
                      {getGreeting()},
                    </Text>
                    <Text fontSize={Type.h3} fontWeight="700" color={Palette.ink}>
                      {displayName}
                    </Text>
                  </HStack>
                  <HStack alignItems="center" space="xs">
                    <Box bg={Palette.goldTint} px="$2" py="$1" rounded="$md">
                      <Text fontSize={Type.caption} fontWeight="700" color={Palette.gold} letterSpacing={0.5}>
                        {format(new Date(), 'EEEE, MMM d').toUpperCase()}
                      </Text>
                    </Box>
                    <Text fontSize={Type.caption} color={Palette.gray400}>
                      • {t('payroll.earningsTrackerTitle')}
                    </Text>
                  </HStack>
                  {/* Re-open the payroll guide on demand (auto-shows once). */}
                  <Pressable onPress={() => setGuideVisible(true)} hitSlop={6} style={{ marginTop: 4 }}>
                    <Text fontSize={Type.caption} fontWeight="700" color={Palette.gold} style={{ textDecorationLine: 'underline' }}>
                      {t('payroll.guide.title')}
                    </Text>
                  </Pressable>
                </VStack>

                {/* Right side - Avatar */}
                <Pressable onPress={() => fetchEmployeeData(true)} opacity={refreshing ? 0.5 : 1}>
                  <Box
                    p="$1"
                    rounded="$full"
                    borderWidth={2}
                    borderColor={Palette.gray100}
                    bg={Palette.white}
                    shadowColor={Palette.black}
                    shadowOffset={{ width: 0, height: 2 }}
                    shadowOpacity={0.1}
                    shadowRadius={4}
                    elevation={2}
                  >
                    <Avatar size="md" bgColor={Palette.indigo}>
                      <AvatarFallbackText>{getInitials(displayName)}</AvatarFallbackText>
                    </Avatar>
                  </Box>
                </Pressable>
              </HStack>
            </Box>
          </BlurView>
        </Box>

        {/* Main Content */}
        <Box flex={1}>
          {!unlocked ? (
            <Box flex={1} justifyContent="center" alignItems="center" px="$8">
              <VStack space="xl" alignItems="center">
                <Box bg={Palette.gray100} p="$8" rounded="$full" borderWidth={1} borderColor={Palette.gray200}>
                  <MaterialIcons name="lock" size={64} color={Palette.gray400} />
                </Box>
                <VStack space="xs" alignItems="center">
                  <Text fontSize={Type.h3} fontWeight="700" color={Palette.ink} textAlign="center">Dashboard Locked</Text>
                  <Text fontSize={Type.body} color={Palette.gray500} textAlign="center">Access requires authorization.</Text>
                </VStack>
                <Button
                  size="xl"
                  action="primary"
                  onPress={() => setUnlocked(true)}
                  bg={Palette.gold}
                  rounded="$full"
                  px="$8"
                  shadowColor={Palette.gold}
                  shadowOffset={{ width: 0, height: 4 }}
                  shadowOpacity={0.3}
                  shadowRadius={8}
                  elevation={5}
                >
                  <ButtonText fontWeight="700">{t("payroll.unlockDashboard")}</ButtonText>
                  <Box ml="$2"><MaterialIcons name="lock-open" size={20} color={Palette.white} /></Box>
                </Button>
              </VStack>
            </Box>
          ) : (
            <FlatList
              data={filteredEmployees}
              keyExtractor={(item) => item.id.toString()}
              renderItem={renderEmployeeItem}
              contentContainerStyle={{ paddingBottom: 100, paddingTop: 16 }}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={() => fetchEmployeeData(true)} tintColor={Palette.gold} />
              }
              ListHeaderComponent={
                <VStack space="xl" px="$5" pt="$2" pb="$4">
                  {/* Summary Dashboard */}
                  <MotiView
                    from={{ opacity: 0, translateY: -10 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ type: 'timing', duration: 400 }}
                  >
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20 }}>
                      <HStack space="md">
                        {/* Total Payroll Card */}
                        <Box
                          bg={Palette.blueTint} p="$4" rounded="$2xl" width={160}
                          borderWidth={1} borderColor={Palette.blue + '22'}
                          shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.03} shadowRadius={8} elevation={2}
                        >
                          <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                            <Box style={{ backgroundColor: Palette.blue, borderRadius: 10, padding: 7 }}>
                              <MaterialIcons name="payments" size={16} color={Palette.white} />
                            </Box>
                            <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>
                              {money(summaryStats.totalPayroll, { maximumFractionDigits: 0 })}
                            </Text>
                          </HStack>
                          <Text fontSize={Type.label} color={Palette.ink} fontWeight="700">Total Payroll</Text>
                          <Text fontSize={Type.tiny} color={Palette.gray500}>Profile Monthly</Text>
                        </Box>

                        {/* On Track Card */}
                        <Box
                          bg={Palette.greenTint} p="$4" rounded="$2xl" width={140}
                          borderWidth={1} borderColor={Palette.success + '22'}
                          shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.03} shadowRadius={8} elevation={2}
                        >
                          <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                            <Box style={{ backgroundColor: Palette.success, borderRadius: 10, padding: 7 }}>
                              <MaterialIcons name="check-circle" size={16} color={Palette.white} />
                            </Box>
                            <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>{summaryStats.onTrack}</Text>
                          </HStack>
                          <Text fontSize={Type.label} color={Palette.ink} fontWeight="700">{t('payroll.statusOnTrack')}</Text>
                          <Text fontSize={Type.tiny} color={Palette.gray500}>Efficient Staff</Text>
                        </Box>

                        {/* At Risk Card */}
                        <Box
                          bg={Palette.warningTint} p="$4" rounded="$2xl" width={140}
                          borderWidth={1} borderColor={Palette.warning + '22'}
                          shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.03} shadowRadius={8} elevation={2}
                        >
                          <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                            <Box style={{ backgroundColor: Palette.warning, borderRadius: 10, padding: 7 }}>
                              <MaterialIcons name="trending-up" size={16} color={Palette.white} />
                            </Box>
                            <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>{summaryStats.atRisk}</Text>
                          </HStack>
                          <Text fontSize={Type.label} color={Palette.ink} fontWeight="700">{t('payroll.statusAtRisk')}</Text>
                          <Text fontSize={Type.tiny} color={Palette.gray500}>Low Revenue</Text>
                        </Box>

                        {/* Critical Card */}
                        <Box
                          bg={Palette.errorTint} p="$4" rounded="$2xl" width={140}
                          borderWidth={1} borderColor={Palette.error + '22'}
                          shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.03} shadowRadius={8} elevation={2}
                        >
                          <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                            <Box style={{ backgroundColor: Palette.error, borderRadius: 10, padding: 7 }}>
                              <MaterialIcons name="report-problem" size={16} color={Palette.white} />
                            </Box>
                            <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>{summaryStats.critical}</Text>
                          </HStack>
                          <Text fontSize={Type.label} color={Palette.ink} fontWeight="700">{t('payroll.statusCritical')}</Text>
                          <Text fontSize={Type.tiny} color={Palette.gray500}>Action Needed</Text>
                        </Box>
                      </HStack>
                    </ScrollView>
                  </MotiView>

                  {/* Search and Filters */}
                  <VStack space="md">
                    <Input
                      size="lg"
                      variant="outline"
                      bg={Palette.white}
                      borderWidth={0}
                      rounded="$2xl"
                      shadowColor={Palette.black}
                      shadowOffset={{ width: 0, height: 2 }}
                      shadowOpacity={0.03}
                      shadowRadius={10}
                      elevation={3}
                      borderColor={Palette.gray100}
                    >
                      <InputSlot pl="$4">
                        <MaterialIcons name="search" size={20} color={Palette.gray400} />
                      </InputSlot>
                      <InputField
                        placeholder={t("payroll.searchEmployeePosition")}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        color={Palette.gray800}
                        placeholderTextColor={Palette.gray400}
                        fontSize={Type.body}
                      />
                    </Input>

                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      <HStack space="sm" pb="$1">
                        <Pressable onPress={() => setFilterDepartment('')}>
                          <Box
                            bg={filterDepartment === '' ? Palette.ink : Palette.white}
                            px="$4" py="$2" rounded="$xl"
                            borderWidth={1} borderColor={filterDepartment === '' ? Palette.ink : Palette.gray200}
                            shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.03} shadowRadius={4} elevation={1}
                          >
                            <Text color={filterDepartment === '' ? Palette.white : Palette.gray600} fontSize={Type.label} fontWeight="600">
                              All Departments
                            </Text>
                          </Box>
                        </Pressable>
                        {departments.map((dept) => (
                          <Pressable key={dept} onPress={() => setFilterDepartment(dept)}>
                            <Box
                              bg={filterDepartment === dept ? Palette.ink : Palette.white}
                              px="$4" py="$2" rounded="$xl"
                              borderWidth={1} borderColor={filterDepartment === dept ? Palette.ink : Palette.gray200}
                              shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.03} shadowRadius={4} elevation={1}
                            >
                              <Text color={filterDepartment === dept ? Palette.white : Palette.gray600} fontSize={Type.label} fontWeight="600">
                                {dept}
                              </Text>
                            </Box>
                          </Pressable>
                        ))}
                      </HStack>
                    </ScrollView>
                  </VStack>
                </VStack>
              }
              ListEmptyComponent={
                <Box py="$10" alignItems="center">
                  {isLoading ? <Spinner size="large" color={Palette.gold} /> : <Text color={Palette.gray500} fontSize={Type.body}>{t('payroll.noEmployeesFound')}</Text>}
                </Box>
              }
            />
          )}
        </Box>

        {/* Export FAB (Visible when unlocked) */}
        {unlocked && (
          // Clear the absolute bottom tab bar (~60) + the system nav bar
          // (insets.bottom) + a 16 margin, so the FAB isn't hidden behind the nav.
          <Box position="absolute" bottom={insets.bottom + 76} right={20}>
            <Pressable
              onPress={handleExport}
              style={({ pressed }) => ({
                transform: [{ scale: pressed ? 0.95 : 1 }],
              })}
            >
              <Box
                bg={Palette.gray800}
                w={56} h={56}
                rounded="$full"
                alignItems="center"
                justifyContent="center"
                shadowColor={Palette.black}
                shadowOffset={{ width: 0, height: 4 }}
                shadowOpacity={0.3}
                shadowRadius={8}
                elevation={8}
              >
                <MaterialIcons name="download" size={28} color={Palette.white} />
              </Box>
            </Pressable>
          </Box>
        )}

      </SafeAreaView>

      {/* Employee Detail Modal */}
      {selectedEmployee && (
        <Modal isOpen={isDetailModalVisible} onClose={() => setDetailModalVisible(false)} size="full">
          <ModalBackdrop />
          <ModalContent maxHeight="85%" bg={Palette.white} rounded="$3xl" overflow="hidden" p="$0" mx="$4">
            {/* Gradient Header */}
            <LinearGradient
              colors={[Palette.gray800, Palette.ink]}
              style={{ paddingHorizontal: 20, paddingTop: 20, paddingBottom: 20 }}
            >
              <HStack justifyContent="space-between" alignItems="flex-start">
                <HStack space="md" alignItems="center" flex={1}>
                  <Box
                    w={48} h={48} rounded="$full"
                    bg="rgba(255,255,255,0.15)"
                    alignItems="center" justifyContent="center"
                  >
                    <Text fontSize={Type.h3} fontWeight="800" color={Palette.white}>
                      {getInitials(selectedEmployee.name)}
                    </Text>
                  </Box>
                  <VStack flex={1}>
                    <Heading size="md" color={Palette.white} fontWeight="800" numberOfLines={1}>
                      {selectedEmployee.name}
                    </Heading>
                    <HStack space="xs" alignItems="center" mt="$0.5">
                      <MaterialIcons name="work-outline" size={12} color="rgba(255,255,255,0.6)" />
                      <Text fontSize={Type.small} color="rgba(255,255,255,0.6)" fontWeight="500" numberOfLines={1}>
                        {selectedEmployee.position}
                      </Text>
                    </HStack>
                  </VStack>
                </HStack>
                <Pressable
                  onPress={() => setDetailModalVisible(false)}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                >
                  <Box
                    w={36} h={36}
                    bg="rgba(255,255,255,0.12)"
                    rounded="$full"
                    alignItems="center" justifyContent="center"
                  >
                    <MaterialIcons name="close" size={18} color={Palette.white} />
                  </Box>
                </Pressable>
              </HStack>

              {/* Financial Stats Row */}
              <HStack space="sm" mt="$4">
                <Box flex={1} bg="rgba(255,255,255,0.1)" p="$3" rounded="$xl">
                  <Text fontSize={Type.tiny} color="rgba(255,255,255,0.6)" fontWeight="600" letterSpacing={0.5}>ESTIMATED</Text>
                  <Text fontSize={Type.title} fontWeight="800" color={Palette.white} mt="$0.5">
                    {money(Math.round(selectedEmployee.estimatedEarnings))}
                  </Text>
                </Box>
                <Box flex={1} bg="rgba(255,255,255,0.1)" p="$3" rounded="$xl">
                  <Text fontSize={Type.tiny} color="rgba(255,255,255,0.6)" fontWeight="600" letterSpacing={0.5}>MONTHLY</Text>
                  <Text fontSize={Type.title} fontWeight="800" color={Palette.white} mt="$0.5">
                    {money(Math.round(selectedEmployee.totalIncome))}
                  </Text>
                </Box>
              </HStack>
              <HStack space="sm" mt="$2">
                <Box flex={1} bg="rgba(255,255,255,0.08)" p="$2.5" rounded="$xl">
                  <Text fontSize={Type.tiny} color="rgba(255,255,255,0.5)" fontWeight="600">HRS CLOCKED</Text>
                  <Text fontSize={Type.body} fontWeight="700" color="rgba(255,255,255,0.9)" mt="$0.5">
                    {selectedEmployee.totalHoursWorked?.toFixed(1) || '0'} h
                  </Text>
                </Box>
                <Box flex={1} bg="rgba(255,255,255,0.08)" p="$2.5" rounded="$xl">
                  <Text fontSize={Type.tiny} color="rgba(255,255,255,0.5)" fontWeight="600">HOURLY RATE</Text>
                  <Text fontSize={Type.body} fontWeight="700" color="rgba(255,255,255,0.9)" mt="$0.5">
                    {money(Math.round(selectedEmployee.hourlyRate || 0))}/hr
                  </Text>
                </Box>
              </HStack>

              {/* Pay Breakdown (if overtime or holiday) */}
              {((selectedEmployee.overtimePay ?? 0) > 0 || (selectedEmployee.holidayPay ?? 0) > 0) && (
                <HStack space="xs" mt="$3" flexWrap="wrap">
                  <Box bg="rgba(255,255,255,0.1)" px="$2.5" py="$1" rounded="$lg" mr="$1" mb="$1">
                    <Text fontSize={Type.caption} color="rgba(255,255,255,0.75)" fontWeight="600">
                      Reg: {money(Math.round(selectedEmployee.regularPay ?? 0))}
                    </Text>
                  </Box>
                  {(selectedEmployee.overtimePay ?? 0) > 0 && (
                    <Box bg="rgba(245,158,11,0.25)" px="$2.5" py="$1" rounded="$lg" mr="$1" mb="$1">
                      <Text fontSize={Type.caption} color={Palette.gold} fontWeight="600">
                        OT: +{money(Math.round(selectedEmployee.overtimePay ?? 0))} ({selectedEmployee.overtimeHours?.toFixed(1) ?? '0'}h)
                      </Text>
                    </Box>
                  )}
                  {(selectedEmployee.holidayPay ?? 0) > 0 && (
                    <Box bg="rgba(139,92,246,0.25)" px="$2.5" py="$1" rounded="$lg" mb="$1">
                      <Text fontSize={Type.caption} color={Palette.violetTint} fontWeight="600">
                        Hol: +{money(Math.round(selectedEmployee.holidayPay ?? 0))}
                      </Text>
                    </Box>
                  )}
                </HStack>
              )}
            </LinearGradient>

            {/* Time Log Body */}
            <ModalBody px="$4" pb="$6" pt="$4" maxHeight={340}>
              {isFetchingLogs ? (
                <Box py="$8" alignItems="center">
                  <Spinner size="large" color={Palette.gold} />
                  <Text mt="$3" color={Palette.gray700} fontWeight="500" fontSize={Type.title}>Fetching clock-in history…</Text>
                </Box>
              ) : employeeTimeLogs.length === 0 ? (
                <Box py="$8" alignItems="center">
                  <Box bg={Palette.gray100} p="$5" rounded="$full" mb="$3">
                    <MaterialIcons name="event-busy" size={36} color={Palette.gray400} />
                  </Box>
                  <Text color={Palette.ink} fontWeight="700" fontSize={Type.h3} textAlign="center">No clock-in records</Text>
                  <Text color={Palette.gray500} fontSize={Type.small} textAlign="center" mt="$1">No sessions found for this employee.</Text>
                </Box>
              ) : (
                <VStack space="xs">
                  <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray400} letterSpacing={1} mb="$2">
                    CLOCK-IN HISTORY ({employeeTimeLogs.length})
                  </Text>
                  <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
                    <VStack space="sm">
                      {employeeTimeLogs.map((item, index) => (
                        <Box
                          key={item?.timelog_id?.toString() ?? index.toString()}
                          bg={Palette.gray50}
                          borderWidth={1}
                          borderColor={Palette.gray100}
                          rounded="$2xl"
                          p="$3"
                        >
                          <HStack justifyContent="space-between" alignItems="center">
                            <VStack space="xs">
                              <Text fontWeight="700" color={Palette.ink} fontSize={Type.body}>
                                {item.start_time ? format(new Date(item.start_time), 'EEE, MMM dd') : 'N/A'}
                              </Text>
                              <HStack space="xs" alignItems="center">
                                <MaterialIcons name="access-time" size={13} color={Palette.gray400} />
                                <Text color={Palette.gray500} fontSize={Type.small} fontWeight="500">
                                  {item.start_time ? format(new Date(item.start_time), 'p') : 'N/A'}{' '}
                                  — {item.end_time ? format(new Date(item.end_time), 'p') : 'Ongoing'}
                                </Text>
                              </HStack>
                            </VStack>
                            <Box
                              bg={Palette.white}
                              px="$3" py="$1.5"
                              rounded="$full"
                              borderWidth={1}
                              borderColor={Palette.gray200}
                              shadowColor={Palette.black}
                              shadowOffset={{ width: 0, height: 1 }}
                              shadowOpacity={0.05}
                              shadowRadius={2}
                            >
                              <Text fontWeight="800" color={Palette.ink} fontSize={Type.label}>
                                {item.hours_worked?.toFixed(2) || '0.00'} hrs
                              </Text>
                            </Box>
                          </HStack>
                        </Box>
                      ))}
                    </VStack>
                  </ScrollView>
                </VStack>
              )}
            </ModalBody>
          </ModalContent>
        </Modal>
      )}
      <PayrollGuide visible={guideVisible} onClose={() => setGuideVisible(false)} />
    </LinearGradient>
  );
}


