/**
 * Field Sales — capture a sale.
 *
 * Rep flow: pick the outlet (geofence check-in), add product lines
 * (scan barcode or pick from the catalog), submit. Sales are pinned to the
 * offline queue first, then flushed — so a dead zone never loses a sale.
 */

import { Palette, Type } from '@/app/constants/theme';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  ActivityIndicator,
  Alert,
  Modal as RNModal,
  ScrollView as RNScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
} from 'react-native';
import {
  Box,
  Button,
  ButtonText,
  HStack,
  Pressable,
  ScrollView,
  Text,
  VStack,
  useToast,
  Toast,
  ToastTitle,
  ToastDescription,
} from '@gluestack-ui/themed';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { CameraView, useCameraPermissions } from 'expo-camera';
import useAuth from '../hooks/useAuth';
import useCurrency from '../hooks/useCurrency';
import {
  isApiError,
  listCatalog,
  listMySales,
  listOutlets,
  type CatalogProduct,
  type CatalogVariant,
  type FieldOutlet,
  type RepSale,
  type SyncSaleItem,
} from '@/api/fieldSales';
import { catalogCache } from '@/services/offline/catalogCache';
import { newClientUuid, salesQueueStore } from '@/services/offline/salesQueue';
import { salesSyncWorker } from '@/services/offline/salesSync';

interface DraftLine {
  key: string;
  variant: CatalogVariant;
  quantity: string;
}

// Country-agnostic settlement methods. "Mobile money" is the generic bucket for
// local wallets (M-Pesa, Orange Money, Juice, ...) — the specific wallet can go
// in the notes. Must stay in step with PAYMENT_METHODS on the backend.
const PAYMENT_METHODS: { value: string; label: string; icon: string }[] = [
  { value: 'cash', label: 'Cash', icon: 'cash-outline' },
  { value: 'card', label: 'Card', icon: 'card-outline' },
  { value: 'mobile_money', label: 'Mobile money', icon: 'phone-portrait-outline' },
  { value: 'bank_transfer', label: 'Bank transfer', icon: 'business-outline' },
  { value: 'cheque', label: 'Cheque', icon: 'document-text-outline' },
  { value: 'credit', label: 'Credit', icon: 'time-outline' },
];

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

interface RepeatPayload {
  lines?: { variant_id: number; quantity: number }[];
  outlet_id?: number | null;
  payment_method?: string | null;
}

const lastOutletKey = (companyId: number | null) => `field_sales:last_outlet:${companyId ?? 'none'}`;

export default function NewFieldSaleScreen() {
  const router = useRouter();
  const { repeat } = useLocalSearchParams<{ repeat?: string }>();
  const toast = useToast();
  const { user } = useAuth();
  const { baseCurrency } = useCurrency();

  const companyId = user?.private_user?.company_id ?? user?.company_id ?? null;
  const repId = user?.private_user?.private_user_id ?? (user?.private_user_id ? Number(user.private_user_id) : null);

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [outlets, setOutlets] = useState<FieldOutlet[]>([]);
  const [recentVariantIds, setRecentVariantIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [offline, setOffline] = useState(false);
  const appliedPrefill = useRef(false);

  const [selectedOutlet, setSelectedOutlet] = useState<FieldOutlet | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [visitDistance, setVisitDistance] = useState<number | null>(null);

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const [permission, requestPermission] = useCameraPermissions();

  const allVariants = useMemo(
    () => products.flatMap((p) => p.variants.map((v) => ({ product: p, variant: v }))),
    [products],
  );

  const recentVariants = useMemo(
    () =>
      recentVariantIds
        .map((id) => allVariants.find((v) => v.variant.id === id))
        .filter((v): v is { product: CatalogProduct; variant: CatalogVariant } => v != null),
    [recentVariantIds, allVariants],
  );

  useEffect(() => {
    (async () => {
      if (!companyId || !repId) {
        setLoading(false);
        return;
      }

      const applyRecents = (sales: RepSale[]) => {
        const ids: number[] = [];
        [...sales]
          .filter((s) => s.status !== 'void')
          .sort((a, b) => new Date(b.sold_at).getTime() - new Date(a.sold_at).getTime())
          .forEach((s) =>
            s.lines.forEach((l) => {
              if (!ids.includes(l.variant_id)) ids.push(l.variant_id);
            }),
          );
        setRecentVariantIds(ids.slice(0, 12));
      };

      const applyPrefill = async (catalog: CatalogProduct[], repsOutlets: FieldOutlet[]) => {
        if (appliedPrefill.current) return;
        appliedPrefill.current = true;
        const variants = catalog.flatMap((p) => p.variants);
        let payload: RepeatPayload | null = null;
        if (repeat) {
          try {
            payload = JSON.parse(String(repeat)) as RepeatPayload;
          } catch {
            payload = null;
          }
        }

        if (payload?.lines?.length) {
          const prefill = payload.lines
            .map((l) => {
              const variant = variants.find((v) => v.id === l.variant_id);
              return variant ? { key: newClientUuid(), variant, quantity: String(Math.max(1, Number(l.quantity) || 1)) } : null;
            })
            .filter((l): l is DraftLine => l != null);
          if (prefill.length) setLines(prefill);
          if (payload.payment_method) setPaymentMethod(payload.payment_method);
          const outlet = repsOutlets.find((o) => o.id === payload?.outlet_id);
          if (outlet) setSelectedOutlet(outlet);
        } else {
          const stored = await AsyncStorage.getItem(lastOutletKey(companyId));
          const outlet = stored ? repsOutlets.find((o) => String(o.id) === stored) : null;
          if (outlet) setSelectedOutlet(outlet);
        }
      };

      const cached = await catalogCache.get(companyId, repId);
      if (cached) {
        setProducts(cached.products);
        setOutlets(cached.outlets);
        await applyPrefill(cached.products, cached.outlets);
        setLoading(false);
      }

      const [catRes, outRes, salesRes] = await Promise.all([
        listCatalog(companyId),
        listOutlets(companyId, repId),
        listMySales(companyId, repId),
      ]);
      const catOk = !isApiError(catRes);
      const outOk = !isApiError(outRes);
      if (catOk) setProducts(catRes);
      if (outOk) setOutlets(outRes);
      if (catOk && outOk) void catalogCache.set(companyId, repId, catRes, outRes);
      if (!isApiError(salesRes)) applyRecents(salesRes);

      if (!cached) await applyPrefill(catOk ? catRes : [], outOk ? outRes : []);
      setOffline(!catOk && !outOk);
      setLoading(false);
    })();
  }, [companyId, repId, repeat]);

  const captureLocation = useCallback(async () => {
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') return null;
      let loc = await Location.getLastKnownPositionAsync();
      if (!loc) {
        loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      }
      if (!loc?.coords) return null;
      const c = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setCoords(c);
      return c;
    } catch {
      return null;
    }
  }, []);

  const pickOutlet = useCallback(
    async (outlet: FieldOutlet) => {
      setSelectedOutlet(outlet);
      AsyncStorage.setItem(lastOutletKey(companyId), String(outlet.id)).catch(() => {});
      const c = await captureLocation();
      if (c && outlet.latitude != null && outlet.longitude != null) {
        setVisitDistance(haversineM(c.latitude, c.longitude, outlet.latitude, outlet.longitude));
      } else {
        setVisitDistance(null);
      }
    },
    [captureLocation, companyId],
  );

  const addVariant = useCallback((variant: CatalogVariant) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.variant.id === variant.id);
      if (existing) {
        return prev.map((l) =>
          l.variant.id === variant.id ? { ...l, quantity: String(Number(l.quantity || '0') + 1) } : l,
        );
      }
      return [...prev, { key: newClientUuid(), variant, quantity: '1' }];
    });
  }, []);

  const handleBarcode = useCallback(
    ({ data }: { data: string }) => {
      const match = allVariants.find((v) => v.variant.barcode === data);
      setScannerOpen(false);
      if (match) {
        addVariant(match.variant);
        toast.show({
          placement: 'top',
          render: ({ id }) => (
            <Toast nativeID={id} action="success" variant="solid">
              <VStack space="xs">
                <ToastTitle>Added</ToastTitle>
                <ToastDescription>{match.product.name} — {match.variant.sku}</ToastDescription>
              </VStack>
            </Toast>
          ),
        });
      } else {
        Alert.alert('Unknown barcode', `No product matches ${data}.`);
      }
    },
    [allVariants, addVariant, toast],
  );

  const total = useMemo(
    () => lines.reduce((acc, l) => acc + Number(l.variant.unit_price) * (Number(l.quantity) || 0), 0),
    [lines],
  );

  const submit = async () => {
    if (!companyId || !repId) return;
    const validLines = lines.filter((l) => Number(l.quantity) > 0);
    if (validLines.length === 0) {
      Alert.alert('Nothing to save', 'Add at least one product with a quantity.');
      return;
    }
    if (!selectedOutlet && outlets.length > 0) {
      Alert.alert('Pick an outlet', 'Select the outlet you sold at (or continue without one).', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: () => void performSubmit(validLines) },
      ]);
      return;
    }
    await performSubmit(validLines);
  };

  const performSubmit = async (validLines: DraftLine[]) => {
    if (!companyId || !repId) return;
    setSubmitting(true);
    const item: SyncSaleItem = {
      client_uuid: newClientUuid(),
      rep_private_user_id: repId,
      outlet_id: selectedOutlet?.id ?? null,
      sold_at: new Date().toISOString(),
      geo: coords,
      currency: baseCurrency || null,
      payment_method: paymentMethod,
      notes: null,
      lines: validLines.map((l) => ({ variant_id: l.variant.id, quantity: Number(l.quantity) })),
    };

    await salesQueueStore.enqueue(item);
    salesSyncWorker.setCompanyId(companyId);
    const result = await salesSyncWorker.runOnce().catch(() => null);

    setSubmitting(false);
    const stillQueued = await salesQueueStore.getById(item.client_uuid);
    if (stillQueued) {
      toast.show({
        placement: 'top',
        render: ({ id }) => (
          <Toast nativeID={id} action="warning" variant="solid">
            <VStack space="xs">
              <ToastTitle>Saved offline</ToastTitle>
              <ToastDescription>It will sync automatically when you’re back online.</ToastDescription>
            </VStack>
          </Toast>
        ),
      });
    } else if (result && result.succeeded > 0) {
      toast.show({
        placement: 'top',
        render: ({ id }) => (
          <Toast nativeID={id} action="success" variant="solid">
            <VStack space="xs">
              <ToastTitle>Sale submitted</ToastTitle>
              <ToastDescription>It’s queued for review and commission.</ToastDescription>
            </VStack>
          </Toast>
        ),
      });
    } else {
      Alert.alert('Could not submit', 'The sale was saved but the server rejected it. Check the products and try again.');
    }

    router.replace('/private_dashboard/field_sales' as any);
  };

  const openScanner = async () => {
    if (!permission?.granted) {
      const res = await requestPermission();
      if (!res.granted) {
        Alert.alert('Camera needed', 'Allow camera access to scan barcodes.');
        return;
      }
    }
    setScannerOpen(true);
  };

  const filteredVariants = search.trim()
    ? allVariants.filter(({ product, variant }) =>
        `${product.name} ${variant.sku} ${variant.barcode ?? ''}`.toLowerCase().includes(search.toLowerCase()),
      )
    : allVariants;

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Palette.gray50 }}>
        <Box flex={1} alignItems="center" justifyContent="center">
          <ActivityIndicator color={Palette.gold} />
        </Box>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.gray50 }}>
      <HStack p="$4" alignItems="center" space="md" bg="white" style={styles.headerShadow}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="arrow-back" size={24} color={Palette.ink} />
        </Pressable>
        <Text fontSize={Type.h3} fontWeight="900" color={Palette.ink}>
          Log a sale
        </Text>
      </HStack>

      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 140 }}>
        {offline && (
          <HStack bg={Palette.gray100} px="$3" py="$2" rounded="$xl" mb="$3" alignItems="center" space="xs">
            <Ionicons name="cloud-offline-outline" size={15} color={Palette.gray500} />
            <Text fontSize={Type.tiny} color={Palette.gray600} fontWeight="700" flex={1}>
              Offline — showing your saved catalog. Sales sync when you reconnect.
            </Text>
          </HStack>
        )}

        {/* Outlet */}
        <Text fontSize={Type.small} fontWeight="800" color={Palette.gray400} textTransform="uppercase" mb="$2" ml="$1">
          Outlet
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 4 }}>
          {outlets.length === 0 && (
            <Box bg="white" px="$4" py="$3" rounded="$xl" style={{ borderWidth: 1, borderColor: Palette.gray100 }}>
              <Text color={Palette.gray500} fontSize={Type.caption}>No outlets assigned</Text>
            </Box>
          )}
          {outlets.map((o) => {
            const active = selectedOutlet?.id === o.id;
            return (
              <Pressable key={o.id} onPress={() => pickOutlet(o)}>
                <Box
                  bg={active ? Palette.ink : 'white'}
                  px="$4"
                  py="$3"
                  rounded="$xl"
                  style={{ borderWidth: 1, borderColor: active ? Palette.ink : Palette.gray100 }}
                >
                  <Text color={active ? 'white' : Palette.ink} fontWeight="800" fontSize={Type.caption}>
                    {o.name}
                  </Text>
                  {o.address ? (
                    <Text color={active ? 'rgba(255,255,255,0.7)' : Palette.gray400} fontSize={Type.tiny} numberOfLines={1}>
                      {o.address}
                    </Text>
                  ) : null}
                </Box>
              </Pressable>
            );
          })}
        </ScrollView>

        {selectedOutlet && (
          <HStack mt="$2" ml="$1" space="xs" alignItems="center">
            {visitDistance == null ? (
              <>
                <Ionicons name="location-outline" size={13} color={Palette.gray400} />
                <Text fontSize={Type.tiny} color={Palette.gray400}>Location not captured (will save as unverified)</Text>
              </>
            ) : visitDistance <= (selectedOutlet.radius_meters || 150) ? (
              <>
                <Ionicons name="checkmark-circle" size={13} color={Palette.success} />
                <Text fontSize={Type.tiny} color={Palette.success} fontWeight="700">
                  Checked in — {Math.round(visitDistance)}m from outlet
                </Text>
              </>
            ) : (
              <>
                <Ionicons name="warning" size={13} color={Palette.warning} />
                <Text fontSize={Type.tiny} color={Palette.warning} fontWeight="700">
                  {Math.round(visitDistance)}m away — visit may be flagged
                </Text>
              </>
            )}
          </HStack>
        )}

        {/* Payment method */}
        <Text fontSize={Type.small} fontWeight="800" color={Palette.gray400} textTransform="uppercase" mt="$5" mb="$2" ml="$1">
          Payment
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 4 }}>
          {PAYMENT_METHODS.map((m) => {
            const active = paymentMethod === m.value;
            return (
              <Pressable key={m.value} onPress={() => setPaymentMethod(m.value)}>
                <HStack
                  bg={active ? Palette.ink : 'white'}
                  px="$3"
                  py="$2"
                  rounded="$full"
                  space="xs"
                  alignItems="center"
                  style={{ borderWidth: 1, borderColor: active ? Palette.ink : Palette.gray100 }}
                >
                  <Ionicons name={m.icon as any} size={14} color={active ? 'white' : Palette.ink} />
                  <Text color={active ? 'white' : Palette.ink} fontWeight="700" fontSize={Type.caption}>
                    {m.label}
                  </Text>
                </HStack>
              </Pressable>
            );
          })}
        </ScrollView>

        {recentVariants.length > 0 && (
          <>
            <Text fontSize={Type.small} fontWeight="800" color={Palette.gray400} textTransform="uppercase" mt="$5" mb="$2" ml="$1">
              Recent
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingBottom: 4 }}>
              {recentVariants.map(({ product, variant }) => (
                <Pressable key={variant.id} onPress={() => addVariant(variant)}>
                  <Box bg="white" px="$3" py="$2" rounded="$full" style={{ borderWidth: 1, borderColor: Palette.gray100 }}>
                    <Text fontSize={Type.caption} fontWeight="700" color={Palette.ink} numberOfLines={1}>
                      {product.name}
                    </Text>
                    <Text fontSize={Type.tiny} color={Palette.gray400}>
                      {variant.sku}
                    </Text>
                  </Box>
                </Pressable>
              ))}
            </ScrollView>
          </>
        )}

        {/* Lines */}
        <HStack justifyContent="space-between" alignItems="center" mt="$5" mb="$2">
          <Text fontSize={Type.small} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">
            Products
          </Text>
          <HStack space="sm">
            <TouchableOpacity onPress={openScanner}>
              <HStack bg={Palette.gray100} px="$3" py="$2" rounded="$full" space="xs" alignItems="center">
                <Ionicons name="barcode-outline" size={15} color={Palette.ink} />
                <Text fontSize={Type.caption} fontWeight="700" color={Palette.ink}>Scan</Text>
              </HStack>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setPickerOpen(true)}>
              <HStack bg={Palette.ink} px="$3" py="$2" rounded="$full" space="xs" alignItems="center">
                <Ionicons name="add" size={15} color="white" />
                <Text fontSize={Type.caption} fontWeight="700" color="white">Add</Text>
              </HStack>
            </TouchableOpacity>
          </HStack>
        </HStack>

        {lines.length === 0 ? (
          <Box bg="white" p="$8" rounded="$2xl" alignItems="center">
            <Ionicons name="cart-outline" size={34} color={Palette.gray300} />
            <Text fontWeight="800" color={Palette.ink} mt="$3">No products yet</Text>
            <Text fontSize={Type.caption} color={Palette.gray400} mt="$1">Scan a barcode or add from the catalog.</Text>
          </Box>
        ) : (
          <VStack space="sm">
            {lines.map((l) => (
              <Box key={l.key} bg="white" p="$4" rounded="$xl" style={{ borderWidth: 1, borderColor: Palette.gray100 }}>
                <HStack justifyContent="space-between" alignItems="center">
                  <VStack flex={1} space="xs">
                    <Text fontWeight="800" color={Palette.ink} numberOfLines={1}>
                      {allVariants.find((v) => v.variant.id === l.variant.id)?.product.name ?? l.variant.sku}
                    </Text>
                    <Text fontSize={Type.tiny} color={Palette.gray400}>
                      {l.variant.sku} · {l.variant.currency} {Number(l.variant.unit_price).toFixed(2)}
                    </Text>
                  </VStack>
                  <HStack space="sm" alignItems="center">
                    <Pressable
                      accessibilityLabel={`Decrease quantity of ${l.variant.sku}`}
                      onPress={() =>
                        setLines((prev) =>
                          prev
                            .map((x) => (x.key === l.key ? { ...x, quantity: String(Math.max(0, Number(x.quantity) - 1)) } : x))
                            .filter((x) => Number(x.quantity) > 0),
                        )
                      }
                      hitSlop={10}
                    >
                      <Box bg={Palette.gray100} w="$10" h="$10" rounded="$full" alignItems="center" justifyContent="center">
                        <Ionicons name="remove" size={18} color={Palette.ink} />
                      </Box>
                    </Pressable>
                    <TextInput
                      accessibilityLabel={`Quantity of ${l.variant.sku}`}
                      value={l.quantity}
                      onChangeText={(t) =>
                        setLines((prev) => prev.map((x) => (x.key === l.key ? { ...x, quantity: t.replace(/[^0-9]/g, '') } : x)))
                      }
                      onBlur={() =>
                        setLines((prev) =>
                          prev.map((x) =>
                            x.key === l.key ? { ...x, quantity: x.quantity === '' || Number(x.quantity) < 1 ? '1' : x.quantity } : x,
                          ),
                        )
                      }
                      keyboardType="number-pad"
                      inputMode="numeric"
                      returnKeyType="done"
                      selectTextOnFocus
                      maxLength={6}
                      style={styles.qtyInput}
                    />
                    <Pressable
                      accessibilityLabel={`Increase quantity of ${l.variant.sku}`}
                      onPress={() =>
                        setLines((prev) => prev.map((x) => (x.key === l.key ? { ...x, quantity: String(Number(x.quantity) + 1) } : x)))
                      }
                      hitSlop={10}
                    >
                      <Box bg={Palette.ink} w="$10" h="$10" rounded="$full" alignItems="center" justifyContent="center">
                        <Ionicons name="add" size={18} color="white" />
                      </Box>
                    </Pressable>
                  </HStack>
                </HStack>
              </Box>
            ))}
          </VStack>
        )}
      </ScrollView>

      {/* Footer */}
      <Box
        position="absolute"
        left={0}
        right={0}
        bottom={0}
        bg="white"
        px="$4"
        pt="$3"
        pb="$6"
        style={styles.footerShadow}
      >
        <HStack justifyContent="space-between" alignItems="center" mb="$3">
          <Text color={Palette.gray500} fontWeight="700" textTransform="uppercase" fontSize={Type.small}>
            Total
          </Text>
          <Text fontWeight="900" fontSize={20} color={Palette.ink}>
            {baseCurrency || lines[0]?.variant.currency || 'MUR'} {total.toFixed(2)}
          </Text>
        </HStack>
        <Button bg={Palette.ink} onPress={submit} isDisabled={submitting}>
          <ButtonText fontWeight="800">{submitting ? 'Saving…' : 'Submit sale'}</ButtonText>
        </Button>
      </Box>

      {/* Product picker */}
      <RNModal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: Palette.gray50 }}>
          <HStack p="$4" alignItems="center" space="md" bg="white">
            <Pressable onPress={() => setPickerOpen(false)} hitSlop={10}>
              <Ionicons name="close" size={24} color={Palette.ink} />
            </Pressable>
            <Box flex={1} bg={Palette.gray100} rounded="$full" px="$4" py="$2">
              <TextInput
                placeholder="Search products or SKU"
                placeholderTextColor={Palette.gray400}
                value={search}
                onChangeText={setSearch}
                style={{ fontSize: 15, color: Palette.ink }}
              />
            </Box>
          </HStack>
          <RNScrollView contentContainerStyle={{ padding: 16 }}>
            {filteredVariants.map(({ product, variant }) => (
              <TouchableOpacity
                key={variant.id}
                onPress={() => {
                  addVariant(variant);
                  setPickerOpen(false);
                }}
              >
                <Box bg="white" p="$4" rounded="$xl" mb="$2" style={{ borderWidth: 1, borderColor: Palette.gray100 }}>
                  <HStack justifyContent="space-between" alignItems="center">
                    <VStack flex={1}>
                      <Text fontWeight="800" color={Palette.ink}>{product.name}</Text>
                      <Text fontSize={Type.tiny} color={Palette.gray400}>
                        {variant.sku}{product.category ? ` · ${product.category}` : ''}
                      </Text>
                    </VStack>
                    <Text fontWeight="800" color={Palette.ink}>
                      {variant.currency} {Number(variant.unit_price).toFixed(2)}
                    </Text>
                  </HStack>
                </Box>
              </TouchableOpacity>
            ))}
            {filteredVariants.length === 0 && (
              <Box py="$10" alignItems="center">
                <Text color={Palette.gray400}>No products found.</Text>
              </Box>
            )}
          </RNScrollView>
        </SafeAreaView>
      </RNModal>

      {/* Barcode scanner */}
      <RNModal visible={scannerOpen} animationType="slide" onRequestClose={() => setScannerOpen(false)}>
        <Box flex={1} bg="black">
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e', 'code128', 'code39', 'qr'] }}
            onBarcodeScanned={handleBarcode}
          />
          <SafeAreaView style={{ flex: 1 }} pointerEvents="box-none">
            <HStack p="$4" justifyContent="space-between" alignItems="center">
              <Text color="white" fontWeight="800">Scan barcode</Text>
              <Pressable onPress={() => setScannerOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={26} color="white" />
              </Pressable>
            </HStack>
          </SafeAreaView>
        </Box>
      </RNModal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  qtyInput: {
    minWidth: 48,
    height: 40,
    textAlign: 'center',
    fontWeight: '900',
    fontSize: 16,
    color: Palette.ink,
    paddingHorizontal: 4,
  },
  headerShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 3,
  },
  footerShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
    borderTopWidth: 1,
    borderTopColor: Palette.gray100,
  },
});
