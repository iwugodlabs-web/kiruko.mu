import { getJobsByCompany } from "@/services/api";
import { salaryStructures } from "@/services/payroll-api";
import PermissionGate from '@/components/PermissionGate';
import { Palette, Type } from '@/app/constants/theme';
import { MaterialIcons } from "@expo/vector-icons";
import {
  Badge,
  Box,
  Heading,
  HStack,
  Input,
  InputField,
  InputSlot,
  ScrollView,
  Spinner,
  Text,
  VStack,
} from "@gluestack-ui/themed";
import { LinearGradient } from "expo-linear-gradient";
import { MotiView } from "moti";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import useAuth from "../hooks/useAuth";
import useCurrency from "../hooks/useCurrency";
import { useTranslation } from "react-i18next";
import PayrollGuide, { hasSeenPayrollGuide } from "@/components/PayrollGuide";
import { PremiumHeader } from "@/components/PremiumHeader";
import { router } from "expo-router";
import { Pressable, RefreshControl } from "react-native";
import { ArrowLeft, Plus } from "lucide-react-native";

export default function PayrollPage() {
  return (
    <PermissionGate permission={['view_salary', 'view_payslip', 'manage_payroll']} label="payroll">
      <PayrollPageInner />
    </PermissionGate>
  );
}

function PayrollPageInner() {
  const { user } = useAuth();
  const { formatCurrency } = useCurrency();
  const { t } = useTranslation();

  // Show payroll in the company's own operating currency (derived server-side
  // from its country), with NO FX conversion — matches salaries.tsx. Was using
  // the device display-currency preference, which silently converted amounts.
  const companyCurrency = (user as any)?.company?.currency || undefined;
  const money = useCallback(
    (amount: number, opts?: { minimumFractionDigits?: number; maximumFractionDigits?: number }) =>
      formatCurrency(amount, { currencyCode: companyCurrency, convert: false, ...opts }),
    [formatCurrency, companyCurrency],
  );
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAdjustmentModalOpen, setIsAdjustmentModalOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState("monthly");
  const [guideVisible, setGuideVisible] = useState(false);

  useEffect(() => {
    void (async () => {
      if (!(await hasSeenPayrollGuide())) setGuideVisible(true);
    })();
  }, []);
  
  const loadData = async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);

    const companyId = user?.company?.company_id || user?.private_user?.company_id || (user as any)?.company_id;
    if (!companyId) {
      setItems([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    const jobsRes = await getJobsByCompany(companyId);
    const filteredJobs = Array.isArray(jobsRes) ? jobsRes : [];
    if (Array.isArray(filteredJobs)) {
      const rows = await Promise.all(
        filteredJobs.map(async (job: any) => {
          // Every job on this screen belongs to THIS company (getJobsByCompany
          // is already scoped to it) — the modern SalaryStructure system is
          // always the right source here, never the legacy `salaries` table
          // (self-reported by the employee on their own profile, with no
          // sync to structure changes an employer makes). See the same fix
          // in salaries.tsx / employees/[id].tsx for the full rationale.
          let salary: any = null;
          try {
            const structRes = await salaryStructures.preview(job.private_user_id);
            if (!('error' in structRes)) {
              const basicComponent = structRes.components?.find(
                (c) => c.kind === 'earning' && c.is_basic,
              );
              if (basicComponent) {
                const allowanceTotal = (structRes.components ?? [])
                  .filter((c) => c.kind === 'earning' && !c.is_basic)
                  .reduce((sum, c) => sum + (parseFloat(String(c.amount)) || 0), 0);
                const basicAmount = parseFloat(String(basicComponent.amount)) || 0;
                salary = {
                  salary: String(basicAmount),
                  allowance: String(allowanceTotal),
                  revenue: String(basicAmount + allowanceTotal),
                };
              }
              // else: structure not configured yet -> salary stays null,
              // rendering the existing "No Salary" status below rather than
              // falling back to an unrelated old personal profile entry.
            }
          } catch (structErr) {
            console.warn(`Failed to fetch salary structure for job ${job.job_id}:`, structErr);
          }
          const employeeName = job.private_user
            ? `${job.private_user.first_name} ${job.private_user.last_name}`
            : `Employee ${job.private_user_id}`;

          return {
            job,
            salary,
            employeeName,
            employeeId: job.private_user_id,
          };
        }),
      );
      setItems(rows);
    } else {
      setItems([]);
    }
    setLoading(false);
    setRefreshing(false);
  };

  // Filtered items based on search
  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    return items.filter(
      (item) =>
        (item.job?.job_title || "")
          .toLowerCase()
          .includes(searchQuery.toLowerCase()) ||
        (item.employeeName || "")
          .toLowerCase()
          .includes(searchQuery.toLowerCase()),
    );
  }, [items, searchQuery]);

  // Calculate total payroll
  const totalPayroll = useMemo(() => {
    return filteredItems.reduce((sum, item) => {
      return sum + (item.salary ? parseFloat(item.salary.revenue) || 0 : 0);
    }, 0);
  }, [filteredItems]);

  // Get salary status indicator
  const getSalaryStatus = (salary: any) => {
    if (!salary) {
      return {
        status: "No Salary",
        color: Palette.error,
        bgColor: Palette.errorTint,
        icon: "warning",
      };
    }

    const revenue = parseFloat(salary.revenue) || 0;
    if (revenue === 0) {
      return {
        status: "No Revenue",
        color: Palette.warning,
        bgColor: Palette.warningTint,
        icon: "info",
      };
    }

    return {
      status: "Active",
      color: Palette.success,
      bgColor: Palette.successTint,
      icon: "check-circle",
    };
  };

  // Currency formatting is now handled by the useCurrency hook

  useEffect(() => {
    let mounted = true;
    loadData();
    return () => {
      mounted = false;
    };
  }, [user]);

  return (
    <LinearGradient
      colors={[Palette.gray50, Palette.gray100, Palette.white]}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <Box px="$6" pt="$4" pb="$2">
          <VStack space="xs">
            <HStack justifyContent="space-between" alignItems="center">
              <Pressable
                onPress={() => router.push("/company_dashboard/home" as any)}
              >
                <Box
                  bg="white"
                  p="$2"
                  rounded="$full"
                  shadowColor={Palette.black}
                  shadowOffset={{ width: 0, height: 2 }}
                  shadowOpacity={0.1}
                  shadowRadius={4}
                  elevation={3}
                >
                  <ArrowLeft size={24} color={Palette.gray800} />
                </Box>
              </Pressable>
              <Heading
                size="xl"
                fontWeight="800"
                color={Palette.ink}
                style={{ letterSpacing: -1 }}
              >
                {t('payroll.overviewTitle')}
              </Heading>
              <Pressable onPress={() => setIsAdjustmentModalOpen(true)}>
                <Box
                  bg={Palette.white}
                  p="$2"
                  rounded="$full"
                  shadowColor={Palette.black}
                  shadowOffset={{ width: 0, height: 2 }}
                  shadowOpacity={0.1}
                  shadowRadius={4}
                  elevation={3}
                >
                  <Plus size={24} color={Palette.gold} />
                </Box>
              </Pressable>
            </HStack>
            <HStack alignItems="center" space="xs" alignSelf="center" mt="$1">
              <Box bg={Palette.successTint} px="$2" py="$1" rounded="$md">
                <Text
                  fontSize={Type.caption}
                  fontWeight="700"
                  color={Palette.success}
                  letterSpacing={0.5}
                >
                  FINAL SETTLEMENT
                </Text>
              </Box>
              <Text fontSize={Type.caption} color={Palette.gray500}>
                • Pay Runs & Payslips
              </Text>
            </HStack>
            {/* Re-open the payroll guide on demand (it only auto-shows once). */}
            <Pressable
              onPress={() => setGuideVisible(true)}
              hitSlop={8}
              style={{ alignSelf: 'center', marginTop: 6 }}
            >
              <Text
                fontSize={Type.caption}
                fontWeight="700"
                color={Palette.gold}
                style={{ textDecorationLine: 'underline' }}
              >
                {t('payroll.guide.title')}
              </Text>
            </Pressable>
          </VStack>
        </Box>

        <Box
          bg={Palette.white}
          borderBottomWidth={1}
          borderBottomColor={Palette.gray100}
        >
        </Box>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingTop: 16,
            paddingBottom: 40,
          }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(true)}
              colors={[Palette.gold]}
            />
          }
        >
          {/* Total Payroll Summary */}
          {!loading && filteredItems.length > 0 && (
            <MotiView
              from={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "timing", duration: 400, delay: 100 }}
            >
              <Box
                bg={Palette.successTint}
                p="$4"
                rounded="$2xl"
                borderWidth={1}
                borderColor={Palette.success + '22'}
                shadowColor={Palette.black}
                shadowOffset={{ width: 0, height: 2 }}
                shadowOpacity={0.04}
                shadowRadius={8}
                elevation={2}
                mb="$4"
              >
                <HStack alignItems="center" space="md">
                  <Box style={{ backgroundColor: Palette.success, borderRadius: 10, padding: 7 }}>
                    <MaterialIcons name="payments" size={16} color={Palette.white} />
                  </Box>
                  <VStack flex={1}>
                    <Text color={Palette.ink} fontSize={Type.label} fontWeight="700">
                      {t('payroll.totalMonthly')}
                    </Text>
                    <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>
                      {money(totalPayroll)}
                    </Text>
                  </VStack>
                </HStack>
              </Box>
            </MotiView>
          )}

          {/* Search Bar */}
          <MotiView
            from={{ opacity: 0, translateY: 10 }}
            animate={{ opacity: 1, translateY: 0 }}
            transition={{ type: "timing", duration: 400, delay: 200 }}
          >
            <Box mb="$4">
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
                p="$1"
              >
                <Input
                  variant="rounded"
                  size="lg"
                  bg="transparent"
                  borderWidth={0}
                  minHeight={50}
                >
                  <InputSlot pl="$4">
                    <MaterialIcons name="search" size={20} color={Palette.gray400} />
                  </InputSlot>
                  <InputField
                    placeholder={t('payroll.searchPlaceholder')}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    color={Palette.ink}
                    fontSize={Type.body}
                    pl="$2"
                  />
                </Input>
              </Box>
            </Box>
          </MotiView>

          {/* Results Count */}
          {!loading && (
            <MotiView
              from={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ type: "timing", duration: 300, delay: 300 }}
            >
              <Text color={Palette.gray600} fontSize={Type.body} mb="$4">
                {filteredItems.length} of {items.length} positions
              </Text>
            </MotiView>
          )}

          {/* Loading State */}
          {loading ? (
            <MotiView
              from={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: "timing", duration: 400 }}
            >
              <Box alignItems="center" py="$8">
                <Spinner size="large" color={Palette.gold} />
                <Text mt="$4" color={Palette.gray700} fontSize={Type.title}>
                  Loading payroll data...
                </Text>
              </Box>
            </MotiView>
          ) : (
            <VStack space="md">
              {filteredItems.length === 0 ? (
                // Empty State
                <MotiView
                  from={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ type: "timing", duration: 400 }}
                >
                  <Box
                    bg={Palette.white}
                    p="$8"
                    rounded="$2xl"
                    alignItems="center"
                    borderWidth={1}
                    borderColor={Palette.gray100}
                    shadowColor={Palette.black}
                    shadowOffset={{ width: 0, height: 2 }}
                    shadowOpacity={0.04}
                    shadowRadius={8}
                    elevation={2}
                  >
                    <Box
                      bg={Palette.gray100}
                      p="$4"
                      rounded="$full"
                      mb="$4"
                    >
                      <MaterialIcons
                        name="work-outline"
                        size={48}
                        color={Palette.gray300}
                      />
                    </Box>
                    <Heading
                      size="md"
                      color={Palette.ink}
                      fontWeight="700"
                      textAlign="center"
                      mb="$2"
                    >
                      {searchQuery
                        ? t('payroll.noMatchingPositions')
                        : t('payroll.noPayrollData')}
                    </Heading>
                    <Text
                      color={Palette.gray500}
                      textAlign="center"
                      fontSize={Type.body}
                      lineHeight={20}
                    >
                      {searchQuery
                        ? "Try adjusting your search terms to find positions."
                        : t('payroll.noPayrollDataHint')}
                    </Text>
                    {!searchQuery && (
                      <Pressable onPress={() => router.push('/company_dashboard/salaries')}>
                        <Box
                          mt="$4"
                          bg={Palette.gold}
                          px="$5"
                          py="$3"
                          rounded="$xl"
                        >
                          <Text color={Palette.white} fontWeight="700" fontSize={Type.body}>
                            {t('payroll.setupSalariesCta')}
                          </Text>
                        </Box>
                      </Pressable>
                    )}
                  </Box>
                </MotiView>
              ) : (
                // Payroll Cards
                filteredItems.map((item, index) => {
                  const salaryStatus = getSalaryStatus(item.salary);
                  const revenue = item.salary
                    ? parseFloat(item.salary.revenue) || 0
                    : 0;

                  return (
                    <MotiView
                      key={item.job?.job_id || index}
                      from={{ opacity: 0, translateY: 20 }}
                      animate={{ opacity: 1, translateY: 0 }}
                      transition={{
                        type: "timing",
                        duration: 300,
                        delay: index * 50,
                      }}
                    >
                      <Box
                        bg={Palette.white}
                        p="$4"
                        rounded="$2xl"
                        borderWidth={1}
                        borderColor={Palette.gray100}
                        shadowColor={Palette.black}
                        shadowOffset={{ width: 0, height: 2 }}
                        shadowOpacity={0.04}
                        shadowRadius={8}
                        elevation={2}
                        mb="$2"
                      >
                        <VStack space="md">
                          {/* Header */}
                          <HStack
                            justifyContent="space-between"
                            alignItems="flex-start"
                          >
                            <VStack flex={1} space="xs">
                              <Text
                                fontWeight="700"
                                fontSize={Type.title}
                                color={Palette.ink}
                                numberOfLines={1}
                              >
                                {item.employeeName}
                              </Text>
                              <Text
                                color={Palette.gray600}
                                fontSize={Type.body}
                                numberOfLines={1}
                              >
                                {item.job?.job_title || "Position"}
                              </Text>
                            </VStack>
                            <Badge
                              action="muted"
                              variant={
                                salaryStatus.status === "Active"
                                  ? "solid"
                                  : "outline"
                              }
                              size="sm"
                              rounded="$lg"
                              px="$3"
                              py="$1"
                              bg={salaryStatus.bgColor}
                              borderWidth={0}
                            >
                              <HStack alignItems="center" space="xs">
                                <MaterialIcons
                                  name={salaryStatus.icon as any}
                                  size={14}
                                  color={salaryStatus.color}
                                />
                                <Text
                                  fontSize={Type.small}
                                  fontWeight="600"
                                  color={salaryStatus.color}
                                >
                                  {salaryStatus.status}
                                </Text>
                              </HStack>
                            </Badge>
                          </HStack>

                          {/* Salary Details */}
                          <VStack space="sm">
                            <HStack
                              justifyContent="space-between"
                              alignItems="center"
                            >
                              <HStack alignItems="center" space="sm">
                                <MaterialIcons
                                  name="attach-money"
                                  size={18}
                                  color={Palette.success}
                                />
                                <Text
                                  color={Palette.gray600}
                                  fontSize={Type.body}
                                  fontWeight="500"
                                >
                                  {t('payroll.monthlySalary')}
                                </Text>
                              </HStack>
                              <Text
                                fontSize={Type.h3}
                                fontWeight="700"
                                color={
                                  revenue > 0 ? Palette.success : Palette.gray500
                                }
                              >
                                {revenue > 0
                                  ? money(revenue)
                                  : "Not set"}
                              </Text>
                            </HStack>

                            {item.salary && (
                              <>
                                <HStack
                                  justifyContent="space-between"
                                  alignItems="center"
                                >
                                  <Text color={Palette.gray600} fontSize={Type.label}>
                                    {t('payroll.monthlyHours')}
                                  </Text>
                                  <Text
                                    color={Palette.gray700}
                                    fontSize={Type.label}
                                    fontWeight="600"
                                  >
                                    {item.salary.monthly_hours || "N/A"} hrs
                                  </Text>
                                </HStack>

                                <HStack
                                  justifyContent="space-between"
                                  alignItems="center"
                                >
                                  <Text color={Palette.gray600} fontSize={Type.label}>
                                    {t('payroll.daysPerMonth')}
                                  </Text>
                                  <Text
                                    color={Palette.gray700}
                                    fontSize={Type.label}
                                    fontWeight="600"
                                  >
                                    {item.salary.days_of_work_per_month ||
                                      "N/A"}{" "}
                                    days
                                  </Text>
                                </HStack>

                                {revenue > 0 && item.salary.monthly_hours && (
                                  <Box
                                    bg={Palette.goldTint}
                                    p="$3"
                                    rounded="$lg"
                                    borderWidth={1}
                                    borderColor={Palette.gold + '22'}
                                  >
                                    <HStack
                                      justifyContent="space-between"
                                      alignItems="center"
                                    >
                                      <HStack alignItems="center" space="sm">
                                        <MaterialIcons
                                          name="schedule"
                                          size={16}
                                          color={Palette.gold}
                                        />
                                        <Text
                                          color={Palette.gray600}
                                          fontSize={Type.label}
                                        >
                                          {t('payroll.hourlyRate')}
                                        </Text>
                                      </HStack>
                                      <Text
                                        color={Palette.ink}
                                        fontSize={Type.body}
                                        fontWeight="600"
                                      >
                                        {money(
                                          revenue / item.salary.monthly_hours,
                                        )}
                                      </Text>
                                    </HStack>
                                  </Box>
                                )}
                              </>
                            )}
                          </VStack>
                        </VStack>
                      </Box>
                    </MotiView>
                  );
                })
              )}
            </VStack>
          )}

          <Box h="$8" />
        </ScrollView>
      </SafeAreaView>
      <PayrollGuide visible={guideVisible} onClose={() => setGuideVisible(false)} />
    </LinearGradient>
  );
}
