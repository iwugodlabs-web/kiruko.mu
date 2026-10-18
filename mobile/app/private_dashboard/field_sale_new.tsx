/**
 * Field Sales — capture a sale.
 *
 * Rep flow: pick the outlet (geofence check-in), add product lines
 * (scan barcode or pick from the catalog), submit. Sales are pinned to the
 * offline queue first, then flushed — so a dead zone never loses a sale.
 */

import { Palette, Type } from '@/app/constants/theme';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  isApiError,
  listCatalog,
  listOutlets,
  type CatalogProduct,
  type CatalogVariant,
  type FieldOutlet,
  type SyncSaleItem,
} from '@/api/fieldSales';
import { newClientUuid, salesQueueStore } from '@/services/offline/salesQueue';
import { salesSyncWorker } from '@/services/offline/salesSync';

interface DraftLine {
  key: string;
  variant: CatalogVariant;
  quantity: string;
}

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

export default function NewFieldSaleScreen() {
  const router = useRouter();
  const toast = useToast();
  const { user } = useAuth();

  const companyId = user?.private_user?.company_id ?? user?.company_id ?? null;
  const repId = user?.private_user?.private_user_id ?? (user?.private_user_id ? Number(user.private_user_id) : null);

  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [outlets, setOutlets] = useState<FieldOutlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [selectedOutlet, setSelectedOutlet] = useState<FieldOutlet | null>(null);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [visitDistance, setVisitDistance] = useState<number | null>(null);

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [search, setSearch] = useState('');

  const [permission, requestPermission] = useCameraPermissions();

  const allVariants = useMemo(
    () => products.flatMap((p) => p.variants.map((v) => ({ product: p, variant: v }))),
    [products],
  );

  useEffect(() => {
    (async () => {
      if (!companyId || !repId) {
        setLoading(false);
        return;
      }
      const [catRes, outRes] = await Promise.all([
        listCatalog(companyId),
        listOutlets(companyId, repId),
      ]);
      if (!isApiError(catRes)) setProducts(catRes);
      if (!isApiError(outRes)) setOutlets(outRes);
      setLoading(false);
    })();
  }, [companyId, repId]);

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
      const c = await captureLocation();
      if (c && outlet.latitude != null && outlet.longitude != null) {
        setVisitDistance(haversineM(c.latitude, c.longitude, outlet.latitude, outlet.longitude));
      } else {
        setVisitDistance(null);
      }
    },
    [captureLocation],
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
                  <HStack space="md" alignItems="center">
                    <Pressable
                      onPress={() =>
                        setLines((prev) =>
                          prev
                            .map((x) => (x.key === l.key ? { ...x, quantity: String(Math.max(0, Number(x.quantity) - 1)) } : x))
                            .filter((x) => Number(x.quantity) > 0),
                        )
                      }
                      hitSlop={8}
                    >
                      <Box bg={Palette.gray100} w="$8" h="$8" rounded="$full" alignItems="center" justifyContent="center">
                        <Ionicons name="remove" size={16} color={Palette.ink} />
                      </Box>
                    </Pressable>
                    <Text fontWeight="900" color={Palette.ink} minWidth={28} textAlign="center">
                      {l.quantity}
                    </Text>
                    <Pressable
                      onPress={() =>
                        setLines((prev) => prev.map((x) => (x.key === l.key ? { ...x, quantity: String(Number(x.quantity) + 1) } : x)))
                      }
                      hitSlop={8}
                    >
                      <Box bg={Palette.ink} w="$8" h="$8" rounded="$full" alignItems="center" justifyContent="center">
                        <Ionicons name="add" size={16} color="white" />
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
            {lines[0]?.variant.currency ?? 'MUR'} {total.toFixed(2)}
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
