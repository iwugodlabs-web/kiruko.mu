import { Palette, Type } from '@/app/constants/theme';
import { Box, HStack, Input, InputField, InputSlot, Pressable, Text, VStack } from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert } from 'react-native';
import {
  Card,
  DAYS,
  EmployerSuggestions,
  FieldLabel,
  MobileDatePicker,
  SectionShell,
  SavingOverlay,
  YesNo,
  formatDate,
  formatTime,
  parseDate,
  parseTimeDate,
  saveFailed,
  saveSuccess,
  submitOnboard,
  toBool,
  toBoolStr,
  useProfileBootstrap,
} from '@/components/private_profile/shared';
import { getCompanyByBrn } from '@/services/api';

export default function WorkScheduleScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { privateUserId, job, companyLocked, loading, refreshAuth } = useProfileBootstrap();

  const [employer, setEmployer] = useState('');
  const [employerBrn, setEmployerBrn] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [employerEmail, setEmployerEmail] = useState('');
  const [employerPhone, setEmployerPhone] = useState('');
  const [employerAddress, setEmployerAddress] = useState('');
  const [startDate, setStartDate] = useState<Date>(new Date());
  const [startTime, setStartTime] = useState<Date>(() => parseTimeDate('09:00'));
  const [endTime, setEndTime] = useState<Date>(() => parseTimeDate('17:00'));
  const [selectedDays, setSelectedDays] = useState<Record<string, boolean>>({});
  const [hoursPerDay, setHoursPerDay] = useState('8');
  const [autoClockIn, setAutoClockIn] = useState<'true' | 'false' | ''>('');
  const [showStartDate, setShowStartDate] = useState(false);
  const [showStartTime, setShowStartTime] = useState(false);
  const [showEndTime, setShowEndTime] = useState(false);
  const [saving, setSaving] = useState(false);
  const [brnLoading, setBrnLoading] = useState(false);
  const [companyFound, setCompanyFound] = useState(false);
  // True once the user types in the BRN field. Distinguishes a deliberate
  // employer change (overwrite identity fields with the matched company) from
  // the automatic mount-time backfill (only fill blanks, never clobber the
  // user's existing employer/schedule data).
  const brnUserEdited = useRef(false);

  useEffect(() => {
    if (loading) return;
    setEmployer(job?.employer_name ?? '');
    setEmployerBrn(job?.employer_brn ?? '');
    setJobTitle(job?.job_title ?? '');
    setEmployerEmail(job?.employer_email ?? '');
    setEmployerPhone(job?.employer_phone ?? '');
    setEmployerAddress(job?.employer_address ?? '');
    setStartDate(job?.first_date_of_employment ? parseDate(job.first_date_of_employment) : new Date());
    setStartTime(parseTimeDate(job?.work_start_time || '09:00'));
    setEndTime(parseTimeDate(job?.work_end_time || '17:00'));
    const wd: Record<string, boolean> = {};
    if (job?.work_days && typeof job.work_days === 'object') {
      Object.keys(job.work_days).forEach((d) => {
        wd[d] = true;
      });
      const firstVal = Object.values(job.work_days)[0];
      if (firstVal) setHoursPerDay(String(firstVal));
    }
    setSelectedDays(wd);
    setAutoClockIn(toBoolStr(job?.auto_clockin_enabled));
  }, [loading, job]);

  // Look up the company by BRN (case-insensitive on the backend) and pre-fill
  // the employer IDENTITY fields (name/email/phone/address). Never touches the
  // schedule (work days, hours, times, start date) — those are the user's own.
  //
  // Two modes:
  //  - mount/backfill (brnUserEdited=false): only fill blanks, so existing
  //    employer + schedule data entered at signup is never overwritten. This is
  //    what backfills a missing employer name for a BRN stored at signup.
  //  - user changed the BRN (brnUserEdited=true): overwrite identity fields with
  //    the matched company, because switching BRN means switching employer.
  useEffect(() => {
    if (loading || companyLocked) return;
    const brn = employerBrn.trim();
    if (brn.length < 3) {
      setCompanyFound(false);
      setBrnLoading(false);
      return;
    }
    const timeoutId = setTimeout(async () => {
      setBrnLoading(true);
      try {
        const result: any = await getCompanyByBrn(brn);
        if (result?.status === 'success' && result.data) {
          setCompanyFound(true);
          const overwrite = brnUserEdited.current;
          const apply = (setter: React.Dispatch<React.SetStateAction<string>>, next?: string | null) => {
            if (next == null) return;
            setter((prev) => (overwrite || !(prev && prev.trim()) ? String(next) : prev));
          };
          apply(setEmployer, result.data.company_name);
          apply(setEmployerEmail, result.data.email);
          apply(setEmployerPhone, result.data.phone);
          apply(setEmployerAddress, result.data.address);
        } else {
          setCompanyFound(false);
        }
      } catch (e: any) {
        console.debug('BRN lookup miss:', e?.message);
        setCompanyFound(false);
      } finally {
        setBrnLoading(false);
      }
    }, 500);
    return () => clearTimeout(timeoutId);
  }, [employerBrn, loading, companyLocked]);

  const toggleDay = (day: string) =>
    setSelectedDays((prev) => ({ ...prev, [day]: !prev[day] }));

  const selectedCount = Object.values(selectedDays).filter(Boolean).length;

  const onSave = async () => {
    if (privateUserId === undefined) return;
    if (!jobTitle.trim()) {
      Alert.alert(t('common.errorTitle', { defaultValue: 'Error' }), t('profile.jobRequired', { defaultValue: 'Job title is required.' }));
      return;
    }
    if (selectedCount === 0) {
      Alert.alert(t('common.errorTitle', { defaultValue: 'Error' }), t('setup.pickDay', { defaultValue: 'Pick at least one work day.' }));
      return;
    }
    setSaving(true);
    try {
      const workDays: Record<string, string> = {};
      DAYS.forEach((d) => {
        if (selectedDays[d]) workDays[d] = hoursPerDay.trim() || '8';
      });
      await submitOnboard({
        user_data: { private_user_id: Number(privateUserId) },
        job_data: {
          private_user_id: Number(privateUserId),
          job_title: jobTitle.trim(),
          employer_name: employer.trim() || null,
          employer_brn: employerBrn.trim() || null,
          employer_email: employerEmail.trim() || null,
          employer_phone: employerPhone.trim() || null,
          employer_address: employerAddress.trim() || null,
          first_date_of_employment: formatDate(startDate),
          work_start_time: formatTime(startTime),
          work_end_time: formatTime(endTime),
          work_days: workDays,
          auto_clockin_enabled: toBool(autoClockIn),
        },
      });
      await refreshAuth();
      saveSuccess();
      router.back();
    } catch (e: any) {
      saveFailed();
      Alert.alert(t('common.errorTitle', { defaultValue: 'Error' }), e?.message || t('profile.saveFailed', { defaultValue: 'Failed to save.' }));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SectionShell title={t('profileHub.workTitle', { defaultValue: 'Work & Schedule' })} onSave={() => {}} saving={false} saveDisabled>
        <SavingOverlay />
      </SectionShell>
    );
  }

  const disabled = companyLocked;

  return (
    <SectionShell
      title={t('profileHub.workTitle', { defaultValue: 'Work & Schedule' })}
      subtitle={t('profileHub.workSub', { defaultValue: 'Employer, job and working hours' })}
      onSave={onSave}
      saving={saving}
      saveDisabled={disabled}
    >
      {disabled && (
        <Box bg={Palette.warningTint} rounded="$xl" p="$3" mb="$4" borderLeftWidth={3} borderLeftColor={Palette.gold}>
          <HStack space="sm" alignItems="center">
            <MaterialIcons name="lock" size={16} color={Palette.gold} />
            <Text flex={1} fontSize={Type.small} color={Palette.gold} fontWeight="700">
              {t('profile.lockedHint', { defaultValue: 'Managed by your employer' })}
            </Text>
          </HStack>
        </Box>
      )}

      <Card>
        <Text fontWeight="800" color={Palette.ink} mb="$3">
          {t('profile.sectionEmployerJob', { defaultValue: 'Employer & job' })}
        </Text>
        <VStack space="md">
          <Box>
            <FieldLabel>{t('profile.labelEmployerBrn', { defaultValue: 'Employer BRN' })}</FieldLabel>
            <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} isDisabled={disabled}>
              <InputField
                value={employerBrn}
                onChangeText={(v) => { brnUserEdited.current = true; setEmployerBrn(v); }}
                editable={!disabled}
                autoCapitalize="characters"
                placeholder={t('profile.brnSearchPlaceholder', { defaultValue: 'Search BRN or company name' })}
              />
              <InputSlot pr="$3">
                {brnLoading ? (
                  <ActivityIndicator size="small" color={Palette.gray400} />
                ) : companyFound ? (
                  <MaterialIcons name="check-circle" size={20} color={Palette.teal} />
                ) : null}
              </InputSlot>
            </Input>
            <EmployerSuggestions
              query={employerBrn}
              disabled={disabled}
              onSelect={(c) => {
                brnUserEdited.current = true;
                setEmployer(c.company_name ?? '');
                setEmployerBrn(c.brn ?? '');
              }}
            />
            {companyFound && (
              <Text fontSize={Type.caption} color={Palette.teal} fontWeight="700" mt="$1">
                {t('profile.brnCompanyFound', { defaultValue: 'Registered employer matched' })}
              </Text>
            )}
          </Box>
          <Box>
            <FieldLabel>{t('profile.labelEmployerName', { defaultValue: 'Employer name' })}</FieldLabel>
            <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} isDisabled={disabled}>
              <InputField value={employer} onChangeText={setEmployer} editable={!disabled} />
            </Input>
          </Box>
          <Box>
            <FieldLabel>{t('profile.labelJobTitle', { defaultValue: 'Job title' })}</FieldLabel>
            <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} isDisabled={disabled}>
              <InputField value={jobTitle} onChangeText={setJobTitle} editable={!disabled} />
            </Input>
          </Box>
          <Box>
            <FieldLabel>{t('profile.labelEmployerEmail', { defaultValue: 'Employer email' })}</FieldLabel>
            <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} isDisabled={disabled}>
              <InputField value={employerEmail} onChangeText={setEmployerEmail} editable={!disabled} keyboardType="email-address" autoCapitalize="none" />
            </Input>
          </Box>
          <Box>
            <FieldLabel>{t('profile.labelEmployerPhone', { defaultValue: 'Employer phone' })}</FieldLabel>
            <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} isDisabled={disabled}>
              <InputField value={employerPhone} onChangeText={setEmployerPhone} editable={!disabled} keyboardType="phone-pad" />
            </Input>
          </Box>
          <Box>
            <FieldLabel>{t('profile.labelWorkAddress', { defaultValue: 'Work address' })}</FieldLabel>
            <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} isDisabled={disabled}>
              <InputField value={employerAddress} onChangeText={setEmployerAddress} editable={!disabled} />
            </Input>
          </Box>
          <Box>
            <FieldLabel>{t('profile.labelEmploymentStartDate', { defaultValue: 'Employment start date' })}</FieldLabel>
            <Pressable onPress={() => !disabled && setShowStartDate(true)}>
              <Box bg={Palette.gray50} rounded="$xl" p="$3" borderWidth={1} borderColor={Palette.gray200} opacity={disabled ? 0.5 : 1}>
                <Text fontWeight="700" color={Palette.ink}>{formatDate(startDate)}</Text>
              </Box>
            </Pressable>
          </Box>
        </VStack>
      </Card>

      <Card color={Palette.teal}>
        <Text fontWeight="800" color={Palette.ink} mb="$3">
          {t('profile.sectionWorkingHours', { defaultValue: 'Working hours' })}
        </Text>
        <HStack space="md" mb="$3">
          <Pressable flex={1} onPress={() => !disabled && setShowStartTime(true)}>
            <Box bg={Palette.gray50} rounded="$xl" p="$3" borderWidth={1} borderColor={Palette.gray200} opacity={disabled ? 0.5 : 1}>
              <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="700">{t('setup.start', { defaultValue: 'START' })}</Text>
              <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink}>{formatTime(startTime)}</Text>
            </Box>
          </Pressable>
          <Pressable flex={1} onPress={() => !disabled && setShowEndTime(true)}>
            <Box bg={Palette.gray50} rounded="$xl" p="$3" borderWidth={1} borderColor={Palette.gray200} opacity={disabled ? 0.5 : 1}>
              <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="700">{t('setup.end', { defaultValue: 'END' })}</Text>
              <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink}>{formatTime(endTime)}</Text>
            </Box>
          </Pressable>
        </HStack>

        <HStack space="xs" flexWrap="wrap" mb="$3">
          {DAYS.map((day) => {
            const active = !!selectedDays[day];
            return (
              <Pressable key={day} onPress={() => !disabled && toggleDay(day)} mb="$2" disabled={disabled}>
                <Box
                  px="$3"
                  py="$2"
                  rounded="$full"
                  borderWidth={1.5}
                  borderColor={active ? Palette.teal : Palette.gray200}
                  bg={active ? Palette.tealTint : Palette.white}
                  opacity={disabled ? 0.5 : 1}
                >
                  <Text fontSize={Type.small} fontWeight="800" color={active ? Palette.teal : Palette.gray400}>
                    {day.slice(0, 3)}
                  </Text>
                </Box>
              </Pressable>
            );
          })}
        </HStack>

        <Box>
          <FieldLabel>{t('profile.placeholderHours', { defaultValue: 'Hours per day' })}</FieldLabel>
          <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} w="$24" isDisabled={disabled}>
            <InputField value={hoursPerDay} onChangeText={setHoursPerDay} editable={!disabled} keyboardType="numeric" />
          </Input>
        </Box>
      </Card>

      <Card>
        <Text fontWeight="800" color={Palette.ink} mb="$2">
          {t('profile.sectionAutoClock', { defaultValue: 'Auto clock-in reminders' })}
        </Text>
        <Text size="xs" color={Palette.gray500} mb="$3">
          {t('profile.autoClockHint', { defaultValue: 'We will remind you at your start and end times on work days.' })}
        </Text>
        <YesNo value={autoClockIn} onChange={setAutoClockIn} disabled={disabled} color={Palette.teal} />
      </Card>

      <MobileDatePicker
        visible={showStartDate}
        mode="date"
        value={startDate}
        maximumDate={new Date()}
        onClose={() => setShowStartDate(false)}
        onChange={setStartDate}
        title={t('profile.labelEmploymentStartDate', { defaultValue: 'Employment start date' })}
      />
      <MobileDatePicker
        visible={showStartTime}
        mode="time"
        value={startTime}
        onClose={() => setShowStartTime(false)}
        onChange={setStartTime}
        title={t('setup.start', { defaultValue: 'Start' })}
      />
      <MobileDatePicker
        visible={showEndTime}
        mode="time"
        value={endTime}
        onClose={() => setShowEndTime(false)}
        onChange={setEndTime}
        title={t('setup.end', { defaultValue: 'End' })}
      />
    </SectionShell>
  );
}
