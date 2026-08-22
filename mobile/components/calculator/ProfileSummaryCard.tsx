import { Box, HStack, VStack, Text, Heading } from '@gluestack-ui/themed';
import { Palette } from '@/app/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import React from 'react';
import { useTranslation } from 'react-i18next';

interface ProfileSummaryCardProps {
  prefilledProfileData?: {
    salary?: number;
    allowances?: number;
    daysPerMonth?: number;
  } | null;
  salaryDetails?: {
    totalAllowances?: number;
  } | null;
  computeDaysPerMonth: () => number;
}

const ProfileSummaryCard: React.FC<ProfileSummaryCardProps> = ({
  prefilledProfileData,
  salaryDetails,
  computeDaysPerMonth,
}) => {
  const { t } = useTranslation();
  // Safely extract values with fallbacks
  const salary = prefilledProfileData?.salary || 0;
  const allowances = salaryDetails?.totalAllowances || prefilledProfileData?.allowances || 0;
  const daysPerMonth = computeDaysPerMonth();

  return (
    <Box
      bg="white"
      p="$4"
      rounded="$3xl"
      mx="$1"
      mb="$4"
      borderWidth={1}
      borderColor={Palette.gray200}
      shadowColor={Palette.gray700}
      shadowOffset={{ width: 0, height: 4 }}
      shadowOpacity={0.12}
      shadowRadius={12}
      elevation={8}
    >
      <VStack space="lg">
        {/* Header with Icon */}
        <HStack alignItems="center" space="sm">
          <Box bg={Palette.gray100} p="$3" rounded="$full">
            <MaterialIcons name="account-balance" size={24} color={Palette.gray700} />
          </Box>
          <VStack flex={1}>
            <Heading size="lg" color={Palette.ink} fontWeight="700">
              {t('calculator.profileSummaryTitle')}
            </Heading>
            <Text color={Palette.gray500} fontSize={14}>
              {t('calculator.profileSummarySubtitle')}
            </Text>
          </VStack>
        </HStack>

        {/* Stat Boxes */}
        <HStack space="md">
          {/* Monthly Salary */}
          <Box
            flex={1}
            bg="rgba(0,0,0,0.03)"
            p="$3"
            rounded="$2xl"
            borderWidth={1}
            borderColor="rgba(0,0,0,0.07)"
          >
            <VStack alignItems="center" space="xs">
              <MaterialIcons name="payments" size={16} color={Palette.gray700} />
              <Heading size="sm" color={Palette.ink} numberOfLines={1} ellipsizeMode="tail">
                {Number(salary).toLocaleString()}
              </Heading>
              <Text color={Palette.gray500} fontSize={10} fontWeight="600">
                {t('calculator.statSalary')}
              </Text>
            </VStack>
          </Box>

          {/* Allowances */}
          <Box
            flex={1}
            bg="rgba(22, 163, 74, 0.06)"
            p="$3"
            rounded="$2xl"
            borderWidth={1}
            borderColor="rgba(22, 163, 74, 0.15)"
          >
            <VStack alignItems="center" space="xs">
              <MaterialIcons name="add-circle" size={16} color={Palette.success} />
              <Heading size="sm" color={Palette.ink} numberOfLines={1} ellipsizeMode="tail">
                {Number(allowances).toLocaleString()}
              </Heading>
              <Text color={Palette.gray500} fontSize={10} fontWeight="600">
                {t('calculator.statAllowances')}
              </Text>
            </VStack>
          </Box>

          {/* Days Per Month */}
          <Box
            flex={1}
            bg="rgba(0,0,0,0.03)"
            p="$3"
            rounded="$2xl"
            borderWidth={1}
            borderColor="rgba(0,0,0,0.06)"
          >
            <VStack alignItems="center" space="xs">
              <MaterialIcons name="event" size={16} color={Palette.gray700} />
              <Heading size="sm" color={Palette.ink}>
                {daysPerMonth}
              </Heading>
              <Text color={Palette.gray500} fontSize={10} fontWeight="600">
                {t('calculator.statDaysPerMonth')}
              </Text>
            </VStack>
          </Box>
        </HStack>
      </VStack>
    </Box>
  );
};

export default ProfileSummaryCard;