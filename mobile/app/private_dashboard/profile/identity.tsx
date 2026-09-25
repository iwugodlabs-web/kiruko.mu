import { getCountries, type Country } from '@/services/api';
import { Palette, Type } from '@/app/constants/theme';
import { Box, HStack, Input, InputField, Pressable, Text, VStack } from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import {
  Card,
  FieldLabel,
  MobileDatePicker,
  SavingOverlay,
  SectionShell,
  formatDate,
  parseDate,
  saveFailed,
  saveSuccess,
  submitOnboard,
  updateUserProfile,
  useProfileBootstrap,
} from '@/components/private_profile/shared';

const GENDERS = ['Male', 'Female', 'Other'];

export default function IdentityScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, privateUserId, isIndependentUser, identityLocked, loading, refreshAuth } = useProfileBootstrap();

  const [gender, setGender] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState<Date>(new Date());
  const [passportNumber, setPassportNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [showDob, setShowDob] = useState(false);
  const [saving, setSaving] = useState(false);

  const [countries, setCountries] = useState<Country[]>([]);
  const [currentCountry, setCurrentCountry] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (loading) return;
    const pu = user?.private_user;
    setGender((pu?.gender as any) || '');
    setDateOfBirth(pu?.date_of_birth ? parseDate(pu.date_of_birth) : new Date());
    setPassportNumber(pu?.pass_port_number || '');
    setPhone(pu?.phone || '');
    setCurrentCountry(pu?.country_code || pu?.effective_country_code);
  }, [loading, user]);

  useEffect(() => {
    if (!isIndependentUser) return;
    let cancelled = false;
    (async () => {
      const result = await getCountries();
      if (!cancelled && Array.isArray(result)) setCountries(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [isIndependentUser]);

  const saveCountry = async (code: string) => {
    if (user?.user_id === undefined) return;
    try {
      const result: any = await updateUserProfile(Number(user.user_id), { country_code: code } as any);
      if (result?.error) {
        Alert.alert(t('common.errorTitle', { defaultValue: 'Error' }), result.error);
        return;
      }
      setCurrentCountry(code);
      await refreshAuth();
    } catch {
      Alert.alert(t('common.errorTitle', { defaultValue: 'Error' }), t('settings.countryUpdateFailed', { defaultValue: 'Could not update country.' }));
    }
  };

  const onSave = async () => {
    if (privateUserId === undefined) return;
    if (!dateOfBirth) {
      Alert.alert(t('common.errorTitle', { defaultValue: 'Error' }), t('profile.dobRequired', { defaultValue: 'Date of birth is required.' }));
      return;
    }
    if (!passportNumber.trim()) {
      Alert.alert(t('common.errorTitle', { defaultValue: 'Error' }), t('profile.passportRequired', { defaultValue: 'Passport / ID number is required.' }));
      return;
    }
    setSaving(true);
    try {
      const userData: Record<string, any> = {
        private_user_id: Number(privateUserId),
      };
      if (!identityLocked) {
        userData.gender = gender || null;
        userData.date_of_birth = formatDate(dateOfBirth);
        userData.pass_port_number = passportNumber.trim();
      }
      if (phone.trim()) userData.phone = phone.trim();

      await submitOnboard({ user_data: userData });
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
      <SectionShell title={t('profileHub.identityTitle', { defaultValue: 'Identity & KYC' })} onSave={() => {}} saving={false} saveDisabled>
        <SavingOverlay />
      </SectionShell>
    );
  }

  return (
    <SectionShell
      title={t('profileHub.identityTitle', { defaultValue: 'Identity & KYC' })}
      subtitle={t('profileHub.identitySub', { defaultValue: 'Needed for employer verification' })}
      onSave={onSave}
      saving={saving}
    >
      {identityLocked && (
        <Box bg={Palette.warningTint} rounded="$xl" p="$3" mb="$4" borderLeftWidth={3} borderLeftColor={Palette.gold}>
          <HStack space="sm" alignItems="center">
            <MaterialIcons name="lock" size={16} color={Palette.gold} />
            <Text flex={1} fontSize={Type.small} color={Palette.gold} fontWeight="700">
              {t('profile.lockedDescription', { defaultValue: 'Identity verified — contact HR to change.' })}
            </Text>
          </HStack>
        </Box>
      )}

      {isIndependentUser && (
        <Card color={Palette.violet}>
          <FieldLabel>{t('settings.country', { defaultValue: 'Country' })}</FieldLabel>
          <HStack space="xs" flexWrap="wrap" mt="$2">
            {countries.length === 0 ? (
              <Text size="sm" color={Palette.gray400}>{t('common.loading', { defaultValue: 'Loading…' })}</Text>
            ) : (
              countries.map((c) => {
                const active = currentCountry === c.code;
                return (
                  <Pressable key={c.code} onPress={() => !identityLocked && saveCountry(c.code)} disabled={identityLocked} mb="$2">
                    <Box
                      px="$3"
                      py="$2"
                      rounded="$full"
                      borderWidth={1.5}
                      borderColor={active ? Palette.violet : Palette.gray200}
                      bg={active ? Palette.violetTint : Palette.white}
                      opacity={identityLocked ? 0.5 : 1}
                    >
                      <Text fontSize={Type.small} fontWeight="800" color={active ? Palette.violet : Palette.gray500}>
                        {c.name}
                      </Text>
                    </Box>
                  </Pressable>
                );
              })
            )}
          </HStack>
        </Card>
      )}

      <Card>
        <VStack space="md">
          <Box>
            <FieldLabel>{t('profile.labelGender', { defaultValue: 'Gender' })}</FieldLabel>
            <HStack space="sm">
              {GENDERS.map((g) => {
                const active = gender === g;
                return (
                  <Pressable key={g} onPress={() => !identityLocked && setGender(g)} flex={1} disabled={identityLocked} opacity={identityLocked ? 0.5 : 1}>
                    <Box
                      rounded="$full"
                      borderWidth={1.5}
                      borderColor={active ? Palette.violet : Palette.gray200}
                      bg={active ? Palette.violetTint : Palette.white}
                      py="$3"
                      alignItems="center"
                    >
                      <Text fontSize={Type.small} fontWeight="700" color={active ? Palette.violet : Palette.gray500}>
                        {g}
                      </Text>
                    </Box>
                  </Pressable>
                );
              })}
            </HStack>
          </Box>

          <Box>
            <FieldLabel>{t('profile.labelDateOfBirth', { defaultValue: 'Date of birth' })}</FieldLabel>
            <Pressable onPress={() => !identityLocked && setShowDob(true)}>
              <Box bg={Palette.gray50} rounded="$xl" p="$3" borderWidth={1} borderColor={Palette.gray200} opacity={identityLocked ? 0.5 : 1}>
                <Text fontWeight="700" color={Palette.ink}>{formatDate(dateOfBirth)}</Text>
              </Box>
            </Pressable>
          </Box>

          <Box>
            <FieldLabel>{t('profile.labelPassportOrId', { defaultValue: 'Passport / ID number' })}</FieldLabel>
            <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50} isDisabled={identityLocked}>
              <InputField value={passportNumber} onChangeText={setPassportNumber} editable={!identityLocked} />
            </Input>
          </Box>

          <Box>
            <FieldLabel>{t('profile.labelYourPhone', { defaultValue: 'Your phone number' })}</FieldLabel>
            <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
              <InputField value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
            </Input>
          </Box>
        </VStack>
      </Card>

      <MobileDatePicker
        visible={showDob}
        mode="date"
        value={dateOfBirth}
        maximumDate={new Date()}
        onClose={() => setShowDob(false)}
        onChange={setDateOfBirth}
        title={t('profile.labelDateOfBirth', { defaultValue: 'Date of birth' })}
      />
    </SectionShell>
  );
}
