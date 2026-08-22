import { MaterialIcons } from '@expo/vector-icons';
import { Palette } from '@/app/constants/theme';
import { Box, HStack, Text, VStack, Pressable } from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';
import React from 'react';
import Animated, { FadeIn } from '@/app/utils/animated';
import { useTranslation } from 'react-i18next';

export type ExpenseRow = { label: string; amount: number; date?: string };

interface EarningsVsExpensesProps {
  estimatedPay: number;
  totalExpenses: number;
  recentExpenses?: ExpenseRow[];
  hourlyRate: number;
  formatCurrency: (amount: number) => string;
}

const EarningsVsExpenses: React.FC<EarningsVsExpensesProps> = ({
  estimatedPay,
  totalExpenses,
  recentExpenses = [],
  hourlyRate,
  formatCurrency,
}) => {
  const router = useRouter();
  const { t } = useTranslation();
  const balance = estimatedPay - totalExpenses;
  const isPositive = balance >= 0;
  const hoursNeeded = !isPositive && hourlyRate > 0 ? Math.ceil(Math.abs(balance) / hourlyRate) : 0;

  const expenseRatio = estimatedPay > 0 ? Math.min((totalExpenses / estimatedPay) * 100, 100) : 0;

  return (
    <Animated.View entering={FadeIn.duration(700).delay(200)}>
      <Pressable onPress={() => router.push('/private_dashboard/expenses' as any)}>
        <Box
          bg="white"
          p="$5"
          rounded="$3xl"
          shadowColor="$shadowColor"
          shadowOffset={{ width: 0, height: 4 }}
          shadowOpacity={0.1}
          shadowRadius={20}
          elevation={8}
          borderWidth={1}
          borderColor="$borderLight100"
        >
          <HStack alignItems="center" space="sm" mb="$4">
            <Box bg={isPositive ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)"} p="$3" rounded="$full">
              <MaterialIcons name="account-balance-wallet" size={22} color={isPositive ? Palette.green : Palette.errorAlt} />
            </Box>
            <VStack flex={1}>
              <Text fontSize={16} fontWeight="800" color="$textDark900">{t('privateHomeCards.earningsVsExpenses')}</Text>
              <Text fontSize={12} color="$textLight500" fontWeight="600">{t('privateHomeCards.monthlyOverview')}</Text>
            </VStack>
          </HStack>

          <HStack justifyContent="space-between" mb="$3">
            <VStack>
              <Text fontSize={11} fontWeight="700" color="$textLight500" textTransform="uppercase">{t('privateHomeCards.earnings')}</Text>
              <Text fontSize={20} fontWeight="900" color={Palette.green}>{formatCurrency(estimatedPay)}</Text>
            </VStack>
            <VStack alignItems="flex-end">
              <Text fontSize={11} fontWeight="700" color="$textLight500" textTransform="uppercase">{t('privateHomeCards.expenses')}</Text>
              <Text fontSize={20} fontWeight="900" color={Palette.errorAlt}>{formatCurrency(totalExpenses)}</Text>
            </VStack>
          </HStack>

          {/* Progress Bar */}
          <Box bg="$backgroundLight100" rounded="$full" h={8} mb="$3" overflow="hidden">
            <Box
              bg={expenseRatio > 80 ? Palette.errorAlt : expenseRatio > 50 ? Palette.warning : Palette.green}
              h={8}
              rounded="$full"
              style={{ width: `${expenseRatio}%` }}
            />
          </Box>

          {/* Balance */}
          <Box bg={isPositive ? "rgba(34, 197, 94, 0.06)" : "rgba(239, 68, 68, 0.06)"} p="$3" rounded="$xl">
            <HStack justifyContent="space-between" alignItems="center">
              <HStack space="sm" alignItems="center">
                <MaterialIcons name={isPositive ? "trending-up" : "trending-down"} size={20} color={isPositive ? Palette.green : Palette.errorAlt} />
                <Text fontSize={14} fontWeight="800" color={isPositive ? Palette.green : Palette.errorAlt}>
                  {isPositive ? t('privateHomeCards.surplus') : t('privateHomeCards.deficit')}
                </Text>
              </HStack>
              <Text fontSize={18} fontWeight="900" color={isPositive ? Palette.green : Palette.errorAlt}>
                {formatCurrency(Math.abs(balance))}
              </Text>
            </HStack>
            {!isPositive && hoursNeeded > 0 && (
              <Text fontSize={12} fontWeight="600" color={Palette.errorAlt} mt="$1">
                {t('privateHomeCards.hoursNeeded', { count: hoursNeeded })}
              </Text>
            )}
          </Box>

          {/* Recent expenses — 3 most recent; tapping the card opens the full list. */}
          {recentExpenses.length > 0 && (
            <VStack mt="$3" space="xs">
              {recentExpenses.slice(0, 3).map((e, i) => (
                <HStack key={i} justifyContent="space-between" alignItems="center">
                  <Text fontSize={13} color="$textLight600" numberOfLines={1} flex={1} mr="$2">{e.label}</Text>
                  <Text fontSize={13} fontWeight="700" color="$textDark900">{formatCurrency(e.amount)}</Text>
                </HStack>
              ))}
              {recentExpenses.length > 3 && (
                <HStack space="xs" alignItems="center" justifyContent="flex-end" mt="$1">
                  <Text fontSize={12} fontWeight="700" color="$blue600">
                    {t('privateHomeCards.viewMoreCount', { count: recentExpenses.length - 3 })}
                  </Text>
                  <MaterialIcons name="arrow-forward" size={13} color={Palette.blue} />
                </HStack>
              )}
            </VStack>
          )}
        </Box>
      </Pressable>
    </Animated.View>
  );
};

export default EarningsVsExpenses;
