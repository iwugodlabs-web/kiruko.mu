import React from 'react';
import { Box, Heading, HStack, Text, VStack, Pressable } from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import Animated, { FadeInUp, SlideInRight } from '@/app/utils/animated';
import { useTranslation } from 'react-i18next';
import useCurrency from '@/app/hooks/useCurrency';

export interface DashboardHeaderProps {
  firstName: string;
  isDataLoading: boolean;
  currentlyWorking: boolean;
  payData: {
    totalHours: number;
    estimatedPay: number;
  };
  activeTasksCount: number;
  selectedPayFilter: string;
  timeLogs: any[];
  isProfileComplete: boolean;
  onLogout?: () => void;
}

export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  firstName,
  isDataLoading,
  currentlyWorking,
  payData,
  activeTasksCount,
  selectedPayFilter,
  timeLogs,
  isProfileComplete,
  onLogout,
}) => {
  const { t } = useTranslation();
  const { currencyInfo } = useCurrency();

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('privateHomeCards.greetingMorning');
    if (hour < 18) return t('privateHomeCards.greetingAfternoon');
    return t('privateHomeCards.greetingEvening');
  };

  const getFilterLabel = () => {
    switch (selectedPayFilter) {
      case 'today': return t('privateHomeCards.filterToday');
      case '7days': return t('privateHomeCards.filterThisWeek');
      case 'month': return t('privateHomeCards.filterThisMonth');
      case '6months': return t('privateHomeCards.filter6Months');
      default: return t('privateHomeCards.filterThisYear');
    }
  };

  const getStatusMessage = () => {
    if (isDataLoading) return t('privateHomeCards.statusLoading');
    if (!isProfileComplete) return t('privateHomeCards.statusExploring');
    if (timeLogs.length === 0) return t('privateHomeCards.statusReady');
    if (currentlyWorking) return t('privateHomeCards.statusWorking');
    return t(
      timeLogs.length === 1
        ? 'privateHomeCards.statusSummarySingular'
        : 'privateHomeCards.statusSummaryPlural',
      { count: timeLogs.length },
    );
  };

  return (
    <Box
      bg="$primary500"
      pt="$6"
      px="$4"
      pb="$6"
      borderBottomLeftRadius="$3xl"
      borderBottomRightRadius="$3xl"
    >
      <VStack space="md">
        {/* Header with Welcome Message and Logout */}
        <Animated.View entering={FadeInUp.duration(600).delay(200)}>
          <HStack alignItems="center" justifyContent="space-between" mb="$2">
            <HStack alignItems="center" space="sm" flex={1}>
              <Text color="rgba(255,255,255,0.9)" fontWeight="500" fontSize={16}>
                {t('privateHomeCards.goodGreeting', { greeting: getGreeting() })}{' '}
                <Text fontSize={14}>👋</Text>
              </Text>
              {currentlyWorking && (
                <Box bg="rgba(16, 185, 129, 0.8)" px="$2" py="$1" rounded="$full">
                  <Text color="white" fontWeight="600" fontSize={10}>
                    🟢 {t('privateHomeCards.workingBadge')}
                  </Text>
                </Box>
              )}
            </HStack>

            {/* Logout Button */}
            {onLogout && (
              <Pressable onPress={onLogout}>
                <Box
                  bg="rgba(255,255,255,0.15)"
                  p="$2"
                  rounded="$full"
                  borderWidth={1}
                  borderColor="rgba(255,255,255,0.2)"
                >
                  <MaterialIcons name="logout" size={20} color="white" />
                </Box>
              </Pressable>
            )}
          </HStack>

          <VStack space="xs">
            <Heading size="2xl" fontWeight="700" color="white">
              {t('privateHomeCards.welcomeBackName', {
                name: isDataLoading ? t('privateHomeCards.loading') : firstName,
              })}
            </Heading>
            <Text color="rgba(255,255,255,0.8)" mt="$1" fontSize={14}>
              {getStatusMessage()}
            </Text>
          </VStack>
        </Animated.View>

        {/* Enhanced Quick Stats Cards */}
        <Animated.View entering={SlideInRight.duration(700).delay(400)}>
          <HStack space="sm" mt="$4">
            <Box
              flex={1}
              bg="rgba(255,255,255,0.15)"
              p="$4"
              rounded="$2xl"
              borderWidth={1}
              borderColor="rgba(255,255,255,0.2)"
            >
              <VStack alignItems="center" space="xs">
                <Box bg="rgba(255,255,255,0.3)" p="$2" rounded="$full">
                  <MaterialIcons name="access-time" size={20} color="white" />
                </Box>
                <Text color="white" fontWeight="700" textAlign="center" fontSize={18}>
                  {isDataLoading ? '...' : (() => {
                    const totalMins = Math.round(payData.totalHours * 60);
                    const h = Math.floor(totalMins / 60);
                    const m = totalMins % 60;
                    if (h === 0) return `${m}m`;
                    if (m === 0) return `${h}h`;
                    return `${h}h ${m}m`;
                  })()}
                </Text>
                <Text color="rgba(255,255,255,0.8)" textAlign="center" fontSize={12}>
                  {getFilterLabel()}
                </Text>
              </VStack>
            </Box>

            <Box
              flex={1}
              bg="rgba(255,255,255,0.15)"
              p="$4"
              rounded="$2xl"
              borderWidth={1}
              borderColor="rgba(255,255,255,0.2)"
            >
              <VStack alignItems="center" space="xs">
                <Box bg="rgba(255,255,255,0.3)" p="$2" rounded="$full">
                  <MaterialIcons name="trending-up" size={20} color="white" />
                </Box>
                <Text color="white" fontWeight="700" textAlign="center" fontSize={18}>
                  {isDataLoading ? '...' : `${currencyInfo.symbol} ${payData.estimatedPay.toFixed(0)}`}
                </Text>
                <Text color="rgba(255,255,255,0.8)" textAlign="center" fontSize={12}>
                  {t('privateHomeCards.estimated')}
                </Text>
              </VStack>
            </Box>

            <Box
              flex={1}
              bg="rgba(255,255,255,0.15)"
              p="$4"
              rounded="$2xl"
              borderWidth={1}
              borderColor="rgba(255,255,255,0.2)"
            >
              <VStack alignItems="center" space="xs">
                <Box bg="rgba(255,255,255,0.3)" p="$2" rounded="$full">
                  <MaterialIcons name="assignment" size={20} color="white" />
                </Box>
                <Text color="white" fontWeight="700" textAlign="center" fontSize={18}>
                  {isDataLoading ? '...' : activeTasksCount}
                </Text>
                <Text color="rgba(255,255,255,0.8)" textAlign="center" fontSize={12}>
                  {t('privateHomeCards.activeTasks')}
                </Text>
              </VStack>
            </Box>
          </HStack>
        </Animated.View>
      </VStack>
    </Box>
  );
};

export default DashboardHeader;