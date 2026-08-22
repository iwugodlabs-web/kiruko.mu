import { Palette, Type } from '@/app/constants/theme';
import {
  FinancialsData,
  createLoan,
  createPurchase,
  createRepayment,
  createSubscription,
  createTransfer,
  deleteLoan,
  deletePurchase,
  deleteSubscription,
  deleteTransfer,
  getFinancials,
  getRepaymentsByLoan,
  isApiError,
  updateLoan,
  updatePurchase,
  updateSubscription,
  updateTransfer,
  scanReceipt,
  ScannedReceipt,
  type Purchase,
  createRent,
  updateRent,
  deleteRent,
  type RentData,
  type Repayment,
} from '@/services/api';
import * as ImagePicker from 'expo-image-picker';
import { Camera } from 'lucide-react-native';
import { FontAwesome5, Ionicons, MaterialIcons } from '@expo/vector-icons';
import {
  Box, Button, ButtonText,
  HStack,
  Heading,
  Input, InputField, InputIcon, InputSlot, Modal, ModalBackdrop, ModalBody, ModalContent, ModalFooter, ModalHeader, Pressable,
  Progress, ProgressFilledTrack,
  ScrollView,
  Spinner,
  Text,
  Toast,
  ToastDescription,
  ToastTitle,
  VStack,
  useToast,
} from '@gluestack-ui/themed';
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'expo-router';
import { AlertCircle, ArrowDown, ArrowUp, Calendar, CheckCircle, DollarSign, Pencil, Search, Trash2, XCircle } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import useAuth from '../hooks/useAuth';
import useCurrency from '../hooks/useCurrency';
import { StandardButton } from '@/app/design-system';
import { Alert, Dimensions, Image as RNImage, Modal as RNModal, Platform, StyleSheet, ActivityIndicator, LayoutAnimation, UIManager, TextInput } from 'react-native';
import { api as _api } from '@/services/apiClient';

// Backend LocalStorage returns relative URLs like `/uploads/receipts/foo.jpg`;
// S3/GCS return absolute https. RN's <Image> needs an absolute URL, so prefix
// the relative path with the API origin (axios baseURL minus the `/api/vN`
// suffix). Mirrors the helper in mobile/components/SponsoredCard.tsx.
function resolveReceiptUrl(url?: string | null): string | undefined {
    if (!url) return undefined;
    if (/^https?:\/\//i.test(url)) return url;
    const base = _api.defaults.baseURL || '';
    const origin = base.replace(/\/api\/v\d+\/?$/, '');
    const sep = url.startsWith('/') ? '' : '/';
    return `${origin}${sep}${url}`;
}
import Svg, { Rect, G, Text as SvgText, Path } from 'react-native-svg';
import Animated, { FadeIn, FadeInUp, useAnimatedStyle, withSpring, withTiming } from '@/app/utils/animated';
import { z } from 'zod';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PremiumHeader } from '@/components/PremiumHeader';
import { BasilUserSolid } from '@/components/custom/icons';
import { activeLocale } from '@/app/utils/intl';

const screenWidth = Dimensions.get('window').width;
const screenHeight = Dimensions.get('window').height;
const modalMaxHeight = Math.min(screenHeight * 0.95, 920);
const modalMinHeight = Math.min(screenHeight * 0.86, 760);
const modalMaxWidth = Platform.OS === 'web' ? Math.min(screenWidth * 0.96, 980) : screenWidth;

type Entry = {
  id: number;
  from?: string;
  to?: string;
  amount: number;
  date: string;
  description?: string;
  repaid_amount?: number;
  status?: string;
  merchant?: string;
  purchase_category?: string;
  items?: { name: string; price: number }[];
  /** Originally-scanned receipt image (purchases only). */
  receipt_image_url?: string | null;
  landlord_name?: string;
  property_address?: string;
  due_day?: number;
  is_recurring?: boolean;
};

const buildMenuItems = (t: (k: string) => string) => [
  { key: 'status', label: t('expensesScreen.catStatus'), icon: <CheckCircle size={28} color={Palette.gray700} /> },
  { key: 'rent', label: t('expensesScreen.catRent'), icon: <MaterialIcons name="house" size={28} color={Palette.gray700} /> },
  { key: 'purchases', label: t('expensesScreen.catPurchases'), icon: <FontAwesome5 name="shopping-cart" size={24} color={Palette.gray700} /> },
  { key: 'subscriptions', label: t('expensesScreen.catSubscriptions'), icon: <MaterialIcons name="subscriptions" size={28} color={Palette.gray700} /> },
  { key: 'loans', label: t('expensesScreen.catLoans'), icon: <FontAwesome5 name="money-check" size={24} color={Palette.gray700} /> },
];

const expenseFormSchema = z.object({
  category: z.string(),
  amount: z.string().nonempty('Amount is required').refine(val => !isNaN(parseFloat(val)) && parseFloat(val) > 0, { message: 'Please enter a valid positive amount.' }),
  date: z.string().nonempty('Date is required').regex(/^\d{4}-\d{2}-\d{2}$/, 'Please use YYYY-MM-DD format.'),
  from: z.string().optional(),
  to: z.string().optional(),
  description: z.string().optional(),
  direction: z.enum(['incoming', 'outgoing']).optional(),
  merchant: z.string().optional(),
  purchase_category: z.string().optional(),
  // Rent fields
  landlord_name: z.string().optional(),
  property_address: z.string().optional(),
  due_day: z.string().optional(),
  is_recurring: z.boolean().optional(),
  // Loan extended fields
  is_recurrent: z.boolean().optional(),
  duration_months: z.string().optional(),
  payment_frequency: z.string().optional(),
  interest_rate: z.string().optional(),
  lender_name: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.category === 'rent') {
    if (!data.description) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Description is required.',
        path: ['description'],
      });
    }
  } else if (data.category !== 'status') { // For purchases, subscriptions, loans
    if (!data.description) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Description is required.',
        path: ['description'],
      });
    }
  }
});

type ExpenseFormData = z.infer<typeof expenseFormSchema>;

const repaymentFormSchema = z.object({
  amount: z.string().nonempty('Amount is required').refine(val => !isNaN(parseFloat(val)) && parseFloat(val) > 0, { message: 'Please enter a valid positive amount.' }),
  date: z.string().nonempty('Date is required').regex(/^\d{4}-\d{2}-\d{2}$/, 'Please use YYYY-MM-DD format.'),
});

type RepaymentFormData = z.infer<typeof repaymentFormSchema>;

// ─── Memoized item row: owns its own local text state so the parent
//     re-render from setPurchaseItems never causes a visible flicker ───────────
type PurchaseItemRowProps = {
  itemId: string;
  initialName: string;
  initialPrice: string;
  currencySymbol: string;
  whatBuyPlaceholder: string;
  onChange: (itemId: string, field: 'name' | 'price', value: string) => void;
  onRemove: (itemId: string) => void;
};

const PurchaseItemRow = React.memo<PurchaseItemRowProps>(
  ({ itemId, initialName, initialPrice, currencySymbol, whatBuyPlaceholder, onChange, onRemove }) => {
    const [name, setName] = useState(initialName);
    const [price, setPrice] = useState(initialPrice);

    const handleNameChange = useCallback((value: string) => {
      setName(value);
      onChange(itemId, 'name', value);
    }, [itemId, onChange]);

    const handlePriceChange = useCallback((value: string) => {
      setPrice(value);
      onChange(itemId, 'price', value);
    }, [itemId, onChange]);

    const handleRemove = useCallback(() => {
      onRemove(itemId);
    }, [itemId, onRemove]);

    return (
      <Box>
        <Box bg="white" p="$3" rounded="$xl" style={styles.cardShadow}>
          <HStack space="md" alignItems="center">
            <VStack flex={1} space="md">
              <Box borderBottomWidth={1} borderColor={Palette.gray100} pb="$1">
                <TextInput
                  placeholder={whatBuyPlaceholder}
                  placeholderTextColor={Palette.gray500}
                  value={name}
                  onChangeText={handleNameChange}
                  style={{ fontSize: 15, fontWeight: '600', color: Palette.ink, paddingVertical: 6 }}
                  autoCorrect={false}
                  autoCapitalize="words"
                  returnKeyType="next"
                  underlineColorAndroid="transparent"
                  selectionColor={Palette.gray700}
                />
              </Box>
              <HStack space="sm" alignItems="center">
                <Text fontSize={Type.small} fontWeight="800" color={Palette.gray400}>{currencySymbol}</Text>
                <Box flex={1} borderBottomWidth={1} borderColor={Palette.gray100} pb="$1">
                  <TextInput
                    placeholder="0.00"
                    placeholderTextColor={Palette.gray500}
                    keyboardType="decimal-pad"
                    value={price}
                    onChangeText={handlePriceChange}
                    style={{ fontSize: 18, fontWeight: '900', color: Palette.ink, paddingVertical: 6 }}
                    autoCorrect={false}
                    returnKeyType="done"
                    underlineColorAndroid="transparent"
                    selectionColor={Palette.ink}
                  />
                </Box>
              </HStack>
            </VStack>
            <Pressable onPress={handleRemove}>
              <Box bg={Palette.errorTint} p="$2.5" rounded="$2xl">
                <Trash2 size={18} color={Palette.errorAlt} />
              </Box>
            </Pressable>
          </HStack>
        </Box>
      </Box>
    );
  },
  // Only re-render when the item's ID or the stable callbacks change.
  // Ignore initialName/initialPrice changes — local state owns those after mount.
  (prev, next) =>
    prev.itemId === next.itemId &&
    prev.currencySymbol === next.currencySymbol &&
    prev.whatBuyPlaceholder === next.whatBuyPlaceholder &&
    prev.onChange === next.onChange &&
    prev.onRemove === next.onRemove,
);
PurchaseItemRow.displayName = 'PurchaseItemRow';

// ─── Custom Chart Components ─────────────────────────────────────────────────
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutArcPath(
  cx: number, cy: number,
  outerR: number, innerR: number,
  startAngle: number, endAngle: number
): string {
  const p1 = polarToCartesian(cx, cy, outerR, startAngle);
  const p2 = polarToCartesian(cx, cy, outerR, endAngle);
  const p3 = polarToCartesian(cx, cy, innerR, endAngle);
  const p4 = polarToCartesian(cx, cy, innerR, startAngle);
  const large = (endAngle - startAngle) > 180 ? 1 : 0;
  return `M${p1.x} ${p1.y} A${outerR} ${outerR} 0 ${large} 1 ${p2.x} ${p2.y} L${p3.x} ${p3.y} A${innerR} ${innerR} 0 ${large} 0 ${p4.x} ${p4.y}Z`;
}

const SpendingBarChart = React.memo(({ labels, values }: { labels: string[]; values: number[] }) => {
  const chartWidth = screenWidth - 96;
  const chartH = 160;
  const sidePad = 8;
  const bottomPad = 26;
  const topPad = 14;
  const usableH = chartH - bottomPad - topPad;
  const max = Math.max(...values, 1);
  const slotW = (chartWidth - sidePad * 2) / values.length;
  const barW = Math.min(slotW * 0.5, 26);
  const maxVal = Math.max(...values);
  return (
    <Svg width={chartWidth} height={chartH}>
      {values.map((val, i) => {
        const barH = Math.max((val / max) * usableH, 3);
        const x = sidePad + i * slotW + (slotW - barW) / 2;
        const y = topPad + usableH - barH;
        const isHighest = val === maxVal && val > 0;
        return (
          <G key={i}>
            <Rect x={x} y={topPad} width={barW} height={usableH} fill="rgba(0,0,0,0.04)" rx={7} ry={7} />
            <Rect x={x} y={y} width={barW} height={barH} fill={isHighest ? Palette.gold : 'rgba(224, 169, 59,0.45)'} rx={7} ry={7} />
            <SvgText x={x + barW / 2} y={chartH - 6} textAnchor="middle" fontSize={Type.tiny} fontWeight="700" fill={Palette.gray400}>{labels[i]}</SvgText>
          </G>
        );
      })}
    </Svg>
  );
});
SpendingBarChart.displayName = 'SpendingBarChart';

const SpendingDonutChart = React.memo(({ data, centerLabel, totalLabel }: {
  data: { name: string; population: number; color: string }[];
  centerLabel: string;
  totalLabel: string;
}) => {
  const size = 130;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 54;
  const innerR = 34;
  const gapDeg = 2.5;
  const total = data.reduce((s, d) => s + d.population, 0);
  const segments: { d: string; color: string }[] = [];
  let currentAngle = 0;
  data.forEach(item => {
    const sliceDeg = (item.population / total) * 360;
    const startAngle = currentAngle + gapDeg / 2;
    const endAngle = currentAngle + sliceDeg - gapDeg / 2;
    segments.push({ d: donutArcPath(cx, cy, outerR, innerR, startAngle, endAngle), color: item.color });
    currentAngle += sliceDeg;
  });
  return (
    <Svg width={size} height={size}>
      {segments.map((seg, i) => <Path key={i} d={seg.d} fill={seg.color} />)}
      <SvgText x={cx} y={cy - 7} textAnchor="middle" fontSize={Type.tiny} fontWeight="700" fill={Palette.gray400}>{totalLabel}</SvgText>
      <SvgText x={cx} y={cy + 9} textAnchor="middle" fontSize={Type.small} fontWeight="800" fill={Palette.ink}>{centerLabel}</SvgText>
    </Svg>
  );
});
SpendingDonutChart.displayName = 'SpendingDonutChart';
// ─────────────────────────────────────────────────────────────────────────────

export default function Expenses() {
  const { t } = useTranslation();
  const menuItems = useMemo(() => buildMenuItems(t), [t]);
  const categoryLabel = useCallback((key: string) => {
    switch (key) {
      case 'status': return t('expensesScreen.catStatus');
      case 'rent': return t('expensesScreen.catRent');
      case 'purchases': return t('expensesScreen.catPurchases');
      case 'subscriptions': return t('expensesScreen.catSubscriptions');
      case 'loans': return t('expensesScreen.catLoans');
      default: return key;
    }
  }, [t]);
  const [selectedCategory, setSelectedCategory] = useState<string>('status');
  const [transfers, setTransfers] = useState<Entry[]>([]);
  const [purchases, setPurchases] = useState<Entry[]>([]);
  const [subscriptions, setSubscriptions] = useState<Entry[]>([]);
  const [loans, setLoans] = useState<Entry[]>([]);
  const [rents, setRents] = useState<Entry[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'amount'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [repaymentModalOpen, setRepaymentModalOpen] = useState(false);
  const [selectedLoanForRepayment, setSelectedLoanForRepayment] = useState<Entry | null>(null);
  const [loanDetailOpen, setLoanDetailOpen] = useState(false);
  const [selectedLoanForView, setSelectedLoanForView] = useState<Entry | null>(null);
  const [loanRepayments, setLoanRepayments] = useState<Repayment[]>([]);
  const [isLoadingRepayments, setIsLoadingRepayments] = useState(false);
  const { currency: currentCurrency, currencyInfo, formatCurrency } = useCurrency();

  // Enable LayoutAnimation for Android
  useEffect(() => {
    if (Platform.OS === 'android') {
      if (UIManager.setLayoutAnimationEnabledExperimental) {
        UIManager.setLayoutAnimationEnabledExperimental(true);
      }
    }
  }, []);

  // Enhanced Purchase states
  const [purchaseItems, setPurchaseItems] = useState<{ id: string; name: string; price: string }[]>([]);
  const [showItemized, setShowItemized] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [scanReviewFields, setScanReviewFields] = useState<string[]>([]);
  // URL of the just-scanned receipt image (from POST /purchases/scan).
  // Threaded into the create-purchase payload so the saved purchase points
  // at its source image, and rendered as a thumbnail in the form so the
  // user can confirm the right image was processed.
  const [scannedReceiptUrl, setScannedReceiptUrl] = useState<string | null>(null);
  // When set, opens a full-screen modal viewer for an already-saved
  // purchase's receipt image. Drives the modal at the bottom of the tree.
  const [receiptViewerUrl, setReceiptViewerUrl] = useState<string | null>(null);

  const handleScanReceipt = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (permissionResult.granted === false) {
        Alert.alert(t('expensesScreen.permissionRequiredTitle'), t('expensesScreen.permissionMediaBody'));
        return;
      }

      Alert.alert(
        t('expensesScreen.scanReceiptTitle'),
        t('expensesScreen.chooseOption'),
        [
          {
            text: t('expensesScreen.takePhoto'),
            onPress: async () => {
              const cameraPerm = await ImagePicker.requestCameraPermissionsAsync();
              if (cameraPerm.granted === false) {
                Alert.alert(t('expensesScreen.permissionRequiredTitle'), t('expensesScreen.permissionCameraBody'));
                return;
              }
              const result = await ImagePicker.launchCameraAsync({
                mediaTypes: ['images'], // Updated to use MediaTypeOptions array or specific string
                quality: 0.8,
              });
              if (!result.canceled) processReceipt(result.assets[0].uri);
            }
          },
          {
            text: t('expensesScreen.chooseGallery'),
            onPress: async () => {
              const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                quality: 0.8,
              });
              if (!result.canceled) processReceipt(result.assets[0].uri);
            }
          },
          { text: t('expensesScreen.cancel'), style: "cancel" }
        ]
      );

    } catch (e) {
      console.error(e);
      Alert.alert(t('expensesScreen.errorTitle'), t('expensesScreen.failedToPickImage'));
    }
  };

  const createPurchaseItem = (name = '', price = '') => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    price,
  });

  const processReceipt = async (uri: string) => {
    setIsScanning(true);
    setScanReviewFields([]);
    setScannedReceiptUrl(null);
    try {
      const result = await scanReceipt(uri);
      if ('error' in result) {
        Alert.alert(t('expensesScreen.scanFailedTitle'), result.error);
      } else {
        // Auto-fill form
        if (result.merchant) setValue('merchant', result.merchant);
        if (result.date) setValue('date', result.date);

        // Handle items first, then amount will be auto-calculated by useEffect
        if (result.items && result.items.length > 0) {
          const scannedItems = result.items.map(item => {
            const priceSource = item.unit_price ?? item.amount ?? item.price ?? 0;
            return createPurchaseItem(item.name ?? '', String(priceSource));
          });
          setPurchaseItems(scannedItems);
          setShowItemized(true);
          // Total will be auto-calculated by useEffect
        } else if (result.amount) {
          // If no items, just set the amount
          setValue('amount', result.amount.toString());
        }

        if (result.low_confidence_fields && result.low_confidence_fields.length > 0) {
          setScanReviewFields(result.low_confidence_fields);
        }

        // Remember the saved-image URL so it travels to the create-purchase
        // payload below. Backend may have failed to persist the image
        // (non-fatal); in that case the field is just null.
        if (result.receipt_image_url) {
          setScannedReceiptUrl(result.receipt_image_url);
        }

        Alert.alert(t('expensesScreen.successTitle'), t('expensesScreen.receiptScanned'));
      }
    } catch (e) {
      console.error("Scan error:", e);
      Alert.alert(t('expensesScreen.errorTitle'), t('expensesScreen.failedToScanReceipt'));
    } finally {
      setIsScanning(false);
    }
  };

  const handleAddItem = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPurchaseItems(prev => [...prev, createPurchaseItem()]);
  };

  const handleRemoveItem = useCallback((itemId: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setPurchaseItems(prev => prev.filter(item => item.id !== itemId));
  }, []);

  const handleItemChange = useCallback((itemId: string, field: 'name' | 'price', value: string) => {
    setPurchaseItems(prev =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, [field]: value }
          : item,
      ),
    );
  }, []);

  const itemizedTotal = useMemo(
    () => purchaseItems.reduce((acc, it) => acc + (parseFloat(it.price) || 0), 0),
    [purchaseItems],
  );

  const router = useRouter();
  const { user } = useAuth();
  const toast = useToast();

  const {
    control,
    handleSubmit,
    getValues,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ExpenseFormData>({
    resolver: zodResolver(expenseFormSchema),
    defaultValues: {
      category: selectedCategory,
      amount: '',
      date: new Date().toISOString().split('T')[0],
      from: '',
      to: '',
      description: '',
      direction: 'outgoing',
    },
    mode: 'onChange',
  });

  const {
    control: repaymentControl,
    handleSubmit: handleRepaymentSubmit,
    reset: resetRepaymentForm,
    formState: { errors: repaymentErrors, isSubmitting: isRepaymentSubmitting },
  } = useForm<RepaymentFormData>({
    resolver: zodResolver(repaymentFormSchema),
    defaultValues: { amount: '', date: new Date().toISOString().split('T')[0] },
  });

  const resetModalForm = () => {
    setEditingEntry(null);
    setPurchaseItems([]);
    setShowItemized(false);
    setScanReviewFields([]);
    setScannedReceiptUrl(null);
    reset({
      category: selectedCategory,
      amount: '',
      date: new Date().toISOString().split('T')[0],
      from: '',
      to: '',
      description: '',
      direction: 'outgoing',
      merchant: '',
      purchase_category: '',
      landlord_name: '',
      property_address: '',
      due_day: '',
      is_recurring: true,
      is_recurrent: false,
      duration_months: '',
      payment_frequency: '',
      interest_rate: '',
      lender_name: '',
    });
  };

  const fetchFinancialData = useCallback(async () => {
    const privateUserId = user?.private_user?.private_user_id ?? (user?.private_user_id ? Number(user.private_user_id) : undefined);
    if (!privateUserId) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const response = await getFinancials(privateUserId);

    if (isApiError(response)) {
      const errorMessage = response.error || t('expensesScreen.failedToFetch');
      setError(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
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
      setPurchases(data.purchases.map(p => ({
        id: p.purchase_id,
        description: p.description,
        amount: p.amount,
        date: p.created_at || new Date().toISOString(),
        merchant: (p as Purchase).merchant,
        purchase_category: (p as Purchase).category,
        items: (p as Purchase).items as { name: string; price: number }[] | undefined,
        receipt_image_url: (p as Purchase).receipt_image_url ?? null,
      })));
      setSubscriptions(data.subscriptions.map(s => ({
        id: s.subscription_id,
        description: s.description,
        amount: s.amount,
        date: s.subscription_date || new Date().toISOString(),
      })));
      setLoans(data.loans.map(l => ({
        id: l.loan_id,
        description: l.description,
        amount: l.amount,
        date: l.start_date || new Date().toISOString(),
        repaid_amount: l.repaid_amount || 0,
      })));
      setRents((data.rents || []).map(r => ({
        id: r.rent_id,
        description: r.description,
        amount: r.amount,
        date: r.created_at || new Date().toISOString(),
        status: r.status,
        landlord_name: r.landlord_name,
        property_address: r.property_address,
        due_day: r.due_day,
        is_recurring: r.is_recurring,
      })));
    }
    setIsLoading(false);
  }, [user, t]);

  const fetchRepayments = async (loanId: number) => {
    setIsLoadingRepayments(true);
    try {
      const result = await getRepaymentsByLoan(loanId);
      if (!isApiError(result) && result.status === 'success') {
        setLoanRepayments(result.data || []);
      }
    } catch (err) {
      console.error('Error fetching repayments:', err);
    } finally {
      setIsLoadingRepayments(false);
    }
  };

  const handleOpenLoanDetail = (loan: Entry) => {
    setSelectedLoanForView(loan);
    setLoanDetailOpen(true);
    fetchRepayments(loan.id);
  };

  useEffect(() => {
    if (user) fetchFinancialData();
  }, [user, fetchFinancialData]);

  useEffect(() => {
    setValue('category', selectedCategory, { shouldValidate: true });
    setSearchQuery(''); // Clear search on category change
  }, [selectedCategory, setValue]);

  const handleFormSubmit = async (data: ExpenseFormData) => {
    const privateUserId = user?.private_user?.private_user_id ?? (user?.private_user_id ? Number(user.private_user_id) : undefined);
    if (!privateUserId) {
      return;
    }

    const amount = parseFloat(data.amount);
    let apiCall: Promise<any>;
    let payload: any;

    const isEditing = !!editingEntry;
    const entryId = editingEntry?.id;

    switch (data.category) {
      case 'rent': {
        const rentStatus = 'active';
        payload = {
          amount,
          description: data.description || 'N/A',
          landlord_name: data.landlord_name,
          property_address: data.property_address,
          due_day: data.due_day ? parseInt(data.due_day) : undefined,
          is_recurring: data.is_recurring ?? true,
          status: rentStatus,
        };
        if (isEditing) {
          apiCall = updateRent(entryId!, payload);
        } else {
          apiCall = createRent({ ...payload, private_user_id: privateUserId, currency: currencyInfo.code });
        }
        break;
      }
      case 'purchases':
        const resolvedPurchaseAmount = showItemized && itemizedTotal > 0 ? itemizedTotal : amount;
        payload = {
          amount: resolvedPurchaseAmount,
          description: data.description || 'N/A',
          merchant: data.merchant,
          category: data.purchase_category,
          items: showItemized ? purchaseItems.map(it => ({ name: it.name, price: parseFloat(it.price) || 0 })) : undefined,
          // Carry the just-scanned receipt URL so the saved purchase points
          // at its source image. Only set on create (not when editing an
          // existing entry) — editing keeps whatever URL was already there.
          ...(scannedReceiptUrl && !isEditing ? { receipt_image_url: scannedReceiptUrl } : {}),
        };
        if (isEditing) {
          apiCall = updatePurchase(entryId!, payload);
        } else {
          apiCall = createPurchase({ ...payload, private_user_id: privateUserId, currency: currencyInfo.code });
        }
        break;
      case 'subscriptions':
        payload = { amount, description: data.description || 'N/A', subscription_date: data.date };
        if (isEditing) {
          apiCall = updateSubscription(entryId!, payload);
        } else {
          apiCall = createSubscription({ ...payload, private_user_id: privateUserId, currency: currencyInfo.code });
        }
        break;
      case 'loans':
        payload = {
          amount,
          description: data.description || 'N/A',
          start_date: data.date,
          is_recurrent: data.is_recurrent ?? false,
          duration_months: data.duration_months ? parseInt(data.duration_months) : undefined,
          payment_frequency: data.payment_frequency || undefined,
          interest_rate: data.interest_rate ? parseFloat(data.interest_rate) : undefined,
          lender_name: data.lender_name || undefined,
        };
        if (isEditing) {
          apiCall = updateLoan(entryId!, payload);
        } else {
          apiCall = createLoan({ ...payload, private_user_id: Number(user!.private_user_id), currency: currencyInfo.code, status: 'active' });
        }
        break;
      default:
        return;
    }

    try {
      const response = await apiCall;

      if (isApiError(response) || (response as any).status !== 'success') {
        const errorMessage = (response as any).error || (response as any).message || (isEditing ? t('expensesScreen.failedUpdate') : t('expensesScreen.failedAdd'));
        throw new Error(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
      }

      toast.show({
        placement: 'top',
        render: ({ id }) => (
          <Toast nativeID={id} action="success" variant="solid">
            <VStack space="xs">
              <ToastTitle>{t('expensesScreen.successTitle')}</ToastTitle>
              <ToastDescription>{isEditing ? t('expensesScreen.entryUpdatedSuccess') : t('expensesScreen.entryAddedSuccess')}</ToastDescription>
            </VStack>
          </Toast>
        ),
      });

      await fetchFinancialData(); // Refresh data
      resetModalForm();
      setModalOpen(false);

    } catch (e: any) {
      toast.show({
        placement: 'top',
        render: ({ id }) => (
          <Toast nativeID={id} action="error" variant="solid">
            <VStack space="xs">
              <ToastTitle>{t('expensesScreen.errorTitle')}</ToastTitle>
              <ToastDescription>{e.message}</ToastDescription>
            </VStack>
          </Toast>
        ),
      });
    }
  };

  const handleOpenRepaymentModal = (loan: Entry) => {
    setSelectedLoanForRepayment(loan);
    resetRepaymentForm({ amount: '', date: new Date().toISOString().split('T')[0] });
    setRepaymentModalOpen(true);
  };

  const onRepaymentSubmit = async (data: RepaymentFormData) => {
    if (!selectedLoanForRepayment) return;

    const payload = {
      loan_id: selectedLoanForRepayment.id,
      amount: parseFloat(data.amount),
      payment_date: data.date,
    };

    try {
      const response = await createRepayment(payload);
      if (isApiError(response) || (response as any).status !== 'success') {
        const errorMessage = (response as any).error || (response as any).message || t('expensesScreen.failedLogPayment');
        throw new Error(typeof errorMessage === 'string' ? errorMessage : JSON.stringify(errorMessage));
      }

      toast.show({
        placement: 'top',
        render: ({ id }) => (
          <Toast nativeID={id} action="success" variant="solid">
            <VStack space="xs">
              <ToastTitle>{t('expensesScreen.successTitle')}</ToastTitle>
              <ToastDescription>{t('expensesScreen.paymentLoggedSuccess')}</ToastDescription>
            </VStack>
          </Toast>
        ),
      });
      setRepaymentModalOpen(false);
      await fetchFinancialData();
    } catch (e: any) {
      toast.show({
        placement: 'top',
        render: ({ id }) => (
          <Toast nativeID={id} action="error" variant="solid">
            <VStack space="xs"><ToastTitle>{t('expensesScreen.errorTitle')}</ToastTitle><ToastDescription>{e.message}</ToastDescription></VStack>
          </Toast>
        ),
      });
    }
  };

  const handleEditClick = (entry: Entry, category: string) => {
    setEditingEntry(entry);
    setPurchaseItems(entry.items ? entry.items.map(it => createPurchaseItem(it.name, it.price.toString())) : []);
    setShowItemized(!!entry.items && entry.items.length > 0);
    reset({
      category: category,
      amount: entry.amount.toString(),
      date: new Date(entry.date).toISOString().split('T')[0],
      from: entry.from || '',
      to: entry.to || '',
      description: entry.description || '',
      direction: 'outgoing',
      merchant: entry.merchant || '',
      purchase_category: entry.purchase_category || '',
      landlord_name: entry.landlord_name || '',
      property_address: entry.property_address || '',
      due_day: entry.due_day ? String(entry.due_day) : '',
      is_recurring: entry.is_recurring ?? true,
    });
    setModalOpen(true);
  };

  const handleDeleteEntry = (id: number, category: string) => {
    const categoryName = categoryLabel(category).toLowerCase();
    Alert.alert(
      t('expensesScreen.confirmDeletionTitle'),
      t('expensesScreen.confirmDeletionBody', { category: categoryName }),
      [
        { text: t('expensesScreen.cancel'), style: 'cancel' },
        {
          text: t('expensesScreen.deleteAction'),
          style: 'destructive',
          onPress: async () => {
            let apiCall: Promise<any>;

            switch (category) {
              case 'rent':
                apiCall = deleteRent(id);
                break;
              case 'purchases':
                apiCall = deletePurchase(id);
                break;
              case 'subscriptions':
                apiCall = deleteSubscription(id);
                break;
              case 'loans':
                apiCall = deleteLoan(id);
                break;
              default:
                toast.show({
                  placement: 'top',
                  render: ({ id: toastId }) => (
                    <Toast nativeID={toastId} action="error" variant="solid">
                      <VStack space="xs"><ToastTitle>{t('expensesScreen.errorTitle')}</ToastTitle><ToastDescription>{t('expensesScreen.invalidCategoryDeletion')}</ToastDescription></VStack>
                    </Toast>
                  ),
                });
                return;
            }

            try {
              await apiCall;
              toast.show({
                placement: 'top',
                render: ({ id: toastId }) => (
                  <Toast nativeID={toastId} action="success" variant="solid">
                    <VStack space="xs"><ToastTitle>{t('expensesScreen.successTitle')}</ToastTitle><ToastDescription>{t('expensesScreen.entryDeletedSuccess')}</ToastDescription></VStack>
                  </Toast>
                ),
              });
              await fetchFinancialData(); // Refresh data
            } catch (e: any) {
              const errorMessage = e.response?.data?.detail || e.message || t('expensesScreen.failedDelete');
              toast.show({
                placement: 'top',
                render: ({ id: toastId }) => (<Toast nativeID={toastId} action="error" variant="solid"><VStack space="xs"><ToastTitle>{t('expensesScreen.errorTitle')}</ToastTitle><ToastDescription>{errorMessage}</ToastDescription></VStack></Toast>),
              });
            }
          },
        },
      ]
    );
  };
  const totalRepayments = loans.reduce((acc, l) => acc + (l.repaid_amount || 0), 0);
  const totalDebt = loans.reduce((acc, l) => acc + l.amount, 0);
  const totalRent = rents.reduce((acc, r) => acc + r.amount, 0);
  const outgoingTransfers = transfers.filter(t => t.status !== 'incoming').reduce((acc, t) => acc + t.amount, 0);
  const incomingTransfers = transfers.filter(t => t.status === 'incoming').reduce((acc, t) => acc + t.amount, 0);

  const totalExpenses =
    purchases.reduce((acc, e) => acc + e.amount, 0) +
    subscriptions.reduce((acc, e) => acc + e.amount, 0) +
    totalRepayments +
    totalRent +
    outgoingTransfers;

  const totalIncome = incomingTransfers;


  const expenseDataForCharts = useMemo(() => {
    const allExpenses = [...purchases, ...subscriptions, ...loans, ...transfers];
    const now = new Date();

    const monthlyExpenses = Array(6).fill(0).map((_, i) => {
      const monthDate = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1);
      const totalInMonth = allExpenses.filter(e => {
        const d = new Date(e.date);
        return d.getMonth() === monthDate.getMonth() && d.getFullYear() === monthDate.getFullYear();
      }).reduce((acc, e) => acc + e.amount, 0);

      return {
        month: monthDate.toLocaleString(activeLocale(), { month: 'short' }),
        total: totalInMonth,
      };
    });

    const barChartData = {
      labels: monthlyExpenses.map(m => m.month),
      datasets: [
        {
          data: monthlyExpenses.map(m => m.total > 0 ? m.total : 0.01),
        },
      ],
    };

    const pieChartData = [
      {
        name: t('expensesScreen.piePurchases'),
        population: purchases.reduce((acc, e) => acc + e.amount, 0),
        color: Palette.gold,
        legendFontColor: Palette.gray700,
        legendFontSize: 14,
      },
      {
        name: t('expensesScreen.pieSubscriptions'),
        population: subscriptions.reduce((acc, e) => acc + e.amount, 0),
        color: Palette.gray700,
        legendFontColor: Palette.gray700,
        legendFontSize: 14,
      },
      {
        name: t('expensesScreen.pieTransfers'),
        population: outgoingTransfers,
        color: Palette.blue,
        legendFontColor: Palette.gray700,
        legendFontSize: 14,
      },
      {
        name: t('expensesScreen.pieRepayments'),
        population: totalRepayments,
        color: Palette.teal,
        legendFontColor: Palette.gray700,
        legendFontSize: 14,
      },
      {
        name: t('expensesScreen.pieReceived'),
        population: incomingTransfers,
        color: Palette.green,
        legendFontColor: Palette.gray700,
        legendFontSize: 14,
      },
    ].filter(item => item.population > 0);

    return { barChartData, pieChartData };
  }, [purchases, subscriptions, loans, transfers, outgoingTransfers, totalRepayments, incomingTransfers, t]);

  const topSpendCategory = useMemo(() => {
    const cats = [
      { name: t('expensesScreen.piePurchases'), val: purchases.reduce((acc, e) => acc + e.amount, 0) },
      { name: t('expensesScreen.pieSubscriptions'), val: subscriptions.reduce((acc, e) => acc + e.amount, 0) },
      { name: t('expensesScreen.pieTransfers'), val: outgoingTransfers },
      { name: t('expensesScreen.pieRepayments'), val: totalRepayments },
    ];
    return cats.sort((a, b) => b.val - a.val)[0];
  }, [purchases, subscriptions, outgoingTransfers, totalRepayments, t]);

  let statusText = t('expensesScreen.healthTracking');
  let statusColor = Palette.gray700;
  let StatusIcon = CheckCircle;

  if (totalIncome > totalExpenses) {
    statusText = t('expensesScreen.healthPositive');
    statusColor = Palette.green;
    StatusIcon = CheckCircle;
  } else if (totalIncome === totalExpenses) {
    statusText = t('expensesScreen.healthNeutral');
    statusColor = Palette.gold;
    StatusIcon = AlertCircle;
  } else {
    statusText = t('expensesScreen.healthExpense');
    statusColor = Palette.errorAlt;
    StatusIcon = XCircle;
  }

  const renderListItems = () => {
    let list: Entry[] = [];
    switch (selectedCategory) {
      case 'rent':
        list = rents;
        break;
      case 'purchases':
        list = purchases;
        break;
      case 'subscriptions':
        list = subscriptions;
        break;
      case 'loans':
        list = loans;
        break;
      default:
        return null;
    }

    const filteredList = searchQuery
      ? list.filter(entry => {
        const query = searchQuery.toLowerCase();
        const descriptionMatch = entry.description?.toLowerCase().includes(query);
        const fromMatch = entry.from?.toLowerCase().includes(query);
        const toMatch = entry.to?.toLowerCase().includes(query);
        const amountMatch = entry.amount.toString().includes(query);
        return descriptionMatch || fromMatch || toMatch || amountMatch;
      })
      : list;

    const sortedList = [...filteredList].sort((a, b) => {
      if (sortBy === 'date') {
        const dateA = new Date(a.date).getTime();
        const dateB = new Date(b.date).getTime();
        return sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
      } else { // sortBy === 'amount'
        return sortOrder === 'asc' ? a.amount - b.amount : b.amount - a.amount;
      }
    });

    if (sortedList.length === 0) {
      return (
        <Animated.View entering={FadeIn.delay(200)}>
          <Box
            bg="white"
            p="$10"
            rounded="$3xl"
            style={styles.cardShadow}
            alignItems="center"
          >
            <Box bg={Palette.gray50} p="$5" rounded="$full" mb="$4">
              <MaterialIcons
                name={searchQuery ? "search-off" : "folder-open"}
                size={40}
                color={Palette.gray400}
              />
            </Box>
            <Text color={Palette.ink} fontSize={Type.h3} fontWeight="800">
              {searchQuery ? t('expensesScreen.noResults') : t('expensesScreen.noEntriesYet', { category: categoryLabel(selectedCategory).toLowerCase() })}
            </Text>
            <Text color={Palette.gray400} textAlign="center" mt="$2" fontSize={Type.body} fontWeight="500">
              {searchQuery ? t('expensesScreen.noResultsHint') : t('expensesScreen.noEntriesHint')}
            </Text>
          </Box>
        </Animated.View>
      );
    }

    const groupedByDate = sortedList.reduce((groups: { [key: string]: Entry[] }, entry) => {
      const dateKey = new Date(entry.date).toLocaleDateString(activeLocale(), { month: 'long', day: 'numeric', year: 'numeric' });
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(entry);
      return groups;
    }, {});

    return (
      <VStack space="xl">
        {Object.entries(groupedByDate).map(([dateLabel, entries]) => (
          <VStack key={dateLabel} space="md">
            <Text fontSize={Type.small} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$2">
              {dateLabel}
            </Text>
            {entries.map((entry) => {
              const {
                id,
                from,
                to,
                amount,
                date: entryDate,
                description,
                repaid_amount,
                status,
                merchant,
                items,
                receipt_image_url,
                landlord_name,
                property_address,
                due_day,
                is_recurring,
              } = entry;
              const remainingBalance = amount - (repaid_amount || 0);
              const progressValue = repaid_amount && amount > 0 ? (repaid_amount / amount) * 100 : 0;
              const rentPrimaryLabel = landlord_name || description || t('expensesScreen.rentDefaultLabel');
              const rentSecondaryLabel = property_address
                ? property_address
                : due_day
                  ? t('expensesScreen.dueDayLabel', { day: due_day, recurring: is_recurring ? ` (${t('expensesScreen.recurring')})` : '' })
                  : (is_recurring ? t('expensesScreen.recurring') : t('expensesScreen.oneTime'));

              return (
                <Animated.View key={id} entering={FadeInUp.duration(300)}>
                  <Pressable
                    onPress={() => selectedCategory === 'loans' ? handleOpenLoanDetail({ id, from, to, amount, date: entryDate, description, repaid_amount, status }) : null}
                  >
                    <Box
                      bg="white"
                      p="$4"
                      rounded="$2xl"
                      style={styles.cardShadow}
                    >
                      <HStack justifyContent="space-between" alignItems="center">
                        <HStack flex={1} space="md" alignItems="center">
                          <Box
                            bg={
                              selectedCategory === 'rent' ? Palette.violetTint :
                                selectedCategory === 'purchases' ? Palette.goldTint :
                                  selectedCategory === 'subscriptions' ? Palette.gray100 : Palette.warningTint
                            }
                            w="$12"
                            h="$12"
                            rounded="$xl"
                            justifyContent="center"
                            alignItems="center"
                          >
                            <MaterialIcons
                              name={
                                selectedCategory === 'rent' ? "arrow-upward" :
                                  selectedCategory === 'purchases' ? "shopping-bag" :
                                    selectedCategory === 'subscriptions' ? "calendar-today" : "account-balance-wallet"
                              }
                              size={24}
                              color={
                                selectedCategory === 'rent' ? Palette.violet :
                                  selectedCategory === 'purchases' ? Palette.gold :
                                    selectedCategory === 'subscriptions' ? Palette.gray700 : Palette.warning
                              }
                            />
                          </Box>
                          <VStack space="xs" flex={1}>
                    <Text fontSize={Type.body} fontWeight="800" color={Palette.ink} numberOfLines={1}>
                              {selectedCategory === 'rent' ? rentPrimaryLabel : (selectedCategory === 'purchases' && merchant ? merchant : description)}
                            </Text>
                            {selectedCategory === 'rent' && (
                              <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="600" numberOfLines={1}>
                                {rentSecondaryLabel}
                              </Text>
                            )}

                            {/* Loan Progress Bar */}
                            {selectedCategory === 'loans' && (
                              <VStack space="xs" mt="$1">
                                <Box w="100%" h={4} bg={Palette.warningTint} rounded="$full" overflow="hidden">
                                  <Box w={`${progressValue}%`} h="100%" bg={Palette.warning} rounded="$full" />
                                </Box>
                                <HStack justifyContent="space-between">
                                  <Text fontSize={Type.tiny} color={Palette.gold} fontWeight="700">{t('expensesScreen.percentRepaid', { percent: progressValue.toFixed(0) })}</Text>
                                  <Text fontSize={Type.tiny} color={Palette.gray400} fontWeight="600">{t('expensesScreen.remainingPrefix', { amount: formatCurrency(remainingBalance, { convert: false }) })}</Text>
                                </HStack>
                              </VStack>
                            )}

                            <HStack space="xs" alignItems="center">
                              {!selectedCategory.startsWith('loans') && ( // Hide time for loans if crowded
                                <Text fontSize={Type.caption} color={Palette.gray400} fontWeight="700">
                                  {new Date(entryDate).toLocaleTimeString(activeLocale(), { hour: 'numeric', minute: '2-digit' })}
                                </Text>
                              )}
                              {selectedCategory === 'purchases' && items && items.length > 0 && (
                                <HStack space="xs" alignItems="center" bg={Palette.gray100} px="$1.5" py="$0.5" rounded="$full">
                                  <MaterialIcons name="receipt" size={10} color={Palette.gray500} />
                                  <Text fontSize={Type.tiny} fontWeight="700" color={Palette.gray500}>{t('expensesScreen.itemsCount', { count: items.length })}</Text>
                                </HStack>
                              )}
                              {selectedCategory === 'purchases' && receipt_image_url && (
                                <Pressable
                                  onPress={(e) => {
                                    // Don't bubble to the row's loan-detail handler.
                                    e.stopPropagation?.();
                                    setReceiptViewerUrl(receipt_image_url);
                                  }}
                                  hitSlop={6}
                                >
                                  <HStack space="xs" alignItems="center" bg={Palette.blueTint} px="$1.5" py="$0.5" rounded="$full">
                                    <MaterialIcons name="image" size={10} color={Palette.blue} />
                                    <Text fontSize={Type.tiny} fontWeight="700" color={Palette.blue}>{t('expensesScreen.viewReceipt', { defaultValue: 'View receipt' })}</Text>
                                  </HStack>
                                </Pressable>
                              )}
                            </HStack>
                          </VStack>
                        </HStack>

                        <VStack alignItems="flex-end" space="xs" style={{ maxWidth: '45%' }}>
                          <Text fontWeight="900" fontSize={Type.title} color={Palette.ink} numberOfLines={1} adjustsFontSizeToFit>
                            -{formatCurrency(amount, { convert: false })}
                          </Text>
                          <HStack space="xs">
                            {selectedCategory === 'loans' && remainingBalance > 0 && (
                              <Pressable hitSlop={8} onPress={() => handleOpenRepaymentModal({ id, from, to, amount, date: entryDate, description, repaid_amount, status })}>
                                <Box style={{ backgroundColor: Palette.greenTint, padding: 5, borderRadius: 6 }}>
                                  <MaterialIcons name="payments" size={13} color={Palette.success} />
                                </Box>
                              </Pressable>
                            )}
                            <Pressable
                              hitSlop={8}
                              onPress={() =>
                                handleEditClick(
                                  { id, from, to, amount, date: entryDate, description, repaid_amount, status, merchant, items, landlord_name, property_address, due_day, is_recurring },
                                  selectedCategory,
                                )
                              }
                            >
                              <Box style={{ backgroundColor: Palette.gray100, padding: 5, borderRadius: 6 }}>
                                <MaterialIcons name="edit" size={13} color={Palette.gray700} />
                              </Box>
                            </Pressable>
                            <Pressable hitSlop={8} onPress={() => handleDeleteEntry(id, selectedCategory)}>
                              <Box style={{ backgroundColor: Palette.errorTint, padding: 5, borderRadius: 6 }}>
                                <MaterialIcons name="delete-outline" size={13} color={Palette.error} />
                              </Box>
                            </Pressable>
                          </HStack>
                        </VStack>
                      </HStack>

                      {selectedCategory === 'loans' && (
                        <VStack space="xs" mt="$4">
                          <HStack justifyContent="space-between" mb={2}>
                            <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="700">{t('expensesScreen.paymentProgress')}</Text>
                            <Text fontSize={Type.tiny} color={Palette.ink} fontWeight="800">{progressValue.toFixed(0)}%</Text>
                          </HStack>
                          <Progress value={progressValue} size="xs" bg={Palette.gray100} rounded="$full">
                            <ProgressFilledTrack bg={Palette.gold} />
                          </Progress>
                        </VStack>
                      )}
                    </Box>
                  </Pressable>
                </Animated.View>
              );
            })}
          </VStack>
        ))}
      </VStack>
    );
  };

  if (isLoading) {
    // Keep the header (back + title) mounted while data loads.
    return (
      <Box flex={1} bg={Palette.white}>
        <SafeAreaView style={{ flex: 1 }}>
          <PremiumHeader
            title={t('expensesScreen.pageTitle')}
            onBack={() => router.push('/private_dashboard/settings')}
          />
          <Box flex={1} justifyContent="center" alignItems="center" bg={Palette.gray50}>
            <Spinner size="large" color={Palette.gold} />
            <Text mt="$4" fontSize={Type.title} color={Palette.gray700}>{t('expensesScreen.loadingFinancials')}</Text>
          </Box>
        </SafeAreaView>
      </Box>
    );
  }

  if (error) {
    return (
      <Box flex={1} justifyContent="center" alignItems="center" p="$4" bg={Palette.gray50}>
        <MaterialIcons name="error-outline" size={48} color={Palette.errorAlt} />
        <Heading color={Palette.error} mt="$2">{t('expensesScreen.errorLoadingData')}</Heading>
        <Text color={Palette.errorAlt} textAlign="center" mt="$1">{error}</Text>
      </Box>
    );
  }

  return (
    <Box flex={1} bg={Palette.white}>
      <SafeAreaView style={{ flex: 1 }}>
        <PremiumHeader
          title={t('expensesScreen.pageTitle')}
          onBack={() => router.push('/private_dashboard/settings')}
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 160 }}
          keyboardShouldPersistTaps="always"
        >
          {/* Fintech Header */}
          <Box px="$6" pt="$12" pb="$4">
            <Animated.View entering={FadeInUp.delay(200).duration(800)}>
              <HStack justifyContent="space-between" alignItems="center">
                <VStack space="xs">
                  <Text fontSize={Type.body} color={Palette.gray500} fontWeight="600">{t('expensesScreen.walletBalance')}</Text>
                  <Heading size="3xl" color={Palette.ink} fontWeight="900">
                    {formatCurrency(totalIncome - totalExpenses, { showSymbol: true, convert: false })}
                  </Heading>
                </VStack>
                <Pressable onPress={() => fetchFinancialData()}>
                  <Box bg="white" p="$2.5" rounded="$xl" style={styles.cardShadow}>
                    <Ionicons name="refresh" size={20} color={Palette.gray700} />
                  </Box>
                </Pressable>
              </HStack>
            </Animated.View>
          </Box>

          {/* Categories Chip Selector (Scrollable) */}
          <Box mb="$6">
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ paddingHorizontal: 24, gap: 10 }}
            >
              {menuItems.map(({ key, label }) => (
                <Pressable key={key} onPress={() => setSelectedCategory(key)}>
                  <Box
                    bg={selectedCategory === key ? (
                      key === 'rent' ? Palette.violet :
                        key === 'purchases' ? Palette.gold :
                          key === 'subscriptions' ? Palette.gray700 :
                            key === 'loans' ? Palette.warning : Palette.gray700
                    ) : Palette.gray100}
                    px="$5"
                    py="$2.5"
                    rounded="$full"
                    style={selectedCategory === key ? styles.cardShadow : {}}
                  >
                    <Text
                      fontSize={Type.label}
                      fontWeight="800"
                      color={selectedCategory === key ? Palette.white : Palette.gray500}
                    >
                      {label}
                    </Text>
                  </Box>
                </Pressable>
              ))}
            </ScrollView>
          </Box>

          {/* Main Layer */}
          <Box px="$6">
            <Animated.View entering={FadeInUp.duration(600)}>
              <VStack space="2xl">
                {/* Status Panel (Financial Overview) */}
                {selectedCategory === 'status' && (
                  <VStack space="xl">
                    {/* Glassmorphic Hero Card */}
                    <Animated.View entering={FadeInUp.delay(300).duration(800)}>
                      {(() => {
                        // Dynamic Gradient Logic
                        const netFlow = totalIncome - totalExpenses;
                        const isPositive = netFlow > 0;
                        const isNeutral = netFlow === 0;

                        const gradientColors = isPositive ? [Palette.teal, Palette.green] : (isNeutral ? [Palette.gold, Palette.gold] : [Palette.errorAlt, Palette.error]);
                        const statusLabel = isPositive ? t('expensesScreen.netSurplus') : (isNeutral ? t('expensesScreen.breakEven') : t('expensesScreen.netDeficit'));
                        const arrowIcon = isPositive ? 'trending-up' : (isNeutral ? 'remove' : 'trending-down');

                        return (
                          <LinearGradient
                            colors={gradientColors as any}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                            style={[styles.heroCard, styles.cardShadow]}
                          >
                            <HStack justifyContent="space-between" alignItems="flex-start">
                              <VStack space="xs">
                                <Text color="rgba(255,255,255,0.8)" fontSize={Type.small} fontWeight="700" textTransform="uppercase">{statusLabel}</Text>
                                <Heading color="white" size="xl" fontWeight="900">
                                  {formatCurrency(Math.abs(netFlow), { showSymbol: true, convert: false })}
                                </Heading>
                              </VStack>
                              <Box bg="rgba(255,255,255,0.2)" p="$2.5" rounded="$2xl">
                                <MaterialIcons name={arrowIcon} size={24} color="white" />
                              </Box>
                            </HStack>

                            <HStack space="lg" mt="$8" justifyContent="space-between">
                              <VStack space="xs" flex={1}>
                                <HStack space="xs" alignItems="center">
                                  <Box bg="rgba(255,255,255,0.2)" p="$1" rounded="$full">
                                    <MaterialIcons name="arrow-downward" size={12} color="white" />
                                  </Box>
                                  <Text color="white" fontSize={Type.caption} fontWeight="700">{t('expensesScreen.totalIncome')}</Text>
                                </HStack>
                                <Text color="white" fontSize={Type.title} fontWeight="800">{formatCurrency(totalIncome, { showSymbol: true, convert: false })}</Text>
                              </VStack>

                              <Box w={1} bg="rgba(255,255,255,0.2)" h="$10" alignSelf="center" />

                              <VStack space="xs" flex={1} alignItems="flex-end">
                                <HStack space="xs" alignItems="center">
                                  <Text color="white" fontSize={Type.caption} fontWeight="700">{t('expensesScreen.totalExpenses')}</Text>
                                  <Box bg="rgba(255,255,255,0.2)" p="$1" rounded="$full">
                                    <MaterialIcons name="arrow-upward" size={12} color="white" />
                                  </Box>
                                </HStack>
                                <Text color="white" fontSize={Type.title} fontWeight="800">{formatCurrency(totalExpenses, { showSymbol: true, convert: false })}</Text>
                              </VStack>
                            </HStack>
                          </LinearGradient>
                        );
                      })()}
                    </Animated.View>

                    {/* Insight Grid */}
                    <HStack space="md" justifyContent="space-between">
                      <VStack flex={1} space="md">
                        <Box bg="white" p="$5" rounded="$3xl" style={styles.cardShadow}>
                          <Box bg={Palette.greenTint} w="$10" h="$10" rounded="$xl" justifyContent="center" alignItems="center" mb="$3">
                            <MaterialIcons name="trending-up" size={20} color={Palette.green} />
                          </Box>
                          <Text fontSize={Type.small} color={Palette.gray500} fontWeight="700">{t('expensesScreen.health')}</Text>
                          <Text fontSize={Type.body} color={Palette.ink} fontWeight="800" mt="$1">{statusText}</Text>
                        </Box>
                        <Box bg="white" p="$5" rounded="$3xl" style={styles.cardShadow}>
                        <Box bg={Palette.gray100} w="$10" h="$10" rounded="$xl" justifyContent="center" alignItems="center" mb="$3">
                            <MaterialIcons name="receipt-long" size={20} color={Palette.gray700} />
                          </Box>
                          <Text fontSize={Type.small} color={Palette.gray500} fontWeight="700">{t('expensesScreen.activeSubscriptions')}</Text>
                          <Text fontSize={Type.body} color={Palette.ink} fontWeight="800" mt="$1">{t('expensesScreen.itemsLabel', { count: subscriptions.length })}</Text>
                        </Box>
                      </VStack>

                      <VStack flex={1} space="md">
                        <Box bg="white" p="$5" rounded="$3xl" style={styles.cardShadow}>
                          <Box bg={Palette.warningTint} w="$10" h="$10" rounded="$xl" justifyContent="center" alignItems="center" mb="$3">
                            <MaterialIcons name="account-balance" size={20} color={Palette.warning} />
                          </Box>
                          <Text fontSize={Type.small} color={Palette.gray500} fontWeight="700">{t('expensesScreen.totalDebt')}</Text>
                          <Text fontSize={Type.body} color={Palette.ink} fontWeight="800" mt="$1">{formatCurrency(totalDebt, { showSymbol: true, convert: false })}</Text>
                        </Box>
                        <Box bg="white" p="$5" rounded="$3xl" style={styles.cardShadow}>
                          <Box bg={Palette.violetTint} w="$10" h="$10" rounded="$xl" justifyContent="center" alignItems="center" mb="$3">
                            <MaterialIcons name="pie-chart" size={20} color={Palette.violet} />
                          </Box>
                          <Text fontSize={Type.small} color={Palette.gray500} fontWeight="700">{t('expensesScreen.topCategory')}</Text>
                          <Text fontSize={Type.body} color={Palette.ink} fontWeight="800" mt="$1" isTruncated>
                            {topSpendCategory.val > 0 ? topSpendCategory.name : t('expensesScreen.noSpend')}
                          </Text>
                        </Box>
                      </VStack>
                    </HStack>

                    {/* Charts Card */}
                    {totalExpenses > 0 && (
                      <Box bg="white" rounded="$3xl" p="$5" style={styles.cardShadow}>
                        <VStack space="lg">

                          {/* Bar Chart — Spending Trend */}
                          <VStack space="md">
                            <HStack justifyContent="space-between" alignItems="center">
                              <VStack>
                                <Text fontSize={Type.tiny} color={Palette.gray400} fontWeight="700" textTransform="uppercase" letterSpacing={0.8}>{t('expensesScreen.sixMonthOverview')}</Text>
                                <Text fontSize={Type.body} fontWeight="900" color={Palette.ink}>{t('expensesScreen.spendingTrend')}</Text>
                              </VStack>
                              <Box bg={Palette.goldTint} p="$2" rounded="$xl">
                                <MaterialIcons name="bar-chart" size={16} color={Palette.gold} />
                              </Box>
                            </HStack>
                            <SpendingBarChart
                              labels={expenseDataForCharts.barChartData.labels}
                              values={expenseDataForCharts.barChartData.datasets[0].data}
                            />
                          </VStack>

                          {/* Donut Chart — Category Breakdown */}
                          {expenseDataForCharts.pieChartData.length > 0 && (() => {
                            const pieTotal = expenseDataForCharts.pieChartData.reduce((s, d) => s + d.population, 0);
                            return (
                              <VStack space="md">
                                <Box h={1} bg={Palette.gray100} />
                                <HStack justifyContent="space-between" alignItems="center">
                                  <VStack>
                                    <Text fontSize={Type.tiny} color={Palette.gray400} fontWeight="700" textTransform="uppercase" letterSpacing={0.8}>{t('expensesScreen.breakdown')}</Text>
                                    <Text fontSize={Type.body} fontWeight="900" color={Palette.ink}>{t('expensesScreen.byCategory')}</Text>
                                  </VStack>
                                  <Box bg={Palette.gray100} p="$2" rounded="$xl">
                                    <MaterialIcons name="donut-large" size={16} color={Palette.gray700} />
                                  </Box>
                                </HStack>
                                <HStack alignItems="center" space="sm">
                                  <SpendingDonutChart
                                    data={expenseDataForCharts.pieChartData}
                                    centerLabel={formatCurrency(pieTotal, { showSymbol: false, convert: false })}
                                    totalLabel={t('expensesScreen.donutTotal')}
                                  />
                                  <VStack flex={1} space="sm">
                                    {expenseDataForCharts.pieChartData.map((item, index) => {
                                      const pct = pieTotal > 0 ? Math.round((item.population / pieTotal) * 100) : 0;
                                      return (
                                        <HStack key={index} alignItems="center" space="xs">
                                          <Box style={{ width: 3, height: 24, borderRadius: 2, backgroundColor: item.color }} />
                                          <VStack flex={1}>
                                            <Text fontSize={Type.caption} fontWeight="800" color={Palette.gray700}>{item.name}</Text>
                                            <Text fontSize={Type.tiny} fontWeight="600" color={Palette.gray400}>{pct}%</Text>
                                          </VStack>
                                          <Text fontSize={Type.tiny} fontWeight="700" color={Palette.gray500}>{formatCurrency(item.population, { showSymbol: false, convert: false })}</Text>
                                        </HStack>
                                      );
                                    })}
                                  </VStack>
                                </HStack>
                              </VStack>
                            );
                          })()}
                        </VStack>
                      </Box>
                    )}
                  </VStack>
                )}

                {/* List & Add button */}
                {selectedCategory !== 'status' && (
                  <VStack space="xl">
                    {selectedCategory === 'rent' && (
                      <Animated.View entering={FadeInUp.delay(400)}>
                        <Box bg="white" p="$4" rounded="$2xl" style={styles.cardShadow}>
                          <HStack space="xs" alignItems="center" justifyContent="space-between">
                            <HStack space="xs" alignItems="center">
                              <Box bg={Palette.violetTint} p="$1" rounded="$full">
                                <MaterialIcons name="arrow-upward" size={10} color={Palette.violet} />
                              </Box>
                              <Text fontSize={Type.tiny} fontWeight="700" color={Palette.gray500}>{t('expensesScreen.totalRentExpense')}</Text>
                            </HStack>
                            <Text fontSize={Type.body} fontWeight="800" color={Palette.ink}>{formatCurrency(totalRent, { showSymbol: true, convert: false })}</Text>
                          </HStack>
                        </Box>
                      </Animated.View>
                    )}
                    <Input variant="outline" size="xl" bg="white" rounded="$2xl" borderColor={Palette.gray100} style={styles.cardShadow}>
                      <InputSlot pl="$4">
                        <InputIcon as={Search} color={Palette.gold} />
                      </InputSlot>
                      <InputField
                        placeholder={t('expensesScreen.searchPlaceholder', { category: categoryLabel(selectedCategory).toLowerCase() })}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        returnKeyType="search"
                        clearButtonMode="while-editing"
                        fontSize={Type.body}
                      />
                    </Input>

                    <HStack space="sm" justifyContent="space-between" alignItems="center">
                      <HStack space="xs" alignItems="center">
                        <StandardButton.Small isActive={sortBy === 'date'} onPress={() => setSortBy('date')}>
                          {t('expensesScreen.sortDate')}
                        </StandardButton.Small>
                        <StandardButton.Small isActive={sortBy === 'amount'} onPress={() => setSortBy('amount')}>
                          {t('expensesScreen.sortAmount')}
                        </StandardButton.Small>
                      </HStack>
                      <Pressable onPress={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}>
                        {({ pressed }: any) => (
                          <HStack alignItems="center" space="xs" bg="white" px="$3" py="$2" rounded="$xl" style={[styles.cardShadow, { opacity: pressed ? 0.7 : 1 }] as any}>
                            <Text fontSize={Type.small} color={Palette.gray600} fontWeight="700">
                              {sortOrder === 'asc' ? t('expensesScreen.lowToHigh') : t('expensesScreen.highToLow')}
                            </Text>
                            {sortOrder === 'asc' ? <ArrowUp size={12} color={Palette.gold} /> : <ArrowDown size={12} color={Palette.gold} />}
                          </HStack>
                        )}
                      </Pressable>
                    </HStack>

                    {renderListItems()}

                    <Animated.View entering={FadeIn.delay(500)}>
                      <Pressable onPress={() => { resetModalForm(); setModalOpen(true); }}>
                        {({ pressed }: any) => (
                          <Box
                            bg={Palette.gray700}
                            rounded="$2xl"
                            p="$4"
                            style={[
                              styles.cardShadow,
                              { transform: [{ scale: (pressed as any) ? 0.98 : 1 }] }
                            ]}
                          >
                            <HStack space="sm" justifyContent="center" alignItems="center">
                              <MaterialIcons name="add-circle" size={24} color="white" />
                              <Text color="white" fontWeight="800" fontSize={Type.title}>{t('expensesScreen.addEntryButton', { category: categoryLabel(selectedCategory) })}</Text>
                            </HStack>
                          </Box>
                        )}
                      </Pressable>
                    </Animated.View>
                  </VStack>
                )}
              </VStack>
            </Animated.View>
          </Box>
        </ScrollView>

        {/* No avoidKeyboard here — the ScrollView's automaticallyAdjustKeyboardInsets
            owns keyboard handling; both together would double-shift the field. */}
        <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); resetModalForm(); }} finalFocusRef={undefined}>
          <ModalBackdrop />
          <ModalContent
            maxHeight="85%"
            maxWidth={Platform.OS === 'web' ? '$full' : '$full'}
            bg="white"
            rounded="$3xl"
            my="$2"
            mx="$0"
            overflow="hidden"
            style={{
              width: modalMaxWidth,
              maxHeight: modalMaxHeight,
              minHeight: Platform.OS === 'web' ? modalMinHeight : screenHeight * 0.9,
            }}
          >
            <LinearGradient
              colors={
                selectedCategory === 'rent' ? [Palette.violet, Palette.violet] :
                  selectedCategory === 'purchases' ? [Palette.gold, Palette.warning] :
                    selectedCategory === 'subscriptions' ? [Palette.gray700, Palette.ink] : [Palette.warning, Palette.gold]
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 16, paddingBottom: 20 }}
            >
              <HStack alignItems="center" space="md">
                <Box bg="rgba(255, 255, 255, 0.2)" p="$3" rounded="$2xl">
                  <MaterialIcons
                    name={editingEntry ? "edit-note" : "add-circle-outline"}
                    size={26}
                    color="white"
                  />
                </Box>
                <VStack>
                  <Heading size="lg" color="white" fontWeight="900">
                    {editingEntry ? t('expensesScreen.modalEditTitle', { category: categoryLabel(selectedCategory) }) : t('expensesScreen.modalAddTitle', { category: categoryLabel(selectedCategory) })}
                  </Heading>
                  <Text fontSize={Type.small} color="rgba(255,255,255,0.8)" fontWeight="700">
                    {editingEntry ? t('expensesScreen.modalUpdateSubtitle') : t('expensesScreen.modalCompleteSubtitle')}
                  </Text>
                </VStack>
              </HStack>
            </LinearGradient>

            <ModalBody px="$0">
              <ScrollView
                keyboardShouldPersistTaps="always"
                showsVerticalScrollIndicator={false}
                // Insets the scroll content by the keyboard height and scrolls the
                // focused field into view (iOS 15+). Without this, fields deep in
                // the form (lender/duration/interest) sit hidden behind the keyboard.
                automaticallyAdjustKeyboardInsets={true}
                contentContainerStyle={{ paddingBottom: 24 }}
              >
                <VStack space="lg" pb="$8">
                  {/* 1. Basic Info Section */}
                  <Box px="$1" pt="$4">
                    <VStack space="md" bg="white" p="$4" rounded="$2xl" style={styles.cardShadow}>
                      <HStack space="xs" alignItems="center" mb="$2">
                        <Box bg={Palette.goldTint} p="$2" rounded="$xl">
                          <MaterialIcons name="info-outline" size={18} color={Palette.gold} />
                        </Box>
                        <Text fontSize={Type.label} fontWeight="800" color={Palette.gray800}>{t('expensesScreen.basicInformation')}</Text>
                      </HStack>

                      <VStack space="xl">
                        {selectedCategory === 'rent' ? (
                          <VStack space="lg">

                            <VStack space="xs">
                              <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldDescription')}</Text>
                              <Controller
                                control={control}
                                name="description"
                                render={({ field: { onChange, onBlur, value } }) => (
                                  <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="xl">
                                    <InputSlot pl="$4"><InputIcon as={Pencil} color={Palette.gold} /></InputSlot>
                                    <InputField placeholder={t('expensesScreen.placeholderDescRent')} value={value} onChangeText={onChange} onBlur={onBlur} fontSize={Type.body} fontWeight="600" />
                                  </Input>
                                )}
                              />
                            </VStack>

                            <VStack space="md">
                              <VStack space="xs">
                                <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">
                                  {t('expensesScreen.fieldLandlordName')}
                                </Text>
                                <Controller
                                  control={control}
                                  name="landlord_name"
                                  render={({ field: { onChange, onBlur, value } }) => (
                                    <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="xl">
                                      <InputSlot pl="$4"><InputIcon as={BasilUserSolid} color={Palette.violet} /></InputSlot>
                                      <InputField placeholder={t('expensesScreen.placeholderLandlord')} value={value} onChangeText={onChange} onBlur={onBlur} fontSize={Type.body} fontWeight="600" />
                                    </Input>
                                  )}
                                />
                              </VStack>
                              <VStack space="xs">
                                <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldPropertyAddress')}</Text>
                                <Controller
                                  control={control}
                                  name="property_address"
                                  render={({ field: { onChange, onBlur, value } }) => (
                                    <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="xl">
                                      <InputSlot pl="$4"><MaterialIcons name="location-on" size={18} color={Palette.gray500} /></InputSlot>
                                      <InputField placeholder={t('expensesScreen.placeholderPropertyAddress')} value={value} onChangeText={onChange} onBlur={onBlur} fontSize={Type.label} fontWeight="600" />
                                    </Input>
                                  )}
                                />
                              </VStack>
                              <HStack space="md">
                                <VStack space="xs" flex={1}>
                                  <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldDueDay')}</Text>
                                  <Controller
                                    control={control}
                                    name="due_day"
                                    render={({ field: { onChange, value } }) => (
                                      <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="lg">
                                        <InputSlot pl="$3"><MaterialIcons name="event" size={14} color={Palette.gray500} /></InputSlot>
                                        <InputField keyboardType="numeric" placeholder="1" value={value} onChangeText={onChange} fontSize={Type.label} />
                                      </Input>
                                    )}
                                  />
                                </VStack>
                                <VStack space="xs" flex={1} justifyContent="flex-end">
                                  <Controller
                                    control={control}
                                    name="is_recurring"
                                    render={({ field: { onChange, value } }) => (
                                      <Pressable onPress={() => onChange(!value)}>
                                        <HStack space="sm" alignItems="center" p="$3" rounded="$xl" bg={value ? Palette.violetTint : Palette.gray50} borderWidth={1} borderColor={value ? Palette.violet : "transparent"}>
                                          <MaterialIcons name={value ? "repeat" : "repeat-one"} size={16} color={value ? Palette.violet : Palette.gray400} />
                                          <Text fontSize={Type.small} fontWeight="800" color={value ? Palette.violet : Palette.gray400}>{t('expensesScreen.recurring')}</Text>
                                        </HStack>
                                      </Pressable>
                                    )}
                                  />
                                </VStack>
                              </HStack>

                              <VStack space="md">
                                <VStack space="xs">
                                  <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldAmount', { code: currencyInfo.code })}</Text>
                                  <Controller
                                    control={control}
                                    name="amount"
                                    render={({ field: { onChange, value } }) => (
                                      <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="xl">
                                        <InputSlot pl="$4">
                                          <Text fontWeight="900" fontSize={Type.title} color={Palette.ink}>{currencyInfo.symbol}</Text>
                                        </InputSlot>
                                        <InputField keyboardType="numeric" placeholder={t('expensesScreen.placeholderAmountZero')} value={value} onChangeText={onChange} fontSize={Type.title} fontWeight="900" />
                                      </Input>
                                    )}
                                  />
                                </VStack>
                                <VStack space="xs">
                                  <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldDate')}</Text>
                                  <Controller
                                    control={control}
                                    name="date"
                                    render={({ field: { onChange, value } }) => (
                                      <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="xl">
                                        <InputSlot pl="$4"><InputIcon as={Calendar} color={Palette.gray400} /></InputSlot>
                                        <InputField placeholder={t('expensesScreen.placeholderDateFormat')} value={value} onChangeText={onChange} fontSize={Type.body} fontWeight="600" />
                                      </Input>
                                    )}
                                  />
                                </VStack>
                              </VStack>
                            </VStack>
                          </VStack>
                        ) : (
                          <VStack space="lg">
                            <VStack space="xs">
                              <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldDescription')}</Text>
                              <Controller
                                control={control}
                                name="description"
                                render={({ field: { onChange, onBlur, value } }) => (
                                  <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="xl">
                                    <InputSlot pl="$4"><InputIcon as={Pencil} color={Palette.gold} /></InputSlot>
                                    <InputField
                                      placeholder={
                                        selectedCategory === 'subscriptions'
                                          ? t('expensesScreen.placeholderDescSubs')
                                          : selectedCategory === 'loans'
                                            ? t('expensesScreen.placeholderDescLoan')
                                            : t('expensesScreen.placeholderDescPurchase')
                                      }
                                      value={value}
                                      onChangeText={onChange}
                                      onBlur={onBlur}
                                      fontSize={Type.body}
                                      fontWeight="600"
                                    />
                                  </Input>
                                )}
                              />
                            </VStack>

                            {selectedCategory === 'subscriptions' && (
                              <VStack space="sm">
                                <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.quickTemplates')}</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
                                  <HStack space="xs">
                                    {[
                                      { value: 'Netflix', label: t('expensesScreen.subTplNetflix') },
                                      { value: 'Spotify', label: t('expensesScreen.subTplSpotify') },
                                      { value: 'Apple Music', label: t('expensesScreen.subTplAppleMusic') },
                                      { value: 'Internet Bill', label: t('expensesScreen.subTplInternetBill') },
                                      { value: 'Gym Membership', label: t('expensesScreen.subTplGymMembership') },
                                      { value: 'Cloud Storage', label: t('expensesScreen.subTplCloudStorage') },
                                    ].map((template) => (
                                      <Pressable key={template.value} onPress={() => setValue('description', template.value, { shouldValidate: true })}>
                                        {({ pressed }: any) => (
                                          <Box
                                            bg={pressed ? 'rgba(55,65,81,0.12)' : 'rgba(55,65,81,0.06)'}
                                            px="$3"
                                            py="$1.5"
                                            rounded="$full"
                                            borderWidth={1}
                                            borderColor="rgba(55,65,81,0.2)"
                                          >
                                            <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray700}>{template.label}</Text>
                                          </Box>
                                        )}
                                      </Pressable>
                                    ))}
                                  </HStack>
                                </ScrollView>
                                <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="600" ml="$1">
                                  {t('expensesScreen.tipServiceName')}
                                </Text>
                              </VStack>
                            )}

                            {selectedCategory === 'loans' && (
                              <VStack space="sm">
                                <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.loanTemplates')}</Text>
                                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
                                  <HStack space="xs">
                                    {[
                                      { value: 'Car Loan', label: t('expensesScreen.loanTplCarLoan') },
                                      { value: 'Business Loan', label: t('expensesScreen.loanTplBusinessLoan') },
                                      { value: 'School Fees Loan', label: t('expensesScreen.loanTplSchoolFeesLoan') },
                                      { value: 'Emergency Loan', label: t('expensesScreen.loanTplEmergencyLoan') },
                                      { value: 'Mortgage Payment', label: t('expensesScreen.loanTplMortgagePayment') },
                                    ].map((template) => (
                                      <Pressable key={template.value} onPress={() => setValue('description', template.value, { shouldValidate: true })}>
                                        {({ pressed }: any) => (
                                          <Box
                                            bg={pressed ? 'rgba(245, 158, 11, 0.16)' : 'rgba(245, 158, 11, 0.08)'}
                                            px="$3"
                                            py="$1.5"
                                            rounded="$full"
                                            borderWidth={1}
                                            borderColor="rgba(245, 158, 11, 0.25)"
                                          >
                                            <Text fontSize={Type.caption} fontWeight="700" color={Palette.gold}>{template.label}</Text>
                                          </Box>
                                        )}
                                      </Pressable>
                                    ))}
                                  </HStack>
                                </ScrollView>
                                <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="600" ml="$1">
                                  {t('expensesScreen.tipPickTemplate')}
                                </Text>
                              </VStack>
                            )}

                            {selectedCategory === 'purchases' && (
                              <VStack space="md">
                                <VStack space="xs">
                                  <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldMerchant')}</Text>
                                  <Controller
                                    control={control}
                                    name="merchant"
                                    render={({ field: { onChange, value } }) => (
                                      <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="lg">
                                        <InputSlot pl="$3"><MaterialIcons name="store" size={14} color={Palette.gray500} /></InputSlot>
                                        <InputField placeholder={t('expensesScreen.placeholderStore')} value={value} onChangeText={onChange} fontSize={Type.label} />
                                      </Input>
                                    )}
                                  />
                                </VStack>
                                <VStack space="xs">
                                  <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldCategory')}</Text>
                                  {/* Tag Suggestions */}
                                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
                                    <HStack space="xs">
                                      {[
                                        { value: 'Groceries', label: t('expensesScreen.tagGroceries') },
                                        { value: 'Transport', label: t('expensesScreen.tagTransport') },
                                        { value: 'Utilities', label: t('expensesScreen.tagUtilities') },
                                        { value: 'Dining', label: t('expensesScreen.tagDining') },
                                        { value: 'Entertainment', label: t('expensesScreen.tagEntertainment') },
                                        { value: 'Health', label: t('expensesScreen.tagHealth') },
                                        { value: 'Shopping', label: t('expensesScreen.tagShopping') },
                                        { value: 'Travel', label: t('expensesScreen.tagTravel') },
                                      ].map(tag => (
                                        <Pressable key={tag.value} onPress={() => setValue('purchase_category', tag.value)}>
                                          {({ pressed }: any) => (
                                            <Box
                                              bg={pressed ? Palette.gray100 : Palette.gray100}
                                              px="$3"
                                              py="$1.5"
                                              rounded="$full"
                                              borderWidth={1}
                                              borderColor={Palette.gray200}
                                            >
                                              <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray600}>{tag.label}</Text>
                                            </Box>
                                          )}
                                        </Pressable>
                                      ))}
                                    </HStack>
                                  </ScrollView>
                                  <Controller
                                    control={control}
                                    name="purchase_category"
                                    render={({ field: { onChange, value } }) => (
                                      <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="lg">
                                        <InputSlot pl="$3"><MaterialIcons name="category" size={14} color={Palette.gray500} /></InputSlot>
                                        <InputField placeholder={t('expensesScreen.placeholderTagOrCustom')} value={value} onChangeText={onChange} fontSize={Type.label} />
                                      </Input>
                                    )}
                                  />
                                </VStack>

                                <Pressable onPress={handleScanReceipt} disabled={isScanning}>
                                  {({ pressed }: any) => (
                                    <HStack
                                      space="sm"
                                      alignItems="center"
                                      justifyContent="center"
                                      p="$3"
                                      rounded="$xl"
                                      bg={isScanning ? Palette.gray100 : pressed ? "rgba(55,65,81,0.08)" : "rgba(55,65,81,0.05)"}
                                      style={{ borderStyle: 'dashed', borderWidth: 1, borderColor: Palette.gray700 }}
                                    >
                                      {isScanning ? <ActivityIndicator color={Palette.gray700} size="small" /> : <Camera size={18} color={Palette.gray700} />}
                                      <Text fontSize={Type.body} fontWeight="800" color={Palette.gray700}>
                                        {isScanning ? t('expensesScreen.analyzingReceipt') : t('expensesScreen.autofillScan')}
                                      </Text>
                                    </HStack>
                                  )}
                                </Pressable>

                                {scanReviewFields.length > 0 && (
                                  <HStack
                                    space="sm"
                                    alignItems="flex-start"
                                    p="$3"
                                    rounded="$xl"
                                    bg={Palette.warningTint}
                                    style={{ borderWidth: 1, borderColor: Palette.gold }}
                                  >
                                    <Text fontSize={Type.title}>⚠️</Text>
                                    <VStack flex={1} space="xs">
                                      <Text fontSize={Type.label} fontWeight="800" color={Palette.gold}>
                                        {t('expensesScreen.reviewScannedTitle', { defaultValue: 'Please double-check' })}
                                      </Text>
                                      <Text fontSize={Type.small} color={Palette.gold}>
                                        {scanReviewFields.join(', ')}
                                      </Text>
                                    </VStack>
                                  </HStack>
                                )}
                              </VStack>
                            )}

                            <VStack space="md">
                              <VStack space="xs">
                                <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldAmount', { code: currencyInfo.code })}</Text>
                                <Controller
                                  control={control}
                                  name="amount"
                                  render={({ field: { onChange, value } }) => (
                                    <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="xl">
                                      <InputSlot pl="$4">
                                        <Text fontWeight="900" fontSize={Type.title} color={Palette.ink}>{currencyInfo.symbol}</Text>
                                      </InputSlot>
                                      <InputField
                                        keyboardType="numeric"
                                        placeholder={t('expensesScreen.placeholderAmountZero')}
                                        value={selectedCategory === 'purchases' && showItemized ? (itemizedTotal > 0 ? itemizedTotal.toString() : '') : value}
                                        onChangeText={selectedCategory === 'purchases' && showItemized ? () => { } : onChange}
                                        readOnly={selectedCategory === 'purchases' && showItemized}
                                        editable={!(selectedCategory === 'purchases' && showItemized)}
                                        fontSize={Type.title}
                                        fontWeight={"900" as any}
                                      />
                                    </Input>
                                  )}
                                />
                                {selectedCategory === 'purchases' && showItemized && (
                                  <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="600" ml="$1">
                                    {t('expensesScreen.autoCalculatedFromItems')}
                                  </Text>
                                )}
                              </VStack>
                              <VStack space="xs">
                                <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldDate')}</Text>
                                <Controller
                                  control={control}
                                  name="date"
                                  render={({ field: { onChange, value } }) => (
                                    <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="xl">
                                      <InputSlot pl="$4"><InputIcon as={Calendar} color={Palette.gray400} /></InputSlot>
                                      <InputField placeholder={t('expensesScreen.placeholderDateFormat')} value={value} onChangeText={onChange} fontSize={Type.body} fontWeight="600" />
                                    </Input>
                                  )}
                                />
                              </VStack>
                            </VStack>
                          </VStack>
                        )}
                      </VStack>
                    </VStack>
                  </Box>

                  {/* 2. Loan Details Section */}
                  {selectedCategory === 'loans' && (
                    <VStack space="md" px="$1">
                      <Box bg="white" p="$4" rounded="$2xl" style={styles.cardShadow}>
                        <HStack space="xs" alignItems="center" mb="$3">
                          <Box bg={Palette.warningTint} p="$2" rounded="$xl">
                            <MaterialIcons name="account-balance" size={18} color={Palette.gold} />
                          </Box>
                          <Text fontSize={Type.label} fontWeight="800" color={Palette.gray800}>{t('expensesScreen.loanDetails')}</Text>
                        </HStack>
                        <VStack space="md">
                          <VStack space="xs">
                            <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldLenderName')}</Text>
                            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
                              <HStack space="xs">
                                {[
                                  { value: 'Bank', label: t('expensesScreen.lenderBank') },
                                  { value: 'Employer', label: t('expensesScreen.lenderEmployer') },
                                  { value: 'Family', label: t('expensesScreen.lenderFamily') },
                                  { value: 'Co-op', label: t('expensesScreen.lenderCoop') },
                                  { value: 'Microfinance', label: t('expensesScreen.lenderMicrofinance') },
                                ].map((lender) => (
                                  <Pressable key={lender.value} onPress={() => setValue('lender_name', lender.value, { shouldValidate: true })}>
                                    {({ pressed }: any) => (
                                      <Box
                                        bg={pressed ? 'rgba(245,158,11,0.16)' : 'rgba(245,158,11,0.08)'}
                                        px="$3"
                                        py="$1"
                                        rounded="$full"
                                        borderWidth={1}
                                        borderColor="rgba(245,158,11,0.25)"
                                      >
                                        <Text fontSize={Type.caption} fontWeight="700" color={Palette.gold}>{lender.label}</Text>
                                      </Box>
                                    )}
                                  </Pressable>
                                ))}
                              </HStack>
                            </ScrollView>
                            <Controller
                              control={control}
                              name="lender_name"
                              render={({ field: { onChange, value } }) => (
                                <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="lg">
                                  <InputSlot pl="$3"><MaterialIcons name="person" size={14} color={Palette.gray500} /></InputSlot>
                                  <InputField placeholder={t('expensesScreen.placeholderBankOrPerson')} value={value} onChangeText={onChange} fontSize={Type.label} />
                                </Input>
                              )}
                            />
                          </VStack>
                          <HStack space="md">
                            <VStack space="xs" flex={1}>
                              <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldDurationMonths')}</Text>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
                                <HStack space="xs">
                                  {[3, 6, 12, 24, 36].map((months) => (
                                    <Pressable key={months} onPress={() => setValue('duration_months', String(months), { shouldValidate: true })}>
                                      {({ pressed }: any) => (
                                        <Box
                                          bg={pressed ? 'rgba(245,158,11,0.16)' : 'rgba(245,158,11,0.08)'}
                                          px="$2.5"
                                          py="$1"
                                          rounded="$full"
                                          borderWidth={1}
                                          borderColor="rgba(245,158,11,0.25)"
                                        >
                                          <Text fontSize={Type.caption} fontWeight="700" color={Palette.gold}>{months}m</Text>
                                        </Box>
                                      )}
                                    </Pressable>
                                  ))}
                                </HStack>
                              </ScrollView>
                              <Controller
                                control={control}
                                name="duration_months"
                                render={({ field: { onChange, value } }) => (
                                  <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="lg">
                                    <InputField keyboardType="numeric" placeholder="12" value={value} onChangeText={onChange} fontSize={Type.label} />
                                  </Input>
                                )}
                              />
                            </VStack>
                            <VStack space="xs" flex={1}>
                              <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldInterestRate')}</Text>
                              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingVertical: 4 }}>
                                <HStack space="xs">
                                  {['0', '5', '10', '15'].map((rate) => (
                                    <Pressable key={rate} onPress={() => setValue('interest_rate', rate, { shouldValidate: true })}>
                                      {({ pressed }: any) => (
                                        <Box
                                          bg={pressed ? 'rgba(245,158,11,0.16)' : 'rgba(245,158,11,0.08)'}
                                          px="$2.5"
                                          py="$1"
                                          rounded="$full"
                                          borderWidth={1}
                                          borderColor="rgba(245,158,11,0.25)"
                                        >
                                          <Text fontSize={Type.caption} fontWeight="700" color={Palette.gold}>{rate}%</Text>
                                        </Box>
                                      )}
                                    </Pressable>
                                  ))}
                                </HStack>
                              </ScrollView>
                              <Controller
                                control={control}
                                name="interest_rate"
                                render={({ field: { onChange, value } }) => (
                                  <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="lg">
                                    <InputField keyboardType="numeric" placeholder="5.5" value={value} onChangeText={onChange} fontSize={Type.label} />
                                  </Input>
                                )}
                              />
                            </VStack>
                          </HStack>
                          <VStack space="xs">
                            <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.fieldPaymentFrequency')}</Text>
                            <Controller
                              control={control}
                              name="payment_frequency"
                              render={({ field: { onChange, value } }) => (
                                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                                  <HStack space="sm">
                                    {[
                                      { value: 'weekly', label: t('expensesScreen.freqWeekly') },
                                      { value: 'biweekly', label: t('expensesScreen.freqBiweekly') },
                                      { value: 'monthly', label: t('expensesScreen.freqMonthly') },
                                    ].map(freq => (
                                      <Pressable key={freq.value} onPress={() => onChange(freq.value)}>
                                        <Box bg={value === freq.value ? Palette.warningTint : Palette.gray50} px="$4" py="$2" rounded="$full" borderWidth={1} borderColor={value === freq.value ? Palette.gold : Palette.gray200}>
                                          <Text fontSize={Type.small} fontWeight="700" color={value === freq.value ? Palette.gold : Palette.gray600}>{freq.label}</Text>
                                        </Box>
                                      </Pressable>
                                    ))}
                                  </HStack>
                                </ScrollView>
                              )}
                            />
                          </VStack>
                          <Controller
                            control={control}
                            name="is_recurrent"
                            render={({ field: { onChange, value } }) => (
                              <Pressable onPress={() => onChange(!value)}>
                                <HStack space="sm" alignItems="center" p="$3" rounded="$xl" bg={value ? Palette.warningTint : Palette.gray50} borderWidth={1} borderColor={value ? Palette.gold : "transparent"}>
                                  <MaterialIcons name={value ? "repeat" : "repeat-one"} size={16} color={value ? Palette.gold : Palette.gray400} />
                                  <Text fontSize={Type.small} fontWeight="800" color={value ? Palette.gold : Palette.gray400}>{t('expensesScreen.recurringLoan')}</Text>
                                </HStack>
                              </Pressable>
                            )}
                          />
                        </VStack>
                      </Box>
                    </VStack>
                  )}

                  {/* 3. Itemized Breakdown Section (Purchases Only) */}
                  {selectedCategory === 'purchases' && (
                    <VStack space="md" px="$4">
                      <HStack justifyContent="space-between" alignItems="center">
                        <VStack space="xs">
                          <Heading size="sm" fontWeight="900">{t('expensesScreen.itemizedList')}</Heading>
                          <Text fontSize={Type.small} color={Palette.gray500} fontWeight="600">{t('expensesScreen.itemizedListSubtitle')}</Text>
                        </VStack>
                        <Pressable onPress={() => {
                          LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
                          setShowItemized(!showItemized);
                        }}>
                          <Box bg={showItemized ? "rgba(55,65,81,0.08)" : Palette.gray100} px="$4" py="$2" rounded="$full">
                            <Text fontSize={Type.small} fontWeight="800" color={showItemized ? Palette.gray700 : Palette.gray500}>
                              {showItemized ? t('expensesScreen.hide') : t('expensesScreen.addItems')}
                            </Text>
                          </Box>
                        </Pressable>
                      </HStack>

                      {showItemized && (
                        <VStack space="md">
                          {purchaseItems.map((item) => (
                            <PurchaseItemRow
                              key={item.id}
                              itemId={item.id}
                              initialName={item.name}
                              initialPrice={item.price}
                              currencySymbol={currencyInfo.symbol}
                              whatBuyPlaceholder={t('expensesScreen.whatDidYouBuy')}
                              onChange={handleItemChange}
                              onRemove={handleRemoveItem}
                            />
                          ))}

                          <Pressable onPress={handleAddItem}>
                            {({ pressed }: any) => (
                              <Box
                                bg="white"
                                p="$3"
                                rounded="$2xl"
                                borderWidth={1}
                                borderColor={Palette.gray700}
                                borderStyle="dashed"
                                style={{ opacity: pressed ? 0.7 : 1, padding: 12 }}
                              >
                                <HStack space="sm" justifyContent="center" alignItems="center">
                                  <MaterialIcons name="add-circle-outline" size={18} color={Palette.gray700} />
                                  <Text color={Palette.gray700} fontWeight="900" fontSize={Type.label}>{t('expensesScreen.addAnotherItem')}</Text>
                                </HStack>
                              </Box>
                            )}
                          </Pressable>

                          {/* Summary Total Card */}
                          {purchaseItems.length > 0 && (
                            <Box bg={Palette.gray700} p="$4" rounded="$2xl" style={styles.cardShadow}>
                              <HStack justifyContent="space-between" alignItems="center">
                                <VStack space="xs">
                                  <Text color="rgba(255,255,255,0.7)" fontSize={Type.caption} fontWeight="800" textTransform="uppercase">{t('expensesScreen.runningTotal')}</Text>
                                  <Text color="white" fontSize={Type.small} fontWeight="700">{t('expensesScreen.itemsIndexed', { count: purchaseItems.length })}</Text>
                                </VStack>
                                <Text color="white" fontSize={Type.h2} fontWeight="900">
                                  {formatCurrency(itemizedTotal, { showSymbol: true })}
                                </Text>
                              </HStack>
                            </Box>
                          )}
                        </VStack>
                      )}
                    </VStack>
                  )}
                </VStack>
              </ScrollView>
            </ModalBody>
            <ModalFooter borderTopWidth={0} p="$6">
              <HStack space="md" flex={1}>
                <Pressable onPress={() => { setModalOpen(false); resetModalForm(); }} flex={1}>
                  {({ pressed }: any) => (
                    <Box bg="rgba(0,0,0,0.05)" rounded="$2xl" p="$3.5" style={{ opacity: pressed ? 0.7 : 1 }}>
                      <Text textAlign="center" fontWeight="800" color={Palette.gray600} fontSize={Type.body}>{t('expensesScreen.cancel')}</Text>
                    </Box>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (selectedCategory === 'purchases' && showItemized) {
                      const values = getValues();
                      handleFormSubmit(values);
                      return;
                    }
                    handleSubmit(handleFormSubmit)();
                  }}
                  flex={2}
                  disabled={isSubmitting}
                >
                  {({ pressed }: any) => (
                    <Box bg={
                      selectedCategory === 'rent' ? Palette.violet :
                        selectedCategory === 'purchases' ? Palette.gold :
                          selectedCategory === 'subscriptions' ? Palette.gray700 : Palette.warning
                    } rounded="$2xl" p="$3.5" style={[{ opacity: (pressed || isSubmitting) ? 0.8 : 1 }, styles.cardShadow]}>
                      <HStack space="xs" justifyContent="center" alignItems="center">
                        {isSubmitting && <ActivityIndicator size="small" color="white" />}
                        <Text textAlign="center" fontWeight="900" color="white" fontSize={Type.body}>{t('expensesScreen.save')}</Text>
                      </HStack>
                    </Box>
                  )}
                </Pressable>
              </HStack>
            </ModalFooter>
          </ModalContent>
        </Modal>

        <Modal isOpen={repaymentModalOpen} onClose={() => setRepaymentModalOpen(false)} finalFocusRef={undefined} avoidKeyboard>
          <ModalBackdrop />
          <ModalContent
            maxHeight="85%"
            maxWidth={Platform.OS === 'web' ? '$full' : '$full'}
            bg="white"
            rounded="$3xl"
            my="$2"
            mx="$0"
            overflow="hidden"
            style={{
              width: modalMaxWidth,
              maxHeight: modalMaxHeight,
              minHeight: Platform.OS === 'web' ? Math.min(screenHeight * 0.72, 640) : screenHeight * 0.7,
            }}
          >
            <LinearGradient
              colors={[Palette.teal, Palette.green]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 16, paddingBottom: 20 }}
            >
              <HStack space="md" alignItems="center">
                <Box bg="rgba(255, 255, 255, 0.2)" p="$3" rounded="$2xl">
                  <MaterialIcons name="payments" size={26} color="white" />
                </Box>
                <VStack>
                  <Heading size="lg" fontWeight="900" color="white">{t('expensesScreen.logRepayment')}</Heading>
                  <Text fontSize={Type.small} color="rgba(255,255,255,0.8)" fontWeight="700">
                    {t('expensesScreen.forLabel', { name: selectedLoanForRepayment?.description ?? '' })}
                  </Text>
                </VStack>
              </HStack>
            </LinearGradient>

            <ModalBody px="$4" pt="$6" pb="$4">
              <VStack space="xl">
                <VStack space="xs">
                  <Text fontSize={Type.caption} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.repaymentAmount', { code: currencyInfo.code })}</Text>
                  <Controller
                    control={repaymentControl}
                    name="amount"
                    render={({ field: { onChange, onBlur, value } }) => (
                      <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="xl">
                        <InputSlot pl="$4">
                          <Text fontWeight="900" fontSize={Type.title} color={Palette.ink}>{currencyInfo.symbol}</Text>
                        </InputSlot>
                        <InputField keyboardType="numeric" placeholder={t('expensesScreen.placeholderAmountZero')} value={value} onChangeText={onChange} onBlur={onBlur} fontSize={Type.title} fontWeight="800" />
                      </Input>
                    )}
                  />
                  {repaymentErrors.amount && <Text color={Palette.error} fontSize={Type.tiny} mt="$1" ml="$1" fontWeight="700">{repaymentErrors.amount.message}</Text>}
                </VStack>
                <VStack space="xs">
                  <Text fontSize={Type.caption} fontWeight="800" color={Palette.gray400} textTransform="uppercase" ml="$1">{t('expensesScreen.paymentDate')}</Text>
                  <Controller
                    control={repaymentControl}
                    name="date"
                    render={({ field: { onChange, onBlur, value } }) => (
                      <Input borderColor={Palette.gray100} rounded="$2xl" bg={Palette.gray50} size="xl">
                        <InputSlot pl="$4">
                          <InputIcon as={Calendar} color={Palette.gray400} />
                        </InputSlot>
                        <InputField placeholder={t('expensesScreen.placeholderDateFormat')} value={value} onChangeText={onChange} onBlur={onBlur} fontSize={Type.body} fontWeight="600" />
                      </Input>
                    )}
                  />
                  {repaymentErrors.date && <Text color={Palette.error} fontSize={Type.tiny} mt="$1" ml="$1" fontWeight="700">{repaymentErrors.date.message}</Text>}
                </VStack>
              </VStack>
            </ModalBody>
            <ModalFooter borderTopWidth={0} p="$6">
              <HStack space="md" flex={1}>
                <Pressable onPress={() => setRepaymentModalOpen(false)} flex={1}>
                  {({ pressed }: any) => (
                    <Box bg="rgba(0,0,0,0.05)" rounded="$2xl" p="$3.5" style={{ opacity: pressed ? 0.7 : 1 }}>
                      <Text textAlign="center" fontWeight="800" color={Palette.gray600} fontSize={Type.body}>{t('expensesScreen.cancel')}</Text>
                    </Box>
                  )}
                </Pressable>
                <Pressable onPress={handleRepaymentSubmit(onRepaymentSubmit)} flex={2} disabled={isRepaymentSubmitting}>
                  {({ pressed }: any) => (
                    <Box bg={Palette.teal} rounded="$2xl" p="$3.5" style={[{ opacity: (pressed || isRepaymentSubmitting) ? 0.8 : 1 }, styles.cardShadow]}>
                      <HStack space="xs" justifyContent="center" alignItems="center">
                        {isRepaymentSubmitting && <ActivityIndicator size="small" color="white" />}
                        <Text textAlign="center" fontWeight="900" color="white" fontSize={Type.body}>{t('expensesScreen.save')}</Text>
                      </HStack>
                    </Box>
                  )}
                </Pressable>
              </HStack>
            </ModalFooter>
          </ModalContent>
        </Modal>
        <Modal isOpen={loanDetailOpen} onClose={() => setLoanDetailOpen(false)}>
          <ModalBackdrop />
          <ModalContent
            maxHeight="85%"
            maxWidth={Platform.OS === 'web' ? '$full' : '$full'}
            bg={Palette.white}
            rounded="$3xl"
            my="$2"
            mx="$0"
            overflow="hidden"
            style={{
              width: modalMaxWidth,
              maxHeight: modalMaxHeight,
              minHeight: Platform.OS === 'web' ? modalMinHeight : screenHeight * 0.88,
            }}
          >
            <LinearGradient
              colors={[Palette.warning, Palette.gold]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 16, paddingBottom: 24 }}
            >
              <HStack space="md" alignItems="center" justifyContent="space-between">
                <VStack space="xs">
                  <Text color="rgba(255,255,255,0.8)" fontSize={Type.small} fontWeight="700" textTransform="uppercase">{t('expensesScreen.loanDetail')}</Text>
                  <Heading size="xl" color="white" fontWeight="900">{selectedLoanForView?.description}</Heading>
                </VStack>
                <Pressable onPress={() => setLoanDetailOpen(false)}>
                  <Box bg="rgba(255,255,255,0.2)" p="$2" rounded="$full">
                    <MaterialIcons name="close" size={20} color="white" />
                  </Box>
                </Pressable>
              </HStack>

              <HStack space="lg" mt="$8">
                <VStack flex={1}>
                  <Text color="rgba(255,255,255,0.8)" fontSize={Type.tiny} fontWeight="700">{t('expensesScreen.totalLoan')}</Text>
                  <Text color="white" fontSize={Type.h2} fontWeight="900">{formatCurrency(selectedLoanForView?.amount || 0, { showSymbol: true, convert: false })}</Text>
                </VStack>
                <Box w={1} bg="rgba(255,255,255,0.2)" h="$10" />
                <VStack flex={1} alignItems="flex-end">
                  <Text color="rgba(255,255,255,0.8)" fontSize={Type.tiny} fontWeight="700">{t('expensesScreen.remaining')}</Text>
                  <Text color="white" fontSize={Type.h2} fontWeight="900">
                    {formatCurrency(selectedLoanForView ? selectedLoanForView.amount - (selectedLoanForView.repaid_amount || 0) : 0, { showSymbol: true, convert: false })}
                  </Text>
                </VStack>
              </HStack>
            </LinearGradient>

            <ModalBody px="$4" mt={-16}>
              <VStack space="xl">
                {/* Stats Row */}
                <HStack space="md">
                  <Box flex={1} bg="white" p="$4" rounded="$2xl" style={styles.cardShadow}>
                    <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="700">{t('expensesScreen.status')}</Text>
                    <Text fontSize={Type.body} color={Palette.warning} fontWeight="800" mt="$1">{t('expensesScreen.statusActive')}</Text>
                  </Box>
                  <Box flex={1} bg="white" p="$4" rounded="$2xl" style={styles.cardShadow}>
                    <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="700">{t('expensesScreen.progress')}</Text>
                    <Text fontSize={Type.body} color={Palette.ink} fontWeight="800" mt="$1">
                      {t('expensesScreen.percentPaid', {
                        percent: selectedLoanForView && selectedLoanForView.amount > 0
                          ? ((selectedLoanForView.repaid_amount || 0) / selectedLoanForView.amount * 100).toFixed(0)
                          : 0
                      })}
                    </Text>
                  </Box>
                </HStack>

                {/* Repayment History Ledger */}
                <VStack space="md">
                  <HStack justifyContent="space-between" alignItems="center">
                    <Heading size="sm" color={Palette.ink} fontWeight="800">{t('expensesScreen.repaymentHistory')}</Heading>
                    <Box bg={Palette.tealTint} px="$2" py="$1" rounded="$full">
                      <Text fontSize={Type.tiny} color={Palette.teal} fontWeight="800">{t('expensesScreen.paymentsCount', { count: loanRepayments.length })}</Text>
                    </Box>
                  </HStack>

                  <ScrollView style={{ maxHeight: Math.min(screenHeight * 0.45, 420) }} showsVerticalScrollIndicator={false}>
                    <VStack space="sm">
                      {isLoadingRepayments ? (
                        <Box py="$10" alignItems="center">
                          <ActivityIndicator size="small" color={Palette.warning} />
                          <Text mt="$2" fontSize={Type.small} color={Palette.gray400}>{t('expensesScreen.fetchingHistory')}</Text>
                        </Box>
                      ) : loanRepayments.length === 0 ? (
                        <Box py="$10" alignItems="center" bg="white" rounded="$2xl" style={styles.cardShadow} borderWidth={1} borderColor={Palette.gray100}>
                          <MaterialIcons name="history" size={32} color={Palette.gray200} />
                          <Text mt="$2" fontSize={Type.label} color={Palette.gray400} fontWeight="600">{t('expensesScreen.noRepaymentsLog')}</Text>
                        </Box>
                      ) : (
                        loanRepayments.map((repayment, idx) => (
                          <Box key={repayment.repayment_id} bg="white" p="$4" rounded="$2xl" style={styles.cardShadow}>
                            <HStack justifyContent="space-between" alignItems="center">
                              <HStack space="sm" alignItems="center">
                                <Box bg={Palette.tealTint} p="$2" rounded="$xl">
                                  <MaterialIcons name="check" size={16} color={Palette.teal} />
                                </Box>
                                <VStack>
                                  <Text fontSize={Type.body} fontWeight="800" color={Palette.ink}>{t('expensesScreen.repaymentNumber', { number: loanRepayments.length - idx })}</Text>
                                  <Text fontSize={Type.caption} color={Palette.gray400} fontWeight="700">
                                    {new Date(repayment.payment_date).toLocaleDateString()}
                                  </Text>
                                </VStack>
                              </HStack>
                              <Text fontSize={Type.title} fontWeight="900" color={Palette.ink}>{formatCurrency(repayment.amount, { showSymbol: true, convert: false })}</Text>
                            </HStack>
                          </Box>
                        ))
                      )}
                    </VStack>
                  </ScrollView>
                </VStack>
              </VStack>
            </ModalBody>

            <ModalFooter borderTopWidth={0} p="$6" bg="white">
              <HStack space="md" flex={1}>
                {(selectedLoanForView?.amount! - (selectedLoanForView?.repaid_amount || 0)) > 0 && (
                  <Pressable
                    onPress={() => {
                      setLoanDetailOpen(false);
                      handleOpenRepaymentModal(selectedLoanForView!);
                    }}
                    flex={1}
                  >
                    {({ pressed }: any) => (
                      <Box bg={Palette.teal} rounded="$2xl" p="$3.5" style={[{ opacity: pressed ? 0.8 : 1 }, styles.cardShadow]}>
                        <HStack space="xs" justifyContent="center" alignItems="center">
                          <MaterialIcons name="add-circle-outline" size={20} color="white" />
                          <Text textAlign="center" fontWeight="900" color="white" fontSize={Type.body}>{t('expensesScreen.newRepayment')}</Text>
                        </HStack>
                      </Box>
                    )}
                  </Pressable>
                )}
              </HStack>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* Full-screen receipt image viewer. Opens when a list-row "View
            receipt" badge is tapped (or, below, when the user taps the form
            thumbnail). Dismiss = tap anywhere or hit X. */}
        <RNModal
          visible={!!receiptViewerUrl}
          transparent
          animationType="fade"
          onRequestClose={() => setReceiptViewerUrl(null)}
        >
          <Pressable
            onPress={() => setReceiptViewerUrl(null)}
            style={{
              flex: 1,
              backgroundColor: 'rgba(0,0,0,0.92)',
              justifyContent: 'center',
              alignItems: 'center',
              padding: 16,
            }}
          >
            {receiptViewerUrl && (
              <RNImage
                source={{ uri: resolveReceiptUrl(receiptViewerUrl) }}
                style={{ width: '100%', height: '90%' }}
                resizeMode="contain"
              />
            )}
            <Pressable
              onPress={() => setReceiptViewerUrl(null)}
              style={{
                position: 'absolute',
                top: 48,
                right: 16,
                backgroundColor: 'rgba(255,255,255,0.18)',
                borderRadius: 9999,
                padding: 8,
              }}
              hitSlop={10}
            >
              <XCircle size={28} color={Palette.white} />
            </Pressable>
          </Pressable>
        </RNModal>
      </SafeAreaView>
    </Box>
  );
}

const styles = StyleSheet.create({
  heroCard: {
    padding: 24,
    borderRadius: 32,
    overflow: 'hidden',
  },
  cardShadow: {
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
});