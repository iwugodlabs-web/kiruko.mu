import React from 'react';
import { Palette } from '@/app/constants/theme';
import { Box, VStack, HStack, Text, Heading, Button, ButtonText, ScrollView, FlatList } from '@gluestack-ui/themed';
import { UseFormReturn } from 'react-hook-form';
import { MaterialIcons } from '@expo/vector-icons';
import { format, isWithinInterval } from 'date-fns';
import { ActivityIndicator, TouchableOpacity, Text as RNText } from 'react-native';
import { TimeLog } from '../../services/api';
import { computeHourlyFromMonthly } from '@/utils/payroll';
import { useTranslation } from 'react-i18next';
import useCurrency from '@/app/hooks/useCurrency';

interface ClockInCalculatorProps {
  calculatorMode: 'manual' | 'clockin';
  primary: string;
  prefilledProfileData: any;
  Select: any;
  SelectTrigger: any;
  SelectInput: any;
  SelectIcon: any;
  SelectPortal: any;
  SelectBackdrop: any;
  SelectContent: any;
  SelectDragIndicatorWrapper: any;
  SelectDragIndicator: any;
  SelectItem: any;
  Pressable: any;
  // Form and data props
  form: UseFormReturn<any>;
  timeframe: string;
  watchedStartDate: Date | undefined;
  watchedEndDate: Date | undefined;
  showClockIns: boolean;
  setShowClockIns: (show: boolean) => void;
  setShowStartDatePicker: (show: boolean) => void;
  setShowEndDatePicker: (show: boolean) => void;
  isCalculating: boolean;
  handleCalculateFromClockIns: () => void;
  clockInTotal: any;
  showClockInSummary: boolean;
  setShowClockInSummary: (show: boolean) => void;
  timeLogs: any[];
}

const ClockInCalculator: React.FC<ClockInCalculatorProps> = ({
  calculatorMode,
  primary,
  prefilledProfileData,

  Select,
  SelectTrigger,
  SelectInput,
  SelectIcon,
  SelectPortal,
  SelectBackdrop,
  SelectContent,
  SelectDragIndicatorWrapper,
  SelectDragIndicator,
  SelectItem,
  Pressable,
  form,
  timeframe,
  watchedStartDate,
  watchedEndDate,
  showClockIns,
  setShowClockIns,
  setShowStartDatePicker,
  setShowEndDatePicker,
  isCalculating,
  handleCalculateFromClockIns,
  clockInTotal,
  showClockInSummary,
  setShowClockInSummary,
  timeLogs,
}) => {
  const { t } = useTranslation();
  const { currencyInfo } = useCurrency();

  const { handleSubmit } = form;

  // Filter time logs based on current timeframe and calculate totals
  const { filteredTimeLogs, totalHoursForPeriod, daysWorkedInPeriod } = React.useMemo(() => {
    if (!watchedStartDate || !watchedEndDate || !timeLogs.length) {
      return {
        filteredTimeLogs: [],
        totalHoursForPeriod: 0,
        daysWorkedInPeriod: 0
      };
    }

    const dateRange = { start: watchedStartDate, end: watchedEndDate };
    const filtered = timeLogs.filter(log => {
      if (!log.start_time) return false;

      const startTime = new Date(log.start_time);
      const endTime = log.end_time ? new Date(log.end_time) : startTime; // If no end_time, use start_time

      // Check if the log overlaps with the date range
      // A log overlaps if: startTime <= rangeEnd AND endTime >= rangeStart
      const overlaps = startTime <= watchedEndDate && endTime >= watchedStartDate;

      return overlaps;
    });

    // Calculate totals
    const uniqueDays = new Set<string>();
    let totalHours = 0;

    filtered.forEach(log => {
      if (log.hours_worked && log.start_time) {
        totalHours += log.hours_worked;
        const dayKey = format(new Date(log.start_time), 'yyyy-MM-dd');
        uniqueDays.add(dayKey);
      }
    });

    return {
      filteredTimeLogs: filtered,
      totalHoursForPeriod: totalHours,
      daysWorkedInPeriod: uniqueDays.size
    };
  }, [timeLogs, watchedStartDate, watchedEndDate]);

  if (calculatorMode !== 'clockin') return null;

  return (
    <Box
      style={{ display: calculatorMode === 'clockin' ? 'flex' : 'none' }}
      bg="white"
      p="$4"
      rounded="$3xl"
      mx="$2"
      mb="$4"
      borderWidth={1}
      borderColor={Palette.gray200}
      overflow="hidden"
      shadowColor={Palette.gray700}
      shadowOffset={{ width: 0, height: 4 }}
      shadowOpacity={0.1}
      shadowRadius={12}
      elevation={8}
    >
      <HStack alignItems="center" justifyContent="space-between" mb="$6">
        <HStack alignItems="center" space="sm">
          <Box bg={Palette.gray100} p="$3" rounded="$full">
            <MaterialIcons name="access-time" size={24} color={Palette.gray700} />
          </Box>
          <VStack flex={1} style={{ flexShrink: 1 }}>
            <Heading size="lg" color={Palette.ink} fontWeight="700">
              {t('calculator.clockInTitle')}
            </Heading>
            <Text fontSize={14} color={Palette.gray500}>
              {t('calculator.basedOnRecords', { count: timeLogs.length })}
            </Text>
          </VStack>
        </HStack>
      </HStack>

      <VStack space="2xl">

        {/* SECTION 1: PROFILE INFO */}
        <Box>
          <HStack alignItems="center" space="sm" mb="$4">
            <Box bg="rgba(0,0,0,0.05)" p="$2" rounded="$full">
              <MaterialIcons name="person" size={18} color={Palette.gray700} />
            </Box>
            <Text fontSize={14} fontWeight="700" color={Palette.gray700} letterSpacing={0.5} textTransform="uppercase">
              {t('calculator.profileMetrics')}
            </Text>
          </HStack>

          <Box bg="white" p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.gray200}>
            <HStack space="md">
              <VStack flex={1} space="xs">
                <Text fontSize={12} fontWeight="600" color="$textDark500" textTransform="uppercase">{t('calculator.monthlyBase')}</Text>
                <HStack alignItems="center" space="xs">
                  <MaterialIcons name="account-balance" size={16} color={primary} />
                  <Text fontSize={16} fontWeight="700" color="$textDark800">{currencyInfo.symbol} {Number(prefilledProfileData?.salary ?? 0).toLocaleString()}</Text>
                </HStack>
              </VStack>

              <Box w={1} bg="$borderLight200" rounded="$full" />

              <VStack flex={1} space="xs">
                <Text fontSize={12} fontWeight="600" color="$textDark500" textTransform="uppercase">{t('calculator.hourlyRate')}</Text>
                <HStack alignItems="center" space="xs">
                  <MaterialIcons name="schedule" size={16} color={primary} />
                  <Text fontSize={16} fontWeight="700" color="$textDark800">{currencyInfo.symbol} {Math.round(computeHourlyFromMonthly(Number(prefilledProfileData?.salary ?? 0))).toLocaleString()}</Text>
                </HStack>
              </VStack>
            </HStack>

            <HStack mt="$3" alignItems="center" space="xs" bg="white" p="$2" rounded="$lg" borderWidth={1} borderColor="$borderLight200">
              <MaterialIcons name="verified" size={14} color={Palette.teal} />
              <Text fontSize={11} color="$text600">{t('calculator.ratesDerived')}</Text>
            </HStack>
          </Box>
        </Box>

        {/* SECTION 2: PERIOD CONFIGURATION */}
        <Box>
          <HStack alignItems="center" space="sm" mb="$4">
            <Box bg="rgba(0,0,0,0.05)" p="$2" rounded="$full">
              <MaterialIcons name="calendar-today" size={18} color={Palette.gray700} />
            </Box>
            <Text fontSize={14} fontWeight="700" color={Palette.gray700} letterSpacing={0.5} textTransform="uppercase">
              {t('calculator.calculationPeriod')}
            </Text>
          </HStack>

          <VStack space="md">
            {/* Period — pill chips */}
            <HStack space="sm" flexWrap="wrap">
              {([
                { value: 'weekly',    label: t('calculator.periodWeekly'),    icon: 'today' as const },
                { value: 'biweekly', label: t('calculator.periodBiweekly'), icon: 'date-range' as const },
                { value: 'monthly',  label: t('calculator.periodMonthly'),   icon: 'event' as const },
                { value: 'custom',   label: t('calculator.custom'),    icon: 'tune' as const },
              ]).map(opt => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => form.setValue('timeframe', opt.value as any)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
                    backgroundColor: timeframe === opt.value ? Palette.gray700 : Palette.gray50,
                    borderWidth: 1.5,
                    borderColor: timeframe === opt.value ? Palette.gray700 : Palette.gray200,
                    marginBottom: 4,
                  }}
                >
                  <MaterialIcons
                    name={opt.icon}
                    size={14}
                    color={timeframe === opt.value ? 'white' : Palette.gray700}
                  />
                  <RNText style={{
                    fontSize: 13, fontWeight: '600',
                    color: timeframe === opt.value ? 'white' : Palette.gray700,
                  }}>{opt.label}</RNText>
                </TouchableOpacity>
              ))}
            </HStack>

            {/* Date Range Display for Custom */}
            {timeframe === 'custom' && (
              <Box bg="white" rounded="$2xl" borderWidth={1} borderColor={Palette.gray200} overflow="hidden">
                {/* Range header */}
                <HStack px="$4" py="$2.5" bg={Palette.gray50} borderBottomWidth={1} borderBottomColor={Palette.gray200} alignItems="center" space="xs">
                  <MaterialIcons name="date-range" size={14} color={Palette.gray500} />
                  <Text fontSize={11} fontWeight="700" color={Palette.gray400} letterSpacing={0.8}>{t('calculator.customDateRange')}</Text>
                  {watchedStartDate && watchedEndDate && (
                    <Box ml="auto" bg={Palette.gray100} px="$2" py="$0.5" rounded="$full">
                      <Text fontSize={10} fontWeight="600" color={Palette.gray500}>
                        {t('calculator.daysCount', { count: Math.round((watchedEndDate.getTime() - watchedStartDate.getTime()) / (1000 * 60 * 60 * 24)) })}
                      </Text>
                    </Box>
                  )}
                </HStack>

                {/* Start date row */}
                <Pressable onPress={() => setShowStartDatePicker(true)}>
                  <HStack px="$4" py="$3.5" alignItems="center" borderBottomWidth={1} borderBottomColor={Palette.gray100}>
                    <Box bg={Palette.gray100} p="$2" rounded="$lg" mr="$3">
                      <MaterialIcons name="flight-takeoff" size={16} color={Palette.gray700} />
                    </Box>
                    <VStack flex={1} space={"none" as any}>
                      <Text fontSize={11} fontWeight="600" color={Palette.gray400}>{t('calculator.from')}</Text>
                      <Text fontSize={14} fontWeight="700" color={watchedStartDate ? Palette.ink : Palette.gray400}>
                        {watchedStartDate ? format(watchedStartDate, 'EEE, MMM dd yyyy') : t('calculator.selectStartDate')}
                      </Text>
                    </VStack>
                    <MaterialIcons name="chevron-right" size={20} color={Palette.gray300} />
                  </HStack>
                </Pressable>

                {/* End date row */}
                <Pressable onPress={() => setShowEndDatePicker(true)}>
                  <HStack px="$4" py="$3.5" alignItems="center">
                    <Box bg={Palette.gray100} p="$2" rounded="$lg" mr="$3">
                      <MaterialIcons name="flight-land" size={16} color={Palette.gray700} />
                    </Box>
                    <VStack flex={1} space={"none" as any}>
                      <Text fontSize={11} fontWeight="600" color={Palette.gray400}>{t('calculator.to')}</Text>
                      <Text fontSize={14} fontWeight="700" color={watchedEndDate ? Palette.ink : Palette.gray400}>
                        {watchedEndDate ? format(watchedEndDate, 'EEE, MMM dd yyyy') : t('calculator.selectEndDate')}
                      </Text>
                    </VStack>
                    <MaterialIcons name="chevron-right" size={20} color={Palette.gray300} />
                  </HStack>
                </Pressable>
              </Box>
            )}

            {/* Clock-In History Toggle */}
            <Pressable
              onPress={() => setShowClockIns(!showClockIns)}
              bg="white"
              p="$4"
              rounded="$2xl"
              borderWidth={1}
              borderColor="$borderLight200"
              shadowColor="$backgroundLight900"
              shadowOffset={{ width: 0, height: 2 }}
              shadowOpacity={0.05}
              shadowRadius={4}
              elevation={2}
            >
              <HStack justifyContent="space-between" alignItems="center">
                <HStack space="md" alignItems="center" flex={1}>
                  <Box bg="rgba(0,0,0,0.04)" p="$3" rounded="$full">
                    <MaterialIcons name="history" size={20} color={Palette.gray700} />
                  </Box>
                  <VStack flex={1}>
                    <Text fontSize={14} fontWeight="700" color="$text900">{t('calculator.historyLogs')}</Text>
                    <HStack space="sm" alignItems="center" flexWrap="wrap">
                      <Text fontSize={11} color="$text500">
                        {(() => {
                          const totalHours = totalHoursForPeriod || 0;
                          const totalMins = Math.round(totalHours * 60);
                          const h = Math.floor(totalMins / 60);
                          const m = totalMins % 60;
                          if (h === 0) return `${m}m`;
                          if (m === 0) return `${h}h`;
                          return `${h}h ${m}m`;
                        })()}
                      </Text>
                      <Text fontSize={11} color="$text400">•</Text>
                      <Text fontSize={11} color="$text500">{t('calculator.daysCount', { count: daysWorkedInPeriod })}</Text>
                      <Text fontSize={11} color="$text400">•</Text>
                      <Text fontSize={11} color="$text500">{t('calculator.recordsCount', { count: filteredTimeLogs.length })}</Text>
                    </HStack>
                  </VStack>
                </HStack>
                <MaterialIcons name={showClockIns ? 'expand-less' : 'expand-more'} size={24} color={Palette.gray500} />
              </HStack>

              {showClockIns && (
                <Box mt="$3" pt="$3" borderTopWidth={1} borderTopColor="$borderLight200">
                  <Box bg={Palette.gray50} p="$3" rounded="$lg" mb="$3">
                    <HStack justifyContent="space-between">
                      <Text fontSize={13} color={Palette.gray700} fontWeight="600">{t('calculator.totalHours')}</Text>
                      <Text fontSize={13} color={Palette.gray700} fontWeight="700">
                        {(() => {
                          const totalHours = totalHoursForPeriod || 0;
                          const totalMins = Math.round(totalHours * 60);
                          const h = Math.floor(totalMins / 60);
                          const m = totalMins % 60;
                          if (h === 0) return `${m}m`;
                          if (m === 0) return `${h}h`;
                          return `${h}h ${m}m`;
                        })()}
                      </Text>
                    </HStack>
                  </Box>
                  <ScrollView
                    style={{ maxHeight: 220 }}
                    showsVerticalScrollIndicator={true}
                    nestedScrollEnabled={true}
                  >
                    <VStack space="xs">
                      {filteredTimeLogs.length > 0 ? (
                        filteredTimeLogs.slice(0, 50).map((item: TimeLog, index: number) => (
                          <HStack key={`cis-${index}`} py="$2" justifyContent="space-between" borderBottomWidth={1} borderBottomColor="$borderLight100">
                            <Text fontSize={12} color="$text600">{format(new Date(item.start_time), 'MMM dd')}</Text>
                            <Text fontSize={12} fontWeight="600" color="$text800">
                              {(() => {
                                const itemHours = item.hours_worked || 0;
                                const itemMins = Math.round(itemHours * 60);
                                const hItem = Math.floor(itemMins / 60);
                                const mItem = itemMins % 60;
                                if (hItem === 0) return `${mItem}m`;
                                if (mItem === 0) return `${hItem}h`;
                                return `${hItem}h ${mItem}m`;
                              })()}
                            </Text>
                          </HStack>
                        ))
                      ) : (
                        <Text fontSize={12} color="$text400" textAlign="center" py="$2">{t('calculator.noLogsFound')}</Text>
                      )}
                    </VStack>
                  </ScrollView>
                </Box>
              )}
            </Pressable>
          </VStack>
        </Box>

        {/* Calculate Button */}
        <Button
          bg={timeLogs.length === 0 ? '$borderLight300' : Palette.gray700}
          h="$16"
          rounded="$2xl"
          w="100%"
          shadowColor={Palette.gray700}
          shadowOffset={{ width: 0, height: 4 }}
          shadowOpacity={0.3}
          shadowRadius={8}
          elevation={6}
          onPress={handleSubmit(handleCalculateFromClockIns)}
          isDisabled={timeLogs.length === 0 || isCalculating}
          sx={{
            ":active": { transform: [{ scale: 0.98 }] },
            ":disabled": { opacity: 0.7 }
          }}
        >
          <HStack space="md" alignItems="center" justifyContent="center">
            {isCalculating ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              <MaterialIcons name="calculate" size={24} color="white" />
            )}
            <ButtonText fontSize={18} fontWeight="700" color="white">
              {isCalculating ? t('calculator.computing') : timeLogs.length === 0 ? t('calculator.noDataAvailable') : t('calculator.calculateEstimate')}
            </ButtonText>
          </HStack>
        </Button>
      </VStack>
    </Box>
  );
};

export default ClockInCalculator;