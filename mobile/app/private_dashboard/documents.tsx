import React, { useState, useEffect, useCallback } from 'react';
import { Palette, Type } from '@/app/constants/theme';
import { useTranslation } from 'react-i18next';
import {
  Box,
  HStack,
  VStack,
  Text,
  Heading,
  Pressable,
  ScrollView,
  Input,
  InputField,
  InputSlot,
  Button,
  ButtonText,
  Spinner,
} from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeIn, FadeInUp } from '@/app/utils/animated';
import { useRouter } from 'expo-router';
import { Alert, KeyboardAvoidingView, Modal as RNModal, Platform, StyleSheet, View } from 'react-native';
import DocViewerModal from '@/components/DocViewerModal';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { PremiumHeader } from '@/components/PremiumHeader';
import useAuth from '../hooks/useAuth';
import { format, differenceInDays, parseISO, isValid } from 'date-fns';
import { uploadVaultDocument, getVaultDocuments, deleteVaultDocument, resolveFileUrl, pdfViewerUrl } from '@/services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type VaultDoc = {
  doc_id: number;
  doc_type: 'passport' | 'work_permit' | 'contract' | 'pay_stub' | 'id_card' | 'visa' | 'certificate' | 'other';
  name: string;
  expiry_date?: string;
  notes?: string;
  file_url?: string;
  file_name?: string;
  file_mime?: string;
  created_at: string;
};

// ─── Constants ────────────────────────────────────────────────────────────────

const DOC_TYPES = [
  { key: 'passport',    label: 'Passport',    icon: 'book',        color: Palette.blue },
  { key: 'work_permit', label: 'Work Permit', icon: 'badge',       color: Palette.success },
  { key: 'contract',    label: 'Contract',    icon: 'description', color: Palette.blue },
  { key: 'pay_stub',    label: 'Pay Stub',    icon: 'receipt',     color: Palette.gold },
  { key: 'id_card',     label: 'ID Card',     icon: 'credit-card', color: Palette.violet },
  { key: 'visa',        label: 'Visa',        icon: 'flight',          color: Palette.teal },
  { key: 'certificate', label: 'Certificate', icon: 'card-membership', color: Palette.warning },
  { key: 'other',       label: 'Other',       icon: 'folder',      color: Palette.gray500 },
] as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

type ExpiryStatus = {
  label: string;
  color: string;
  bg: string;
  urgent: boolean;
};

function getExpiryStatus(
  expiry_date: string | undefined,
  t: (key: string, opts?: Record<string, any>) => string,
): ExpiryStatus {
  const noExpiryLabel = t('documentVault.expiryNoExpiry');
  if (!expiry_date) return { label: noExpiryLabel, color: Palette.gray500, bg: Palette.gray100, urgent: false };
  const parsed = parseISO(expiry_date);
  if (!isValid(parsed)) return { label: noExpiryLabel, color: Palette.gray500, bg: Palette.gray100, urgent: false };
  const days = differenceInDays(parsed, new Date());
  if (days < 0)    return { label: t('documentVault.expiryExpired'),                       color: Palette.error, bg: Palette.errorTint, urgent: true };
  if (days <= 30)  return { label: t('documentVault.expiryDaysLeft', { count: days }),     color: Palette.error, bg: Palette.errorTint, urgent: true };
  if (days <= 60)  return { label: t('documentVault.expiryDaysLeft', { count: days }),     color: Palette.gold, bg: Palette.warningTint, urgent: true };
  if (days <= 90)  return { label: t('documentVault.expiryDaysLeft', { count: days }),     color: Palette.gold, bg: Palette.warningTint, urgent: false };
  return { label: format(parsed, 'MMM d, yyyy'), color: Palette.success, bg: Palette.successTint, urgent: false };
}

function getDocTypeInfo(key: string) {
  return DOC_TYPES.find((d) => d.key === key) ?? DOC_TYPES[DOC_TYPES.length - 1];
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DocumentVault() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const docTypeLabel = (key: string): string => {
    switch (key) {
      case 'passport':    return t('documentVault.typePassport');
      case 'work_permit': return t('documentVault.typeWorkPermit');
      case 'contract':    return t('documentVault.typeContract');
      case 'pay_stub':    return t('documentVault.typePayStub');
      case 'id_card':     return t('documentVault.typeIdCard');
      case 'other':
      default:            return t('documentVault.typeOther');
    }
  };

  const privateUserId: number = (user as any)?.private_user?.private_user_id ?? (user as any)?.private_user_id;

  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  // Form state
  const [formDocType, setFormDocType] = useState<VaultDoc['doc_type']>('passport');
  const [formName, setFormName] = useState('');
  const [formExpiry, setFormExpiry] = useState('');
  const [formNotes, setFormNotes] = useState('');
  // Default to employer_only (visible to HR) — matches existing behavior; the
  // worker can switch to Private to keep a doc to themselves.
  const [formVisibility, setFormVisibility] = useState<'private' | 'employer_only'>('employer_only');
  const [formFileUri, setFormFileUri] = useState('');
  const [formFileName, setFormFileName] = useState('');
  const [formFileType, setFormFileType] = useState('');
  const [formFileMime, setFormFileMime] = useState('');

  // ── API ───────────────────────────────────────────────────────────────────

  const loadDocs = useCallback(async () => {
    if (!privateUserId) return;
    try {
      const data = await getVaultDocuments(privateUserId);
      if (data && !data.error) {
        setDocs(data.data ?? []);
      } else {
        console.warn('DocumentVault: loadDocs error', data?.error);
      }
    } catch (e) {
      console.warn('DocumentVault: loadDocs error', e);
    } finally {
      setLoading(false);
    }
  }, [privateUserId]);

  useEffect(() => {
    loadDocs();
  }, [loadDocs]);

  // ── Form reset & open ─────────────────────────────────────────────────────

  const openAddModal = () => {
    setFormDocType('passport');
    setFormName('');
    setFormExpiry('');
    setFormNotes('');
    setFormVisibility('employer_only');
    setFormFileUri('');
    setFormFileName('');
    setFormFileType('');
    setFormFileMime('');
    setShowModal(true);
  };

  // ── File picking ──────────────────────────────────────────────────────────

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (!result.canceled && result.assets?.[0]) {
      setFormFileUri(result.assets[0].uri);
      setFormFileName(result.assets[0].name);
      setFormFileMime(result.assets[0].mimeType || 'application/octet-stream');
      setFormFileType('document');
    }
  };

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (!result.canceled && result.assets?.[0]) {
      setFormFileUri(result.assets[0].uri);
      setFormFileName(result.assets[0].uri.split('/').pop() || 'image.jpg');
      setFormFileMime('image/jpeg');
      setFormFileType('image');
    }
  };

  // ── CRUD ──────────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!formName.trim()) {
      Alert.alert(t('documentVault.nameRequiredTitle'), t('documentVault.nameRequiredBody'));
      return;
    }
    setSaving(true);
    try {
      const result = await uploadVaultDocument({
        private_user_id: privateUserId,
        doc_type: formDocType,
        name: formName.trim(),
        expiry_date: formExpiry.trim() || undefined,
        notes: formNotes.trim() || undefined,
        visibility: formVisibility,
        fileUri: formFileUri || undefined,
        fileName: formFileName || undefined,
        fileMime: formFileMime || undefined,
      });
      if (result?.error) {
        Alert.alert(t('documentVault.errorTitle'), result.error || t('documentVault.errorSave'));
      } else {
        await loadDocs();
        setShowModal(false);
      }
    } catch (e) {
      Alert.alert(t('documentVault.errorTitle'), t('documentVault.errorSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (doc_id: number, name: string) => {
    Alert.alert(
      t('documentVault.deleteTitle'),
      t('documentVault.deleteConfirm', { name }),
      [
        { text: t('documentVault.cancelAction'), style: 'cancel' },
        {
          text: t('documentVault.deleteAction'),
          style: 'destructive',
          onPress: async () => {
            const result = await deleteVaultDocument(doc_id);
            if (result?.error) {
              Alert.alert(t('documentVault.errorTitle'), result.error || t('documentVault.errorDelete'));
            } else {
              await loadDocs();
            }
          },
        },
      ]
    );
  };

  const handleOpenFile = (doc: VaultDoc) => {
    // Resolve relative (local-storage) URLs to the backend origin, then view in
    // an in-app modal (no external browser). PDFs go through the pdf.js viewer
    // so they render in the WebView on Android too.
    const resolved = resolveFileUrl(doc.file_url);
    if (!resolved) return;
    const isPdf =
      (doc.file_mime || '').toLowerCase().includes('pdf') ||
      resolved.toLowerCase().split('?')[0].endsWith('.pdf');
    setViewer({ url: isPdf ? pdfViewerUrl(resolved) : resolved, title: doc.name });
  };

  // ── Derived data ──────────────────────────────────────────────────────────

  const urgentDocs = docs.filter((d) => getExpiryStatus(d.expiry_date, t).urgent);

  const groupedDocs: { typeInfo: (typeof DOC_TYPES)[number]; items: VaultDoc[] }[] = DOC_TYPES
    .map((dt) => ({ typeInfo: dt, items: docs.filter((d) => d.doc_type === dt.key) }))
    .filter((g) => g.items.length > 0);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <PremiumHeader
        title={t('documentVault.headerTitle')}
        subtitle={t('documentVault.headerSubtitle')}
        onBack={() => router.replace('/private_dashboard/settings')}
      />

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Urgent expiry banner */}
        {urgentDocs.length > 0 && !bannerDismissed && (
          <Animated.View entering={FadeIn.duration(400)}>
            <Box
              mx="$4"
              mb="$3"
              rounded="$2xl"
              style={{ backgroundColor: Palette.warningTint, borderWidth: 1, borderColor: Palette.gold }}
            >
              <HStack p="$3" alignItems="flex-start" space="sm">
                <Text style={{ fontSize: Type.h3 }}>⚠️</Text>
                <VStack flex={1}>
                  <Text style={{ fontWeight: '700', color: Palette.gold, fontSize: Type.label }}>
                    {t('documentVault.expiringSoon', { count: urgentDocs.length, plural: urgentDocs.length > 1 ? 's' : '' })}
                  </Text>
                  {urgentDocs.map((d) => (
                    <Text key={d.doc_id} style={{ color: Palette.gold, fontSize: Type.small, marginTop: 1 }}>
                      • {d.name} — {getExpiryStatus(d.expiry_date, t).label}
                    </Text>
                  ))}
                </VStack>
                <Pressable onPress={() => setBannerDismissed(true)} hitSlop={8}>
                  <MaterialIcons name="close" size={18} color={Palette.gold} />
                </Pressable>
              </HStack>
            </Box>
          </Animated.View>
        )}

        {/* Add Document button */}
        <Box px="$4" mb="$4">
          <Pressable onPress={openAddModal}>
            <LinearGradient
              colors={[Palette.blue, Palette.blue]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.addButton}
            >
              <HStack space="sm" alignItems="center" justifyContent="center">
                <MaterialIcons name="add" size={22} color={Palette.white} />
                <Text style={{ color: Palette.white, fontWeight: '700', fontSize: Type.title }}>
                  {t('documentVault.addDocument')}
                </Text>
              </HStack>
            </LinearGradient>
          </Pressable>
        </Box>

        {/* Loading */}
        {loading && (
          <Box alignItems="center" py="$10">
            <Spinner size="large" color={Palette.gold} />
          </Box>
        )}

        {/* Empty state */}
        {!loading && docs.length === 0 && (
          <Animated.View entering={FadeInUp.duration(500)}>
            <Box alignItems="center" py="$12" px="$8">
              <Box
                style={{ backgroundColor: Palette.gray100, borderRadius: 999, padding: 20, marginBottom: 16 }}
              >
                <MaterialIcons name="lock" size={48} color={Palette.gray400} />
              </Box>
              <Heading style={{ color: Palette.ink, fontSize: Type.h3, fontWeight: '700', textAlign: 'center', marginBottom: 8 }}>
                {t('documentVault.emptyTitle')}
              </Heading>
              <Text style={{ color: Palette.gray500, fontSize: Type.body, textAlign: 'center', lineHeight: 22 }}>
                {t('documentVault.emptyHint')}
              </Text>
            </Box>
          </Animated.View>
        )}

        {/* Grouped document list */}
        {!loading && groupedDocs.map(({ typeInfo, items }, groupIdx) => (
          <Animated.View key={typeInfo.key} entering={FadeInUp.duration(400).delay(groupIdx * 80)}>
            <Box px="$4" mb="$5">
              {/* Group header */}
              <HStack alignItems="center" space="xs" mb="$2" px="$1">
                <Box style={{ backgroundColor: typeInfo.color, borderRadius: 10, padding: 7 }}>
                  <MaterialIcons name={typeInfo.icon as any} size={16} color={Palette.white} />
                </Box>
                <Text style={{ fontSize: Type.small, fontWeight: '700', color: Palette.gray500, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  {docTypeLabel(typeInfo.key)}
                </Text>
                <Text style={{ fontSize: Type.small, color: Palette.gray400 }}>({items.length})</Text>
              </HStack>

              <VStack space="sm">
                {items.map((doc) => {
                  const expiry = getExpiryStatus(doc.expiry_date, t);
                  return (
                    <Pressable
                      key={doc.doc_id}
                      onLongPress={() => handleDelete(doc.doc_id, doc.name)}
                      delayLongPress={600}
                    >
                      <Box
                        style={[
                          styles.docCard,
                          { borderLeftColor: typeInfo.color, borderLeftWidth: 4 },
                        ]}
                      >
                        <HStack alignItems="flex-start" space="sm">
                          {/* Icon */}
                          <Box
                            style={{
                              backgroundColor: typeInfo.color + '15',
                              borderRadius: 10,
                              padding: 8,
                              marginTop: 2,
                            }}
                          >
                            <MaterialIcons name={typeInfo.icon as any} size={20} color={typeInfo.color} />
                          </Box>

                          {/* Details */}
                          <VStack flex={1} space="xs">
                            <Text style={{ fontWeight: '700', fontSize: Type.title, color: Palette.ink }} numberOfLines={1}>
                              {doc.name}
                            </Text>
                            <Text style={{ fontSize: Type.small, color: Palette.gray400 }}>
                              {docTypeLabel(typeInfo.key)}
                            </Text>
                            {doc.file_name && (
                              <Pressable onPress={() => handleOpenFile(doc)}>
                                <HStack alignItems="center" space="xs">
                                  <MaterialIcons
                                    name={doc.file_mime?.startsWith('image/') ? 'image' : 'attach-file'}
                                    size={13}
                                    color={Palette.blue}
                                  />
                                  <Text
                                    style={{ fontSize: Type.caption, color: Palette.blue, fontWeight: '600' }}
                                    numberOfLines={1}
                                  >
                                    {doc.file_name}
                                  </Text>
                                </HStack>
                              </Pressable>
                            )}
                            {doc.notes && (
                              <Text
                                style={{ fontSize: Type.small, color: Palette.gray400, fontStyle: 'italic' }}
                                numberOfLines={2}
                              >
                                {doc.notes}
                              </Text>
                            )}
                          </VStack>

                          {/* Expiry badge */}
                          <Box
                            style={{
                              backgroundColor: expiry.bg,
                              borderRadius: 8,
                              paddingHorizontal: 8,
                              paddingVertical: 4,
                              alignSelf: 'flex-start',
                            }}
                          >
                            <Text style={{ fontSize: Type.small, fontWeight: '700', color: expiry.color }}>
                              {expiry.label}
                            </Text>
                          </Box>
                        </HStack>
                      </Box>
                    </Pressable>
                  );
                })}
              </VStack>
            </Box>
          </Animated.View>
        ))}

        <Box h={40} />
      </ScrollView>

      {/* ── Add Document Modal (native page sheet) ──────────────────────────── */}
      <RNModal
        visible={showModal}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setShowModal(false)}
      >
        <View style={{ flex: 1, backgroundColor: Palette.white, paddingTop: insets.top, paddingBottom: insets.bottom }}>
          {/* Header */}
          <Box px="$5" py="$4" borderBottomWidth={1} borderBottomColor={Palette.gray100} style={{ backgroundColor: Palette.white }}>
            <HStack alignItems="center" space="sm" justifyContent="space-between">
              <HStack alignItems="center" space="sm">
                <Box style={{ backgroundColor: Palette.blue, borderRadius: 10, padding: 7 }}>
                  <MaterialIcons name="add-circle" size={16} color={Palette.white} />
                </Box>
                <Heading style={{ fontSize: Type.h3, fontWeight: '700', color: Palette.ink }}>
                  {t('documentVault.modalTitle')}
                </Heading>
              </HStack>
              <Pressable
                onPress={() => setShowModal(false)}
                style={{ backgroundColor: Palette.gray100, borderRadius: 20, padding: 6 }}
                hitSlop={8}
              >
                <MaterialIcons name="close" size={18} color={Palette.gray500} />
              </Pressable>
            </HStack>
          </Box>

          {/* Body */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={{ flex: 1 }}
          >
            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 }}
            >
              <VStack space="lg">

                {/* Doc type selector */}
                <VStack space="sm">
                  <Text style={styles.label}>{t('documentVault.fieldDocumentType')}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {DOC_TYPES.map((dt) => {
                      const selected = formDocType === dt.key;
                      return (
                        <Pressable
                          key={dt.key}
                          onPress={() => setFormDocType(dt.key as VaultDoc['doc_type'])}
                        >
                          <Box
                            style={[
                              styles.typeChip,
                              {
                                backgroundColor: selected ? dt.color : Palette.gray50,
                                borderColor: selected ? dt.color : Palette.gray200,
                              },
                            ]}
                          >
                            <HStack alignItems="center" space="xs">
                              <MaterialIcons
                                name={selected ? 'check-circle' : (dt.icon as any)}
                                size={14}
                                color={selected ? Palette.white : dt.color}
                              />
                              <Text
                                style={{
                                  fontSize: Type.label,
                                  fontWeight: '600',
                                  color: selected ? Palette.white : Palette.gray700,
                                }}
                              >
                                {docTypeLabel(dt.key)}
                              </Text>
                            </HStack>
                          </Box>
                        </Pressable>
                      );
                    })}
                  </View>
                </VStack>

                {/* Visibility selector — who can see this document */}
                <VStack space="sm">
                  <Text style={styles.label}>{t('documentVault.fieldVisibility')}</Text>
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    {([
                      { key: 'private' as const, label: t('documentVault.visibilityPrivate'), icon: 'lock' },
                      { key: 'employer_only' as const, label: t('documentVault.visibilityShared'), icon: 'business' },
                    ]).map((opt) => {
                      const selected = formVisibility === opt.key;
                      return (
                        <Pressable key={opt.key} onPress={() => setFormVisibility(opt.key)} style={{ flex: 1 }}>
                          <Box style={[styles.typeChip, { backgroundColor: selected ? Palette.blue : Palette.gray50, borderColor: selected ? Palette.blue : Palette.gray200, justifyContent: 'center' }]}>
                            <HStack alignItems="center" space="xs" justifyContent="center">
                              <MaterialIcons name={selected ? 'check-circle' : (opt.icon as any)} size={14} color={selected ? Palette.white : Palette.gray700} />
                              <Text style={{ fontSize: Type.label, fontWeight: '600', color: selected ? Palette.white : Palette.gray700 }}>{opt.label}</Text>
                            </HStack>
                          </Box>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={{ fontSize: Type.tiny, color: Palette.gray400 }}>{t('documentVault.visibilityHint')}</Text>
                </VStack>

                {/* Name input */}
                <VStack space="xs">
                  <HStack alignItems="center" space="xs">
                    <Text style={styles.label}>{t('documentVault.fieldDocumentName')}</Text>
                    <Text style={{ fontSize: Type.label, fontWeight: '700', color: Palette.errorAlt }}>*</Text>
                  </HStack>
                  <Input
                    variant="outline"
                    size="md"
                    borderColor={Palette.gray200}
                    borderRadius="$xl"
                  >
                    <InputSlot pl="$3">
                      <MaterialIcons name="description" size={16} color={Palette.gray400} />
                    </InputSlot>
                    <InputField
                      placeholder={t('documentVault.namePlaceholder')}
                      value={formName}
                      onChangeText={setFormName}
                      autoCapitalize="words"
                    />
                  </Input>
                </VStack>

                {/* Expiry date input */}
                <VStack space="xs">
                  <Text style={styles.label}>{t('documentVault.fieldExpiryDate')} <Text style={{ fontWeight: '400', color: Palette.gray400 }}>{t('documentVault.optional')}</Text></Text>
                  <Input
                    variant="outline"
                    size="md"
                    borderColor={Palette.gray200}
                    borderRadius="$xl"
                  >
                    <InputSlot pl="$3">
                      <MaterialIcons name="calendar-today" size={16} color={Palette.gray400} />
                    </InputSlot>
                    <InputField
                      placeholder={t('documentVault.expiryPlaceholder')}
                      value={formExpiry}
                      onChangeText={(text) => {
                        // Auto-insert dashes: 2025- and 2025-12-
                        const digits = text.replace(/[^0-9]/g, '');
                        let formatted = digits;
                        if (digits.length > 4) formatted = digits.slice(0, 4) + '-' + digits.slice(4);
                        if (digits.length > 6) formatted = digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8);
                        setFormExpiry(formatted);
                      }}
                      keyboardType="numeric"
                      maxLength={10}
                    />
                  </Input>
                  <Text style={{ fontSize: Type.caption, color: Palette.gray400, marginTop: 4 }}>
                    {t('documentVault.expiryHint')}
                  </Text>
                </VStack>

                {/* Notes input */}
                <VStack space="xs">
                  <Text style={styles.label}>{t('documentVault.fieldNotes')} <Text style={{ fontWeight: '400', color: Palette.gray400 }}>{t('documentVault.optional')}</Text></Text>
                  <Input
                    variant="outline"
                    size="md"
                    borderColor={Palette.gray200}
                    borderRadius="$xl"
                    style={{ alignItems: 'flex-start', height: 'auto', minHeight: 92 }}
                  >
                    <InputSlot pl="$3" style={{ paddingTop: 12 }}>
                      <MaterialIcons name="notes" size={16} color={Palette.gray400} />
                    </InputSlot>
                    <InputField
                      placeholder={t('documentVault.notesPlaceholder')}
                      value={formNotes}
                      onChangeText={setFormNotes}
                      multiline
                      numberOfLines={3}
                      style={{ minHeight: 80, textAlignVertical: 'top', paddingTop: 10, paddingBottom: 10 }}
                    />
                  </Input>
                </VStack>

                {/* Attach file row */}
                <VStack space="sm">
                  <Text style={styles.label}>{t('documentVault.fieldAttachFile')} <Text style={{ fontWeight: '400', color: Palette.gray400 }}>{t('documentVault.optional')}</Text></Text>
                  <HStack space="sm">
                    <Pressable style={{ flex: 1 }} onPress={pickDocument}>
                      <Box
                        style={[
                          styles.attachBtn,
                          { borderColor: Palette.blue, backgroundColor: Palette.blueTint },
                        ]}
                      >
                        <VStack alignItems="center" space="xs">
                          <MaterialIcons name="upload-file" size={20} color={Palette.blue} />
                          <Text style={{ fontSize: Type.small, fontWeight: '600', color: Palette.blue }}>
                            {t('documentVault.pickDocument')}
                          </Text>
                        </VStack>
                      </Box>
                    </Pressable>

                    <Pressable style={{ flex: 1 }} onPress={pickImage}>
                      <Box
                        style={[
                          styles.attachBtn,
                          { borderColor: Palette.success, backgroundColor: Palette.greenTint },
                        ]}
                      >
                        <VStack alignItems="center" space="xs">
                          <MaterialIcons name="add-a-photo" size={20} color={Palette.success} />
                          <Text style={{ fontSize: Type.small, fontWeight: '600', color: Palette.success }}>
                            {t('documentVault.takePickPhoto')}
                          </Text>
                        </VStack>
                      </Box>
                    </Pressable>
                  </HStack>

                  {!!formFileName && (
                    <HStack
                      alignItems="center"
                      space="xs"
                      style={{
                        backgroundColor: Palette.gray50,
                        borderRadius: 10,
                        padding: 10,
                        borderWidth: 1,
                        borderColor: Palette.gray200,
                      }}
                    >
                      <MaterialIcons
                        name={formFileType === 'image' ? 'image' : 'attach-file'}
                        size={16}
                        color={Palette.blue}
                      />
                      <Text
                        style={{ fontSize: Type.small, color: Palette.blue, fontWeight: '600', flex: 1 }}
                        numberOfLines={1}
                      >
                        {formFileName}
                      </Text>
                      <Pressable onPress={() => { setFormFileUri(''); setFormFileName(''); setFormFileType(''); setFormFileMime(''); }}>
                        <MaterialIcons name="close" size={16} color={Palette.gray400} />
                      </Pressable>
                    </HStack>
                  )}
                </VStack>

              </VStack>
            </ScrollView>
          </KeyboardAvoidingView>

          {/* Footer */}
          <Box px="$5" py="$4" borderTopWidth={1} borderTopColor={Palette.gray100} style={{ backgroundColor: Palette.white }}>
            <HStack space="sm">
              <Button
                flex={1}
                h={52}
                variant="outline"
                borderColor={Palette.gray200}
                rounded="$xl"
                onPress={() => setShowModal(false)}
                isDisabled={saving}
              >
                <ButtonText style={{ color: Palette.gray500, fontWeight: '600' }}>{t('documentVault.cancelAction')}</ButtonText>
              </Button>

              <Pressable style={{ flex: 1 }} onPress={handleSave} disabled={saving}>
                <LinearGradient
                  colors={[Palette.blue, Palette.blue]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.saveButton}
                >
                  {saving ? (
                    <Spinner size="small" color={Palette.white} />
                  ) : (
                    <Text style={{ color: Palette.white, fontWeight: '700', fontSize: Type.title }}>{t('documentVault.saveAction')}</Text>
                  )}
                </LinearGradient>
              </Pressable>
            </HStack>
          </Box>
        </View>
      </RNModal>

      <DocViewerModal
        visible={!!viewer}
        url={viewer?.url ?? null}
        title={viewer?.title}
        onClose={() => setViewer(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Palette.gray50,
  },
  scrollContent: {
    paddingTop: 12,
    paddingBottom: 40,
  },
  addButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 16,
    shadowColor: Palette.blue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  docCard: {
    backgroundColor: Palette.white,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: Palette.gray100,
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
  },
  label: {
    fontSize: Type.label,
    fontWeight: '700',
    color: Palette.gray700,
    marginBottom: 2,
  },
  typeChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1.5,
  },
  attachBtn: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveButton: {
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Palette.blue,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
});
