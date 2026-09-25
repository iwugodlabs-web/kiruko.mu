import { createOnboardJob, getCompanyByBrn, getUserDetail } from '@/services/api';
import { Palette, Type } from '@/app/constants/theme';
import { StandardButton } from '@/app/design-system';
import { PremiumHeader } from '@/components/PremiumHeader';
import { Box, HStack, Heading, Input, InputField, InputSlot, Pressable, Spinner, Text, VStack } from '@gluestack-ui/themed';
import { Building2, Check, ChevronDown, ChevronUp, Clock } from 'lucide-react-native';
import { MobileDatePicker } from '@/components/private_profile/shared';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, KeyboardAvoidingView, Platform, SafeAreaView, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useAuth from '../hooks/useAuth';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const pad2 = (n: number) => String(n).padStart(2, '0');

// Deterministic HH:MM — toLocaleTimeString returns locale formats like
// "08 h 00" (French), which the backend rejects with a 422.
const fmtTime = (d: Date) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;

const parseTime = (value: string): Date => {
  const m = (value || '').match(/(\d{1,2})\s*(?::|h|H)\s*(\d{2})/);
  const h = m ? Number(m[1]) : 9;
  const min = m ? Number(m[2]) : 0;
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(min) ? min : 0, 0, 0);
  return d;
};

const defaultWorkDays = (): Record<string, string> => {
  const map: Record<string, string> = {};
  DAYS.slice(0, 5).forEach((d) => {
    map[d] = '8';
  });
  return map;
};

export default function SetupScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, login } = useAuth();
  const insets = useSafeAreaInsets();

  const [noEmployer, setNoEmployer] = useState(false);

  const [brn, setBrn] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [companyFound, setCompanyFound] = useState(false);
  const [isBrnLoading, setIsBrnLoading] = useState(false);
  const [jobTitle, setJobTitle] = useState('');

  const [startTime, setStartTime] = useState<Date>(() => parseTime('09:00'));
  const [endTime, setEndTime] = useState<Date>(() => parseTime('17:00'));
  const [workDays, setWorkDays] = useState<Record<string, string>>(defaultWorkDays);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const [salaryOpen, setSalaryOpen] = useState(false);
  const [salary, setSalary] = useState('');
  const [allowance, setAllowance] = useState('');
  const [monthlyHours, setMonthlyHours] = useState('208');
  const [workingDays, setWorkingDays] = useState('26');
  const [breakMinutes, setBreakMinutes] = useState('60');

  const [isSubmitting, setIsSubmitting] = useState(false);

  const brnTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const onBrnChange = (value: string) => {
    setBrn(value);
    setCompanyFound(false);
    if (brnTimer.current) clearTimeout(brnTimer.current);
    if (!value || value.trim().length < 3) {
      setCompanyName('');
      setIsBrnLoading(false);
      return;
    }
    brnTimer.current = setTimeout(async () => {
      setIsBrnLoading(true);
      try {
        const result: any = await getCompanyByBrn(value.trim());
        if (result?.status === 'success' && result.data) {
          setCompanyName(result.data.company_name ?? '');
          setCompanyFound(true);
        } else {
          setCompanyFound(false);
          setCompanyName('');
        }
      } catch {
        setCompanyFound(false);
      } finally {
        setIsBrnLoading(false);
      }
    }, 500);
  };

  const toggleDay = (day: string) => {
    Haptics.selectionAsync();
    setWorkDays((prev) => {
      const next = { ...prev };
      if (next[day]) delete next[day];
      else next[day] = '8';
      return next;
    });
  };

  const selectedDayCount = Object.keys(workDays).length;

  const privateUserId = useMemo(
    () =>
      user?.private_user?.private_user_id ??
      (user as any)?.private_user_id ??
      (user?.user_id !== undefined ? Number(user.user_id) : undefined),
    [user],
  );

  const canSubmit = noEmployer
    ? true
    : jobTitle.trim().length > 0 &&
      (companyFound || companyName.trim().length > 0) &&
      selectedDayCount > 0;

  const refreshAuth = async () => {
    try {
      if (login && user?.user_id !== undefined) {
        const latest = await getUserDetail(user.user_id as any);
        if (latest && !('error' in latest)) {
          await login(latest as any, (user as any).token);
        }
      }
    } catch {
      // Non-fatal — data is saved server-side.
    }
  };

  const onSubmit = async () => {
    if (privateUserId === undefined) {
      Alert.alert(t('common.errorTitle', { defaultValue: 'Error' }), t('setup.noUser', { defaultValue: 'Could not identify your account. Please log out and back in.' }));
      return;
    }
    if (!canSubmit) return;

    setIsSubmitting(true);
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      const userData: Record<string, any> = { private_user_id: Number(privateUserId) };
      if (noEmployer) userData.onboarding_acknowledged_no_employer = true;

      const payload: Record<string, any> = { user_data: userData };

      if (!noEmployer) {
        payload.job_data = {
          private_user_id: Number(privateUserId),
          job_title: jobTitle.trim(),
          employer_name: companyName.trim() || jobTitle.trim(),
          employer_brn: brn.trim() || null,
          work_start_time: fmtTime(startTime),
          work_end_time: fmtTime(endTime),
          work_days: workDays,
        };

        const hasSalary = salary.trim().length > 0;
        if (hasSalary) {
          payload.salary_data = {
            monthly_hours: monthlyHours.trim() || '208',
            break_in_minutes_per_day: Number(breakMinutes) || 0,
            days_of_work_per_month: Number(workingDays) || 0,
            salary: salary.trim(),
            allowance: allowance.trim() || '0',
          };
        }
      }

      const result: any = await createOnboardJob(payload);
      if (result?.error) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(t('setup.saveFailed', { defaultValue: 'Could not save' }), result.error);
        return;
      }

      await refreshAuth();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace('/private_dashboard/home' as any);
    } catch (e: any) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('common.errorTitle', { defaultValue: 'Error' }), e?.message || t('setup.unexpected', { defaultValue: 'Something went wrong. Please try again.' }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <PremiumHeader
        title={t('setup.title', { defaultValue: 'Set up your clock-in' })}
        subtitle={t('setup.subtitle', { defaultValue: 'Takes ~20 seconds · change it anytime' })}
        showBack={Boolean(user?.onboard_complete)}
        onBack={() => router.push('/private_dashboard/settings' as any)}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 64 : 0}
      >
        <ScrollView
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
        >
          {/* Employer card */}
          <Box bg={Palette.tealTint} rounded="$2xl" p="$5" mb="$4" borderWidth={1} borderColor="#B9F1E7">
            <HStack space="sm" alignItems="center" mb="$4">
              <Box bg={Palette.white} p="$2" rounded="$full">
                <Building2 size={20} color={Palette.teal} />
              </Box>
              <VStack flex={1}>
                <Heading size="sm" color={Palette.ink}>{t('setup.whereDoYouWork', { defaultValue: 'Where do you work?' })}</Heading>
                <Text size="xs" color={Palette.gray600}>{t('setup.whereHint', { defaultValue: 'Search by BRN, or add it manually.' })}</Text>
              </VStack>
            </HStack>

            {!noEmployer && (
              <VStack space="md">
                <Input size="xl" variant="outline" rounded="$xl" bg={Palette.white}>
                  <InputField
                    placeholder={t('setup.brnPlaceholder', { defaultValue: 'Employer BRN' })}
                    value={brn}
                    onChangeText={onBrnChange}
                    autoCapitalize="characters"
                  />
                  <InputSlot pr="$4">
                    {isBrnLoading ? (
                      <Spinner size="small" color={Palette.teal} />
                    ) : companyFound ? (
                      <Check size={18} color={Palette.success} />
                    ) : null}
                  </InputSlot>
                </Input>

                <Input size="xl" variant="outline" rounded="$xl" bg={companyFound ? Palette.gray50 : Palette.white}>
                  <InputField
                    placeholder={t('setup.employerName', { defaultValue: 'Employer / company name' })}
                    value={companyName}
                    onChangeText={setCompanyName}
                    editable={!companyFound}
                  />
                </Input>

                <Input size="xl" variant="outline" rounded="$xl" bg={Palette.white}>
                  <InputField
                    placeholder={t('setup.jobTitle', { defaultValue: 'Your job title' })}
                    value={jobTitle}
                    onChangeText={setJobTitle}
                  />
                </Input>
              </VStack>
            )}

            <Pressable onPress={() => setNoEmployer((v) => !v)} mt="$4">
              <HStack space="sm" alignItems="center">
                <Box
                  w={22}
                  h={22}
                  rounded="$md"
                  borderWidth={2}
                  borderColor={noEmployer ? Palette.teal : Palette.gray300}
                  bg={noEmployer ? Palette.teal : 'transparent'}
                  alignItems="center"
                  justifyContent="center"
                >
                  {noEmployer && <Check size={14} color={Palette.white} />}
                </Box>
                <Text size="sm" color={Palette.gray700} fontWeight="600">
                  {t('setup.notWorking', { defaultValue: "I'm not working right now" })}
                </Text>
              </HStack>
            </Pressable>
          </Box>

          {/* Schedule card */}
          <Box bg={Palette.gray50} rounded="$2xl" p="$5" mb="$4" borderWidth={1} borderColor={Palette.gray200}>
            <HStack space="sm" alignItems="center" mb="$4">
              <Box bg={Palette.white} p="$2" rounded="$full">
                <Clock size={20} color={Palette.teal} />
              </Box>
              <VStack flex={1}>
                <Heading size="sm" color={Palette.ink}>{t('setup.schedule', { defaultValue: 'Your schedule' })}</Heading>
                <Text size="xs" color={Palette.gray600}>{t('setup.scheduleHint', { defaultValue: 'Pre-filled — tap to adjust.' })}</Text>
              </VStack>
            </HStack>

            <HStack space="md" mb="$4">
              <Pressable flex={1} onPress={() => setShowStartPicker(true)}>
                <Box bg={Palette.white} rounded="$xl" p="$3" borderWidth={1} borderColor={Palette.gray200}>
                  <Text size="xs" color={Palette.gray500} fontWeight="700">{t('setup.start', { defaultValue: 'START' })}</Text>
                  <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink}>{fmtTime(startTime)}</Text>
                </Box>
              </Pressable>
              <Pressable flex={1} onPress={() => setShowEndPicker(true)}>
                <Box bg={Palette.white} rounded="$xl" p="$3" borderWidth={1} borderColor={Palette.gray200}>
                  <Text size="xs" color={Palette.gray500} fontWeight="700">{t('setup.end', { defaultValue: 'END' })}</Text>
                  <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink}>{fmtTime(endTime)}</Text>
                </Box>
              </Pressable>
            </HStack>

            <MobileDatePicker
              visible={showStartPicker}
              mode="time"
              value={startTime}
              onClose={() => setShowStartPicker(false)}
              onChange={setStartTime}
              title={t('setup.start', { defaultValue: 'Start' })}
            />
            <MobileDatePicker
              visible={showEndPicker}
              mode="time"
              value={endTime}
              onClose={() => setShowEndPicker(false)}
              onChange={setEndTime}
              title={t('setup.end', { defaultValue: 'End' })}
            />

            <HStack space="xs" flexWrap="wrap" mb="$2">
              {DAYS.map((day) => {
                const active = Boolean(workDays[day]);
                return (
                  <Pressable key={day} onPress={() => toggleDay(day)} mb="$2">
                    <Box
                      px="$3"
                      py="$2"
                      rounded="$full"
                      borderWidth={1.5}
                      borderColor={active ? Palette.teal : Palette.gray200}
                      bg={active ? Palette.tealTint : Palette.white}
                    >
                      <Text fontSize={Type.small} fontWeight="800" color={active ? Palette.teal : Palette.gray400}>
                        {day.slice(0, 3)}
                      </Text>
                    </Box>
                  </Pressable>
                );
              })}
            </HStack>
            <Text size="xs" color={Palette.gray500}>
              {selectedDayCount > 0
                ? t('setup.summary', {
                    defaultValue: '{{start}} – {{end}} · {{days}} day(s)/week',
                    start: fmtTime(startTime),
                    end: fmtTime(endTime),
                    days: selectedDayCount,
                  })
                : t('setup.pickDay', { defaultValue: 'Pick at least one work day.' })}
            </Text>
          </Box>

          {/* Optional salary */}
          <Pressable onPress={() => setSalaryOpen((v) => !v)}>
            <Box bg={Palette.blueTint} rounded="$2xl" p="$4" mb="$4" borderWidth={1} borderColor="#C9D3F7">
              <HStack alignItems="center" justifyContent="space-between">
                <VStack flex={1}>
                  <Text fontWeight="800" color={Palette.ink}>
                    {t('setup.addSalary', { defaultValue: 'Add salary now (optional)' })}
                  </Text>
                  <Text size="xs" color={Palette.gray600}>
                    {t('setup.addSalaryHint', { defaultValue: 'Helps estimate your payslip. You can add it later.' })}
                  </Text>
                </VStack>
                {salaryOpen ? <ChevronUp size={20} color={Palette.blue} /> : <ChevronDown size={20} color={Palette.blue} />}
              </HStack>
            </Box>
          </Pressable>

          {salaryOpen && (
            <Box bg={Palette.white} rounded="$2xl" p="$5" mb="$4" borderWidth={1} borderColor={Palette.gray200}>
              <VStack space="md">
                <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                  <InputField placeholder={t('setup.salary', { defaultValue: 'Monthly salary' })} keyboardType="numeric" value={salary} onChangeText={setSalary} />
                </Input>
                <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                  <InputField placeholder={t('setup.allowance', { defaultValue: 'Monthly allowance' })} keyboardType="numeric" value={allowance} onChangeText={setAllowance} />
                </Input>
                <HStack space="md">
                  <Input flex={1} size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                    <InputField placeholder={t('setup.hours', { defaultValue: 'Hours / month' })} keyboardType="numeric" value={monthlyHours} onChangeText={setMonthlyHours} />
                  </Input>
                  <Input flex={1} size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                    <InputField placeholder={t('setup.days', { defaultValue: 'Days / month' })} keyboardType="numeric" value={workingDays} onChangeText={setWorkingDays} />
                  </Input>
                </HStack>
                <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                  <InputField placeholder={t('setup.break', { defaultValue: 'Break minutes / day' })} keyboardType="numeric" value={breakMinutes} onChangeText={setBreakMinutes} />
                </Input>
              </VStack>
            </Box>
          )}
        </ScrollView>

        <Box
          px="$4"
          pt="$3"
          bg={Palette.white}
          borderTopWidth={1}
          borderTopColor={Palette.gray100}
          style={{ paddingBottom: Math.max(insets.bottom, 12) + 12 }}
        >
          <StandardButton.Primary onPress={onSubmit} isLoading={isSubmitting} isDisabled={!canSubmit || isSubmitting}>
            {t('setup.cta', { defaultValue: 'Start using Kiruko' })}
          </StandardButton.Primary>
          {!noEmployer && (
            <Pressable onPress={() => setNoEmployer(true)} style={{ marginTop: 12 }}>
              <Text size="sm" textAlign="center" color={Palette.gray500} fontWeight="600">
                {t('setup.later', { defaultValue: "I'll add my employer later" })}
              </Text>
            </Pressable>
          )}
        </Box>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
