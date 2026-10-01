import { MaterialIcons } from '@expo/vector-icons';
import { Palette } from '@/app/constants/theme';
import { Box, HStack, Text, VStack, Pressable } from '@gluestack-ui/themed';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import Animated, { FadeIn } from '@/app/utils/animated';
import { useTranslation } from 'react-i18next';
import { isComplianceDone } from '@/components/private_profile/shared';

const DISMISS_KEY = 'kiruko.profileChecklist.dismissed';

interface ProfileProgressProps {
  /** Server-authoritative onboarding flag. False ⇒ setup isn't finished. */
  onboardComplete?: boolean;
  profileData: {
    gender?: string;
    date_of_birth?: string;
    pass_port_number?: string;
  } | null;
  jobData: {
    job_title?: string;
    employer_name?: string;
    work_start_time?: string;
    work_end_time?: string;
    work_days?: Record<string, string>;
    // Reliable "compliance saved" signal: the boolean answers all default to
    // false in the DB (can't tell "No" from "unanswered"), but this JSONB field
    // is NULL until the Rights & Compliance section is saved — the screen always
    // writes it. A non-null value ⇒ the user has completed compliance.
    reason_for_deduction?: Record<string, boolean> | null;
  } | null;
  salaryData?: { salary?: any } | null;
}

/**
 * Redesign v2 — the home nudge card. Replaces the old "profile percentage"
 * meter (which implied a mandatory 100% goal) with:
 *   - a single CTA to the Setup flow if required setup is somehow incomplete, or
 *   - a dismissible "get the most out of Kiruko" checklist of OPTIONAL items
 *     that deep-link into the profile sections and are driven by the action
 *     that benefits from them (payslip estimate, KYC, compliance).
 */
const ProfileProgress: React.FC<ProfileProgressProps> = ({
  onboardComplete,
  profileData,
  jobData,
  salaryData,
}) => {
  const router = useRouter();
  const { t } = useTranslation();
  const [dismissed, setDismissed] = useState<boolean | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(DISMISS_KEY).then((v) => {
      if (!cancelled) setDismissed(v === 'true');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (dismissed === undefined) return null;

  // Required setup not done — the one thing that must be surfaced.
  if (onboardComplete === false) {
    return (
      <Animated.View entering={FadeIn.duration(500).delay(100)}>
        <Pressable onPress={() => router.replace('/private_dashboard/setup' as any)}>
          <Box
            bg={Palette.blueTint}
            p="$4"
            rounded="$2xl"
            borderWidth={1}
            borderColor="#C9D3F7"
            mb="$4"
          >
            <HStack alignItems="center" space="md">
              <Box bg="white" p="$2" rounded="$full">
                <MaterialIcons name="rocket-launch" size={20} color={Palette.blue} />
              </Box>
              <VStack flex={1}>
                <Text fontSize={14} fontWeight="800" color={Palette.indigo}>
                  {t('privateHomeCards.finishSetupTitle', { defaultValue: 'Finish setting up to clock in' })}
                </Text>
                <Text fontSize={12} color={Palette.blue} fontWeight="600">
                  {t('privateHomeCards.finishSetupBody', { defaultValue: 'Takes ~20 seconds' })}
                </Text>
              </VStack>
              <MaterialIcons name="chevron-right" size={20} color={Palette.blue} />
            </HStack>
          </Box>
        </Pressable>
      </Animated.View>
    );
  }

  const identityDone = Boolean(profileData?.gender && profileData?.date_of_birth && profileData?.pass_port_number);
  const hasEmployer = Boolean(jobData?.job_title && jobData?.employer_name);
  const payDone = Boolean(salaryData?.salary && String(salaryData.salary).trim() !== '');
  const complianceDone = isComplianceDone(jobData);

  const items: { id: string; label: string; icon: string; color: string; route: string }[] = [];
  // Skipped-employer case: onboarding is "complete" (they tapped "add employer
  // later"), but with no employer linked the pay/compliance steps stay locked
  // and there's otherwise no path back to add it. Surface it as the first item
  // so the needed employer info isn't stranded after reopening the app. Still
  // dismissable, so genuine independents aren't nagged.
  if (!hasEmployer) {
    items.push({
      id: 'employer',
      label: t('privateHomeCards.tipEmployer', { defaultValue: 'Add your employer to unlock payslips & schedule' }),
      icon: 'business',
      color: Palette.blue,
      route: '/private_dashboard/setup',
    });
  }
  if (hasEmployer && !payDone) {
    items.push({
      id: 'pay',
      label: t('privateHomeCards.tipPayslip', { defaultValue: 'Add salary for accurate payslip estimates' }),
      icon: 'account-balance-wallet',
      color: Palette.blue,
      route: '/private_dashboard/profile/pay',
    });
  }
  if (!identityDone) {
    items.push({
      id: 'identity',
      label: t('privateHomeCards.tipIdentity', { defaultValue: 'Add ID details for verification' }),
      icon: 'badge',
      color: Palette.violet,
      route: '/private_dashboard/profile/identity',
    });
  }
  if (hasEmployer && !complianceDone) {
    items.push({
      id: 'compliance',
      label: t('privateHomeCards.tipCompliance', { defaultValue: 'Complete compliance details for reports' }),
      icon: 'gavel',
      color: Palette.green,
      route: '/private_dashboard/profile/compliance',
    });
  }

  if (dismissed || items.length === 0) return null;

  const dismiss = async () => {
    setDismissed(true);
    try {
      await AsyncStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // Best-effort.
    }
  };

  return (
    <Animated.View entering={FadeIn.duration(500).delay(100)}>
      <Box
        bg="white"
        p="$4"
        rounded="$2xl"
        borderWidth={1}
        borderColor="$borderLight100"
        shadowColor="$shadowColor"
        shadowOffset={{ width: 0, height: 2 }}
        shadowOpacity={0.06}
        shadowRadius={8}
        elevation={3}
        mb="$4"
      >
        <HStack alignItems="center" space="sm" mb="$3">
          <Box bg={Palette.goldTint} p="$2" rounded="$full">
            <MaterialIcons name="auto-awesome" size={18} color={Palette.gold} />
          </Box>
          <VStack flex={1}>
            <Text fontSize={14} fontWeight="800" color={Palette.ink}>
              {t('privateHomeCards.getMostTitle', { defaultValue: 'Get the most out of Kiruko' })}
            </Text>
            <Text fontSize={11} color={Palette.gray500} fontWeight="600">
              {t('privateHomeCards.getMostBody', { defaultValue: 'Optional — do it whenever you like' })}
            </Text>
          </VStack>
          <Pressable onPress={dismiss} hitSlop={10}>
            <MaterialIcons name="close" size={18} color={Palette.gray400} />
          </Pressable>
        </HStack>

        <VStack space="xs">
          {items.map((item) => (
            <Pressable key={item.id} onPress={() => router.push(item.route as any)}>
              <HStack alignItems="center" space="sm" py="$2">
                <MaterialIcons name={item.icon as any} size={18} color={item.color} />
                <Text flex={1} fontSize={13} color={Palette.gray700} fontWeight="600">
                  {item.label}
                </Text>
                <MaterialIcons name="chevron-right" size={18} color={Palette.gray400} />
              </HStack>
            </Pressable>
          ))}
        </VStack>
      </Box>
    </Animated.View>
  );
};

export default ProfileProgress;
