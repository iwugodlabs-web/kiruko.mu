import React, { useEffect, useState } from 'react';
import { Box, FormControl, FormControlLabel, FormControlLabelText, HStack, Text } from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Palette, Type } from '@/app/constants/theme';
import useAuth from '@/app/hooks/useAuth';
import { countryAssignments, type EmployeeCountryAssignment } from '@/services/payroll-api';

type CountryStatusChipProps = {
  /**
   * 'banner' (default): prominent chip used on the home dashboard.
   * 'field': read-only form field matching the profile's modernInput style.
   */
  variant?: 'banner' | 'field';
};

/**
 * Employee-facing "where am I working" chip for the private home dashboard.
 *
 * Surfaces the effective country (+ active mission/transfer badge) that the
 * payroll engine uses, so somebody on a foreign assignment can actually see the
 * country their pay + shadow tax is keyed to — it previously lived only in the
 * employer-side employee profile/settings and payroll reports.
 *
 * Shows a prominent "On mission" chip when there's an active assignment, and a
 * subtle country/currency line for independent users (no employer) otherwise.
 */
const CountryStatusChip: React.FC<CountryStatusChipProps> = ({ variant = 'banner' }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [active, setActive] = useState<EmployeeCountryAssignment | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const pid = Number(user?.private_user_id);
    if (!pid) { setLoaded(true); return; }
    let mounted = true;
    countryAssignments.active(pid).then((res) => {
      if (!mounted) return;
      if (res && !('error' in res) && res) setActive(res);
      setLoaded(true);
    }).catch(() => { if (mounted) setLoaded(true); });
    return () => { mounted = false; };
  }, [user?.private_user_id]);

  const onMission = !!(active && (active.country_name || active.country_code));
  const countryLabel = active?.country_name || active?.country_code;
  const currency = active?.country_currency;
  const showOnMission = variant === 'banner' ? onMission : true;

  if (variant === 'field') {
    const label = countryLabel && onMission
      ? `${countryLabel}${currency ? ` · ${currency}` : ''}`
      : user?.private_user?.effective_country_code || user?.private_user?.country_code || '';
    return (
      <FormControl isDisabled>
        <FormControlLabel>
          <HStack space="xs" alignItems="center">
            <FormControlLabelText>{t('settings.country')}</FormControlLabelText>
            <MaterialIcons name="lock" size={12} color={Palette.gold} />
          </HStack>
        </FormControlLabel>
        <Box
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          borderWidth={1}
          borderColor={Palette.gray200}
          borderRadius={16}
          px="$4"
          height={60}
          bg={Palette.gray50}
        >
          <HStack flex={1} space="sm" alignItems="center">
            {onMission && (
              <Box bg={Palette.blue} rounded="$sm" px="$2" py="$0.5">
                <Text fontSize={10} color={Palette.white} fontWeight="700">
                  {t('privateHome.onMission', { defaultValue: 'ON MISSION' }).toUpperCase()}
                </Text>
              </Box>
            )}
            <Text color={label ? Palette.ink : Palette.gray400} fontWeight="500">
              {label || t('settings.countryPlaceholder', { defaultValue: 'Not set' })}
            </Text>
          </HStack>
          <MaterialIcons name="lock" size={16} color={Palette.gold} />
        </Box>
      </FormControl>
    );
  }

  if (showOnMission) {
    return (
      <Box bg="rgba(96, 165, 250, 0.12)" p="$2.5" rounded="$lg" borderWidth={1}
           borderColor="rgba(59, 130, 246, 0.4)" mb="$4">
        <HStack alignItems="center" space="sm">
          <Box bg={Palette.blue} rounded="$sm" px="$2" py="$0.5">
            <Text fontSize={10} color={Palette.white} fontWeight="700">
              {t('privateHome.onMission', { defaultValue: 'ON MISSION' }).toUpperCase()}
            </Text>
          </Box>
          <Text fontSize={Type.body} color={Palette.ink} fontWeight="600" flex={1}>
            {countryLabel}{currency ? ` · ${currency}` : ''}
          </Text>
        </HStack>
      </Box>
    );
  }

  // Every user can see their effective country — for a company employee that's
  // their employer's country (company > self-reported > phone > MU), for an
  // independent user their own. Shown subtly so it's informative, not noisy.
  if (!loaded) return null;
  const effective = user?.private_user?.effective_country_code || user?.private_user?.country_code;
  if (!effective) return null;

  return (
    <HStack alignItems="center" space="xs" mb="$2">
      <MaterialIcons name="public" size={13} color={Palette.gray500} />
      <Text fontSize={11} color={Palette.gray500}>
        {t('privateHome.countryLabel', { defaultValue: 'Country' })}
        {` · ${effective}`}
      </Text>
    </HStack>
  );
};

export default CountryStatusChip;