import { Palette, Type } from '@/app/constants/theme';
import { PremiumHeader } from '@/components/PremiumHeader';
import { Box, HStack, Heading, Pressable, Text, VStack } from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, SafeAreaView, ScrollView } from 'react-native';
import { isComplianceDone, useProfileBootstrap } from '@/components/private_profile/shared';

interface HubRow {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  color: string;
  bg: string;
  route: string;
  status: 'complete' | 'incomplete' | 'optional' | 'locked';
}

export default function ProfileHub() {
  const router = useRouter();
  const { t } = useTranslation();
  const { user, job, salary, loading, identityLocked, companyLocked } = useProfileBootstrap();

  const identityComplete = Boolean(
    user?.private_user?.gender &&
      user?.private_user?.date_of_birth &&
      user?.private_user?.pass_port_number,
  );
  const workComplete = Boolean(
    job?.job_title && job?.work_start_time && job?.work_end_time && job?.work_days && Object.keys(job.work_days).length > 0,
  );
  const payComplete = Boolean(salary?.salary && String(salary.salary).trim() !== '');
  const complianceComplete = isComplianceDone(job);

  const rows: HubRow[] = [
    {
      id: 'workschedule',
      title: t('profileHub.workTitle', { defaultValue: 'Work & Schedule' }),
      subtitle: workComplete
        ? t('profileHub.workDone', { defaultValue: 'Employer, job and working hours' })
        : t('profileHub.workTodo', { defaultValue: 'Add your employer and hours' }),
      icon: 'schedule',
      color: Palette.teal,
      bg: Palette.tealTint,
      route: '/private_dashboard/profile/workschedule',
      status: companyLocked ? 'locked' : workComplete ? 'complete' : 'incomplete',
    },
    {
      id: 'pay',
      title: t('profileHub.payTitle', { defaultValue: 'Pay & Payslip' }),
      subtitle: payComplete
        ? t('profileHub.payDone', { defaultValue: 'Salary details on file' })
        : t('profileHub.payTodo', { defaultValue: 'Improve your payslip estimate' }),
      icon: 'account-balance-wallet',
      color: Palette.blue,
      bg: Palette.blueTint,
      route: '/private_dashboard/profile/pay',
      status: companyLocked ? 'locked' : payComplete ? 'complete' : 'incomplete',
    },
    {
      id: 'identity',
      title: t('profileHub.identityTitle', { defaultValue: 'Identity & KYC' }),
      subtitle: identityComplete
        ? t('profileHub.identityDone', { defaultValue: 'ID details provided' })
        : t('profileHub.identityTodo', { defaultValue: 'Needed for verification' }),
      icon: 'badge',
      color: Palette.violet,
      bg: Palette.violetTint,
      route: '/private_dashboard/profile/identity',
      status: identityLocked ? 'locked' : identityComplete ? 'complete' : 'incomplete',
    },
    {
      id: 'compliance',
      title: t('profileHub.complianceTitle', { defaultValue: 'Rights & Compliance' }),
      subtitle: complianceComplete
        ? t('profileHub.complianceDone', { defaultValue: 'Compliance details saved' })
        : t('profileHub.complianceTodo', { defaultValue: 'Required to file a report' }),
      icon: 'gavel',
      color: Palette.green,
      bg: Palette.greenTint,
      route: '/private_dashboard/profile/compliance',
      status: companyLocked ? 'locked' : complianceComplete ? 'complete' : 'optional',
    },
  ];

  const renderStatus = (status: HubRow['status']) => {
    if (status === 'locked') {
      return (
        <HStack space="xs" alignItems="center">
          <MaterialIcons name="lock" size={14} color={Palette.gold} />
          <Text fontSize={Type.caption} fontWeight="700" color={Palette.gold}>
            {t('profileHub.locked', { defaultValue: 'Locked' })}
          </Text>
        </HStack>
      );
    }
    if (status === 'complete') {
      return (
        <HStack space="xs" alignItems="center">
          <MaterialIcons name="check-circle" size={14} color={Palette.success} />
          <Text fontSize={Type.caption} fontWeight="700" color={Palette.success}>
            {t('profileHub.complete', { defaultValue: 'Complete' })}
          </Text>
        </HStack>
      );
    }
    if (status === 'optional') {
      return (
        <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray400}>
          {t('profileHub.optional', { defaultValue: 'Optional' })}
        </Text>
      );
    }
    return (
      <Text fontSize={Type.caption} fontWeight="700" color={Palette.warning}>
        {t('profileHub.incomplete', { defaultValue: 'Add' })}
      </Text>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <PremiumHeader
        title={t('profileHub.title', { defaultValue: 'Profile' })}
        onBack={() => router.push('/private_dashboard/settings' as any)}
      />

      {loading ? (
        <Box flex={1} alignItems="center" justifyContent="center">
          <ActivityIndicator size="large" color={Palette.gold} />
        </Box>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 60 }}>
          {/* Identity header */}
          <Box mb="$5">
            <Heading size="lg" color={Palette.ink} fontWeight="800">
              {user?.private_user?.first_name
                ? `${user.private_user.first_name} ${user.private_user.last_name ?? ''}`.trim()
                : user?.first_name ?? user?.user_name ?? t('profileHub.you', { defaultValue: 'You' })}
            </Heading>
            <Text size="sm" color={Palette.gray500}>
              {user?.private_user?.company_id
                ? t('profileHub.employee', { defaultValue: 'Company employee' })
                : t('profileHub.independent', { defaultValue: 'Independent worker' })}
            </Text>
          </Box>

          {/* Required completeness strip */}
          <Box
            bg={user?.onboard_complete ? Palette.successTint : Palette.warningTint}
            rounded="$xl"
            p="$4"
            mb="$5"
            borderWidth={1}
            borderColor={user?.onboard_complete ? '#A7F3D0' : '#FDE68A'}
          >
            <HStack space="sm" alignItems="center">
              <MaterialIcons
                name={user?.onboard_complete ? 'check-circle' : 'error-outline'}
                size={20}
                color={user?.onboard_complete ? Palette.success : Palette.warning}
              />
              <Text
                flex={1}
                fontSize={Type.body}
                fontWeight="700"
                color={user?.onboard_complete ? Palette.success : Palette.warning}
              >
                {user?.onboard_complete
                  ? t('profileHub.allSet', { defaultValue: "You're all set to clock in" })
                  : t('profileHub.finishSetup', { defaultValue: 'Finish setting up to clock in' })}
              </Text>
              {!user?.onboard_complete && (
                <Pressable onPress={() => router.replace('/private_dashboard/setup' as any)}>
                  <Text fontSize={Type.small} fontWeight="800" color={Palette.warning}>
                    {t('profileHub.finish', { defaultValue: 'Finish' })}
                  </Text>
                </Pressable>
              )}
            </HStack>
          </Box>

          <Text fontSize={Type.small} fontWeight="800" color={Palette.gray400} mb="$3" letterSpacing={0.5}>
            {t('profileHub.optionalHeading', { defaultValue: 'GET THE MOST OUT OF KIRUKO' })}
          </Text>

          <VStack space="sm">
            {rows.map((row) => (
              <Pressable key={row.id} onPress={() => router.push(row.route as any)}>
                <Box
                  bg={row.bg}
                  rounded="$xl"
                  p="$4"
                  borderWidth={1}
                  borderColor={row.color + '30'}
                >
                  <HStack alignItems="center" space="md">
                    <Box bg={Palette.white} p="$3" rounded="$full">
                      <MaterialIcons name={row.icon as any} size={22} color={row.color} />
                    </Box>
                    <VStack flex={1}>
                      <Text fontSize={Type.body} fontWeight="800" color={Palette.ink}>
                        {row.title}
                      </Text>
                      <Text fontSize={Type.small} color={Palette.gray600} numberOfLines={1}>
                        {row.subtitle}
                      </Text>
                    </VStack>
                    {renderStatus(row.status)}
                    <MaterialIcons name="chevron-right" size={20} color={Palette.gray400} />
                  </HStack>
                </Box>
              </Pressable>
            ))}
          </VStack>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}
