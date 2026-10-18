/**
 * Field Sales — rep self-service hub.
 *
 * Shows the offline-queue status, the rep's captured sales, and their commission
 * for the current month (read from the company leaderboard). The actual capture
 * flow lives in `field_sale_new.tsx`.
 */

import { Palette, Type } from '@/app/constants/theme';
import { PremiumHeader } from '@/components/PremiumHeader';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, TouchableOpacity } from 'react-native';
import { Box, HStack, Pressable, ScrollView, Text, VStack } from '@gluestack-ui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import useAuth from '../hooks/useAuth';
import useCurrency from '../hooks/useCurrency';
import {
  getLeaderboard,
  isApiError,
  listMySales,
  type RepSale,
} from '@/api/fieldSales';
import { salesQueueStore } from '@/services/offline/salesQueue';
import { salesSyncWorker } from '@/services/offline/salesSync';

function monthBounds(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
  return { start, end };
}

export default function FieldSalesScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { currency } = useCurrency();

  const companyId = user?.private_user?.company_id ?? user?.company_id ?? null;
  const repId = user?.private_user?.private_user_id ?? (user?.private_user_id ? Number(user.private_user_id) : null);

  const [sales, setSales] = useState<RepSale[]>([]);
  const [pending, setPending] = useState(0);
  const [myCommission, setMyCommission] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!companyId || !repId) {
      setLoading(false);
      return;
    }
    setPending(await salesQueueStore.count());
    const [salesRes, boardRes] = await Promise.all([
      listMySales(companyId, repId),
      getLeaderboard(companyId, monthBounds().start, monthBounds().end),
    ]);
    if (!isApiError(salesRes)) setSales(salesRes);
    if (!isApiError(boardRes)) {
      const mine = boardRes.entries.find((e) => e.private_user_id === repId);
      setMyCommission(mine ? mine.amount : '0.00');
    }
    setLoading(false);
  }, [companyId, repId]);

  useEffect(() => {
    salesSyncWorker.register(companyId);
    const unsub = salesSyncWorker.onChange(({ pending: p }) => setPending(p));
    load();
    return unsub;
  }, [companyId, load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await salesSyncWorker.runOnce().catch(() => undefined);
    await load();
    setRefreshing(false);
  }, [load]);

  const retrySync = async () => {
    const res = await salesSyncWorker.runOnce();
    if (res.failed > 0) {
      Alert.alert('Some sales still pending', `${res.failed} could not be sent yet. They'll retry automatically.`);
    }
    await load();
  };

  if (!companyId || !repId) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Palette.gray50 }}>
        <PremiumHeader title="Field Sales" />
        <Box flex={1} alignItems="center" justifyContent="center" p="$8">
          <Text color={Palette.gray500} textAlign="center">
            Field sales is available to employees linked to a company.
          </Text>
        </Box>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.gray50 }}>
      <PremiumHeader title="Field Sales" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Palette.gold} />}
      >
        {/* Commission this month */}
        <Box bg="white" p="$5" rounded="$2xl" mb="$3" style={{ borderWidth: 1, borderColor: Palette.gray100 }}>
          <Text fontSize={Type.small} color={Palette.gray500} fontWeight="700" textTransform="uppercase">
            Commission this month
          </Text>
          <Text fontSize={34} fontWeight="900" color={Palette.ink} mt="$1">
            {myCommission != null ? `${currency} ${Number(myCommission).toFixed(2)}` : '—'}
          </Text>
          <Text fontSize={Type.caption} color={Palette.gray400} mt="$1">
            Paid on your next payslip once the period is approved.
          </Text>
        </Box>

        {/* Sync status */}
        {pending > 0 && (
          <Pressable onPress={retrySync}>
            <HStack bg={Palette.warningTint} p="$4" rounded="$xl" mb="$3" alignItems="center" space="md">
              <Ionicons name="cloud-upload-outline" size={22} color={Palette.warning} />
              <VStack flex={1}>
                <Text fontWeight="800" color={Palette.ink}>
                  {pending} sale{pending === 1 ? '' : 's'} waiting to sync
                </Text>
                <Text fontSize={Type.caption} color={Palette.gray500}>
                  Saved on your device — tap to retry now.
                </Text>
              </VStack>
              <Ionicons name="refresh" size={18} color={Palette.gray500} />
            </HStack>
          </Pressable>
        )}

        {/* CTA */}
        <TouchableOpacity activeOpacity={0.9} onPress={() => router.push('/private_dashboard/field_sale_new' as any)}>
          <HStack bg={Palette.ink} p="$5" rounded="$2xl" mb="$4" alignItems="center" space="md">
            <Ionicons name="add-circle" size={26} color={Palette.gold} />
            <VStack flex={1}>
              <Text color="white" fontWeight="900" fontSize={Type.body}>
                Log a sale
              </Text>
              <Text color="rgba(255,255,255,0.7)" fontSize={Type.caption}>
                Check in at the outlet, scan, and record what you sold.
              </Text>
            </VStack>
            <Ionicons name="chevron-forward" size={20} color="rgba(255,255,255,0.7)" />
          </HStack>
        </TouchableOpacity>

        <Text fontSize={Type.small} fontWeight="800" color={Palette.gray400} textTransform="uppercase" mb="$2" ml="$1">
          My recent sales
        </Text>

        {loading ? (
          <Box py="$10" alignItems="center">
            <ActivityIndicator color={Palette.gold} />
          </Box>
        ) : sales.length === 0 ? (
          <Box bg="white" p="$8" rounded="$2xl" alignItems="center">
            <Ionicons name="receipt-outline" size={36} color={Palette.gray300} />
            <Text fontWeight="800" color={Palette.ink} mt="$3">
              No sales yet
            </Text>
            <Text fontSize={Type.caption} color={Palette.gray400} textAlign="center" mt="$1">
              Sales you log in the field will appear here.
            </Text>
          </Box>
        ) : (
          <VStack space="sm">
            {sales.slice(0, 30).map((s) => {
              const total = s.lines.reduce((acc, l) => acc + Number(l.line_total), 0);
              return (
                <Box key={s.id} bg="white" p="$4" rounded="$xl" style={{ borderWidth: 1, borderColor: Palette.gray100 }}>
                  <HStack justifyContent="space-between" alignItems="center">
                    <VStack space="xs" flex={1}>
                      <Text fontWeight="800" color={Palette.ink}>
                        {new Date(s.sold_at).toLocaleDateString()}
                      </Text>
                      <HStack space="sm" alignItems="center">
                        <Text fontSize={Type.caption} color={Palette.gray500}>
                          {s.lines.length} line{s.lines.length === 1 ? '' : 's'}
                        </Text>
                        {s.visit_verified === true && (
                          <HStack space="xs" alignItems="center">
                            <Ionicons name="checkmark-circle" size={12} color={Palette.success} />
                            <Text fontSize={Type.tiny} color={Palette.success} fontWeight="700">
                              Visit verified
                            </Text>
                          </HStack>
                        )}
                        {s.visit_verified === false && (
                          <Text fontSize={Type.tiny} color={Palette.warning} fontWeight="700">
                            Visit flagged
                          </Text>
                        )}
                      </HStack>
                    </VStack>
                    <VStack alignItems="flex-end">
                      <Text fontWeight="900" color={Palette.ink}>
                        {s.currency} {total.toFixed(2)}
                      </Text>
                      <Text fontSize={Type.tiny} color={Palette.gray400} textTransform="capitalize">
                        {s.status}
                      </Text>
                    </VStack>
                  </HStack>
                </Box>
              );
            })}
          </VStack>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
