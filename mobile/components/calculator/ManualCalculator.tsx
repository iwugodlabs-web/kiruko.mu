import React from 'react';
import { Palette } from '@/app/constants/theme';
import { Box, VStack, HStack, Text, Heading, Button, ButtonText, Pressable, ScrollView } from '@gluestack-ui/themed';
import { UseFormReturn } from 'react-hook-form';
import { MaterialIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { InputAccessoryView, Keyboard, Platform, ActivityIndicator, TouchableOpacity, Text as RNText, View as RNView, ScrollView as RNScrollView } from 'react-native';
import Animated, { FadeInUp, SlideInLeft, SlideInRight } from '@/app/utils/animated';
import { useTranslation } from 'react-i18next';
import useCurrency from '@/app/hooks/useCurrency';
import { StandardButton } from '@/app/design-system';
import CalculatorInput from './CalculatorInput';
import SearchablePicker from './SearchablePicker';
import { computeHourlyFromMonthly, DEFAULT_MONTHLY_HOURS } from '@/utils/payroll';

interface ManualCalculatorProps {
  calculatorMode: 'manual' | 'clockin';
  primary: string;
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
  // Form and data props  
  form: UseFormReturn<any>;
  categories: any[];
  grades: any[];
  sectors: any[];
  watchedSector: string;
  watchedCategory: string;
  watchedGrade: string;
  watchedServiceYears: string;
  watchedBasicSalary: string;
  watchedDaysMode: string;
  watchedHoursMode: string;
  watchedNumberOfHoursWorked: string;
  watchedTimeframe?: string;
  yearsOptions: Array<number | string>;
  hasRequiredSelection: boolean;
  isCalculating: boolean;
  handleCalculate: () => void;
  daysPerMonthUsed: number;
  // Stepper functions
  decrementHours: () => void;
  incrementHours: () => void;
  handleLongPressStart: (type: 'increment' | 'decrement') => void;
  handleLongPressEnd: () => void;
  errors: any;
}

const ManualCalculator: React.FC<ManualCalculatorProps> = ({
  calculatorMode,
  primary,
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
  form,
  categories,
  grades,
  sectors,
  watchedSector,
  watchedCategory,
  watchedGrade,
  watchedServiceYears,
  watchedBasicSalary,
  watchedDaysMode,
  watchedHoursMode,
  watchedNumberOfHoursWorked,
  watchedTimeframe,
  yearsOptions,
  hasRequiredSelection,
  isCalculating,
  handleCalculate,
  daysPerMonthUsed,
  decrementHours,
  incrementHours,
  handleLongPressStart,
  handleLongPressEnd,
  errors,
}) => {
  const { t } = useTranslation();
  const { currencyInfo } = useCurrency();

  const { handleSubmit } = form;

  // Watch salary basis and expectedKg for dynamic updates when productivity is used
  const salaryBasisWatch = form.watch('salaryBasis');
  const expectedKgWatch = form.watch('expectedKg');
  const productivitySourceWatch = form.watch('productivitySource');

  // Handle productivity-based salary derivation (grade name encodes kg target, e.g. "Up to 125kg").
  // Daily/monthly salary derivation for regular grades is handled by the parent (calculator.tsx)
  // via parseSourceToMonthly(), which respects the selected days-mode. We only handle the
  // productivity case here because it requires extracting the kg amount from the grade name.
  React.useEffect(() => {
    if (!watchedGrade || categories.length === 0 || grades.length === 0) return;

    const selectedGrade = grades.find(g => g.id.toString() === watchedGrade);
    if (!selectedGrade) return;

    // Only run this effect for productivity-based grades (grade name contains a kg value)
    // Match "kg", "kilogram", "kilograms", "kilogramme", "kilogrammes"
    const kgMatch = selectedGrade.name.match(/(\d+)\s*(?:kg|kilog?ram(?:me)?s?)/i);
    if (!kgMatch) {
      // Reset productivity UI if it was previously set by a different grade
      if (form.getValues('salaryBasis') === 'productivity') {
        form.setValue('salaryBasis', '');
        form.setValue('productivitySource', '');
        form.setValue('expectedKg', '');
      }
      return;
    }

    const parentCategory = categories.find(cat => cat.id === selectedGrade.category_id);
    if (!parentCategory?.salary_ranges) return;

    const selectedYears = watchedServiceYears ? Number(watchedServiceYears) : 0;
    // Prefer ranges linked to the specific grade (sector_grade_id), then fall back to unlinked ranges
    const applicableRange = parentCategory.salary_ranges.find((range: any) => {
      if (range.sector_grade_id != null && range.sector_grade_id !== selectedGrade.id) return false;
      const minYears = range.min_years_of_service ?? 0;
      const maxYears = range.max_years_of_service ?? 999;
      return selectedYears >= minYears && selectedYears <= maxYears;
    }) ?? parentCategory.salary_ranges.find((range: any) => range.sector_grade_id === selectedGrade.id && range.productivity != null)
      ?? parentCategory.salary_ranges.find((range: any) => range.productivity != null);

    if (!applicableRange) return;

    const prodVal = applicableRange.productivity != null && applicableRange.productivity > 0
      ? Number(applicableRange.productivity) : null;
    if (!prodVal || isNaN(prodVal)) return;

    const expectedKg = Number(kgMatch[1]);
    const derivedSalary = prodVal * expectedKg;
    form.setValue('salaryBasis', 'productivity');
    form.setValue('productivitySource', String(prodVal));
    form.setValue('expectedKg', String(expectedKg));
    form.setValue('derivedSalary', String(derivedSalary));
    form.setValue('basicSalary', String(derivedSalary));
    form.setValue('hourlyRate', String((computeHourlyFromMonthly(derivedSalary)).toFixed(2)));
    form.setValue('salaryBand', `Monthly: ${currencyInfo.symbol} ${Math.round(derivedSalary)}`);
  }, [watchedGrade, watchedServiceYears, categories, grades, currencyInfo.symbol]);

  // When productivity is used and expectedKg changes, recalc derived salary
  React.useEffect(() => {
    try {
      if (form.getValues('salaryBasis') === 'productivity') {
        const prodVal = Number(form.getValues('productivitySource') || 0);
        const kgVal = Number(form.getValues('expectedKg') || 0);
        if (!isNaN(prodVal) && prodVal > 0 && !isNaN(kgVal) && kgVal > 0) {
          const monthlyFromKg = prodVal * kgVal;
          form.setValue('derivedSalary', String(monthlyFromKg));
          form.setValue('basicSalary', String(monthlyFromKg));
          const hourlyRate = computeHourlyFromMonthly(monthlyFromKg);
          form.setValue('hourlyRate', String(hourlyRate.toFixed(2)));
          form.setValue('salaryBand', `Monthly: ${currencyInfo.symbol} ${Math.round(monthlyFromKg)}`);
        }
      }
    } catch (err) {
      // ignore
    }
  }, [salaryBasisWatch, expectedKgWatch, productivitySourceWatch, currencyInfo.symbol]);

  const hourlyRateWatch = form.watch('hourlyRate');

  const formatNumber = (value: string | undefined | null) => {
    if (!value || typeof value !== 'string') return '';
    const numericValue = value.replace(/[^\d.]/g, '');
    const n = Number(numericValue);
    return !isNaN(n) && numericValue !== '' ? Math.round(n).toLocaleString() : '';
  };

  const parseNumber = (formattedValue: string | undefined | null) => {
    if (!formattedValue || typeof formattedValue !== 'string') return '';
    return formattedValue.replace(/[^\d]/g, '');
  };

  if (calculatorMode !== 'manual') return null;

  return (
    <Box
      style={{ display: calculatorMode === 'manual' ? 'flex' : 'none' }}
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
            <MaterialIcons name="calculate" size={24} color={Palette.gray700} />
          </Box>
          <VStack flex={1} style={{ flexShrink: 1 }}>
            <Heading size="lg" color={Palette.ink} fontWeight="700">
              {t('calculator.manualTitle')}
            </Heading>
            <Text fontSize={14} color={Palette.gray500}>
              {t('calculator.manualSubtitle')}
            </Text>
          </VStack>
        </HStack>
      </HStack>

      <VStack space="2xl">

        {/* SECTION 1: JOB CONFIGURATION */}
        <Box>
          {/* Section Header */}
          <HStack alignItems="center" space="sm" mb="$4">
            <Box bg="rgba(0,0,0,0.05)" p="$2" rounded="$full">
              <MaterialIcons name="work" size={18} color={Palette.gray700} />
            </Box>
            <Text fontSize={14} fontWeight="700" color={Palette.gray700} letterSpacing={0.5} textTransform="uppercase">
              {t('calculator.jobConfiguration')}
            </Text>
          </HStack>

          <Box bg="white" p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.gray200}>
            <VStack space="lg">

              {/* ── Step 1: Sector ── */}
              <VStack space="xs">
                <HStack alignItems="center" space="xs" mb="$1.5">
                  <RNView style={{
                    width: 22, height: 22, borderRadius: 11,
                    backgroundColor: watchedSector ? Palette.gray700 : Palette.gray100,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {watchedSector
                      ? <MaterialIcons name="check" size={13} color="white" />
                      : <RNText style={{ fontSize: 11, fontWeight: '700', color: Palette.gray700 }}>1</RNText>}
                  </RNView>
                  <Text fontSize={13} fontWeight="600" color={Palette.gray700}>{t('calculator.sector')}</Text>
                  {!watchedSector && (
                    <Text fontSize={11} color={Palette.gray400} fontStyle="italic">{t('calculator.sectorHint')}</Text>
                  )}
                </HStack>
                <SearchablePicker
                  items={sectors.map((s: any) => ({ value: s.id.toString(), label: s.name }))}
                  value={watchedSector}
                  onSelect={(v: string) => form.setValue('sector', v)}
                  placeholder={t('calculator.sectorPlaceholder')}
                  label={t('calculator.sector')}
                  accentColor={Palette.gray700}
                />
                {errors.sector && <Text fontSize={12} color="$error600">{errors.sector.message as string}</Text>}
              </VStack>

              {/* ── Step 2: Category ── */}
              <RNView style={{ opacity: watchedSector ? 1 : 0.45 }}>
                <VStack space="xs">
                  <HStack alignItems="center" space="xs" mb="$1.5">
                    <RNView style={{
                      width: 22, height: 22, borderRadius: 11,
                      backgroundColor: watchedCategory ? Palette.gray700 : Palette.gray100,
                      alignItems: 'center', justifyContent: 'center',
                    }}>
                      {watchedCategory
                        ? <MaterialIcons name="check" size={13} color="white" />
                        : <RNText style={{ fontSize: 11, fontWeight: '700', color: Palette.gray700 }}>2</RNText>}
                    </RNView>
                    <Text fontSize={13} fontWeight="600" color={Palette.gray700}>{t('calculator.category')}</Text>
                  </HStack>
                  <SearchablePicker
                    items={categories.map((c: any) => ({ value: c.id.toString(), label: c.name }))}
                    value={watchedCategory}
                    onSelect={(v: string) => form.setValue('category', v)}
                    placeholder={!watchedSector ? t('calculator.categoryPlaceholderNoSector') : t('calculator.categoryPlaceholder')}
                    label={t('calculator.category')}
                    isDisabled={!watchedSector}
                    accentColor={Palette.gray700}
                  />
                  {errors.category && <Text fontSize={12} color="$error600">{errors.category.message as string}</Text>}
                </VStack>
              </RNView>

              {/* ── Step 3: Grade & Years ── */}
              {(grades.length > 0 || yearsOptions.length > 0) && (
                <VStack space="lg">
                  {grades.length > 0 && (
                    <VStack space="xs">
                      <HStack alignItems="center" space="xs" mb="$1.5">
                        <RNView style={{
                          width: 22, height: 22, borderRadius: 11,
                          backgroundColor: watchedGrade ? Palette.gray700 : Palette.gray100,
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          {watchedGrade
                            ? <MaterialIcons name="check" size={13} color="white" />
                            : <RNText style={{ fontSize: 11, fontWeight: '700', color: Palette.gray700 }}>3</RNText>}
                        </RNView>
                        <Text fontSize={13} fontWeight="600" color={Palette.gray700}>{t('calculator.grade')}</Text>
                      </HStack>
                      <SearchablePicker
                        items={grades.map((g: any) => ({ value: g.id.toString(), label: g.name }))}
                        value={watchedGrade}
                        onSelect={(v: string) => form.setValue('grade', v)}
                        placeholder={t('calculator.gradePlaceholder')}
                        label={t('calculator.grade')}
                        accentColor={Palette.gray700}
                      />
                    </VStack>
                  )}

                  {yearsOptions.length > 0 && (
                    <VStack space="xs">
                      <HStack alignItems="center" space="xs" mb="$1.5">
                        <RNView style={{
                          width: 22, height: 22, borderRadius: 11,
                          backgroundColor: watchedServiceYears ? Palette.gray700 : Palette.gray100,
                          alignItems: 'center', justifyContent: 'center',
                        }}>
                          {watchedServiceYears
                            ? <MaterialIcons name="check" size={13} color="white" />
                            : <RNText style={{ fontSize: 11, fontWeight: '700', color: Palette.gray700 }}>{grades.length > 0 ? '4' : '3'}</RNText>}
                        </RNView>
                        <Text fontSize={13} fontWeight="600" color={Palette.gray700}>{t('calculator.yearsOfService')}</Text>
                      </HStack>
                      <RNScrollView horizontal showsHorizontalScrollIndicator={false}>
                        <HStack space="sm" py="$1">
                          {yearsOptions.map((y) => (
                            <TouchableOpacity
                              key={String(y)}
                              onPress={() => form.setValue('serviceYears', String(y))}
                              style={{
                                paddingHorizontal: 16, paddingVertical: 9, borderRadius: 20,
                                backgroundColor: watchedServiceYears === String(y) ? Palette.gray700 : Palette.gray50,
                                borderWidth: 1.5,
                                borderColor: watchedServiceYears === String(y) ? Palette.gray700 : Palette.gray200,
                              }}
                            >
                              <RNText style={{
                                fontSize: 13, fontWeight: '600',
                                color: watchedServiceYears === String(y) ? 'white' : Palette.gray700,
                              }}>
                                {y}{String(y).endsWith('+') || String(y) === '<1' ? '' : Number(y) === 1 ? t('calculator.yearSuffix') : t('calculator.yearsSuffix')}
                              </RNText>
                            </TouchableOpacity>
                          ))}
                        </HStack>
                      </RNScrollView>
                    </VStack>
                  )}
                </VStack>
              )}

            </VStack>
          </Box>
        </Box>

        {/* SECTION 2: FINANCIAL DETAILS */}
        <Box>
          {/* Section Header */}
          <HStack alignItems="center" space="sm" mb="$4">
            <Box bg="rgba(22, 163, 74, 0.1)" p="$2" rounded="$full">
              <MaterialIcons name="payments" size={18} color={Palette.success} />
            </Box>
            <Text fontSize={14} fontWeight="700" color={Palette.gray700} letterSpacing={0.5} textTransform="uppercase">
              {t('calculator.compensation')}
            </Text>
          </HStack>

          <VStack space="lg">
            {/* Basic Salary Card */}
            {!watchedBasicSalary ? (
              <Box
                bg="$success50"
                p="$4"
                rounded="$xl"
                borderWidth={1.5}
                borderColor="$success200"
                style={{ borderStyle: 'dashed' }}
              >
                <HStack alignItems="center" space="sm">
                  <Box bg="rgba(22,163,74,0.12)" p="$2" rounded="$full">
                    <MaterialIcons name="payments" size={20} color={Palette.success} />
                  </Box>
                  <VStack>
                    <Text fontSize={13} fontWeight="600" color="$success700">{t('calculator.basicSalary')}</Text>
                    <Text fontSize={12} color="$success600" fontStyle="italic">
                      {t('calculator.selectJobDetails')}
                    </Text>
                  </VStack>
                </HStack>
                <Box style={{ display: 'none' }}>
                  <CalculatorInput control={form.control} name="basicSalary" icon={null} readOnly={true} />
                </Box>
              </Box>
            ) : (
              <Box bg="$success50" p="$4" rounded="$xl" borderWidth={1} borderColor="$success200">
                <HStack justifyContent="space-between" alignItems="flex-start">
                  <VStack space="xs" flex={1}>
                    <HStack alignItems="center" space="xs">
                      <Text fontSize={11} fontWeight="700" color="$success700" textTransform="uppercase" letterSpacing={0.8}>
                        {t('calculator.basicSalary')}
                      </Text>
                      <MaterialIcons name="lock" size={11} color={Palette.success} />
                    </HStack>
                    <HStack alignItems="flex-end" space="xs">
                      <Text fontSize={26} fontWeight="800" color="$success800">
                        {currencyInfo.symbol} {formatNumber(String(watchedBasicSalary))}
                      </Text>
                      <Text fontSize={13} color="$success600" mb="$1.5">{t('calculator.perMonthShort')}</Text>
                    </HStack>
                    {hourlyRateWatch && parseFloat(hourlyRateWatch) > 0 && (
                      <HStack alignItems="center" space="xs" mt="$0.5">
                        <MaterialIcons name="schedule" size={12} color={Palette.success} />
                        <Text fontSize={12} color="$success600">
                          {currencyInfo.symbol} {parseFloat(hourlyRateWatch).toFixed(2)}{t('calculator.perHourShort')}
                        </Text>
                      </HStack>
                    )}
                  </VStack>
                  <Box bg="rgba(22,163,74,0.12)" p="$2" rounded="$full">
                    <MaterialIcons name="trending-up" size={18} color={Palette.success} />
                  </Box>
                </HStack>
                <Box style={{ display: 'none' }}>
                  <CalculatorInput control={form.control} name="basicSalary" icon={null} readOnly={true} />
                </Box>
              </Box>
            )}

            {/* If productivity was used, allow entering expected kg/month to compute monthly salary */}
            {form.watch('salaryBasis') === 'productivity' && (
              <VStack mt="$2" space="sm">
                <Text fontSize={12} color="$text500">{t('calculator.productivityNote', { symbol: currencyInfo.symbol })}</Text>
                <CalculatorInput
                  control={form.control}
                  icon={<MaterialIcons name="scale" size={20} color={Palette.gray500} />}
                  name="expectedKg"
                  placeholder={t('calculator.expectedKgPlaceholder')}
                  keyboardType="numeric"
                  readOnly={false}
                  isDisabled={false}
                />
                <HStack alignItems="center" space="sm">
                  <Text fontSize={12} color="$text500">{t('calculator.productivityRate')}</Text>
                  <Text fontSize={12} fontWeight="$semibold">{currencyInfo.symbol} {form.getValues('productivitySource') || ''} /kg</Text>
                </HStack>
              </VStack>
            )}

            {/* Config Grid — pill selectors */}
            <Box bg="white" p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.gray200}>
              <VStack space="lg">

                {/* Work Days pills */}
                <VStack space="xs">
                  <HStack alignItems="center" space="xs" mb="$1">
                    <MaterialIcons name="calendar-today" size={14} color={Palette.gray700} />
                    <Text fontSize={11} fontWeight="700" color={Palette.gray500} textTransform="uppercase" letterSpacing={0.6}>
                      {t('calculator.workDaysMonth')}
                    </Text>
                  </HStack>
                  <HStack space="sm">
                    {([
                      { value: '22', label: t('calculator.days22') },
                      { value: '26', label: t('calculator.days26') },
                      { value: 'profile', label: t('calculator.auto') },
                    ] as const).map(opt => (
                      <TouchableOpacity
                        key={opt.value}
                        onPress={() => form.setValue('daysPerMonthMode', opt.value)}
                        style={{
                          flex: 1, paddingVertical: 10, borderRadius: 12,
                          backgroundColor: watchedDaysMode === opt.value ? Palette.gray700 : Palette.gray50,
                          borderWidth: 1.5,
                          borderColor: watchedDaysMode === opt.value ? Palette.gray700 : Palette.gray200,
                          alignItems: 'center',
                        }}
                      >
                        <RNText style={{
                          fontSize: 13, fontWeight: '700',
                          color: watchedDaysMode === opt.value ? 'white' : Palette.gray700,
                        }}>{opt.label}</RNText>
                      </TouchableOpacity>
                    ))}
                  </HStack>
                  <Text fontSize={11} color={Palette.gray400}>{t('calculator.daysEffective', { count: daysPerMonthUsed })}</Text>
                </VStack>

                {/* Hours per Month pills */}
                <VStack space="xs">
                  <HStack alignItems="center" space="xs" mb="$1">
                    <MaterialIcons name="access-time" size={14} color={Palette.gray700} />
                    <Text fontSize={11} fontWeight="700" color={Palette.gray500} textTransform="uppercase" letterSpacing={0.6}>
                      {t('calculator.hoursMonth')}
                    </Text>
                  </HStack>
                  <HStack space="sm">
                    {([
                      { value: '195', label: '195h', sub: t('calculator.subStd') },
                      { value: '180', label: '180h', sub: t('calculator.subRed') },
                      { value: '80', label: '80h', sub: t('calculator.subPart') },
                      { value: 'custom', label: t('calculator.custom'), sub: '' },
                    ] as const).map(opt => (
                      <TouchableOpacity
                        key={opt.value}
                        onPress={() => form.setValue('numberOfHoursWorkedMode', opt.value)}
                        style={{
                          flex: 1, paddingVertical: 10, borderRadius: 12, alignItems: 'center',
                          backgroundColor: watchedHoursMode === opt.value ? Palette.gray700 : Palette.gray50,
                          borderWidth: 1.5,
                          borderColor: watchedHoursMode === opt.value ? Palette.gray700 : Palette.gray200,
                        }}
                      >
                        <RNText style={{
                          fontSize: 12, fontWeight: '700',
                          color: watchedHoursMode === opt.value ? 'white' : Palette.gray700,
                        }}>{opt.label}</RNText>
                        {opt.sub ? (
                          <RNText style={{
                            fontSize: 9, fontWeight: '500',
                            color: watchedHoursMode === opt.value ? 'rgba(255,255,255,0.8)' : Palette.gray700,
                            marginTop: 1,
                          }}>{opt.sub}</RNText>
                        ) : null}
                      </TouchableOpacity>
                    ))}
                  </HStack>

                  {/* Custom hours stepper */}
                  {watchedHoursMode === 'custom' && (
                    <Box bg={Palette.gray50} p="$3" rounded="$xl" borderWidth={1} borderColor={Palette.gray200} mt="$1">
                      <HStack alignItems="center" space="sm">
                        <Pressable
                          onPress={decrementHours}
                          onLongPress={() => handleLongPressStart('decrement')}
                          onPressOut={handleLongPressEnd}
                          p="$2" bg="white" rounded="$lg" borderWidth={1} borderColor={Palette.gray200}
                          accessibilityLabel={t('calculator.decreaseHours')}
                        >
                          <MaterialIcons name="remove" size={18} color={Palette.gray700} />
                        </Pressable>
                        <Box flex={1}>
                          <CalculatorInput control={form.control} name="numberOfHoursWorked" placeholder={t('calculator.enterHours')} keyboardType="numeric" icon={null} />
                        </Box>
                        <Pressable
                          onPress={incrementHours}
                          onLongPress={() => handleLongPressStart('increment')}
                          onPressOut={handleLongPressEnd}
                          p="$2" bg="white" rounded="$lg" borderWidth={1} borderColor={Palette.gray200}
                          accessibilityLabel={t('calculator.increaseHours')}
                        >
                          <MaterialIcons name="add" size={18} color={Palette.gray700} />
                        </Pressable>
                      </HStack>
                    </Box>
                  )}
                </VStack>

              </VStack>
            </Box>


            {/* Adjustments */}
            <VStack space="md">
              <HStack alignItems="center" space="sm" mb="$1" mt="$4">
                <Box bg="rgba(0,0,0,0.04)" p="$2" rounded="$full">
                  <MaterialIcons name="tune" size={18} color={Palette.gray700} />
                </Box>
                <Text fontSize={14} fontWeight="700" color={Palette.gray700} letterSpacing={0.5} textTransform="uppercase">
                  {t('calculator.adjustments')}
                </Text>
              </HStack>

              <Box bg="white" rounded="$2xl" borderWidth={1} borderColor={Palette.gray200} overflow="hidden">
                {/* Allowances Row */}
                <VStack px="$4" pt="$4" pb="$3" borderBottomWidth={1} borderBottomColor={Palette.gray100} space="sm">
                  <HStack justifyContent="space-between" alignItems="center">
                    <HStack space="sm" alignItems="center">
                      <Box bg="rgba(22,163,74,0.1)" p="$1.5" rounded="$full">
                        <MaterialIcons name="add" size={15} color={Palette.success} />
                      </Box>
                      <VStack space={"none" as any}>
                        <Text fontSize={13} fontWeight="700" color={Palette.ink}>{t('calculator.allowances')}</Text>
                        <Text fontSize={11} color={Palette.gray400}>{t('calculator.allowancesRowSub')}</Text>
                      </VStack>
                    </HStack>
                    <Box bg="rgba(22,163,74,0.08)" px="$2" py="$0.5" rounded="$md">
                      <Text fontSize={10} fontWeight="700" color={Palette.success}>{t('calculator.adds')}</Text>
                    </Box>
                  </HStack>
                  <CalculatorInput
                    control={form.control}
                    name="allowances"
                    placeholder="0.00"
                    keyboardType="numeric"
                    icon={null}
                  />
                </VStack>

                {/* Deductions Row */}
                <VStack px="$4" pt="$3" pb="$4" space="sm">
                  <HStack justifyContent="space-between" alignItems="center">
                    <HStack space="sm" alignItems="center">
                      <Box bg="rgba(239,68,68,0.1)" p="$1.5" rounded="$full">
                        <MaterialIcons name="remove" size={15} color={Palette.errorAlt} />
                      </Box>
                      <VStack space={"none" as any}>
                        <Text fontSize={13} fontWeight="700" color={Palette.ink}>{t('calculator.deductions')}</Text>
                        <Text fontSize={11} color={Palette.gray400}>{t('calculator.deductionsRowSub')}</Text>
                      </VStack>
                    </HStack>
                    <Box bg="rgba(239,68,68,0.08)" px="$2" py="$0.5" rounded="$md">
                      <Text fontSize={10} fontWeight="700" color={Palette.errorAlt}>{t('calculator.subs')}</Text>
                    </Box>
                  </HStack>
                  <CalculatorInput
                    control={form.control}
                    name="deductions"
                    placeholder="0.00"
                    keyboardType="numeric"
                    icon={null}
                  />
                </VStack>
              </Box>
            </VStack>

          </VStack>
        </Box>

        {/* Calculate Button */}
        <Button
          bg={!hasRequiredSelection ? '$borderLight300' : Palette.gray700}
          h="$16"
          rounded="$2xl"
          w="100%"
          shadowColor={Palette.gray700}
          shadowOffset={{ width: 0, height: 4 }}
          shadowOpacity={!hasRequiredSelection ? 0 : 0.3}
          shadowRadius={8}
          elevation={!hasRequiredSelection ? 0 : 6}
          onPress={handleSubmit(handleCalculate)}
          accessibilityLabel={t('calculator.calculateAria')}
          isDisabled={!hasRequiredSelection || isCalculating}
          sx={{
            ":active": { transform: [{ scale: 0.98 }] },
            ":disabled": { opacity: 0.8 }
          }}
        >
          <VStack alignItems="center" space="xs">
            <HStack space="md" alignItems="center" justifyContent="center">
              {isCalculating ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <MaterialIcons name="calculate" size={24} color={!hasRequiredSelection ? Palette.gray400 : 'white'} />
              )}
              <ButtonText fontSize={18} fontWeight="700" color={!hasRequiredSelection ? '$textLight500' : 'white'}>
                {isCalculating ? t('calculator.computing') : t('calculator.calculateSalary')}
              </ButtonText>
            </HStack>
            {!hasRequiredSelection && !isCalculating && (
              <ButtonText fontSize={12} color="$textLight500" fontWeight="400">
                {!watchedSector ? t('calculator.selectSectorToBegin') : !watchedCategory ? t('calculator.selectCategoryToContinue') : t('calculator.completeJobDetails')}
              </ButtonText>
            )}
          </VStack>
        </Button>
      </VStack>
    </Box>
  );
};

export default ManualCalculator;