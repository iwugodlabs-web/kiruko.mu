import { Palette, Type } from '@/app/constants/theme';
import {
  createTransfer,
  deleteTransfer,
  getFinancials,
  isApiError,
  updateTransfer,
  type FinancialsData,
  type TransferData,
} from '@/services/api';
import { FontAwesome5, Ionicons, MaterialIcons } from '@expo/vector-icons';
import {
  Box, Button, ButtonText,
  HStack, Heading,
  Input, InputField, InputIcon, InputSlot,
  Modal, ModalBackdrop, ModalBody, ModalContent, ModalFooter,
  Pressable, ScrollView, Spinner, Text,
  Toast, ToastDescription, ToastTitle, VStack, useToast,
} from '@gluestack-ui/themed';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { ArrowDown, ArrowUp, Calendar } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import useAuth from '../hooks/useAuth';
import useCurrency from '../hooks/useCurrency';
import { activeLocale } from '@/app/utils/intl';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Dimensions, StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeInUp } from '@/app/utils/animated';
import { z } from 'zod';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PremiumHeader } from '@/components/PremiumHeader';
import { BasilUserSolid } from '@/components/custom/icons';

const makeTransferFormSchema = (t: (k: string) => string) => z.object({
  amount: z.string().nonempty(t('transfersScreen.vAmountRequired')).refine(val => !isNaN(parseFloat(val)) && parseFloat(val) > 0, { message: t('transfersScreen.vAmountValid') }),
  date: z.string().nonempty(t('transfersScreen.vDateRequired')).regex(/^\d{4}-\d{2}-\d{2}$/, t('transfersScreen.vDateFormat')),
  from: z.string().nonempty(t('transfersScreen.vSenderRequired')),
  to: z.string().nonempty(t('transfersScreen.vRecipientRequired')),
  direction: z.enum(['incoming', 'outgoing']),
});

type TransferFormData = z.infer<ReturnType<typeof makeTransferFormSchema>>;

type Entry = {
  id: number;
  from?: string;
  to?: string;
  amount: number;
  date: string;
  status?: string;
};

export default function Transfers() {
  const [transfers, setTransfers] = useState<Entry[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { currency: currentCurrency, currencyInfo, formatCurrency } = useCurrency();
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const { t } = useTranslation();
  const transferFormSchema = useMemo(() => makeTransferFormSchema(t), [t]);

  const { control, handleSubmit, reset, setValue, formState: { isSubmitting } } = useForm<TransferFormData>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: { amount: '', date: new Date().toISOString().split('T')[0], from: '', to: '', direction: 'outgoing' },
  });

  const fetchTransfers = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    const privateUserId = user?.private_user?.private_user_id ?? (user?.private_user_id ? Number(user.private_user_id) : undefined);
    if (!privateUserId) { setIsLoading(false); return; }
    const response = await getFinancials(privateUserId);
    if (isApiError(response)) {
      setError(response.error || 'Failed to fetch transfers.');
    } else {
      const data = response as FinancialsData;
      setTransfers(data.transfers.map(t => ({
        id: t.transfer_id,
        from: t.from_user,
        to: t.to_user,
        amount: t.amount,
        date: t.created_at || new Date().toISOString(),
        status: t.status,
      })));
    }
    setIsLoading(false);
  }, [user]);

  useEffect(() => { if (user) fetchTransfers(); }, [user, fetchTransfers]);

  const handleFormSubmit = async (data: TransferFormData) => {
    const privateUserId = user?.private_user?.private_user_id ?? (user?.private_user_id ? Number(user.private_user_id) : undefined);
    if (!privateUserId) return;
    const amount = parseFloat(data.amount);
    const payload = { amount, from_user: data.from, to_user: data.to };
    const isEditing = !!editingEntry;

    try {
      let response;
      if (isEditing) {
        response = await updateTransfer(editingEntry!.id, { ...payload, status: data.direction });
      } else {
        response = await createTransfer({ ...payload, private_user_id: privateUserId, currency: currencyInfo.code, status: data.direction });
      }
      if (isApiError(response)) throw new Error(response.error);
      toast.show({ placement: 'top', render: ({ id }) => (<Toast nativeID={id} action="success" variant="solid"><VStack space="xs"><ToastTitle>{t('common.successTitle')}</ToastTitle><ToastDescription>{isEditing ? t('transfersScreen.toastTransferUpdated') : t('transfersScreen.toastTransferAdded')}</ToastDescription></VStack></Toast>) });
      await fetchTransfers();
      setModalOpen(false);
      setEditingEntry(null);
      reset();
    } catch (e: any) {
      toast.show({ placement: 'top', render: ({ id }) => (<Toast nativeID={id} action="error" variant="solid"><VStack space="xs"><ToastTitle>{t('common.errorTitle')}</ToastTitle><ToastDescription>{e.message}</ToastDescription></VStack></Toast>) });
    }
  };

  const handleDelete = (id: number) => {
    Alert.alert(t('common.confirmDeletionTitle'), t('transfersScreen.confirmDeleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: async () => {
        await deleteTransfer(id);
        await fetchTransfers();
        toast.show({ placement: 'top', render: ({ id: tid }) => (<Toast nativeID={tid} action="success" variant="solid"><VStack space="xs"><ToastTitle>{t('common.deletedTitle')}</ToastTitle></VStack></Toast>) });
      }},
    ]);
  };

  const outgoing = transfers.filter(t => t.status !== 'incoming').reduce((s, t) => s + t.amount, 0);
  const incoming = transfers.filter(t => t.status === 'incoming').reduce((s, t) => s + t.amount, 0);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <PremiumHeader title={t('transfersScreen.pageTitle')} onBack={() => router.replace('/private_dashboard/settings')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 120, paddingHorizontal: 16 }}>
        {/* Summary Cards */}
        <Animated.View entering={FadeInUp.duration(500)}>
          <HStack space="sm" mt="$4">
            <Box flex={1} bg="white" rounded={18} borderWidth={1} borderColor={Palette.gray100} overflow="hidden" style={styles.cardShadow}>
              <Box style={{ height: 3, backgroundColor: Palette.error }} />
              <Box p="$3">
                <HStack space="xs" alignItems="center" mb={4}>
                  <Box style={{ backgroundColor: Palette.errorTint, borderRadius: 10, padding: 7, alignItems: 'center', justifyContent: 'center' }}>
                    <ArrowUp size={16} color={Palette.error} />
                  </Box>
                  <Text style={{ fontSize: Type.tiny, fontWeight: '800', color: Palette.gray400, letterSpacing: 0.5 }}>{t("transfersScreen.statSent")}</Text>
                </HStack>
                <Text fontSize={Type.body} fontWeight="800" color={Palette.error} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatCurrency(outgoing, { convert: false })}</Text>
              </Box>
            </Box>
            <Box flex={1} bg="white" rounded={18} borderWidth={1} borderColor={Palette.gray100} overflow="hidden" style={styles.cardShadow}>
              <Box style={{ height: 3, backgroundColor: Palette.success }} />
              <Box p="$3">
                <HStack space="xs" alignItems="center" mb={4}>
                  <Box style={{ backgroundColor: Palette.successTint, borderRadius: 10, padding: 7, alignItems: 'center', justifyContent: 'center' }}>
                    <ArrowDown size={16} color={Palette.success} />
                  </Box>
                  <Text style={{ fontSize: Type.tiny, fontWeight: '800', color: Palette.gray400, letterSpacing: 0.5 }}>{t("transfersScreen.statReceived")}</Text>
                </HStack>
                <Text fontSize={Type.body} fontWeight="800" color={Palette.success} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatCurrency(incoming, { convert: false })}</Text>
              </Box>
            </Box>
            {/* Net */}
            {(() => {
              const net = incoming - outgoing;
              const isPositive = net >= 0;
              return (
                <Box flex={1} bg="white" rounded={18} borderWidth={1} borderColor={Palette.gray100} overflow="hidden" style={styles.cardShadow}>
                  <Box style={{ height: 3, backgroundColor: isPositive ? Palette.indigo : Palette.gold }} />
                  <Box p="$3">
                    <HStack space="xs" alignItems="center" mb={4}>
                      <Box style={{ backgroundColor: Palette.gray100, borderRadius: 10, padding: 7, alignItems: 'center', justifyContent: 'center' }}>
                        <MaterialIcons name="account-balance-wallet" size={16} color={Palette.indigo} />
                      </Box>
                      <Text style={{ fontSize: Type.tiny, fontWeight: '800', color: Palette.gray400, letterSpacing: 0.5 }}>{t("transfersScreen.statNet")}</Text>
                    </HStack>
                    <Text style={{ fontSize: Type.title, fontWeight: '800', color: isPositive ? Palette.indigo : Palette.gold }} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.4}>
                      {isPositive ? '+' : ''}{formatCurrency(net, { convert: false })}
                    </Text>
                  </Box>
                </Box>
              );
            })()}
          </HStack>
        </Animated.View>

        {/* Add Button */}
        <Pressable onPress={() => { setEditingEntry(null); reset(); setModalOpen(true); }} mt="$4">
          <LinearGradient colors={[Palette.gray700, Palette.ink]} style={{ borderRadius: 16, padding: 14, alignItems: 'center' }}>
            <HStack space="sm" alignItems="center">
              <MaterialIcons name="add" size={20} color="white" />
              <Text color="white" fontWeight="800" fontSize={Type.body}>New Transfer</Text>
            </HStack>
          </LinearGradient>
        </Pressable>

        {/* Transfer List */}
        {isLoading ? (
          <Box mt="$8" alignItems="center">
            <Spinner size="large" color={Palette.gold} />
          </Box>
        ) : transfers.length === 0 ? (
          <Box mt="$8" p="$8" bg="white" rounded={18} alignItems="center" borderWidth={1} borderColor={Palette.gray100} style={styles.cardShadow}>
            <Box style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: Palette.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
              <Ionicons name="swap-horizontal" size={32} color={Palette.gray400} />
            </Box>
            <Text style={{ fontSize: Type.h3, fontWeight: '700', color: Palette.ink, marginBottom: 4 }}>No transfers yet</Text>
            <Text style={{ fontSize: Type.small, color: Palette.gray500, textAlign: 'center' }}>Tap "New Transfer" to record money in or out</Text>
          </Box>
        ) : (
          <VStack space="sm" mt="$4">
            {transfers.map((t, idx) => {
              const isIncoming = t.status === 'incoming';
              return (
                <Animated.View key={t.id} entering={FadeIn.delay(idx * 50)}>
                  <Box bg="white" rounded={18} borderWidth={1} borderColor={Palette.gray100} overflow="hidden" style={styles.cardShadow}>
                    {/* Colored left accent bar */}
                    <Box position="absolute" left={0} top={0} bottom={0} style={{ width: 3, backgroundColor: isIncoming ? Palette.success : Palette.error }} />
                    <HStack style={{ padding: 14, paddingLeft: 18 }} justifyContent="space-between" alignItems="center">
                      <HStack space="sm" alignItems="center" flex={1}>
                        <Box style={{ backgroundColor: isIncoming ? Palette.successTint : Palette.errorTint, borderRadius: 10, padding: 7, alignItems: 'center', justifyContent: 'center' }}>
                          <MaterialIcons name={isIncoming ? "arrow-downward" : "arrow-upward"} size={16} color={isIncoming ? Palette.success : Palette.error} />
                        </Box>
                        <VStack flex={1}>
                          <Text fontWeight="800" fontSize={Type.body} color={Palette.ink} numberOfLines={1}>{t.from} → {t.to}</Text>
                          <HStack space="xs" alignItems="center" style={{ marginTop: 3 }}>
                            <Box style={{ paddingHorizontal: 6, paddingVertical: 2, borderRadius: 99, backgroundColor: isIncoming ? Palette.successTint : Palette.errorTint }}>
                              <Text style={{ fontSize: Type.tiny, fontWeight: '800', color: isIncoming ? Palette.success : Palette.error, letterSpacing: 0.5 }}>
                                {isIncoming ? 'RECEIVED' : 'SENT'}
                              </Text>
                            </Box>
                            <Text style={{ fontSize: Type.caption, color: Palette.gray400 }}>
                              {new Date(t.date).toLocaleDateString(activeLocale(), { month: 'short', day: 'numeric', year: 'numeric' })}
                            </Text>
                          </HStack>
                        </VStack>
                      </HStack>
                      <VStack alignItems="flex-end">
                        <Text fontWeight="800" fontSize={Type.title} color={isIncoming ? Palette.success : Palette.error} numberOfLines={1} adjustsFontSizeToFit>
                          {isIncoming ? '+' : '-'}{formatCurrency(t.amount, { convert: false })}
                        </Text>
                        <HStack space="xs" style={{ marginTop: 6 }} alignItems="center">
                          <Pressable hitSlop={8} onPress={() => {
                            setEditingEntry(t);
                            reset({ amount: t.amount.toString(), from: t.from || '', to: t.to || '', direction: (t.status as 'incoming' | 'outgoing') || 'outgoing', date: t.date.split('T')[0] });
                            setModalOpen(true);
                          }}>
                            <Box style={{ backgroundColor: Palette.gray100, padding: 5, borderRadius: 6 }}>
                              <MaterialIcons name="edit" size={13} color={Palette.gray700} />
                            </Box>
                          </Pressable>
                          <Pressable hitSlop={8} onPress={() => handleDelete(t.id)}>
                            <Box style={{ backgroundColor: Palette.errorTint, padding: 5, borderRadius: 6 }}>
                              <MaterialIcons name="delete-outline" size={13} color={Palette.error} />
                            </Box>
                          </Pressable>
                        </HStack>
                      </VStack>
                    </HStack>
                  </Box>
                </Animated.View>
              );
            })}
          </VStack>
        )}
      </ScrollView>

      {/* Modal Form */}
      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); setEditingEntry(null); }} avoidKeyboard>
        <ModalBackdrop />
        <ModalContent
          bg="white"
          rounded="$3xl"
          overflow="hidden"
          style={{
            width: Dimensions.get('window').width,
            maxHeight: Dimensions.get('window').height * 0.9,
            alignSelf: 'center',
          }}
        >
          {/* Gradient Header */}
          <LinearGradient
            colors={[Palette.gray700, Palette.ink]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 20, paddingBottom: 24 }}
          >
            <HStack alignItems="center" space="md">
              <Box bg="rgba(255,255,255,0.2)" p="$3" rounded="$2xl">
                <MaterialIcons
                  name={editingEntry ? 'edit-note' : 'swap-horiz'}
                  size={26}
                  color="white"
                />
              </Box>
              <VStack>
                <Heading size="lg" color="white" fontWeight="800">
                  {editingEntry ? 'Edit Transfer' : 'New Transfer'}
                </Heading>
                <Text fontSize={Type.small} color="rgba(255,255,255,0.8)" fontWeight="700">
                  {editingEntry ? 'Update transfer details' : 'Record money in or out'}
                </Text>
              </VStack>
            </HStack>
          </LinearGradient>

          <ModalBody px="$0">
            <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
              <VStack space="lg" pb="$6">

                {/* Direction Card */}
                <Box px="$4" pt="$4">
                  <Box bg="white" p="$4" rounded="$2xl" style={styles.cardShadow}>
                    <HStack space="xs" alignItems="center" mb="$3">
                      <Box style={{ backgroundColor: Palette.gray100, borderRadius: 10, padding: 7 }}>
                        <MaterialIcons name="swap-horiz" size={16} color={Palette.indigo} />
                      </Box>
                      <Text fontSize={Type.label} fontWeight="800" color={Palette.gray800}>Transfer Type</Text>
                    </HStack>
                    <Controller
                      control={control}
                      name="direction"
                      render={({ field: { onChange, value } }) => (
                        <HStack space="sm">
                          <Pressable onPress={() => onChange('outgoing')} style={{ flex: 1 }}>
                            <Box
                              bg={value === 'outgoing' ? Palette.errorTint : Palette.gray50}
                              borderWidth={1.5}
                              borderColor={value === 'outgoing' ? Palette.errorAlt : Palette.gray200}
                              p="$3"
                              rounded="$xl"
                              alignItems="center"
                            >
                              <Box bg={value === 'outgoing' ? Palette.errorTint : Palette.gray100} p="$2" rounded="$full" mb="$1">
                                <MaterialIcons name="arrow-upward" size={18} color={value === 'outgoing' ? Palette.errorAlt : Palette.gray400} />
                              </Box>
                              <Text fontSize={Type.label} fontWeight="800" color={value === 'outgoing' ? Palette.errorAlt : Palette.gray400}>Sent</Text>
                            </Box>
                          </Pressable>
                          <Pressable onPress={() => onChange('incoming')} style={{ flex: 1 }}>
                            <Box
                              bg={value === 'incoming' ? Palette.successTint : Palette.gray50}
                              borderWidth={1.5}
                              borderColor={value === 'incoming' ? Palette.green : Palette.gray200}
                              p="$3"
                              rounded="$xl"
                              alignItems="center"
                            >
                              <Box bg={value === 'incoming' ? Palette.successTint : Palette.gray100} p="$2" rounded="$full" mb="$1">
                                <MaterialIcons name="arrow-downward" size={18} color={value === 'incoming' ? Palette.green : Palette.gray400} />
                              </Box>
                              <Text fontSize={Type.label} fontWeight="800" color={value === 'incoming' ? Palette.green : Palette.gray400}>Received</Text>
                            </Box>
                          </Pressable>
                        </HStack>
                      )}
                    />
                  </Box>
                </Box>

                {/* Parties Card */}
                <Box px="$4">
                  <Box bg="white" p="$4" rounded="$2xl" style={styles.cardShadow}>
                    <HStack space="xs" alignItems="center" mb="$3">
                      <Box style={{ backgroundColor: Palette.gray100, borderRadius: 10, padding: 7 }}>
                        <MaterialIcons name="people" size={16} color={Palette.indigo} />
                      </Box>
                      <Text fontSize={Type.label} fontWeight="800" color={Palette.gray800}>Parties</Text>
                    </HStack>
                    <VStack space="md">
                      <VStack space="xs">
                        <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">From</Text>
                        <Controller control={control} name="from" render={({ field: { onChange, value } }) => (
                          <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="xl">
                            <InputSlot pl="$4"><InputIcon as={BasilUserSolid} color={Palette.gray700} /></InputSlot>
                            <InputField placeholder={t("transfersScreen.senderNamePlaceholder")} value={value} onChangeText={onChange} style={{ fontSize: Type.body, fontWeight: '600' }} />
                          </Input>
                        )} />
                      </VStack>
                      <VStack space="xs">
                        <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">To</Text>
                        <Controller control={control} name="to" render={({ field: { onChange, value } }) => (
                          <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="xl">
                            <InputSlot pl="$4"><InputIcon as={BasilUserSolid} color={Palette.gray700} /></InputSlot>
                            <InputField placeholder={t("transfersScreen.recipientNamePlaceholder")} value={value} onChangeText={onChange} style={{ fontSize: Type.body, fontWeight: '600' }} />
                          </Input>
                        )} />
                      </VStack>
                    </VStack>
                  </Box>
                </Box>

                {/* Amount & Date Card */}
                <Box px="$4">
                  <Box bg="white" p="$4" rounded="$2xl" style={styles.cardShadow}>
                    <HStack space="xs" alignItems="center" mb="$3">
                      <Box style={{ backgroundColor: Palette.gray100, borderRadius: 10, padding: 7 }}>
                        <FontAwesome5 name="money-bill-wave" size={15} color={Palette.indigo} />
                      </Box>
                      <Text fontSize={Type.label} fontWeight="800" color={Palette.gray800}>Amount & Date</Text>
                    </HStack>
                    <VStack space="md">
                      <VStack space="xs">
                        <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">Amount ({currencyInfo.code})</Text>
                        <Controller control={control} name="amount" render={({ field: { onChange, value } }) => (
                          <Input bg={Palette.gray50} borderWidth={1} borderColor={Palette.gray100} rounded="$2xl" size="xl">
                            <InputSlot pl="$4">
                              <Text fontWeight="800" fontSize={Type.h2} color={Palette.ink}>{currencyInfo.symbol}</Text>
                            </InputSlot>
                            <InputField
                              keyboardType="decimal-pad"
                              placeholder="0.00"
                              value={value}
                              onChangeText={onChange}
                              style={{ fontSize: Type.h2, fontWeight: '800' }}
                            />
                          </Input>
                        )} />
                      </VStack>
                      <VStack space="xs">
                        <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">Date</Text>
                        <Controller control={control} name="date" render={({ field: { onChange, value } }) => (
                          <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="xl">
                            <InputSlot pl="$4"><InputIcon as={Calendar} color={Palette.gray400} /></InputSlot>
                            <InputField placeholder="YYYY-MM-DD" value={value} onChangeText={onChange} style={{ fontSize: Type.body, fontWeight: '600' }} />
                          </Input>
                        )} />
                      </VStack>
                    </VStack>
                  </Box>
                </Box>

              </VStack>
            </ScrollView>
          </ModalBody>

          <ModalFooter borderTopWidth={0} p="$5">
            <HStack space="md" flex={1}>
              <Pressable onPress={() => { setModalOpen(false); setEditingEntry(null); }} flex={1}>
                <Box bg={Palette.gray100} rounded="$2xl" p="$3.5">
                  <Text textAlign="center" fontWeight="800" color={Palette.gray600} fontSize={Type.body}>Cancel</Text>
                </Box>
              </Pressable>
              <Pressable onPress={handleSubmit(handleFormSubmit)} flex={2} disabled={isSubmitting}>
                <Box bg={Palette.ink} rounded="$2xl" p="$3.5" style={[{ opacity: isSubmitting ? 0.8 : 1 }, styles.cardShadow]}>
                  <HStack space="xs" justifyContent="center" alignItems="center">
                    {isSubmitting && <ActivityIndicator size="small" color="white" />}
                    <Text textAlign="center" fontWeight="800" color="white" fontSize={Type.body}>
                      {editingEntry ? 'Update' : 'Save'}
                    </Text>
                  </HStack>
                </Box>
              </Pressable>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  cardShadow: {
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
});
