import React from 'react';
import { Palette } from '@/app/constants/theme';
import { Modal } from 'react-native';
import { Box, VStack, HStack, Text, Heading, Button, ButtonText, Pressable } from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import useCurrency from '@/app/hooks/useCurrency';

interface SalarySummaryProps {
  showSalarySummary: boolean;
  calculatedSalary: any;
  primary: string;
  setShowSalarySummary: (show: boolean) => void;
}

const SalarySummary: React.FC<SalarySummaryProps> = ({
  showSalarySummary,
  calculatedSalary,
  primary,
  setShowSalarySummary
}) => {
  const { t } = useTranslation();
  const { formatCurrency } = useCurrency();

  const currentDate = new Date();

  return (
    <Modal
      visible={showSalarySummary}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => setShowSalarySummary(false)}
    >
      <Box
        flex={1}
        bg="rgba(0,0,0,0.6)"
        justifyContent="center"
        alignItems="center"
      >
      <Pressable
        position="absolute"
        top={0}
        left={0}
        right={0}
        bottom={0}
        onPress={() => setShowSalarySummary(false)}
      />

      <Box
        bg="white"
        rounded="$3xl"
        p="$6"
        mx="$4"
        w="92%"
        maxWidth={380}
        shadowColor={Palette.gray700}
        shadowOffset={{ width: 0, height: 16 }}
        shadowOpacity={0.2}
        shadowRadius={32}
        elevation={20}
        overflow="hidden"
        borderWidth={1}
        borderColor={Palette.gray200}
      >
        <VStack space="lg">
          {/* Header */}
          <HStack justifyContent="space-between" alignItems="center">
            <VStack>
              <Text fontSize={12} color="$textDark500" fontWeight="600" textTransform="uppercase" letterSpacing={1}>
                {t('calculator.estimatedSalary')}
              </Text>
              <Text fontSize={11} color="$textDark400">
                {currentDate.toLocaleDateString()}
              </Text>
            </VStack>
            <Pressable onPress={() => setShowSalarySummary(false)}>
              <MaterialIcons name="close" size={24} color={Palette.gray500} />
            </Pressable>
          </HStack>

          {/* Hero Card - Monthly Net Pay */}
          <LinearGradient
            colors={[Palette.gray700, Palette.gray700]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ borderRadius: 20, padding: 20 }}
          >
            <VStack alignItems="center" space="xs">
              <Text fontSize={13} fontWeight="600" color="rgba(255,255,255,0.9)" letterSpacing={0.5}>
                {t('calculator.monthlyNetPay')}
              </Text>
              <Text fontSize={40} fontWeight="800" color="white" letterSpacing={-1}>
                {formatCurrency(Number(calculatedSalary?.monthly ?? calculatedSalary?.net ?? 0))}
              </Text>
              {calculatedSalary?.monthly ? (
                <Box bg="rgba(255,255,255,0.2)" px="$3" py="$1" rounded="$full" mt="$1">
                  <Text fontSize={10} color="white" fontWeight="500">
                    {t('calculator.estimatedNet')}
                  </Text>
                </Box>
              ) : null}
            </VStack>
          </LinearGradient>

          {/* Breakdown Stats Grid (2x2) */}
          <VStack space="sm">
            <HStack space="sm">
              {/* Gross */}
              <VStack flex={1} bg={Palette.gray50} p="$3" rounded="$xl" alignItems="center" space="xs" borderWidth={1} borderColor={Palette.gray200}>
                <Text fontSize={10} color={Palette.gray500} fontWeight="600">{t('calculator.gross')}</Text>
                <Text fontSize={15} color={Palette.ink} fontWeight="700">
                  {formatCurrency(Number(calculatedSalary?.gross ?? 0))}
                </Text>
              </VStack>
              {/* Hourly */}
              <VStack flex={1} bg={Palette.gray50} p="$3" rounded="$xl" alignItems="center" space="xs" borderWidth={1} borderColor={Palette.gray200}>
                <Text fontSize={10} color={Palette.gray500} fontWeight="600">{t('calculator.hourly')}</Text>
                <Text fontSize={15} color={Palette.ink} fontWeight="700">
                  {formatCurrency(Number(calculatedSalary?.hourly ?? 0))}
                </Text>
              </VStack>
            </HStack>
            <HStack space="sm">
              {/* Weekly */}
              <VStack flex={1} bg={Palette.gray50} p="$3" rounded="$xl" alignItems="center" space="xs" borderWidth={1} borderColor={Palette.gray200}>
                <Text fontSize={10} color={Palette.gray500} fontWeight="600">{t('calculator.weekly')}</Text>
                <Text fontSize={15} color={Palette.ink} fontWeight="700">
                  {formatCurrency(Number(calculatedSalary?.weekly ?? 0))}
                </Text>
              </VStack>
              {/* Bi-Weekly */}
              <VStack flex={1} bg={Palette.gray50} p="$3" rounded="$xl" alignItems="center" space="xs" borderWidth={1} borderColor={Palette.gray200}>
                <Text fontSize={10} color={Palette.gray500} fontWeight="600">{t('calculator.biweekly')}</Text>
                <Text fontSize={15} color={Palette.ink} fontWeight="700">
                  {formatCurrency(Number(calculatedSalary?.biweekly ?? 0))}
                </Text>
              </VStack>
            </HStack>
          </VStack>

          {/* Salary Breakdown */}
          {calculatedSalary && (Number(calculatedSalary.allowance) > 0 || Number(calculatedSalary.deduction) > 0) && (
            <Box bg={Palette.gray50} rounded="$2xl" borderWidth={1} borderColor={Palette.gray200} overflow="hidden">
              <Box px="$4" py="$2.5" borderBottomWidth={1} borderBottomColor={Palette.gray200}>
                <Text fontSize={10} fontWeight="700" color={Palette.gray400} letterSpacing={0.8}>{t('calculator.payBreakdown')}</Text>
              </Box>

              {/* Gross row */}
              <HStack justifyContent="space-between" alignItems="center" px="$4" py="$3" borderBottomWidth={1} borderBottomColor={Palette.gray100}>
                <HStack space="sm" alignItems="center">
                  <Box w={6} h={6} bg={Palette.gray200} rounded="$full" />
                  <Text fontSize={13} color={Palette.gray500}>{t('calculator.baseGross')}</Text>
                </HStack>
                <Text fontSize={13} color={Palette.ink} fontWeight="600">
                  {formatCurrency(Number(calculatedSalary?.gross ?? 0))}
                </Text>
              </HStack>

              {Number(calculatedSalary.allowance) > 0 && (
                <HStack justifyContent="space-between" alignItems="center" px="$4" py="$3" borderBottomWidth={1} borderBottomColor={Palette.gray100} bg="rgba(22,163,74,0.03)">
                  <HStack space="sm" alignItems="center">
                    <MaterialIcons name="add-circle-outline" size={15} color={Palette.success} />
                    <Text fontSize={13} color={Palette.success} fontWeight="600">{t('calculator.allowances')}</Text>
                  </HStack>
                  <Text fontSize={13} color={Palette.success} fontWeight="700">+{formatCurrency(Number(calculatedSalary.allowance))}</Text>
                </HStack>
              )}

              {Number(calculatedSalary.deduction) > 0 && (
                <HStack justifyContent="space-between" alignItems="center" px="$4" py="$3" borderBottomWidth={1} borderBottomColor={Palette.gray100} bg="rgba(239,68,68,0.03)">
                  <HStack space="sm" alignItems="center">
                    <MaterialIcons name="remove-circle-outline" size={15} color={Palette.errorAlt} />
                    <Text fontSize={13} color={Palette.errorAlt} fontWeight="600">{t('calculator.deductions')}</Text>
                  </HStack>
                  <Text fontSize={13} color={Palette.errorAlt} fontWeight="700">−{formatCurrency(Number(calculatedSalary.deduction))}</Text>
                </HStack>
              )}

              {/* Net total line */}
              <HStack justifyContent="space-between" alignItems="center" px="$4" py="$3.5" bg="white">
                <Text fontSize={13} fontWeight="700" color={Palette.ink}>{t('calculator.netMonthly')}</Text>
                <Text fontSize={16} fontWeight="800" color={Palette.ink}>
                  {formatCurrency(Number(calculatedSalary?.monthly ?? calculatedSalary?.net ?? 0))}
                </Text>
              </HStack>
            </Box>
          )}

          {/* Close Button */}
          <Button
            bg={Palette.gray700}
            h="$12"
            rounded="$xl"
            w="100%"
            shadowColor={Palette.gray700}
            shadowOffset={{ width: 0, height: 4 }}
            shadowOpacity={0.3}
            shadowRadius={8}
            elevation={6}
            onPress={() => setShowSalarySummary(false)}
            sx={{
              ":active": { transform: [{ scale: 0.98 }] }
            }}
          >
            <HStack space="md" alignItems="center" justifyContent="center">
              <MaterialIcons name="check-circle" size={20} color="white" />
              <ButtonText fontSize={16} fontWeight="700" color="white">
                {t('calculator.done')}
              </ButtonText>
            </HStack>
          </Button>
        </VStack>
      </Box>
      </Box>
    </Modal>
  );
};

export default SalarySummary;