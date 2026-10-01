import { Palette, Type } from '@/app/constants/theme';
import { Box, HStack, Pressable, Text, VStack } from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import {
  Card,
  DEDUCTION_REASONS,
  FieldLabel,
  SavingOverlay,
  SectionShell,
  jobBase,
  saveFailed,
  saveSuccess,
  submitOnboard,
  toBool,
  toBoolStr,
  useProfileBootstrap,
} from '@/components/private_profile/shared';

const PERMIT_TYPES = ['occupational', 'work', 'none'];

// Permit type values are sent to the backend as-is; `profile.permit*` are the
// existing display labels in the i18n schema.
const PERMIT_LABEL_KEYS: Record<string, string> = {
  occupational: 'permitOccupational',
  work: 'permitWork',
  none: 'permitNone',
};

export default function ComplianceScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { privateUserId, job, companyLocked, loading, refreshAuth } = useProfileBootstrap();

  const [hasContract, setHasContract] = useState<'true' | 'false' | ''>('');
  const [hasPermit, setHasPermit] = useState<'true' | 'false' | ''>('');
  const [permitType, setPermitType] = useState('');
  const [touristVisa, setTouristVisa] = useState<'true' | 'false' | ''>('');
  const [salaryDeductions, setSalaryDeductions] = useState<'true' | 'false' | ''>('');
  const [reasons, setReasons] = useState<Record<string, boolean>>({ Food: false, Lodging: false, Transport: false, Uniform: false });
  const [housingCovered, setHousingCovered] = useState<'true' | 'false' | ''>('');
  const [isDormitory, setIsDormitory] = useState<'true' | 'false' | ''>('');
  const [isDecentHousing, setIsDecentHousing] = useState<'true' | 'false' | ''>('');
  const [passportHeld, setPassportHeld] = useState<'true' | 'false' | ''>('');
  const [workMatch, setWorkMatch] = useState<'true' | 'false' | ''>('');
  const [doubts, setDoubts] = useState<'true' | 'false' | ''>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loading) return;
    setHasContract(toBoolStr(job?.has_contract));
    setHasPermit(toBoolStr(job?.has_permission_to_work));
    setPermitType(job?.work_permit_type || '');
    setTouristVisa(toBoolStr(job?.working_on_tourist_visa));
    setSalaryDeductions(toBoolStr(job?.is_salary_deducted));
    setReasons(job?.reason_for_deduction || { Food: false, Lodging: false, Transport: false, Uniform: false });
    setHousingCovered(toBoolStr(job?.is_accommodation_covered_by_employer));
    setIsDormitory(toBoolStr(job?.is_accommodation_a_dormitory));
    setIsDecentHousing(toBoolStr(job?.is_accommodation_decent));
    setPassportHeld(toBoolStr(job?.is_passport_retained));
    setWorkMatch(toBoolStr(job?.is_job_execution_same_as_description));
    setDoubts(toBoolStr(job?.doubts_about_compensation));
  }, [loading, job]);

  const hasJob = !!job && !!job.job_title;
  const disabled = companyLocked || !hasJob;

  const onSave = async () => {
    if (privateUserId === undefined || !hasJob) return;
    setSaving(true);
    try {
      await submitOnboard({
        user_data: { private_user_id: Number(privateUserId) },
        job_data: {
          ...jobBase(job, Number(privateUserId)),
          has_contract: toBool(hasContract),
          has_permission_to_work: toBool(hasPermit),
          work_permit_type: permitType || null,
          working_on_tourist_visa: toBool(touristVisa),
          is_salary_deducted: toBool(salaryDeductions),
          reason_for_deduction: reasons,
          is_accommodation_covered_by_employer: toBool(housingCovered),
          is_accommodation_a_dormitory: toBool(isDormitory),
          is_accommodation_decent: toBool(isDecentHousing),
          is_passport_retained: toBool(passportHeld),
          is_job_execution_same_as_description: toBool(workMatch),
          doubts_about_compensation: toBool(doubts),
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
      <SectionShell title={t('profileHub.complianceTitle', { defaultValue: 'Rights & Compliance' })} onSave={() => {}} saving={false} saveDisabled>
        <SavingOverlay />
      </SectionShell>
    );
  }

  const YesNoInline = ({ value, onChange, color = Palette.green }: { value: string; onChange: (v: 'true' | 'false') => void; color?: string }) => {
    const Pill = ({ label, v }: { label: string; v: 'true' | 'false' }) => {
      const active = value === v;
      return (
        <Pressable onPress={() => !disabled && onChange(v)} disabled={disabled} flex={1} opacity={disabled ? 0.5 : 1}>
          <Box
            rounded="$full"
            borderWidth={1.5}
            borderColor={active ? color : Palette.gray200}
            bg={active ? color + '12' : Palette.white}
            py="$2"
            alignItems="center"
          >
            <Text fontSize={Type.small} fontWeight="700" color={active ? color : Palette.gray500}>
              {label}
            </Text>
          </Box>
        </Pressable>
      );
    };
    return (
      <HStack space="sm">
        <Pill label={t('common.yes', { defaultValue: 'Yes' })} v="true" />
        <Pill label={t('common.no', { defaultValue: 'No' })} v="false" />
      </HStack>
    );
  };

  const Question: React.FC<{ label: string; value: string; onChange: (v: 'true' | 'false') => void }> = ({ label, value, onChange }) => (
    <Box>
      <FieldLabel>{label}</FieldLabel>
      <YesNoInline value={value} onChange={onChange} />
    </Box>
  );

  return (
    <SectionShell
      title={t('profileHub.complianceTitle', { defaultValue: 'Rights & Compliance' })}
      subtitle={t('profileHub.complianceSub', { defaultValue: 'Required to file a report' })}
      onSave={onSave}
      saving={saving}
      saveDisabled={disabled}
    >
      {!hasJob && (
        <Box bg={Palette.greenTint} rounded="$xl" p="$4" mb="$4" borderWidth={1} borderColor="#BBF7D0">
          <HStack space="sm" alignItems="center">
            <MaterialIcons name="info-outline" size={18} color={Palette.green} />
            <Text flex={1} fontSize={Type.small} color={Palette.green} fontWeight="600">
              {t('profileHub.needEmployerForCompliance', { defaultValue: 'Add your employer in Work & Schedule first — these questions are about your job.' })}
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

      <Card color={Palette.green}>
        <VStack space="lg">
          <Question label={t('profile.labelContract', { defaultValue: 'Do you have a written contract?' })} value={hasContract} onChange={setHasContract} />
          <Question label={t('profile.labelPermit', { defaultValue: 'Do you have a work permit?' })} value={hasPermit} onChange={setHasPermit} />

          <Box>
            <FieldLabel>{t('profile.labelPermitType', { defaultValue: 'Permit type' })}</FieldLabel>
            <HStack space="sm">
              {PERMIT_TYPES.map((pt) => {
                const active = permitType === pt;
                return (
                  <Pressable key={pt} onPress={() => !disabled && setPermitType(pt)} disabled={disabled} flex={1} opacity={disabled ? 0.5 : 1}>
                    <Box
                      rounded="$full"
                      borderWidth={1.5}
                      borderColor={active ? Palette.green : Palette.gray200}
                      bg={active ? Palette.greenTint : Palette.white}
                      py="$2"
                      alignItems="center"
                    >
                      <Text fontSize={Type.caption} fontWeight="700" color={active ? Palette.green : Palette.gray500}>
                        {t(`profile.${PERMIT_LABEL_KEYS[pt] ?? 'permitNone'}`, { defaultValue: pt })}
                      </Text>
                    </Box>
                  </Pressable>
                );
              })}
            </HStack>
          </Box>

          <Question label={t('profile.labelTouristVisa', { defaultValue: 'Are you working on a tourist visa?' })} value={touristVisa} onChange={setTouristVisa} />

          <Question label={t('profile.labelSalaryDeductions', { defaultValue: 'Are any deductions taken from your salary?' })} value={salaryDeductions} onChange={setSalaryDeductions} />
          {salaryDeductions === 'true' && (
            <HStack space="xs" flexWrap="wrap">
              {DEDUCTION_REASONS.map((r) => {
                const active = !!reasons[r];
                return (
                  <Pressable key={r} onPress={() => !disabled && setReasons((prev) => ({ ...prev, [r]: !prev[r] }))} disabled={disabled} mb="$2">
                    <Box
                      px="$3"
                      py="$2"
                      rounded="$full"
                      borderWidth={1.5}
                      borderColor={active ? Palette.green : Palette.gray200}
                      bg={active ? Palette.greenTint : Palette.white}
                      opacity={disabled ? 0.5 : 1}
                    >
                      <Text fontSize={Type.small} fontWeight="700" color={active ? Palette.green : Palette.gray500}>
                        {t(`profile.deduction${r}`, { defaultValue: r })}
                      </Text>
                    </Box>
                  </Pressable>
                );
              })}
            </HStack>
          )}

          <Question label={t('profile.labelAccommodationCovered', { defaultValue: 'Is accommodation provided by your employer?' })} value={housingCovered} onChange={setHousingCovered} />
          {housingCovered === 'true' && (
            <>
              <Question label={t('profile.labelDormitory', { defaultValue: 'Is it a dormitory?' })} value={isDormitory} onChange={setIsDormitory} />
              <Question label={t('profile.labelDecentHousing', { defaultValue: 'Is the housing decent?' })} value={isDecentHousing} onChange={setIsDecentHousing} />
            </>
          )}

          <Question label={t('profile.labelPassportHeld', { defaultValue: 'Is your passport retained by your employer?' })} value={passportHeld} onChange={setPassportHeld} />
          <Question label={t('profile.labelJobMatchesPromise', { defaultValue: 'Does the job match what you were promised?' })} value={workMatch} onChange={setWorkMatch} />
          <Question label={t('profile.labelDoubtsCompensation', { defaultValue: 'Any doubts about your compensation?' })} value={doubts} onChange={setDoubts} />
        </VStack>
      </Card>
    </SectionShell>
  );
}
