import React, { useState, useEffect, useCallback } from 'react';
import PermissionGate from '@/components/PermissionGate';
import { Palette, Type } from '@/app/constants/theme';
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
  Avatar,
  AvatarFallbackText,
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
import { useTranslation } from 'react-i18next';
import useAuth from '../hooks/useAuth';
import { format, differenceInDays, parseISO, isValid } from 'date-fns';
import {
  getUsersByCompany,
  uploadVaultDocument,
  getVaultDocuments,
  deleteVaultDocument,
  resolveFileUrl,
  pdfViewerUrl,
} from '@/services/api';

// ─── Types ────────────────────────────────────────────────────────────────────

type Employee = {
  user_id: number;
  email: string;
  private_user?: {
    private_user_id: number;
    first_name: string;
    last_name: string;
  };
};

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

function getExpiryStatus(expiry_date: string | undefined, t: (k: string, o?: any) => string) {
  const noExpiry = t('companyDashboard.docNoExpiry');
  const daysLeft = (d: number) => t('companyDashboard.docDaysLeft', { days: d });
  if (!expiry_date) return { label: noExpiry, color: Palette.gray500, bg: Palette.gray100, urgent: false };
  const parsed = parseISO(expiry_date);
  if (!isValid(parsed)) return { label: noExpiry, color: Palette.gray500, bg: Palette.gray100, urgent: false };
  const days = differenceInDays(parsed, new Date());
  if (days < 0)    return { label: t('companyDashboard.docExpired'), color: Palette.error, bg: Palette.errorTint, urgent: true };
  if (days <= 30)  return { label: daysLeft(days),  color: Palette.error, bg: Palette.errorTint, urgent: true };
  if (days <= 60)  return { label: daysLeft(days),  color: Palette.gold, bg: Palette.warningTint, urgent: false };
  if (days <= 90)  return { label: daysLeft(days),  color: Palette.gold, bg: Palette.warningTint, urgent: false };
  return { label: format(parsed, 'MMM d, yyyy'), color: Palette.success, bg: Palette.successTint, urgent: false };
}

function getDocTypeInfo(key: string) {
  return DOC_TYPES.find((d) => d.key === key) ?? DOC_TYPES[DOC_TYPES.length - 1];
}

function getInitials(first?: string, last?: string) {
  return `${first?.charAt(0) ?? ''}${last?.charAt(0) ?? ''}`.toUpperCase() || 'E';
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function CompanyDocumentVault() {
  return (
    <PermissionGate permission="view_documents" label="documents">
      <CompanyDocumentVaultInner />
    </PermissionGate>
  );
}

function CompanyDocumentVaultInner() {
  const router = useRouter();
  const { t } = useTranslation();
  const docTypeLabel = (key: string) => {
    switch (key) {
      case 'passport': return t('companyDashboard.docTypePassport');
      case 'work_permit': return t('companyDashboard.docTypeWorkPermit');
      case 'contract': return t('companyDashboard.docTypeContract');
      case 'pay_stub': return t('companyDashboard.docTypePayStub');
      case 'id_card': return t('companyDashboard.docTypeIdCard');
      default: return t('companyDashboard.docTypeOther');
    }
  };
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  // Include the private_user.company_id fallback so delegated role-holders
  // (HR Manager etc.) — who have user.company = null but a private_user
  // company — resolve a company id instead of stalling on the loader.
  const companyId: number = (user as any)?.company?.company_id
    ?? (user as any)?.company?.id
    ?? (user as any)?.company_id
    ?? (user as any)?.private_user?.company_id;

  // Employee list state
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loadingEmployees, setLoadingEmployees] = useState(true);
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);

  // Docs state
  const [docs, setDocs] = useState<VaultDoc[]>([]);
  const [viewer, setViewer] = useState<{ url: string; title: string } | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [formDocType, setFormDocType] = useState<VaultDoc['doc_type']>('contract');
  const [formName, setFormName] = useState('');
  const [formExpiry, setFormExpiry] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formFileUri, setFormFileUri] = useState('');
  const [formFileName, setFormFileName] = useState('');
  const [formFileType, setFormFileType] = useState('');
  const [formFileMime, setFormFileMime] = useState('');

  // ── Load employees ────────────────────────────────────────────────────────

  const loadEmployees = useCallback(async () => {
    // Defensive: never leave the spinner spinning if we can't resolve a company.
    if (!companyId) { setLoadingEmployees(false); return; }
    setLoadingEmployees(true);
    try {
      const data = await getUsersByCompany(companyId);
      if (Array.isArray(data)) {
        const withPrivateUser = data.filter((u) => u.private_user?.private_user_id);
        setEmployees(withPrivateUser);
        setSelectedEmployee((prev) => prev ?? (withPrivateUser[0] ?? null));
      }
    } catch {
      console.warn('CompanyDocVault: loadEmployees error');
    } finally {
      setLoadingEmployees(false);
    }
  }, [companyId]);

  useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  // ── Load docs for selected employee ──────────────────────────────────────

  const loadDocs = useCallback(async () => {
    const pid = selectedEmployee?.private_user?.private_user_id;
    if (!pid) return;
    setLoadingDocs(true);
    try {
      const data = await getVaultDocuments(pid);
      if (data && !data.error) {
        setDocs(data.data ?? []);
      } else {
        setDocs([]);
      }
    } catch {
      setDocs([]);
    } finally {
      setLoadingDocs(false);
    }
  }, [selectedEmployee]);

  useEffect(() => {
    setDocs([]);
    loadDocs();
  }, [loadDocs]);

  // ── Form helpers ──────────────────────────────────────────────────────────

  const openAddModal = () => {
    setFormDocType('contract');
    setFormName('');
    setFormExpiry('');
    setFormNotes('');
    setFormFileUri('');
    setFormFileName('');
    setFormFileType('');
    setFormFileMime('');
    setShowModal(true);
  };

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
      Alert.alert(t('companyDashboard.docNameRequiredTitle'), t('companyDashboard.docNameRequiredBody'));
      return;
    }
    const pid = selectedEmployee?.private_user?.private_user_id;
    if (!pid) return;

    setSaving(true);
    try {
      const result = await uploadVaultDocument({
        private_user_id: pid,
        doc_type: formDocType,
        name: formName.trim(),
        expiry_date: formExpiry.trim() || undefined,
        notes: formNotes.trim() || undefined,
        fileUri: formFileUri || undefined,
        fileName: formFileName || undefined,
        fileMime: formFileMime || undefined,
      });
      if (result?.error) {
        Alert.alert(t('common.errorTitle'), result.error || t('companyDashboard.docCouldNotSave'));
      } else {
        await loadDocs();
        setShowModal(false);
      }
    } catch {
      Alert.alert(t('common.errorTitle'), t('companyDashboard.docCouldNotSaveRetry'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (doc_id: number, name: string) => {
    Alert.alert(t('companyDashboard.docDeleteTitle'), t('companyDashboard.docDeleteBody', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const result = await deleteVaultDocument(doc_id);
          if (result?.error) {
            Alert.alert(t('common.errorTitle'), result.error || t('companyDashboard.docCouldNotDelete'));
          } else {
            await loadDocs();
          }
        },
      },
    ]);
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

  // ── Derived ───────────────────────────────────────────────────────────────

  const urgentDocs = docs.filter((d) => getExpiryStatus(d.expiry_date, t).urgent);
  const groupedDocs = DOC_TYPES
    .map((dt) => ({ typeInfo: dt, items: docs.filter((d) => d.doc_type === dt.key) }))
    .filter((g) => g.items.length > 0);

  const selectedName = selectedEmployee
    ? `${selectedEmployee.private_user?.first_name ?? ''} ${selectedEmployee.private_user?.last_name ?? ''}`.trim()
    : '';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <PremiumHeader
        title={t('companyDashboard.docsTitle')}
        subtitle={t('companyDashboard.docsSubtitle')}
        onBack={() => router.replace('/company_dashboard/settings')}
      />

      {/* Employee picker strip */}
      <Box style={styles.employeeStrip}>
        {loadingEmployees ? (
          <Box flex={1} alignItems="center" justifyContent="center">
            <Spinner size="small" color={Palette.blue} />
          </Box>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10, paddingVertical: 8 }}>
            {employees.map((emp) => {
              const isSelected = selectedEmployee?.user_id === emp.user_id;
              const initials = getInitials(emp.private_user?.first_name, emp.private_user?.last_name);
              const fullName = `${emp.private_user?.first_name ?? ''} ${emp.private_user?.last_name ?? ''}`.trim();
              return (
                <Pressable key={emp.user_id} onPress={() => setSelectedEmployee(emp)}>
                  <VStack alignItems="center" space="xs" style={{ width: 64 }}>
                    <Box style={[
                      styles.avatarRing,
                      isSelected && { borderColor: Palette.blue, borderWidth: 2.5 },
                    ]}>
                      <Avatar size="md" style={{ backgroundColor: isSelected ? Palette.blueTint : Palette.gray100 }}>
                        <AvatarFallbackText style={{ color: isSelected ? Palette.blue : Palette.gray500, fontWeight: '700', fontSize: Type.body }}>
                          {initials}
                        </AvatarFallbackText>
                      </Avatar>
                    </Box>
                    <Text
                      style={{
                        fontSize: Type.tiny,
                        fontWeight: isSelected ? '700' : '500',
                        color: isSelected ? Palette.blue : Palette.gray500,
                        textAlign: 'center',
                      }}
                      numberOfLines={2}
                    >
                      {fullName}
                    </Text>
                  </VStack>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </Box>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* Selected employee header + add button */}
        {selectedEmployee && (
          <Animated.View entering={FadeIn.duration(300)}>
            <HStack px="$4" mb="$3" alignItems="center" justifyContent="space-between">
              <VStack>
                <Text style={{ fontSize: Type.small, color: Palette.gray400, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {t('companyDashboard.docViewingVault')}
                </Text>
                <Text style={{ fontSize: Type.h2, fontWeight: '800', color: Palette.ink, letterSpacing: -0.5 }}>
                  {selectedName}
                </Text>
              </VStack>
              <Pressable onPress={openAddModal}>
                <LinearGradient
                  colors={[Palette.blue, Palette.blue]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.addButton}
                >
                  <HStack space="xs" alignItems="center">
                    <MaterialIcons name="add" size={18} color={Palette.white} />
                    <Text style={{ color: Palette.white, fontWeight: '700', fontSize: Type.label }}>{t('companyDashboard.docAddDoc')}</Text>
                  </HStack>
                </LinearGradient>
              </Pressable>
            </HStack>
          </Animated.View>
        )}

        {/* Urgent expiry banner */}
        {urgentDocs.length > 0 && (
          <Animated.View entering={FadeIn.duration(400)}>
            <Box mx="$4" mb="$3" rounded="$2xl" style={{ backgroundColor: Palette.warningTint, borderWidth: 1, borderColor: Palette.gold }}>
              <HStack p="$3" alignItems="flex-start" space="sm">
                <Text style={{ fontSize: Type.h3 }}>⚠️</Text>
                <VStack flex={1}>
                  <Text style={{ fontWeight: '700', color: Palette.gold, fontSize: Type.label }}>
                    {t(urgentDocs.length === 1 ? 'companyDashboard.docExpiringSoonOne' : 'companyDashboard.docExpiringSoonOther', { count: urgentDocs.length })}
                  </Text>
                  {urgentDocs.map((d) => (
                    <Text key={d.doc_id} style={{ color: Palette.gold, fontSize: Type.small, marginTop: 1 }}>
                      • {d.name} — {getExpiryStatus(d.expiry_date, t).label}
                    </Text>
                  ))}
                </VStack>
              </HStack>
            </Box>
          </Animated.View>
        )}

        {/* Loading docs */}
        {loadingDocs && (
          <Box alignItems="center" py="$10">
            <Spinner size="large" color={Palette.blue} />
          </Box>
        )}

        {/* Empty state */}
        {!loadingDocs && selectedEmployee && docs.length === 0 && (
          <Animated.View entering={FadeInUp.duration(400)}>
            <Box alignItems="center" py="$10" px="$8">
              <Box style={{ backgroundColor: Palette.blueTint, borderRadius: 999, padding: 18, marginBottom: 14 }}>
                <MaterialIcons name="folder-open" size={40} color={Palette.blue} />
              </Box>
              <Heading style={{ color: Palette.ink, fontSize: Type.h3, fontWeight: '700', textAlign: 'center', marginBottom: 6 }}>
                {t('companyDashboard.docNoneTitle')}
              </Heading>
              <Text style={{ color: Palette.gray500, fontSize: Type.label, textAlign: 'center', lineHeight: 20 }}>
                {t('companyDashboard.docNoneBody', { name: selectedName })}
              </Text>
            </Box>
          </Animated.View>
        )}

        {/* No employee selected */}
        {!loadingEmployees && !selectedEmployee && (
          <Box alignItems="center" py="$10" px="$8">
            <Text style={{ color: Palette.gray500, fontSize: Type.body, textAlign: 'center' }}>
              {t('companyDashboard.docSelectEmployee')}
            </Text>
          </Box>
        )}

        {/* Grouped doc list */}
        {!loadingDocs && groupedDocs.map(({ typeInfo, items }, groupIdx) => (
          <Animated.View key={typeInfo.key} entering={FadeInUp.duration(400).delay(groupIdx * 60)}>
            <Box px="$4" mb="$5">
              <HStack alignItems="center" space="xs" mb="$2" px="$1">
                <Box style={{ backgroundColor: typeInfo.color + '20', borderRadius: 8, padding: 4 }}>
                  <MaterialIcons name={typeInfo.icon as any} size={13} color={typeInfo.color} />
                </Box>
                <Text style={{ fontSize: Type.caption, fontWeight: '700', color: Palette.gray500, textTransform: 'uppercase', letterSpacing: 0.8 }}>
                  {docTypeLabel(typeInfo.key)}
                </Text>
                <Text style={{ fontSize: Type.caption, color: Palette.gray400 }}>({items.length})</Text>
              </HStack>

              <VStack space="sm">
                {items.map((doc) => {
                  const expiry = getExpiryStatus(doc.expiry_date, t);
                  const ti = getDocTypeInfo(doc.doc_type);
                  return (
                    <Pressable
                      key={doc.doc_id}
                      onLongPress={() => handleDelete(doc.doc_id, doc.name)}
                      delayLongPress={600}
                    >
                      <Box style={[styles.docCard, { borderLeftColor: ti.color, borderLeftWidth: 4 }]}>
                        <HStack alignItems="flex-start" space="sm">
                          <Box style={{ backgroundColor: ti.color + '15', borderRadius: 10, padding: 8, marginTop: 2 }}>
                            <MaterialIcons name={ti.icon as any} size={18} color={ti.color} />
                          </Box>
                          <VStack flex={1} space="xs">
                            <Text style={{ fontWeight: '700', fontSize: Type.body, color: Palette.ink }} numberOfLines={1}>
                              {doc.name}
                            </Text>
                            <Text style={{ fontSize: Type.small, color: Palette.gray400 }}>{docTypeLabel(ti.key)}</Text>
                            {doc.file_name && (
                              <Pressable onPress={() => handleOpenFile(doc)}>
                                <HStack alignItems="center" space="xs">
                                  <MaterialIcons
                                    name={doc.file_mime?.startsWith('image/') ? 'image' : 'attach-file'}
                                    size={12}
                                    color={Palette.blue}
                                  />
                                  <Text style={{ fontSize: Type.caption, color: Palette.blue, fontWeight: '600' }} numberOfLines={1}>
                                    {doc.file_name}
                                  </Text>
                                </HStack>
                              </Pressable>
                            )}
                            {doc.notes && (
                              <Text style={{ fontSize: Type.caption, color: Palette.gray400, fontStyle: 'italic' }} numberOfLines={2}>
                                {doc.notes}
                              </Text>
                            )}
                          </VStack>
                          <Box style={{ backgroundColor: expiry.bg, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start' }}>
                            <Text style={{ fontSize: Type.tiny, fontWeight: '700', color: expiry.color }}>{expiry.label}</Text>
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
        <View style={{ flex: 1, backgroundColor: Palette.white, paddingBottom: insets.bottom }}>
          <LinearGradient
            colors={[Palette.blue, Palette.blue]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 16, paddingTop: 18, paddingBottom: 20 }}
          >
            <HStack alignItems="center" space="sm" justifyContent="space-between">
              <HStack alignItems="center" space="sm" flex={1}>
                <Box bg="rgba(255,255,255,0.2)" style={{ padding: 10, borderRadius: 14 }}>
                  <MaterialIcons name="upload-file" size={22} color={Palette.white} />
                </Box>
                <VStack>
                  <Text style={{ fontSize: Type.caption, fontWeight: '700', color: 'rgba(255,255,255,0.8)', textTransform: 'uppercase' }}>{t('companyDashboard.docVaultEyebrow')}</Text>
                  <Heading style={{ fontSize: Type.h3, fontWeight: '900', color: Palette.white }}>{t('companyDashboard.docAddDocument')}</Heading>
                  {!!selectedName && <Text style={{ fontSize: Type.small, color: 'rgba(255,255,255,0.7)', fontWeight: '500' }}>{t('companyDashboard.docForName', { name: selectedName })}</Text>}
                </VStack>
              </HStack>
              <Pressable onPress={() => setShowModal(false)} hitSlop={8}>
                <Box bg="rgba(255,255,255,0.2)" style={{ padding: 8, borderRadius: 20 }}>
                  <MaterialIcons name="close" size={20} color={Palette.white} />
                </Box>
              </Pressable>
            </HStack>
          </LinearGradient>

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

                {/* Doc type */}
                <VStack space="sm">
                  <Text style={styles.label}>{t('companyDashboard.docDocumentType')}</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                    {DOC_TYPES.map((dt) => {
                      const selected = formDocType === dt.key;
                      return (
                        <Pressable key={dt.key} onPress={() => setFormDocType(dt.key as VaultDoc['doc_type'])}>
                          <Box style={[styles.typeChip, { backgroundColor: selected ? dt.color : Palette.gray50, borderColor: selected ? dt.color : Palette.gray200 }]}>
                            <HStack alignItems="center" space="xs">
                              <MaterialIcons name={selected ? 'check-circle' : (dt.icon as any)} size={13} color={selected ? Palette.white : dt.color} />
                              <Text style={{ fontSize: Type.small, fontWeight: '600', color: selected ? Palette.white : Palette.gray700 }}>{docTypeLabel(dt.key)}</Text>
                            </HStack>
                          </Box>
                        </Pressable>
                      );
                    })}
                  </View>
                </VStack>

                {/* Name */}
                <VStack space="xs">
                  <HStack alignItems="center" space="xs">
                    <Text style={styles.label}>{t('companyDashboard.docDocumentName')}</Text>
                    <Text style={{ fontSize: Type.label, fontWeight: '700', color: Palette.errorAlt }}>*</Text>
                  </HStack>
                  <Input variant="outline" size="md" borderColor={Palette.gray200} borderRadius="$xl">
                    <InputSlot pl="$3">
                      <MaterialIcons name="description" size={16} color={Palette.gray400} />
                    </InputSlot>
                    <InputField placeholder={t('companyDashboard.docNamePlaceholder')} value={formName} onChangeText={setFormName} autoCapitalize="words" />
                  </Input>
                </VStack>

                {/* Expiry */}
                <VStack space="xs">
                  <Text style={styles.label}>{t('companyDashboard.docExpiryDate')} <Text style={{ fontWeight: '400', color: Palette.gray400 }}>{t('companyDashboard.docOptional')}</Text></Text>
                  <Input variant="outline" size="md" borderColor={Palette.gray200} borderRadius="$xl">
                    <InputSlot pl="$3">
                      <MaterialIcons name="calendar-today" size={16} color={Palette.gray400} />
                    </InputSlot>
                    <InputField
                      placeholder={t('companyDashboard.docExpiryPlaceholder')}
                      value={formExpiry}
                      onChangeText={(text) => {
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
                  <Text style={{ fontSize: Type.caption, color: Palette.gray400 }}>{t('companyDashboard.docExpiryFormat')}</Text>
                </VStack>

                {/* Notes */}
                <VStack space="xs">
                  <Text style={styles.label}>{t('companyDashboard.docNotes')} <Text style={{ fontWeight: '400', color: Palette.gray400 }}>{t('companyDashboard.docOptional')}</Text></Text>
                  <Input variant="outline" size="md" borderColor={Palette.gray200} borderRadius="$xl" style={{ alignItems: 'flex-start', height: 'auto', minHeight: 92 }}>
                    <InputSlot pl="$3" style={{ paddingTop: 12 }}>
                      <MaterialIcons name="notes" size={16} color={Palette.gray400} />
                    </InputSlot>
                    <InputField
                      placeholder={t('companyDashboard.docNotesPlaceholder')}
                      value={formNotes}
                      onChangeText={setFormNotes}
                      multiline
                      numberOfLines={3}
                      style={{ minHeight: 80, textAlignVertical: 'top', paddingTop: 10, paddingBottom: 10 }}
                    />
                  </Input>
                </VStack>

                {/* Attach file */}
                <VStack space="sm">
                  <Text style={styles.label}>{t('companyDashboard.docAttachFile')} <Text style={{ fontWeight: '400', color: Palette.gray400 }}>{t('companyDashboard.docOptional')}</Text></Text>
                  <HStack space="sm">
                    <Pressable style={{ flex: 1 }} onPress={pickDocument}>
                      <Box style={[styles.attachBtn, { borderColor: Palette.blue, backgroundColor: Palette.blueTint }]}>
                        <VStack alignItems="center" space="xs">
                          <MaterialIcons name="upload-file" size={20} color={Palette.blue} />
                          <Text style={{ fontSize: Type.small, fontWeight: '600', color: Palette.blue }}>{t('companyDashboard.docPickDocument')}</Text>
                        </VStack>
                      </Box>
                    </Pressable>
                    <Pressable style={{ flex: 1 }} onPress={pickImage}>
                      <Box style={[styles.attachBtn, { borderColor: Palette.success, backgroundColor: Palette.greenTint }]}>
                        <VStack alignItems="center" space="xs">
                          <MaterialIcons name="add-a-photo" size={20} color={Palette.success} />
                          <Text style={{ fontSize: Type.small, fontWeight: '600', color: Palette.success }}>{t('companyDashboard.docTakePhoto')}</Text>
                        </VStack>
                      </Box>
                    </Pressable>
                  </HStack>

                  {!!formFileName && (
                    <HStack alignItems="center" space="xs" style={{ backgroundColor: Palette.gray50, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: Palette.gray200 }}>
                      <MaterialIcons name={formFileType === 'image' ? 'image' : 'attach-file'} size={16} color={Palette.blue} />
                      <Text style={{ fontSize: Type.small, color: Palette.blue, fontWeight: '600', flex: 1 }} numberOfLines={1}>{formFileName}</Text>
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
          <Box bg="white" px="$5" py="$4" borderTopWidth={1} borderTopColor={Palette.gray100}>
            <HStack space="sm">
              <Button flex={1} h={52} variant="outline" borderColor={Palette.gray200} rounded="$xl" onPress={() => setShowModal(false)} isDisabled={saving}>
                <ButtonText style={{ color: Palette.gray500, fontWeight: '600' }}>{t('common.cancel')}</ButtonText>
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
                    <Text style={{ color: Palette.white, fontWeight: '700', fontSize: Type.title }}>{t('companyDashboard.docSave')}</Text>
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
  employeeStrip: {
    height: 90,
    backgroundColor: Palette.white,
    borderBottomWidth: 1,
    borderBottomColor: Palette.gray100,
  },
  avatarRing: {
    borderRadius: 999,
    borderWidth: 2,
    borderColor: 'transparent',
    padding: 1,
  },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: 40,
  },
  addButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    shadowColor: Palette.blue,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 4,
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
    paddingHorizontal: 11,
    paddingVertical: 7,
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
