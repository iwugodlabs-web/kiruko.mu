/**
 * Field Sales — rep self-service hub.
 *
 * Shows the offline-queue status, the rep's captured sales, and their commission
 * for the current month (read from the company leaderboard). The actual capture
 * flow lives in `field_sale_new.tsx`.
 */

import { Palette, Type } from '@/app/constants/theme';
import { PremiumHeader } from '@/components/PremiumHeader';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Modal as RNModal, RefreshControl, TextInput, TouchableOpacity } from 'react-native';
import { Box, HStack, Pressable, ScrollView, Text, VStack } from '@gluestack-ui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import useAuth from '../hooks/useAuth';
import useCurrency from '../hooks/useCurrency';
import {
  getLeaderboard,
  isApiError,
  isFieldSalesEnabled,
  listMySales,
  updateSale,
  voidSale,
  type RepSale,
} from '@/api/fieldSales';
import { salesQueueStore, type QueuedSale } from '@/services/offline/salesQueue';
import { salesSyncWorker } from '@/services/offline/salesSync';

// Country-agnostic settlement methods — mirrors the backend PAYMENT_METHODS.
const PAYMENT_METHODS: { value: string; label: string; icon: string }[] = [
  { value: 'cash', label: 'Cash', icon: 'cash-outline' },
  { value: 'card', label: 'Card', icon: 'card-outline' },
  { value: 'mobile_money', label: 'Mobile money', icon: 'phone-portrait-outline' },
  { value: 'bank_transfer', label: 'Bank transfer', icon: 'business-outline' },
  { value: 'cheque', label: 'Cheque', icon: 'document-text-outline' },
  { value: 'credit', label: 'Credit', icon: 'time-outline' },
  { value: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' },
];

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
  const [queued, setQueued] = useState<QueuedSale[]>([]);
  const [pending, setPending] = useState(0);
  const [myCommission, setMyCommission] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editing, setEditing] = useState<RepSale | null>(null);
  const [editMethod, setEditMethod] = useState<string>('cash');
  const [editNotes, setEditNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'submitted' | 'approved' | 'void'>('all');
  const [period, setPeriod] = useState<'month' | 'all'>('month');
  // null = unknown (still checking); the entry is normally already hidden by
  // Settings, this is a defence-in-depth guard if the screen is reached anyway.
  const [moduleEnabled, setModuleEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    isFieldSalesEnabled(companyId).then((v) => {
      if (alive) setModuleEnabled(v);
    });
    return () => {
      alive = false;
    };
  }, [companyId]);

  const load = useCallback(async () => {
    if (moduleEnabled === false) {
      setLoading(false);
      return;
    }
    if (!companyId || !repId) {
      setLoading(false);
      return;
    }
    setQueued(await salesQueueStore.listPending());
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
  }, [companyId, repId, moduleEnabled]);

  useEffect(() => {
    salesSyncWorker.register(companyId);
    return salesSyncWorker.onChange(({ pending: p }) => setPending(p));
  }, [companyId]);

  // Reload every time the screen regains focus so a sale captured on the
  // "Log a sale" screen shows up immediately on return.
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

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

  const discardQueued = useCallback((q: QueuedSale) => {
    Alert.alert(
      'Discard this sale?',
      'It was captured offline and hasn’t reached the server. Discarding removes it for good — log it again if needed.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: async () => {
            await salesQueueStore.markSynced(q.id);
            await load();
          },
        },
      ],
    );
  }, [load]);

  const confirmVoid = useCallback((s: RepSale) => {
    Alert.alert(
      'Void this sale?',
      'A voided sale no longer counts toward your commission. Use this when a line was wrong — you can log the corrected sale right after.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Void',
          style: 'destructive',
          onPress: async () => {
            if (!companyId) return;
            const res = await voidSale(companyId, s.id);
            if (isApiError(res)) {
              Alert.alert('Could not void', res.error);
              return;
            }
            await load();
          },
        },
      ],
    );
  }, [companyId, load]);

  const openEdit = useCallback((s: RepSale) => {
    setEditing(s);
    setEditMethod(s.payment_method ?? 'cash');
    setEditNotes(s.notes ?? '');
  }, []);

  const saveEdit = useCallback(async () => {
    if (!companyId || !editing) return;
    setSaving(true);
    const res = await updateSale(companyId, editing.id, {
      payment_method: editMethod || null,
      notes: editNotes.trim() || null,
    });
    setSaving(false);
    if (isApiError(res)) {
      Alert.alert('Could not save', res.error);
      return;
    }
    setEditing(null);
    await load();
  }, [companyId, editing, editMethod, editNotes, load]);

  const repeatSale = useCallback(
    (s: RepSale) => {
      const payload = {
        outlet_id: s.outlet_id,
        payment_method: s.payment_method ?? 'cash',
        lines: s.lines.map((l) => ({ variant_id: l.variant_id, quantity: Number(l.quantity) || 1 })),
      };
      router.push({
        pathname: '/private_dashboard/field_sale_new',
        params: { repeat: JSON.stringify(payload) },
      } as never);
    },
    [router],
  );

  const monthKey = new Date().toISOString().slice(0, 7);
  const monthSales = sales.filter((s) => s.sold_at?.slice(0, 7) === monthKey);
  const monthTotal = monthSales.reduce(
    (acc, s) => acc + s.lines.reduce((a, l) => a + Number(l.line_total), 0),
    0,
  );

  const visibleSales = useMemo(() => {
    const q = query.trim().toLowerCase();
    return sales.filter((s) => {
      if (period === 'month' && s.sold_at?.slice(0, 7) !== monthKey) return false;
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = [
        s.notes ?? '',
        s.payment_method ?? '',
        ...s.lines.map((l) => `${l.product_name ?? ''} ${l.variant_sku ?? ''}`),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sales, query, statusFilter, period, monthKey]);

  if (moduleEnabled === false) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Palette.gray50 }}>
        <PremiumHeader title="Field Sales" />
        <Box flex={1} alignItems="center" justifyContent="center" p="$8">
          <Ionicons name="lock-closed-outline" size={36} color={Palette.gray300} />
          <Text fontWeight="800" color={Palette.ink} mt="$3">
            Field Sales isn&apos;t enabled
          </Text>
          <Text color={Palette.gray500} textAlign="center" mt="$1" fontSize={Type.caption}>
            Ask your employer to switch on Field Sales for your company.
          </Text>
        </Box>
      </SafeAreaView>
    );
  }

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

        {/* This month's own sales */}
        <HStack space="sm" mb="$3">
          <Box flex={1} bg="white" p="$4" rounded="$xl" style={{ borderWidth: 1, borderColor: Palette.gray100 }}>
            <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="700" textTransform="uppercase">
              Sales this month
            </Text>
            <Text fontSize={20} fontWeight="900" color={Palette.ink} mt="$1">
              {monthSales.length}
            </Text>
          </Box>
          <Box flex={1} bg="white" p="$4" rounded="$xl" style={{ borderWidth: 1, borderColor: Palette.gray100 }}>
            <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="700" textTransform="uppercase">
              Value this month
            </Text>
            <Text fontSize={20} fontWeight="900" color={Palette.ink} mt="$1">
              {currency} {monthTotal.toFixed(2)}
            </Text>
          </Box>
        </HStack>

        {/* Sync status + offline edits */}
        {queued.length > 0 && (
          <Box bg={Palette.warningTint} p="$4" rounded="$xl" mb="$3">
            <HStack alignItems="center" space="md">
              <Ionicons name="cloud-upload-outline" size={22} color={Palette.warning} />
              <VStack flex={1}>
                <Text fontWeight="800" color={Palette.ink}>
                  {pending} sale{pending === 1 ? '' : 's'} waiting to sync
                </Text>
                <Text fontSize={Type.caption} color={Palette.gray500}>
                  Saved on your device. Fix or discard a mistake before it syncs.
                </Text>
              </VStack>
              <Pressable onPress={retrySync} hitSlop={8}>
                <HStack alignItems="center" space="xs">
                  <Ionicons name="refresh" size={16} color={Palette.ink} />
                  <Text fontSize={Type.caption} fontWeight="800" color={Palette.ink}>Retry</Text>
                </HStack>
              </Pressable>
            </HStack>

            <VStack mt="$3" space="xs">
              {queued.map((q) => {
                let lineCount = 0;
                try {
                  lineCount = (JSON.parse(q.payloadJson)?.lines ?? []).length;
                } catch {
                  lineCount = 0;
                }
                return (
                  <HStack
                    key={q.id}
                    alignItems="center"
                    justifyContent="space-between"
                    bg="white"
                    rounded="$lg"
                    px="$3"
                    py="$2"
                    style={{ borderWidth: 1, borderColor: Palette.gray100 }}
                  >
                    <VStack flex={1}>
                      <Text fontSize={Type.caption} fontWeight="700" color={Palette.ink}>
                        Captured {new Date(q.createdAt).toLocaleString()}
                      </Text>
                      <Text fontSize={Type.tiny} color={Palette.gray500}>
                        {lineCount} item{lineCount === 1 ? '' : 's'}
                        {q.lastError ? ' · last attempt failed' : ''}
                      </Text>
                    </VStack>
                    <Pressable onPress={() => discardQueued(q)} hitSlop={8}>
                      <HStack alignItems="center" space="xs">
                        <Ionicons name="trash-outline" size={16} color={Palette.error} />
                        <Text fontSize={Type.tiny} fontWeight="800" color={Palette.error}>Discard</Text>
                      </HStack>
                    </Pressable>
                  </HStack>
                );
              })}
            </VStack>
          </Box>
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

        <HStack justifyContent="space-between" alignItems="center" mb="$2">
          <Text fontSize={Type.small} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">
            My recent sales
          </Text>
          <Text fontSize={Type.tiny} fontWeight="700" color={Palette.gray400} mr="$1">
            {visibleSales.length} of {sales.length}
          </Text>
        </HStack>

        <Box bg="white" rounded="$xl" px="$3" py="$2" mb="$2" style={{ borderWidth: 1, borderColor: Palette.gray100 }}>
          <HStack alignItems="center" space="sm">
            <Ionicons name="search" size={16} color={Palette.gray400} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search product, SKU or notes"
              placeholderTextColor={Palette.gray400}
              style={{ flex: 1, fontSize: 14, color: Palette.ink, paddingVertical: 4 }}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Ionicons name="close-circle" size={16} color={Palette.gray400} />
              </Pressable>
            )}
          </HStack>
        </Box>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
          {([
            { value: 'all', label: 'All' },
            { value: 'submitted', label: 'Submitted' },
            { value: 'approved', label: 'Approved' },
            { value: 'void', label: 'Void' },
          ] as const).map((f) => {
            const active = statusFilter === f.value;
            return (
              <Pressable key={f.value} onPress={() => setStatusFilter(f.value)}>
                <Box
                  bg={active ? Palette.ink : 'white'}
                  px="$3"
                  py="$2"
                  rounded="$full"
                  style={{ borderWidth: 1, borderColor: active ? Palette.ink : Palette.gray100 }}
                >
                  <Text fontSize={Type.tiny} fontWeight="800" color={active ? 'white' : Palette.gray600}>
                    {f.label}
                  </Text>
                </Box>
              </Pressable>
            );
          })}
          <Pressable onPress={() => setPeriod(period === 'month' ? 'all' : 'month')}>
            <Box
              bg={period === 'all' ? Palette.ink : 'white'}
              px="$3"
              py="$2"
              rounded="$full"
              style={{ borderWidth: 1, borderColor: period === 'all' ? Palette.ink : Palette.gray100 }}
            >
              <Text fontSize={Type.tiny} fontWeight="800" color={period === 'all' ? 'white' : Palette.gray600}>
                {period === 'month' ? 'This month' : 'All time'}
              </Text>
            </Box>
          </Pressable>
        </ScrollView>

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
        ) : visibleSales.length === 0 ? (
          <Box bg="white" p="$8" rounded="$2xl" alignItems="center">
            <Ionicons name="search" size={32} color={Palette.gray300} />
            <Text fontWeight="800" color={Palette.ink} mt="$3">
              No matching sales
            </Text>
            <Text fontSize={Type.caption} color={Palette.gray400} textAlign="center" mt="$1">
              Try a different search or widen the filters.
            </Text>
          </Box>
        ) : (
          <VStack space="sm">
            {visibleSales.slice(0, 100).map((s) => {
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
                        {s.payment_method ? (
                          <Text fontSize={Type.tiny} color={Palette.gray500} textTransform="capitalize">
                            {s.payment_method.replace(/_/g, ' ')}
                          </Text>
                        ) : null}
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
                    <VStack alignItems="flex-end" space="xs">
                      <Text fontWeight="900" color={Palette.ink}>
                        {s.currency} {total.toFixed(2)}
                      </Text>
                      <Text fontSize={Type.tiny} color={Palette.gray400} textTransform="capitalize">
                        {s.status}
                      </Text>
                    </VStack>
                  </HStack>
                  <VStack mt="$2" space="xs" style={{ borderTopWidth: 1, borderTopColor: Palette.gray100, paddingTop: 8 }}>
                    {s.lines.map((l) => (
                      <HStack key={l.id} justifyContent="space-between" alignItems="center">
                        <Text fontSize={Type.caption} color={Palette.gray600} flex={1} numberOfLines={1}>
                          {l.product_name ?? l.variant_sku ?? `Variant #${l.variant_id}`}
                          {l.variant_sku && l.product_name ? ` · ${l.variant_sku}` : ''}
                        </Text>
                        <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="700" ml="$2">
                          ×{Number(l.quantity)}{l.uom ? ` ${l.uom}` : ''}
                        </Text>
                      </HStack>
                    ))}
                  </VStack>
                  <HStack mt="$2" justifyContent="flex-end" alignItems="center" space="lg">
                    <Pressable onPress={() => repeatSale(s)} hitSlop={8}>
                      <HStack alignItems="center" space="xs">
                        <Ionicons name="repeat" size={14} color={Palette.ink} />
                        <Text fontSize={Type.tiny} fontWeight="800" color={Palette.ink}>Repeat</Text>
                      </HStack>
                    </Pressable>
                    {s.status !== 'void' && (
                      <Pressable onPress={() => openEdit(s)} hitSlop={8}>
                        <HStack alignItems="center" space="xs">
                          <Ionicons name="create-outline" size={14} color={Palette.blue} />
                          <Text fontSize={Type.tiny} fontWeight="800" color={Palette.blue}>Edit</Text>
                        </HStack>
                      </Pressable>
                    )}
                    {s.status !== 'void' && s.status !== 'approved' && (
                      <Pressable onPress={() => confirmVoid(s)} hitSlop={8}>
                        <HStack alignItems="center" space="xs">
                          <Ionicons name="close-circle-outline" size={14} color={Palette.error} />
                          <Text fontSize={Type.tiny} fontWeight="800" color={Palette.error}>Void</Text>
                        </HStack>
                      </Pressable>
                    )}
                  </HStack>
                </Box>
              );
            })}
          </VStack>
        )}
      </ScrollView>

      <RNModal visible={editing != null} animationType="slide" transparent onRequestClose={() => setEditing(null)}>
        <Box flex={1} justifyContent="flex-end" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
          <Box bg="white" rounded="$2xl" p="$5" style={{ borderTopLeftRadius: 24, borderTopRightRadius: 24 }}>
            <HStack justifyContent="space-between" alignItems="center" mb="$3">
              <Text fontWeight="900" fontSize={Type.body} color={Palette.ink}>
                Edit payment
              </Text>
              <Pressable onPress={() => setEditing(null)} hitSlop={8}>
                <Ionicons name="close" size={22} color={Palette.gray500} />
              </Pressable>
            </HStack>
            {editing && (
              <Text fontSize={Type.caption} color={Palette.gray500} mb="$3">
                Sale #{editing.id} · {new Date(editing.sold_at).toLocaleDateString()} · {editing.currency}
              </Text>
            )}

            <Text fontSize={Type.small} fontWeight="700" color={Palette.gray500} mb="$2" textTransform="uppercase">
              Payment method
            </Text>
            <HStack style={{ flexWrap: 'wrap' }} space="sm">
              {PAYMENT_METHODS.map((m) => {
                const active = editMethod === m.value;
                return (
                  <Pressable
                    key={m.value}
                    onPress={() => setEditMethod(m.value)}
                    style={{
                      borderWidth: 1,
                      borderColor: active ? Palette.ink : Palette.gray200,
                      backgroundColor: active ? Palette.ink : 'white',
                      borderRadius: 999,
                      paddingHorizontal: 12,
                      paddingVertical: 8,
                      marginBottom: 8,
                      flexDirection: 'row',
                      alignItems: 'center',
                    }}
                  >
                    <Ionicons name={m.icon as any} size={14} color={active ? 'white' : Palette.gray500} />
                    <Text ml="$1" fontSize={Type.caption} fontWeight="700" color={active ? 'white' : Palette.ink}>
                      {m.label}
                    </Text>
                  </Pressable>
                );
              })}
            </HStack>

            <Text fontSize={Type.small} fontWeight="700" color={Palette.gray500} mt="$3" mb="$2" textTransform="uppercase">
              Notes
            </Text>
            <TextInput
              value={editNotes}
              onChangeText={setEditNotes}
              placeholder="Reference, wallet used (e.g. M-Pesa)…"
              placeholderTextColor={Palette.gray400}
              multiline
              style={{
                borderWidth: 1,
                borderColor: Palette.gray200,
                borderRadius: 12,
                padding: 12,
                minHeight: 64,
                color: Palette.ink,
                textAlignVertical: 'top',
              }}
            />

            <HStack space="sm" mt="$4">
              <Pressable
                onPress={() => setEditing(null)}
                style={{ flex: 1, borderWidth: 1, borderColor: Palette.gray200, borderRadius: 12, paddingVertical: 12, alignItems: 'center' }}
              >
                <Text fontWeight="700" color={Palette.gray600}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={saveEdit}
                disabled={saving}
                style={{ flex: 1, backgroundColor: Palette.ink, borderRadius: 12, paddingVertical: 12, alignItems: 'center', opacity: saving ? 0.6 : 1 }}
              >
                {saving ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text fontWeight="800" color="white">Save</Text>
                )}
              </Pressable>
            </HStack>
          </Box>
        </Box>
      </RNModal>
    </SafeAreaView>
  );
}
