import { Palette, Type } from '@/app/constants/theme';
import { Box, HStack, Input, InputField, Text, VStack } from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { Card, FieldLabel, SavingOverlay, SectionShell, saveFailed, saveSuccess, str, submitOnboard, useProfileBootstrap } from '@/components/private_profile/shared';

export default function PayScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { privateUserId, job, salary, companyLocked, loading, refreshAuth } = useProfileBootstrap();

  const [monthlySalary, setMonthlySalary] = useState('');
  const [monthlyAllowance, setMonthlyAllowance] = useState('');
  const [monthlyHours, setMonthlyHours] = useState('208');
  const [workingDays, setWorkingDays] = useState('26');
  const [breakMinutes, setBreakMinutes] = useState('60');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading) return;
    setMonthlySalary(str(salary?.salary));
    const allowance = salary?.allowance ?? (salary?.revenue && salary?.salary
      ? String(Math.max(0, (parseFloat(String(salary.revenue)) || 0) - (parseFloat(String(salary.salary)) || 0)))
      : '');
    setMonthlyAllowance(str(allowance));
    setMonthlyHours(str(salary?.monthly_hours) || '208');
    setWorkingDays(str(salary?.days_of_work_per_month) || '26');
    setBreakMinutes(str(salary?.break_in_minutes_per_day) || '60');
  }, [loading, salary]);

  const hasJob = !!job;
  const disabled = companyLocked || !hasJob;

  const onSave = async () => {
    if (privateUserId === undefined || !hasJob) return;
    const salaryNum = parseFloat(monthlySalary);
    if (!Number.isFinite(salaryNum) || salaryNum < 0) {
      Alert.alert(t('common.errorTitle', { defaultValue: 'Error' }), t('profile.salaryRequired', { defaultValue: 'Enter a valid monthly salary.' }));
      return;
    }
    setSaving(true);
    try {
      await submitOnboard({
        user_data: { private_user_id: Number(privateUserId) },
        salary_data: {
          monthly_hours: monthlyHours.trim() || '208',
          break_in_minutes_per_day: Number(breakMinutes) || 0,
          days_of_work_per_month: Number(workingDays) || 0,
          salary: monthlySalary.trim(),
          allowance: monthlyAllowance.trim() || '0',
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
      <SectionShell title={t('profileHub.payTitle', { defaultValue: 'Pay & Payslip' })} onSave={() => {}} saving={false} saveDisabled>
        <SavingOverlay />
      </SectionShell>
    );
  }

  return (
    <SectionShell
      title={t('profileHub.payTitle', { defaultValue: 'Pay & Payslip' })}
      subtitle={t('profileHub.paySub', { defaultValue: 'Salary details for payslip estimates' })}
      onSave={onSave}
      saving={saving}
      saveDisabled={disabled}
    >
      {!hasJob && (
        <Box bg={Palette.blueTint} rounded="$xl" p="$4" mb="$4" borderWidth={1} borderColor="#C9D3F7">
          <HStack space="sm" alignItems="center">
            <MaterialIcons name="info-outline" size={18} color={Palette.blue} />
            <Text flex={1} fontSize={Type.small} color={Palette.blue} fontWeight="600">
              {t('profileHub.needEmployerForPay', { defaultValue: 'Add an employer in Work & Schedule before saving salary details. You can still estimate payslips from the calculator.' })}
            </Text>
          </HStack>
        </Box>
      )}
      {companyLocked && (
        <Box bg={Palette.warningTint} rounded="$xl" p="$3" mb="$4" borderLeftWidth={3} borderLeftColor={Palette.gold}>
          <HStack space="sm" alignItems="center">
            <MaterialIcons name="lock" size={16} color={Palette.gold} />
            <Text flex={1} fontSize={Type.small} color={Palette.gold} fontWeight="700">
              {t('profile.lockedHint', { defaultValue: 'Managed by your employer' })}
            </Text>
          </HStack>
        </Box>
      )}

      <Card color={Palette.blue}>
        <VStack space="md">
          <Box>
            <FieldLabel>{t('profile.labelMonthlySalary', { defaultValue: 'Monthly salary' })}</FieldLabel>
            <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} isDisabled={disabled}>
              <InputField value={monthlySalary} onChangeText={setMonthlySalary} editable={!disabled} keyboardType="numeric" />
            </Input>
          </Box>
          <Box>
            <FieldLabel>{t('profile.labelMonthlyAllowance', { defaultValue: 'Monthly allowance' })}</FieldLabel>
            <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} isDisabled={disabled}>
              <InputField value={monthlyAllowance} onChangeText={setMonthlyAllowance} editable={!disabled} keyboardType="numeric" />
            </Input>
          </Box>
          <HStack space="md">
            <Box flex={1}>
              <FieldLabel>{t('profile.labelHoursPerMonth', { defaultValue: 'Hours / month' })}</FieldLabel>
              <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} isDisabled={disabled}>
                <InputField value={monthlyHours} onChangeText={setMonthlyHours} editable={!disabled} keyboardType="numeric" />
              </Input>
            </Box>
            <Box flex={1}>
              <FieldLabel>{t('profile.labelDaysPerMonth', { defaultValue: 'Days / month' })}</FieldLabel>
              <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} isDisabled={disabled}>
                <InputField value={workingDays} onChangeText={setWorkingDays} editable={!disabled} keyboardType="numeric" />
              </Input>
            </Box>
          </HStack>
          <Box>
            <FieldLabel>{t('profile.labelBreakMinutes', { defaultValue: 'Break minutes / day' })}</FieldLabel>
            <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} isDisabled={disabled}>
              <InputField value={breakMinutes} onChangeText={setBreakMinutes} editable={!disabled} keyboardType="numeric" />
            </Input>
          </Box>
        </VStack>
      </Card>
    </SectionShell>
  );
}
