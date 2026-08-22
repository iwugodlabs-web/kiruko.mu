import React from 'react';
import { Palette } from '@/app/constants/theme';
import { Modal } from 'react-native';
import { Box, VStack, HStack, Text, Heading, Button, ButtonText, Pressable } from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import useCurrency from '@/app/hooks/useCurrency';

interface ClockInSummaryProps {
  showClockInSummary: boolean;
  clockInTotal: any;
  primary: string;
  setShowClockInSummary: (show: boolean) => void;
  watchedStartDate: Date | undefined;
  watchedEndDate: Date | undefined;
  format: (date: Date, pattern: string) => string;
}

const ClockInSummary: React.FC<ClockInSummaryProps> = ({
  showClockInSummary,
  clockInTotal,
  primary,
  setShowClockInSummary,
  watchedStartDate,
  watchedEndDate,
  format
}) => {
  const currentDate = new Date();
  const { currencyInfo } = useCurrency();

  return (
    <Modal
      visible={showClockInSummary}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setShowClockInSummary(false)}
    >
      <Box
        flex={1}
        bg="rgba(0,0,0,0.5)"
        justifyContent="center"
        alignItems="center"
      >
      <Pressable
        position="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        onPress={() => setShowClockInSummary(false)}
      />

      <Box
        bg="white"
        rounded="$3xl"
        p="$6"
        mx="$4"
        w="95%"
        maxWidth={380}
        shadowColor={Palette.gray700}
        shadowOffset={{ width: 0, height: 16 }}
        shadowOpacity={0.25}
        shadowRadius={32}
        elevation={20}
        borderWidth={1}
        borderColor={Palette.gray200}
      >
        <VStack space="lg">
          {/* Compact Header */}
          <HStack justifyContent="space-between" alignItems="center">
            <HStack space="md" alignItems="center">
              <Box bg={`${primary}15`} p="$2" rounded="$full">
                <MaterialIcons name="access-time" size={24} color={primary} />
              </Box>
              <VStack>
                <Heading size="md" color="$textDark900" fontWeight="800">
                  Clock-In Estimate
                </Heading>
                <Text fontSize={12} color="$text600">
                  {watchedStartDate && watchedEndDate
                    ? `${format(watchedStartDate, 'MMM dd')} - ${format(watchedEndDate, 'MMM dd')}`
                    : currentDate.toLocaleDateString()}
                </Text>
              </VStack>
            </HStack>
            <Pressable onPress={() => setShowClockInSummary(false)}>
              <MaterialIcons name="close" size={24} color={Palette.gray500} />
            </Pressable>
          </HStack>

          {/* Main Stat: Period Total */}
          <Box bg={Palette.gray50} p="$4" rounded="$xl" borderWidth={1} borderColor={Palette.gray200}>
            <VStack alignItems="center" space="xs">
              <Text fontSize={12} fontWeight="$semibold" color={Palette.gray500} textTransform="uppercase" letterSpacing={1}>
                Period Earnings
              </Text>
              <Text fontSize={36} fontWeight="900" color={Palette.gray700} letterSpacing={-1}>
                {currencyInfo.symbol} {Number(clockInTotal?.totalSalary ?? 0).toLocaleString()}
              </Text>
            </VStack>
          </Box>

          {/* Projections Grid */}
          {(() => {
            // Derive all projections from avgPayPerDay (5 working days/week, 10 bi-weekly, 22 monthly)
            const avgPerDay = Number(clockInTotal?.avgPayPerDay ?? 0);
            const monthly   = avgPerDay > 0 ? Math.round(avgPerDay * 22) : Math.round(Number(clockInTotal?.monthlySalary ?? 0));
            const biweekly  = avgPerDay > 0 ? Math.round(avgPerDay * 10) : Math.round(monthly * 24 / 52);
            const weekly    = avgPerDay > 0 ? Math.round(avgPerDay * 5)  : Math.round(monthly * 12 / 52);
            return (
              <VStack space="sm">
                <Text fontSize={13} fontWeight="600" color="$text700" mb="$1">
                  Projected Earnings
                </Text>
                {/* Monthly (Full Width) */}
                <Box bg={Palette.gray50} p="$3" rounded="$lg" borderWidth={1} borderColor={Palette.gray200}>
                  <HStack justifyContent="space-between" alignItems="center">
                    <Text fontSize={13} color={Palette.gray500}>Monthly (22 days)</Text>
                    <Text fontSize={16} fontWeight="700" color={Palette.ink}>
                      {currencyInfo.symbol} {monthly.toLocaleString()}
                    </Text>
                  </HStack>
                </Box>
                {/* Split Row: Bi-weekly | Weekly */}
                <HStack space="sm">
                  <Box flex={1} bg={Palette.gray50} p="$3" rounded="$lg" borderWidth={1} borderColor={Palette.gray200}>
                    <VStack space="xs">
                      <Text fontSize={12} color={Palette.gray500}>Bi-weekly (10d)</Text>
                      <Text fontSize={15} fontWeight="700" color={Palette.ink}>
                        {currencyInfo.symbol} {biweekly.toLocaleString()}
                      </Text>
                    </VStack>
                  </Box>
                  <Box flex={1} bg={Palette.gray50} p="$3" rounded="$lg" borderWidth={1} borderColor={Palette.gray200}>
                    <VStack space="xs">
                      <Text fontSize={12} color={Palette.gray500}>Weekly (5d)</Text>
                      <Text fontSize={15} fontWeight="700" color={Palette.ink}>
                        {currencyInfo.symbol} {weekly.toLocaleString()}
                      </Text>
                    </VStack>
                  </Box>
                </HStack>
              </VStack>
            );
          })()}

          {/* Compact Time Summary Chips */}
          <VStack space="sm">
            <Text fontSize={13} fontWeight="600" color="$text700" mb="$1">
              Time Summary
            </Text>
            <HStack space="sm" flexWrap="wrap">
              {/* Total Hours */}
              <Box bg="$backgroundLight100" px="$3" py="$2" rounded="$lg" borderWidth={1} borderColor="$borderLight200">
                <HStack space="xs" alignItems="center">
                  <MaterialIcons name="schedule" size={14} color={Palette.gray500} />
                  <Text fontSize={13} fontWeight="600" color="$text700">
                    {(() => {
                      const totalHours = clockInTotal?.totalHours || 0;
                      const totalMins = Math.round(totalHours * 60);
                      const h = Math.floor(totalMins / 60);
                      const m = totalMins % 60;
                      return h > 0 ? `${h}h ${m > 0 ? `${m}m` : ''}` : `${m}m`;
                    })()}
                  </Text>
                </HStack>
              </Box>

              {/* Working Days */}
              {clockInTotal?.workingDays ? (
                <Box bg="$backgroundLight100" px="$3" py="$2" rounded="$lg" borderWidth={1} borderColor="$borderLight200">
                  <HStack space="xs" alignItems="center">
                    <MaterialIcons name="event" size={14} color={Palette.gray500} />
                    <Text fontSize={13} fontWeight="600" color="$text700">
                      {clockInTotal.workingDays}d
                    </Text>
                  </HStack>
                </Box>
              ) : null}

              {/* Hourly Rate */}
              {clockInTotal?.hourlyRate ? (
                <Box bg="$info50" px="$3" py="$2" rounded="$lg" borderWidth={1} borderColor="$info200">
                  <HStack space="xs" alignItems="center">
                    <MaterialIcons name="attach-money" size={14} color={Palette.gray700} />
                    <Text fontSize={13} fontWeight="600" color="$info700">
                      {currencyInfo.symbol} {Math.round(clockInTotal.hourlyRate).toLocaleString()}/hr
                    </Text>
                  </HStack>
                </Box>
              ) : null}
            </HStack>
          </VStack>

          {/* Action Button */}
          <Button
            bg={Palette.gray700}
            rounded="$xl"
            h="$11"
            shadowColor={Palette.gray700}
            shadowOffset={{ width: 0, height: 4 }}
            shadowOpacity={0.3}
            shadowRadius={8}
            elevation={6}
            onPress={() => setShowClockInSummary(false)}
          >
            <ButtonText fontSize={15} fontWeight="600" color="white">
              Done
            </ButtonText>
          </Button>

        </VStack>
      </Box>
      </Box>
    </Modal>
  );
};

export default ClockInSummary;