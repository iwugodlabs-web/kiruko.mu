import { Palette } from '@/app/constants/theme';
import {
  createBudgetGoal,
  getBudgetGoalsByUser,
  isApiError,
  updateBudgetGoal,
  type BudgetGoal,
} from '@/services/api';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Box,
  HStack,
  Input,
  InputField,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Pressable,
  Spinner,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, TextInput } from 'react-native';
import Animated, { FadeIn } from '@/app/utils/animated';
import { useTranslation } from 'react-i18next';
import useCurrency from '@/app/hooks/useCurrency';

interface SavingsGoalProps {
  privateUserId: number;
  estimatedPay: number;
  totalExpenses: number;
  formatCurrency: (amount: number) => string;
}

const SAVINGS_CATEGORY = 'savings';

const SavingsGoal: React.FC<SavingsGoalProps> = ({
  privateUserId,
  estimatedPay,
  totalExpenses,
  formatCurrency,
}) => {
  const { t } = useTranslation();
  const { currencyInfo } = useCurrency();
  const [goal, setGoal] = useState<BudgetGoal | null>(null);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [targetInput, setTargetInput] = useState('');
  const [saving, setSaving] = useState(false);

  const freeCash = estimatedPay - totalExpenses;

  const loadGoal = useCallback(async () => {
    if (!privateUserId) return;
    setLoading(true);
    const res = await getBudgetGoalsByUser(privateUserId);
    if (!isApiError(res) && (res as any).data) {
      const goals: BudgetGoal[] = (res as any).data;
      const savingsGoal = goals.find((g) => g.category === SAVINGS_CATEGORY);
      setGoal(savingsGoal ?? null);
    }
    setLoading(false);
  }, [privateUserId]);

  useEffect(() => { loadGoal(); }, [loadGoal]);

  const handleSave = async () => {
    const amount = parseFloat(targetInput);
    if (isNaN(amount) || amount <= 0) return;
    setSaving(true);
    if (goal) {
      await updateBudgetGoal(goal.budget_id, { monthly_limit: amount });
    } else {
      await createBudgetGoal({
        private_user_id: privateUserId,
        category: SAVINGS_CATEGORY,
        monthly_limit: amount,
        currency: currencyInfo.code,
      });
    }
    await loadGoal();
    setSaving(false);
    setModalOpen(false);
  };

  const openModal = () => {
    setTargetInput(goal ? String(goal.monthly_limit) : '');
    setModalOpen(true);
  };

  if (loading) return null;

  const target = goal?.monthly_limit ?? 0;
  const onTrack = freeCash >= target && target > 0;
  const progressPercent = target > 0 ? Math.min((freeCash / target) * 100, 100) : 0;
  const shortfall = target > 0 ? Math.max(0, target - freeCash) : 0;

  return (
    <Animated.View entering={FadeIn.duration(700).delay(300)}>
      <Pressable onPress={openModal}>
        <Box
          bg="white"
          rounded="$3xl"
          p="$5"
          shadowColor={Palette.black}
          shadowOffset={{ width: 0, height: 4 }}
          shadowOpacity={0.08}
          shadowRadius={16}
          elevation={6}
          borderWidth={1}
          borderColor={Palette.gray100}
        >
          <HStack justifyContent="space-between" alignItems="center" mb="$4">
            <HStack space="sm" alignItems="center">
              <Box bg="rgba(124,58,237,0.1)" p="$2" rounded="$lg">
                <MaterialIcons name="savings" size={22} color={Palette.violet} />
              </Box>
              <Text fontWeight="800" fontSize={16} color={Palette.ink}>
                {t('savingsGoal.title')}
              </Text>
            </HStack>
            <Box bg="rgba(124,58,237,0.06)" px="$3" py="$1" rounded="$full" borderWidth={1} borderColor="rgba(124,58,237,0.2)">
              <Text fontSize={12} fontWeight="700" color={Palette.violet}>
                {target > 0 ? t('savingsGoal.tapToEdit') : t('savingsGoal.setGoal')}
              </Text>
            </Box>
          </HStack>

          {target === 0 ? (
            <Box bg="rgba(124,58,237,0.05)" p="$4" rounded="$xl" alignItems="center">
              <MaterialIcons name="add-circle-outline" size={28} color={Palette.violet} />
              <Text fontWeight="700" fontSize={14} color={Palette.violet} mt="$2" textAlign="center">
                {t('savingsGoal.setTargetTitle')}
              </Text>
              <Text fontSize={13} color={Palette.gray400} textAlign="center" mt="$1">
                {t('savingsGoal.setTargetBody')}
              </Text>
            </Box>
          ) : (
            <VStack space="md">
              <HStack justifyContent="space-between">
                <VStack>
                  <Text fontSize={12} color={Palette.gray400} fontWeight="600">{t('savingsGoal.monthlyTarget')}</Text>
                  <Text fontSize={20} fontWeight="800" color={Palette.violet}>
                    {formatCurrency(target)}
                  </Text>
                </VStack>
                <VStack alignItems="flex-end">
                  <Text fontSize={12} color={Palette.gray400} fontWeight="600">{t('savingsGoal.availableToSave')}</Text>
                  <Text
                    fontSize={20}
                    fontWeight="800"
                    color={freeCash >= 0 ? Palette.success : Palette.error}
                  >
                    {formatCurrency(Math.max(0, freeCash))}
                  </Text>
                </VStack>
              </HStack>

              {/* Progress bar */}
              <Box>
                <Box bg={Palette.gray200} rounded="$full" h={8} overflow="hidden">
                  <Box
                    bg={onTrack ? Palette.green : Palette.gold}
                    rounded="$full"
                    h={8}
                    width={`${progressPercent}%` as any}
                  />
                </Box>
                <HStack justifyContent="space-between" mt="$1">
                  <Text fontSize={11} color={Palette.gray400}>0</Text>
                  <Text fontSize={11} color={Palette.gray400}>{formatCurrency(target)}</Text>
                </HStack>
              </Box>

              {onTrack ? (
                <Box bg="rgba(5,150,105,0.06)" p="$3" rounded="$xl" borderWidth={1} borderColor="rgba(5,150,105,0.2)">
                  <HStack space="xs" alignItems="center">
                    <MaterialIcons name="check-circle" size={16} color={Palette.success} />
                    <Text fontSize={13} fontWeight="700" color={Palette.success} flex={1}>
                      {t('savingsGoal.onTrack', { amount: formatCurrency(freeCash - target) })}
                    </Text>
                  </HStack>
                </Box>
              ) : freeCash > 0 ? (
                <Box bg="rgba(217,119,6,0.06)" p="$3" rounded="$xl" borderWidth={1} borderColor="rgba(217,119,6,0.2)">
                  <HStack space="xs" alignItems="center">
                    <MaterialIcons name="info-outline" size={16} color={Palette.gold} />
                    <Text fontSize={13} fontWeight="700" color={Palette.gold} flex={1}>
                      {t('savingsGoal.shortfall', { amount: formatCurrency(shortfall) })}
                    </Text>
                  </HStack>
                </Box>
              ) : (
                <Box bg="rgba(220,38,38,0.06)" p="$3" rounded="$xl" borderWidth={1} borderColor="rgba(220,38,38,0.2)">
                  <HStack space="xs" alignItems="center">
                    <MaterialIcons name="warning" size={16} color={Palette.error} />
                    <Text fontSize={13} fontWeight="700" color={Palette.error} flex={1}>
                      {t('savingsGoal.expensesExceed')}
                    </Text>
                  </HStack>
                </Box>
              )}
            </VStack>
          )}
        </Box>
      </Pressable>

      {/* Set/Edit Goal Modal */}
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)}>
        <ModalBackdrop />
        <ModalContent maxHeight="85%" rounded="$3xl" mx="$4" bg="white">
          <ModalHeader borderBottomWidth={0} pt="$5" px="$5">
            <HStack space="sm" alignItems="center">
              <Box bg="rgba(124,58,237,0.1)" p="$2" rounded="$lg">
                <MaterialIcons name="savings" size={20} color={Palette.violet} />
              </Box>
              <Text fontWeight="900" fontSize={18} color={Palette.ink}>
                {goal ? t('savingsGoal.editTitle') : t('savingsGoal.setTitle')}
              </Text>
            </HStack>
          </ModalHeader>
          <ModalBody px="$5" pt="$3" pb="$4">
            <Text fontSize={14} color={Palette.gray500} mb="$4" fontWeight="500">
              {t('savingsGoal.howMuch')}
            </Text>
            <TextInput
              keyboardType="numeric"
              placeholder={t('savingsGoal.targetPlaceholder')}
              placeholderTextColor={Palette.gray400}
              value={targetInput}
              onChangeText={setTargetInput}
              autoFocus
              returnKeyType="done"
              style={{
                backgroundColor: Palette.gray50,
                borderColor: Palette.gray100,
                borderWidth: 1,
                borderRadius: 24,
                paddingVertical: 14,
                paddingHorizontal: 16,
                fontSize: 16,
                fontWeight: '700',
                color: Palette.ink,
              }}
            />
            {freeCash > 0 && (
              <Text fontSize={12} color={Palette.gray400} mt="$2" fontWeight="600">
                {t('savingsGoal.availableAfter', { amount: formatCurrency(freeCash) })}
              </Text>
            )}
          </ModalBody>
          <ModalFooter borderTopWidth={0} px="$5" pb="$6">
            <HStack space="md" flex={1}>
              <Pressable onPress={() => setModalOpen(false)} flex={1}>
                {({ pressed }: any) => (
                  <Box bg="rgba(0,0,0,0.05)" rounded="$2xl" p="$3.5" style={{ opacity: pressed ? 0.7 : 1 }}>
                    <Text textAlign="center" fontWeight="800" color={Palette.gray600} fontSize={14}>{t('common.cancel')}</Text>
                  </Box>
                )}
              </Pressable>
              <Pressable onPress={handleSave} flex={2} disabled={saving || !targetInput}>
                {({ pressed }: any) => (
                  <Box
                    bg={Palette.violet}
                    rounded="$2xl"
                    p="$3.5"
                    style={{ opacity: (pressed || saving || !targetInput) ? 0.7 : 1 }}
                  >
                    <HStack space="xs" justifyContent="center" alignItems="center">
                      {saving && <ActivityIndicator size="small" color="white" />}
                      <Text textAlign="center" fontWeight="900" color="white" fontSize={15}>{t('savingsGoal.saveGoal')}</Text>
                    </HStack>
                  </Box>
                )}
              </Pressable>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Animated.View>
  );
};

export default SavingsGoal;
