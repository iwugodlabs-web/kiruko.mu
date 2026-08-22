import React, { useState } from "react";
import { Palette } from '@/app/constants/theme';
import {
  Box,
  Button,
  ButtonText,
  Heading,
  HStack,
  Pressable,
  Spinner,
  Text,
  VStack,
} from "@gluestack-ui/themed";
import { MaterialIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import Animated, { FadeIn } from '@/app/utils/animated';
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import useCurrency from "@/app/hooks/useCurrency";
import type { PayslipEstimate, ResolvedSalary } from "@/services/payroll-api";
import { resolveLiveAmount, periodMatchesBackendPeriod } from "./resolveLiveAmount";

export interface PaySummaryProps {
  payData: {
    totalHours: number;
    estimatedPay: number;
    regularHours: number;
    overtimeHours: number;
    holidayHours: number;
    regularPay: number;
    overtimePay: number;
    holidayPay: number;
    allowances: number;
    completedDays: number;
    breakTime: number;
    filteredTimeLogs: any[];
    hourlyRate: number;
  };
  // The selected Time Period pill's actual resolved date range — needed to
  // check whether it's really the same window `payslipEstimate` was
  // computed for (see periodMatchesBackendPeriod in resolveLiveAmount.ts).
  // Can't be inferred from the pill's name alone: the backend prefers an
  // open payroll run's period over the calendar month when one exists, so
  // "This Month" doesn't always mean what the backend computed.
  selectedPeriodRange: { start: Date; end: Date } | null;
  isDataLoading: boolean;
  authLoading: boolean;
  salaryData: any;
  timeLogs: any[];
  currency?: string;
  // The authoritative payroll-engine figure for the current period — same
  // one the web employer profile shows. Used to correct the "Rs0.00" bug:
  // the local calculation below is derived purely from clock-in logs and
  // reads 0 whenever there are none locally, even when the backend already
  // has a real, non-zero number (fixed-salary staff, kiosk/web clock-ins, …).
  payslipEstimate?: PayslipEstimate | null;
  // The employee's current RECURRING salary structure (basic + recurring
  // allowances — no one-offs, no period docking), resolved straight from
  // SalaryStructure/EmployeeSalaryAssignment. This is what "Salary" mode
  // shows for company-affiliated employees; see the source-selection note
  // on monthlyContractual below.
  resolvedSalary?: ResolvedSalary | null;
  // Whether this employee's active Job has a company_id. This is the real
  // decision boundary for which salary source to trust — NOT "did the
  // structure resolve to anything." The legacy `salaries` table is
  // self-reported by the employee on their own profile (independent/
  // personal users have no employer to configure a structure for them —
  // EmployeeSalaryAssignment structurally requires a company_id, see
  // salary_structures.py). A company-affiliated employee should ALWAYS
  // trust the structure their employer configured, even if it hasn't been
  // set up yet (that's a company setup gap to surface, not a reason to
  // silently show old personal profile data instead).
  isCompanyEmployee?: boolean;
}

const PaySummary: React.FC<PaySummaryProps> = ({
  payData,
  selectedPeriodRange,
  isDataLoading,
  authLoading,
  salaryData,
  timeLogs,
  payslipEstimate,
  resolvedSalary,
  isCompanyEmployee,
}) => {
  const router = useRouter();
  const { t } = useTranslation();
  const { formatCurrency } = useCurrency();

  // Two legitimate numbers: LIVE = earned-so-far from clock-ins (the default),
  // SALARY = the fixed contractual monthly. The employee picks; for a monthly
  // worker the live figure is shown WITH the monthly-salary context so it never
  // reads as a pay cut.
  const isHourly = String(salaryData?.pay_basis || "monthly").toLowerCase() === "hourly";
  // Independent/personal user only — self-reported on their own profile,
  // the legacy `salaries` table (GET /job/salary/{job_id}). Never shown for
  // a company-affiliated employee; see isCompanyEmployee below.
  const legacyBasic = parseFloat(salaryData?.salary || "0") || 0;
  const legacyAllowanceCol = salaryData?.allowance;
  const legacyAllowance =
    legacyAllowanceCol != null && legacyAllowanceCol !== ""
      ? parseFloat(legacyAllowanceCol) || 0
      : Math.max(0, (parseFloat(salaryData?.revenue ?? "0") || 0) - legacyBasic);
  const legacyMonthlyContractual = legacyBasic + legacyAllowance;
  // resolveComponents() (what resolvedSalary comes from) never touches
  // one-off allowances — see resolveLiveAmount.ts's note on why backendGross
  // (from payslipEstimate, which DOES include one-offs) is the wrong source
  // for this. Summing every 'earning' component here is exactly "this
  // employee's recurring monthly salary," nothing more, nothing less.
  const recurringEarnings = resolvedSalary?.components?.filter((c) => c.kind === "earning") ?? [];
  const structureMonthlyContractual = recurringEarnings.reduce(
    (sum, c) => sum + (parseFloat(String(c.amount)) || 0),
    0,
  );
  // The decision is WHO manages this employee's pay, not "which source
  // happened to return data" — a company employee whose structure isn't
  // configured yet must see that gap (Salary tab hidden, since
  // monthlyContractual is legitimately 0), not their own old personal
  // profile entry from before they joined a company. resolve_components()
  // returns an identical EMPTY result for "no company" and "company but no
  // assignment yet" (its own docstring says so) — company_id upstream of
  // the resolver is the only signal that actually distinguishes them.
  const usingStructureSalary = !!isCompanyEmployee;
  const monthlyContractual = usingStructureSalary ? structureMonthlyContractual : legacyMonthlyContractual;
  const [mode, setMode] = useState<"live" | "salary">("live");
  // "Live" is the default mode — tapping it while it's already selected is a
  // legitimate no-op (there's nothing to switch to), but with no press
  // feedback that reads exactly like "I tapped this and nothing happened,
  // it must be broken." Dim on press regardless of whether `mode` actually
  // changes, so every tap gets an immediate visible response.
  const [pressedMode, setPressedMode] = useState<"live" | "salary" | null>(null);
  // Display-only now (the "Fixed Salary"/"Hourly Pay" badge and the "Base
  // Rate"/"Reference Rate" footer label) — it no longer gates which amount
  // Live mode shows. `pay_is_hours_driven` is the backend's own
  // authoritative answer to "does this employee's pay depend on hours";
  // trust it over the local `isHourly` guess when it's available.
  const isHoursDriven = payslipEstimate?.pay_is_hours_driven ?? isHourly;
  const backendGross = payslipEstimate ? Number(payslipEstimate.gross) || 0 : null;
  // Compare against the backend's ACTUAL returned period, not just the pill
  // name — "This Month" locally is always the calendar month, but the
  // backend prefers an open payroll run's period when one exists, which can
  // be a different month during month-end/month-start processing. See
  // periodMatchesBackendPeriod's doc comment.
  const periodMatchesBackend = periodMatchesBackendPeriod({
    localStart: selectedPeriodRange?.start ?? new Date(0),
    localEnd: selectedPeriodRange?.end ?? new Date(0),
    backendPeriod: payslipEstimate?.period,
  });
  // See resolveLiveAmount.ts for the fallback rule + its unit tests. The
  // Detailed Breakdown below keys off `liveAmountSource` too, so it can
  // never disagree with this headline — they're always the same decision.
  const { amount: liveAmount, source: liveAmountSource } = resolveLiveAmount({
    backendGross,
    localEstimate: payData.estimatedPay,
    periodMatchesBackend,
  });
  const displayAmount = mode === "salary" ? monthlyContractual : liveAmount;
  // Local AND backend agree pay is genuinely 0 (not just a local-data gap)
  // — show why instead of a bare Rs0. Gated on periodMatchesBackend: the
  // backend's zero_reason describes ITS period (This Month), which is
  // irrelevant context if the selected filter is a different window that
  // just happens to also be locally empty.
  const zeroReasonKey =
    periodMatchesBackend && liveAmount === 0 && payslipEstimate?.zero_reason
      ? (payslipEstimate.zero_reason === "no_pay_basis"
          ? "privateHomeCards.noPayBasisConfigured"
          : "privateHomeCards.noClockinsThisPeriod")
      : null;

  // Detailed Breakdown, unified across both modes: whichever number is
  // shown up top, this list is sourced from the EXACT same data, never a
  // separately-derived condition (that's what let the headline and the
  // breakdown disagree in the first place, twice). null means "no
  // structured breakdown for this combination" — the local 3-box fallback
  // below only ever applies to mode "live" + source "local"; Salary mode
  // with no resolved structure data shows no breakdown at all rather than
  // a misleading hours-based one under a "your salary" headline.
  type BreakdownEntry = {
    code: string;
    label: string;
    amount: number;
    hoursStr?: string | null;
    multiplierBadge?: string | null;
  };
  const breakdownEntries: BreakdownEntry[] | null =
    mode === "salary"
      ? (usingStructureSalary
          ? recurringEarnings.map((c) => ({
              code: c.code,
              label: c.label,
              amount: parseFloat(String(c.amount)) || 0,
            }))
          : null)
      : (liveAmountSource === "backend" && (payslipEstimate?.earnings?.length ?? 0) > 0
          ? payslipEstimate!.earnings.map((e) => ({
              code: e.code,
              label: e.label,
              amount: parseFloat(e.amount_str.replace(/,/g, "")) || 0,
              hoursStr: e.hours_str,
              multiplierBadge: e.multiplier_badge,
            }))
          : null);
  const showLocalBreakdown =
    mode === "live" && liveAmountSource === "local" && !!salaryData && timeLogs.length > 0;

  return (
    <Animated.View entering={FadeIn.duration(600)}>
      <Box
        bg="white"
        p="$0" // Removed padding to let gradient fill
        rounded="$3xl"
        shadowColor="$shadowColor"
        shadowOffset={{ width: 0, height: 4 }}
        shadowOpacity={0.1}
        shadowRadius={20}
        elevation={8}
        borderWidth={1}
        borderColor="$borderLight100"
        overflow="hidden" // Ensure gradient clips to rounded corners
      >
        <VStack space="lg">
          {/* Main Gradient Card - The "Hero" Section */}
          <LinearGradient
            colors={[Palette.success, Palette.teal, Palette.green]} // Emerald Gradient
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 24 }}
          >
            {/* Header */}
            <HStack alignItems="center" justifyContent="space-between" mb="$6">
              <HStack alignItems="center" space="sm">
                <Box bg="rgba(255,255,255,0.2)" p="$2" rounded="$full">
                  <MaterialIcons
                    name="account-balance-wallet"
                    size={20}
                    color="white"
                  />
                </Box>
                <Text
                  color="white"
                  fontWeight="600"
                  fontSize={16}
                  textTransform="uppercase"
                  letterSpacing={1}
                >
                  {t('privateHomeCards.totalEarnings')}
                </Text>
              </HStack>
              {salaryData && (!isHourly && monthlyContractual > 0 ? (
                // Monthly/structure worker: let them switch Live ↔ Salary.
                // A per-option icon is a much stronger "these are choices you
                // can tap" signal than color/shadow alone on a busy gradient
                // background — no separate label competing for attention
                // next to it (removed; the tab names already say "Live" and
                // "Salary", a static label saying the same thing in different
                // words read as ANOTHER control instead of clarifying one).
                <HStack
                  bg="rgba(255,255,255,0.18)"
                  rounded="$full"
                  p="$0.5"
                  borderWidth={1}
                  borderColor="rgba(255,255,255,0.35)"
                >
                  {(["live", "salary"] as const).map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => setMode(m)}
                      onPressIn={() => setPressedMode(m)}
                      onPressOut={() => setPressedMode(null)}
                      hitSlop={8}
                    >
                      <HStack
                        alignItems="center"
                        space="xs"
                        bg={mode === m ? "rgba(255,255,255,0.95)" : "transparent"}
                        px="$3"
                        py="$1"
                        rounded="$full"
                        opacity={pressedMode === m ? 0.6 : 1}
                        shadowColor="$shadowColor"
                        shadowOffset={{ width: 0, height: 1 }}
                        shadowOpacity={mode === m ? 0.2 : 0}
                        shadowRadius={2}
                        elevation={mode === m ? 2 : 0}
                      >
                        <MaterialIcons
                          name={m === "live" ? "bolt" : "payments"}
                          size={12}
                          color={mode === m ? Palette.success : "white"}
                        />
                        <Text
                          fontSize={10}
                          fontWeight="700"
                          color={mode === m ? Palette.success : "white"}
                        >
                          {m === "live"
                            ? t('privateHomeCards.live')
                            : t('privateHomeCards.salaryMode')}
                        </Text>
                      </HStack>
                    </Pressable>
                  ))}
                </HStack>
              ) : null)}
            </HStack>

            {/* Big Number */}
            <VStack space="xs" mb="$4">
              {isDataLoading ? (
                <HStack space="sm" alignItems="center">
                  <Spinner size="small" color="white" />
                  <Text color="rgba(255,255,255,0.8)">{t('privateHomeCards.calculating')}</Text>
                </HStack>
              ) : !salaryData ? (
                <VStack>
                  <Text color="white" fontSize={24} fontWeight="700">
                    {t('privateHomeCards.setupRequired')}
                  </Text>
                  <Button
                    variant="link"
                    onPress={() => router.push("/private_dashboard/calculator")}
                    justifyContent="flex-start"
                    p="$0"
                  >
                    <ButtonText color="rgba(255,255,255,0.9)" underline>
                      {t('privateHomeCards.configureSalary')}
                    </ButtonText>
                  </Button>
                </VStack>
              ) : (
                <>
                  <Text
                    color="white"
                    fontWeight="800"
                    fontSize={42}
                    lineHeight={48}
                  >
                    {formatCurrency(displayAmount, {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2,
                    })}
                  </Text>
                  {mode === "salary" ? (
                    <Text
                      color="rgba(255,255,255,0.8)"
                      fontSize={14}
                      fontWeight="500"
                    >
                      {t('privateHomeCards.monthlySalaryLabel')}
                    </Text>
                  ) : (
                    <>
                      {payData.filteredTimeLogs.length > 0 && (
                        <Text
                          color="rgba(255,255,255,0.8)"
                          fontSize={14}
                          fontWeight="500"
                        >
                          {t(
                            payData.filteredTimeLogs.length === 1
                              ? 'privateHomeCards.fromSessionsSingular'
                              : 'privateHomeCards.fromSessionsPlural',
                            { count: payData.filteredTimeLogs.length },
                          )}
                        </Text>
                      )}
                      {/* Genuinely zero (both the local calc and the payroll
                          engine agree) — say why instead of a bare Rs0. */}
                      {zeroReasonKey && payData.filteredTimeLogs.length === 0 && (
                        <Text
                          color="rgba(255,255,255,0.8)"
                          fontSize={13}
                          fontWeight="500"
                        >
                          {t(zeroReasonKey)}
                        </Text>
                      )}
                      {/* Monthly worker: live = earned so far; show the full
                          salary so it never reads as a pay cut. */}
                      {!isHourly && monthlyContractual > 0 && (
                        <Text
                          color="rgba(255,255,255,0.7)"
                          fontSize={12}
                          fontWeight="500"
                        >
                          {t('privateHomeCards.ofMonthlySalary', {
                            amount: formatCurrency(monthlyContractual, {
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            }),
                          })}
                        </Text>
                      )}
                    </>
                  )}
                </>
              )}
            </VStack>

            {/* Footer Stats (Glass effect) */}
            <HStack
              bg="rgba(0,0,0,0.1)"
              p="$3"
              rounded="$xl"
              justifyContent="space-between"
              alignItems="center"
              borderWidth={1}
              borderColor="rgba(255,255,255,0.1)"
            >
              <VStack>
                <Text
                  color="rgba(255,255,255,0.7)"
                  fontSize={11}
                  fontWeight="600"
                  textTransform="uppercase"
                >
                  {t('privateHomeCards.totalHours')}
                </Text>
                <Text color="white" fontSize={18} fontWeight="700">
                  {(() => {
                    const totalMins = Math.round(
                      (payData.totalHours || 0) * 60,
                    );
                    const h = Math.floor(totalMins / 60);
                    const m = totalMins % 60;
                    if (h === 0) return `${m}m`;
                    if (m === 0) return `${h}h`;
                    return `${h}h ${m}m`;
                  })()}
                </Text>
              </VStack>
              <Box w={1} h="$8" bg="rgba(255,255,255,0.2)" rounded="$full" />
              <VStack>
                <Text
                  color="rgba(255,255,255,0.7)"
                  fontSize={11}
                  fontWeight="600"
                  textTransform="uppercase"
                >
                  {isHoursDriven
                    ? t('privateHomeCards.baseRate')
                    : t('privateHomeCards.referenceRate')}
                </Text>
                <Text color="white" fontSize={18} fontWeight="700">
                  {formatCurrency(payData.hourlyRate || 0, {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 0,
                  })}
                  {t('privateHomeCards.perHour')}
                </Text>
              </VStack>
            </HStack>
          </LinearGradient>

          {/* Breakdown Section (Below Gradient).
              Renders breakdownEntries — the EXACT SAME decision the headline
              above just made (see the comment where it's computed) — instead
              of separately recomputing when to trust the backend/structure
              data. That's deliberate: independently-derived conditions
              drifted apart before (the headline deferred to the backend for
              cases the breakdown didn't know about), producing a card that
              visibly contradicted itself. Sharing one decision makes that
              whole class of bug structurally impossible instead of just
              fixed for now. */}
          {breakdownEntries && breakdownEntries.length > 0 ? (
            <VStack space="sm" px="$6" pb="$6">
              <Text
                color="$gray500"
                fontSize={12}
                fontWeight="700"
                textTransform="uppercase"
                letterSpacing={0.5}
              >
                {t('privateHomeCards.detailedBreakdown')}
              </Text>
              {breakdownEntries.map((entry) => (
                <HStack
                  key={entry.code}
                  justifyContent="space-between"
                  alignItems="center"
                  bg="white"
                  p="$3"
                  rounded="$xl"
                  borderWidth={1}
                  borderColor="$borderLight100"
                >
                  <VStack flex={1} pr="$2">
                    <Text color="$textDark900" fontWeight="600" fontSize={13}>
                      {entry.label}
                    </Text>
                    {entry.hoursStr && (
                      <Text color="$textLight500" fontSize={11} mt="$0.5">
                        {entry.hoursStr}
                      </Text>
                    )}
                  </VStack>
                  <HStack alignItems="center" space="xs">
                    {entry.multiplierBadge && (
                      <Box bg="$backgroundLight100" px="$2" py="$0.5" rounded="$full">
                        <Text fontSize={10} fontWeight="700" color="$textLight600">
                          {entry.multiplierBadge}
                        </Text>
                      </Box>
                    )}
                    <Text color="$textDark900" fontWeight="700" fontSize={16}>
                      {formatCurrency(entry.amount, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                    </Text>
                  </HStack>
                </HStack>
              ))}
            </VStack>
          ) : (
            showLocalBreakdown && (
              <VStack space="md" px="$6" pb="$6">
                <Text
                  color="$gray500"
                  fontSize={12}
                  fontWeight="700"
                  textTransform="uppercase"
                  letterSpacing={0.5}
                >
                  {t('privateHomeCards.detailedBreakdown')}
                </Text>

                <HStack space="md">
                  {/* Regular */}
                  <Box
                    flex={1}
                    bg="white"
                    p="$3"
                    rounded="$xl"
                    borderWidth={1}
                    borderColor="$borderLight100"
                  >
                    <Text color="$textLight600" fontWeight="600" fontSize={11}>
                      {t('privateHomeCards.regular')}
                    </Text>
                    <Text color="$textDark900" fontWeight="700" fontSize={18} mt="$1">
                      {formatCurrency(payData.regularPay || 0, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                    </Text>
                    <Text color="$textLight500" fontSize={11}>
                      {(() => {
                        const totalMins = Math.round(
                          (payData.regularHours || 0) * 60,
                        );
                        const h = Math.floor(totalMins / 60);
                        const m = totalMins % 60;
                        if (h === 0 && m === 0) return "0h";
                        if (h === 0) return `${m}m`;
                        if (m === 0) return `${h}h`;
                        return `${h}h ${m}m`;
                      })()}
                    </Text>
                  </Box>

                  {/* Overtime */}
                  <Box
                    flex={1}
                    bg="white"
                    p="$3"
                    rounded="$xl"
                    borderWidth={1}
                    borderColor="$borderLight100"
                  >
                    <Text color="$textLight600" fontWeight="600" fontSize={11}>
                      {t('privateHomeCards.overtime')}
                    </Text>
                    <Text color="$textDark900" fontWeight="700" fontSize={18} mt="$1">
                      {formatCurrency(payData.overtimePay || 0, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                    </Text>
                    <Text color="$textLight500" fontSize={11}>
                      {(() => {
                        const totalMins = Math.round(
                          (payData.overtimeHours || 0) * 60,
                        );
                        const h = Math.floor(totalMins / 60);
                        const m = totalMins % 60;
                        if (h === 0 && m === 0) return "0h";
                        if (h === 0) return `${m}m`;
                        if (m === 0) return `${h}h`;
                        return `${h}h ${m}m`;
                      })()}
                    </Text>
                  </Box>

                  {/* Allowances */}
                  <Box
                    flex={1}
                    bg="white"
                    p="$3"
                    rounded="$xl"
                    borderWidth={1}
                    borderColor="$borderLight100"
                  >
                    <Text color="$textLight600" fontWeight="600" fontSize={11}>
                      {t('privateHomeCards.allowances')}
                    </Text>
                    <Text color="$textDark900" fontWeight="700" fontSize={18} mt="$1">
                      {formatCurrency(payData.allowances || 0, {
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      })}
                    </Text>
                    <Text color="$textLight500" fontSize={11}>
                      {t('privateHomeCards.proRated')}
                    </Text>
                  </Box>
                </HStack>

                {/* Second row for Holiday if active */}
                {payData.holidayPay > 0 && (
                  <HStack space="md">
                    <Box
                      flex={1}
                      bg="white"
                      p="$3"
                      rounded="$xl"
                      borderWidth={1}
                      borderColor="$borderLight100"
                    >
                      <Text color="$textLight600" fontWeight="600" fontSize={11}>
                        {t('privateHomeCards.holidayPay')}
                      </Text>
                      <Text color="$textDark900" fontWeight="700" fontSize={18} mt="$1">
                        {formatCurrency(payData.holidayPay || 0, {
                          minimumFractionDigits: 0,
                          maximumFractionDigits: 0,
                        })}
                      </Text>
                      <Text color="$textLight500" fontSize={11}>
                        {payData.holidayHours.toFixed(1)}h
                      </Text>
                    </Box>
                    <Box flex={1} />
                    <Box flex={1} />
                  </HStack>
                )}
              </VStack>
            )
          )}
        </VStack>
      </Box>
    </Animated.View>
  );
};

export default PaySummary;
