import React, { useState } from 'react';
import { Palette } from '@/app/constants/theme';
import {
  Box,
  Heading,
  HStack,
  Pressable,
  Spinner,
  Text,
  VStack
} from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, { FadeIn } from '@/app/utils/animated';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

interface ClockHistoryProps {
  filteredClockData: Array<{
    day: string;
    date: string;
    time: string;
    hours: number;
    status: string;
    breakTime: number;
    isOvertime?: boolean;
    isHoliday?: boolean;
    location?: string;
  }>;
  selectedTimeFilter: string;
  isDataLoading: boolean;
  authLoading: boolean;
  currentlyWorking: boolean;
}

const ClockHistory: React.FC<ClockHistoryProps> = ({
  filteredClockData,
  selectedTimeFilter,
  isDataLoading,
  authLoading,
  currentlyWorking,
}) => {
  const router = useRouter();
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(true);

  const navigateToClockIn = () => {
    router.push('/private_dashboard/clock-in');
  };

  const navigateToWorkHistory = () => {
    router.push('/private_dashboard/clockin_history');
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return { bg: Palette.successTint, border: Palette.teal, text: Palette.teal };
      case 'in-progress': return { bg: Palette.blueTint, border: Palette.blue, text: Palette.blue };
      default: return { bg: Palette.warningTint, border: Palette.warning, text: Palette.gold };
    }
  };

  return (
    <Animated.View entering={FadeIn.duration(700).delay(200)}>
      <Box
        bg="white"
        p="$6"
        rounded="$3xl"
        shadowColor="$shadowColor"
        shadowOffset={{ width: 0, height: 4 }}
        shadowOpacity={0.1}
        shadowRadius={20}
        elevation={8}
        borderWidth={1}
        borderColor="$borderLight100"
      >
        <Pressable onPress={() => setIsExpanded(!isExpanded)}>
          <HStack alignItems="center" justifyContent="space-between" mb="$6">
            <HStack alignItems="center" space="sm">
              <Box bg="$blue50" p="$3" rounded="$full">
                <MaterialIcons name="schedule" size={24} color={Palette.blue} />
              </Box>
              <VStack>
                <Heading size="md" color="$textDark900" fontWeight="700">
                  {t('privateHomeCards.timeTimeline')}
                </Heading>
                <Text color="$textLight500" fontSize={12} fontWeight="500">
                  {selectedTimeFilter === 'today'
                    ? t('privateHomeCards.todaysActivity')
                    : t('privateHomeCards.thisWeeksActivity')}
                </Text>
              </VStack>
            </HStack>

            <Pressable onPress={navigateToWorkHistory}>
              <Text color="$blue600" fontSize={12} fontWeight="600">{t('privateHomeCards.viewAll')}</Text>
            </Pressable>
          </HStack>
        </Pressable>

        {isExpanded && (
          <Animated.View entering={FadeIn.duration(300)}>

            {/* Action Section */}
            <Box mb="$8">
              <Pressable onPress={navigateToClockIn}>
                <LinearGradient
                  colors={currentlyWorking ? [Palette.greenTint, Palette.successTint] : [Palette.blueTint, Palette.blueTint]}
                  style={{ borderRadius: 20, padding: 4 }}
                >
                  <Box bg="white" p="$4" rounded="$2xl" borderWidth={1} borderColor={currentlyWorking ? Palette.greenTint : Palette.blueTint}>
                    <HStack alignItems="center" space="md">
                      <LinearGradient
                        colors={currentlyWorking ? [Palette.teal, Palette.success] : [Palette.blue, Palette.blue]}
                        style={{ padding: 12, borderRadius: 999 }}
                      >
                        <MaterialIcons
                          name={currentlyWorking ? 'stop' : 'play-arrow'}
                          size={24}
                          color="white"
                        />
                      </LinearGradient>
                      <VStack>
                        <Text color="$gray900" fontWeight="700" fontSize={16}>
                          {currentlyWorking
                            ? t('privateHomeCards.stopSession')
                            : t('privateHomeCards.clockInNow')}
                        </Text>
                        <Text color={currentlyWorking ? '$green600' : '$blue600'} fontSize={12} fontWeight="500">
                          {currentlyWorking
                            ? t('privateHomeCards.currentlyWorking')
                            : t('privateHomeCards.readyToStart')}
                        </Text>
                      </VStack>
                    </HStack>
                  </Box>
                </LinearGradient>
              </Pressable>
            </Box>

            {/* Timeline */}
            {isDataLoading ? (
              <HStack space="sm" justifyContent="center" py="$4">
                <Spinner size="small" />
                <Text color="$gray500">{t('privateHomeCards.syncingTimeline')}</Text>
              </HStack>
            ) : filteredClockData.length === 0 ? (
              <Box alignItems="center" py="$6" bg="$gray50" rounded="$xl">
                <MaterialIcons name="history-toggle-off" size={32} color={Palette.gray400} />
                <Text color="$gray400" mt="$2" fontWeight="500">{t('privateHomeCards.noActivity')}</Text>
              </Box>
            ) : (
              <Box pl="$2">
                {/* Home shows the 3 most recent; the footer links to the full
                    history (mirrors the Tasks card). */}
                {filteredClockData.slice(0, 3).map((entry, index, arr) => {
                  const isLast = index === arr.length - 1;
                  const colors = getStatusColor(entry.status);

                  return (
                    <HStack key={index} space="lg" alignItems="flex-start">
                      {/* Left Column: Line & Dot */}
                      <VStack alignItems="center" space="xs" pt="$1" w={20}>
                        {/* Dot - using colors based on status */}
                        <Box
                          w={10} h={10}
                          rounded="$full"
                          bg={entry.status === 'in-progress' ? Palette.blue : Palette.gray200}
                          borderWidth={2}
                          borderColor="white"
                          shadowColor={entry.status === 'in-progress' ? Palette.blue : 'transparent'}
                          shadowOpacity={0.3}
                          shadowRadius={4}
                          zIndex={1}
                        />

                        {/* Connecting Line */}
                        {!isLast && (
                          <Box w={2} flex={1} bg="$gray100" my="$0.5" rounded="$full" />
                        )}
                      </VStack>

                      {/* Right Column: Card */}
                      <Box flex={1} pb={isLast ? "$0" : "$6"}>
                        <Box
                          bg="white"
                          p="$4"
                          rounded="$2xl"
                          shadowColor="$gray200"
                          shadowOffset={{ width: 0, height: 2 }}
                          shadowOpacity={0.05}
                          shadowRadius={8}
                          elevation={2}
                          borderWidth={1}
                          borderColor="$gray50"
                        >
                          <HStack justifyContent="space-between" alignItems="flex-start">
                            <VStack space="xs">
                              <HStack space="xs" alignItems="center">
                                <Text color="$gray900" fontWeight="700" fontSize={15}>
                                  {entry.day}
                                </Text>
                                {entry.isOvertime && (
                                  <Box bg="$orange100" px="$1.5" py="$0.5" rounded="$sm">
                                    <Text color="$orange600" fontSize={10} fontWeight="700">{t('privateHomeCards.badgeOt')}</Text>
                                  </Box>
                                )}
                                {entry.isHoliday && (
                                  <Box bg="$purple100" px="$1.5" py="$0.5" rounded="$sm">
                                    <Text color="$purple600" fontSize={10} fontWeight="700">{t('privateHomeCards.badgeHol')}</Text>
                                  </Box>
                                )}
                              </HStack>
                              <Text color="$gray400" fontSize={11}>
                                {entry.date} • {entry.time}
                              </Text>
                            </VStack>
                            <Box bg={colors.bg} px="$2" py="$1" rounded="$md">
                              <Text color={colors.text} fontWeight="700" fontSize={12}>
                                {(() => {
                                  const totalMins = Math.round(entry.hours * 60);
                                  const h = Math.floor(totalMins / 60);
                                  const m = totalMins % 60;
                                  if (h === 0) return `${m}m`;
                                  if (m === 0) return `${h}h`;
                                  return `${h}h ${m}m`;
                                })()}
                              </Text>
                            </Box>
                          </HStack>

                          {entry.breakTime > 0 && (
                            <HStack mt="$3" space="xs" alignItems="center">
                              <MaterialIcons name="local-cafe" size={12} color={Palette.gray400} />
                              <Text color="$gray400" fontSize={11}>
                                {(() => {
                                  const totalMins = Math.round(entry.breakTime * 60);
                                  const h = Math.floor(totalMins / 60);
                                  const m = totalMins % 60;
                                  const duration = h === 0 ? `${m}m` : m === 0 ? `${h}h` : `${h}h ${m}m`;
                                  return t('privateHomeCards.breakTaken', { duration });
                                })()}
                              </Text>
                            </HStack>
                          )}

                          {entry.location && (
                            <HStack mt="$2" space="xs" alignItems="flex-start">
                              <MaterialIcons name="location-on" size={12} color={Palette.gray400} style={{ marginTop: 2 }} />
                              <Text color="$gray400" fontSize={11} flex={1}>
                                {entry.location}
                              </Text>
                            </HStack>
                          )}
                        </Box>
                      </Box>
                    </HStack>
                  )
                })}
                {filteredClockData.length > 3 && (
                  <Pressable onPress={navigateToWorkHistory} mt="$3" mb="$1" alignItems="center" hitSlop={10}>
                    <HStack space="xs" alignItems="center">
                      <Text color="$blue600" fontSize={13} fontWeight="700">
                        {t('privateHomeCards.viewMoreCount', { count: filteredClockData.length - 3 })}
                      </Text>
                      <MaterialIcons name="arrow-forward" size={14} color={Palette.blue} />
                    </HStack>
                  </Pressable>
                )}
              </Box>
            )}

            {/* Period Summary Footer */}
            {filteredClockData.length > 0 && (
              <Box mt="$6" bg="$gray50" p="$4" rounded="$xl" borderWidth={1} borderColor="$gray200" borderStyle="dashed">
                <HStack justifyContent="space-between" alignItems="center">
                  <Text color="$gray500" fontSize={12} fontWeight="600" textTransform="uppercase">{t('privateHomeCards.totalTracked')}</Text>
                  <HStack space="xs" alignItems="baseline">
                    <Text color="$gray900" fontSize={20} fontWeight="800">
                      {(() => {
                        const totalHours = filteredClockData.reduce((acc, curr) => acc + curr.hours, 0);
                        const totalMins = Math.round(totalHours * 60);
                        const h = Math.floor(totalMins / 60);
                        const m = totalMins % 60;
                        if (h === 0) return `${m}m`;
                        if (m === 0) return `${h}h`;
                        return `${h}h ${m}m`;
                      })()}
                    </Text>
                  </HStack>
                </HStack>
              </Box>
            )}

          </Animated.View>
        )}
      </Box>
    </Animated.View>
  );
};

export default ClockHistory;