import { MaterialIcons } from '@expo/vector-icons';
import { Palette, Type } from '@/app/constants/theme';
import {
  Badge,
  BadgeText,
  Box,
  Heading,
  HStack,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Pressable,
  ScrollView,
  Select,
  SelectBackdrop,
  SelectContent,
  SelectIcon,
  SelectInput,
  SelectItem,
  SelectPortal,
  SelectTrigger,
  Spinner,
  Text,
  useToast,
  VStack,
  ChevronDownIcon,
  CloseIcon,
  Toast,
  ToastTitle,
  ToastDescription,
  VStack as ToastVStack,
  Center,
} from '@gluestack-ui/themed';
import { BlurView } from 'expo-blur';
import { PremiumHeader } from '@/components/PremiumHeader';
import React, { useEffect, useMemo, useState } from 'react';
import { Dimensions, Image, Linking, Modal as RNModal, RefreshControl, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { MotiView } from 'moti';
import {
  History,
  CheckCircle2,
  AlertTriangle,
  Clock as ClockIcon,
  FileText,
  Plus
} from 'lucide-react-native';
import useAuth from '../hooks/useAuth';
import { getUserRightHistory, getOwnerThread, ConcernMessage, resolveFileUrl } from '@/services/api';
import { StandardButton } from '../design-system';

const { width, height: SCREEN_HEIGHT } = Dimensions.get('window');

/** True when a stored file URL points at an image we can preview inline. */
const isImageUrl = (url?: string | null): boolean =>
  !!url && /\.(png|jpe?g|gif|webp|heic|bmp)(\?.*)?$/i.test(url);

interface YourRightHistory {
  right_id: number;
  private_user_id: number;
  title: string;
  issue_description: string;
  category: string;
  status: string;
  urgency_level: 'low' | 'medium' | 'high' | 'urgent';
  created_at: string;
  updated_at: string;
  contact_method: string;
  expected_outcome: string;
  // M3 — surface routing + anonymity in the history view so reporters
  // know whether they're hearing from their employer or Kiruko.
  channel: 'internal' | 'external';
  is_anonymous: boolean;
  escalated_to_external_at?: string | null;
  // M8 closeout #25 — surface the attachment scan outcome on the
  // history details modal so reporters get parity with the web handler UI.
  attachment_url?: string | null;
  attachment_scan_result?: string | null;
}

const YourRightHistoryScreen = () => {
  const { user } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const [yourRightHistory, setYourRightHistory] = useState<YourRightHistory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFilter, setSelectedFilter] = useState<'all' | 'submitted' | 'pending' | 'in_progress' | 'resolved' | 'rejected'>('all');
  // Client-side date-range filter on created_at. Preset windows keep the UX
  // touch-friendly without pulling in a native date-picker dependency.
  const [selectedRange, setSelectedRange] = useState<'all' | '30d' | '90d' | 'year'>('all');
  const [selectedReport, setSelectedReport] = useState<YourRightHistory | null>(null);
  // M8 closeout — inline thread preview in the details modal. Fetched once
  // when the modal opens. The full-thread navigation (View thread CTA)
  // still goes to concern_thread.tsx for the fullscreen experience.
  const [previewMessages, setPreviewMessages] = useState<ConcernMessage[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Full-screen evidence-image viewer (mirrors the schedule proof viewer).
  const [imageViewer, setImageViewer] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedReport?.right_id) {
      setPreviewMessages([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setPreviewLoading(true);
      const res = await getOwnerThread(selectedReport.right_id);
      if (!cancelled) {
        if ('error' in res) {
          setPreviewMessages([]);
        } else {
          // Last 3 messages, chronological.
          setPreviewMessages((res.messages || []).slice(-3));
        }
        setPreviewLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedReport?.right_id]);

  const fetchHistory = async (isRefresh = false) => {
    if (!user?.private_user_id) return;

    if (isRefresh) setRefreshing(true);
    else setIsLoading(true);

    try {
      const result = await getUserRightHistory(Number(user.private_user_id));
      if (result && !('error' in result)) {
        const transformed: YourRightHistory[] = (result as any[]).map(r => ({
          right_id: r.right_id || 0,
          private_user_id: r.private_user_id,
          title: r.title || 'Untitled Report',
          issue_description: r.issue_description || '',
          category: r.category || 'other',
          status: r.status || 'pending',
          urgency_level: (r.urgency_level?.toLowerCase() as any) || 'medium',
          created_at: r.created_at || new Date().toISOString(),
          updated_at: r.updated_at || new Date().toISOString(),
          contact_method: r.contact_method || 'email',
          expected_outcome: r.expected_outcome || '',
          channel: (r.channel === 'external' ? 'external' : 'internal'),
          is_anonymous: !!r.is_anonymous,
          escalated_to_external_at: r.escalated_to_external_at || null,
          attachment_url: r.attachment_url || null,
          attachment_scan_result: r.attachment_scan_result || null,
        }));
        setYourRightHistory(transformed);
      } else {
        setYourRightHistory([]);
      }
    } catch (error) {
      console.error('Fetch error:', error);
      setYourRightHistory([]);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchHistory();
  }, [user]);

  // Apply the date-range window first; stats + the status filter both work
  // off this so the tiles reflect the selected time window.
  const dateFiltered = useMemo(() => {
    if (selectedRange === 'all') return yourRightHistory;
    const now = new Date();
    const cutoff = new Date(now);
    if (selectedRange === '30d') cutoff.setDate(now.getDate() - 30);
    else if (selectedRange === '90d') cutoff.setDate(now.getDate() - 90);
    else if (selectedRange === 'year') cutoff.setFullYear(now.getFullYear() - 1);
    return yourRightHistory.filter(r => {
      const created = new Date(r.created_at);
      return !isNaN(created.getTime()) && created >= cutoff;
    });
  }, [yourRightHistory, selectedRange]);

  const stats = useMemo(() => {
    const total = dateFiltered.length;
    const resolved = dateFiltered.filter(r => r.status.toLowerCase() === 'resolved').length;
    const active = dateFiltered.filter(r => ['submitted', 'pending', 'in_progress'].includes(r.status.toLowerCase())).length;
    return { total, resolved, active };
  }, [dateFiltered]);

  const filteredData = useMemo(() => {
    if (selectedFilter === 'all') return dateFiltered;
    return dateFiltered.filter(r => r.status.toLowerCase() === selectedFilter);
  }, [dateFiltered, selectedFilter]);

  const getStatusConfig = (status: string) => {
    const s = status.toLowerCase();
    switch (s) {
      case 'resolved': return { color: Palette.teal, bg: Palette.tealTint, icon: CheckCircle2 };
      case 'rejected': return { color: Palette.error, bg: Palette.errorTint, icon: AlertTriangle };
      case 'in_progress': return { color: Palette.gold, bg: Palette.warningTint, icon: ClockIcon };
      default: return { color: Palette.blue, bg: Palette.blueTint, icon: FileText };
    }
  };

  const renderEmptyState = () => (
    <MotiView
      from={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      style={styles.emptyContainer}
    >
      <Box p="$8" bg={Palette.white} rounded="$3xl" alignItems="center" style={styles.glassCard}>
        <Box p="$6" bg={Palette.gray100} rounded="$full" mb="$4">
          <History size={48} color={Palette.gray400} />
        </Box>
        <Heading textAlign="center" color={Palette.ink} fontSize={Type.h3} fontWeight="700" mb="$2">No Reports Yet</Heading>
        <Text textAlign="center" color={Palette.gray500} fontSize={Type.body} mb="$6">
          Your submitted concerns will appear here. Need to report an issue?
        </Text>
        <StandardButton.Primary w="$full" onPress={() => router.push('/private_dashboard/your_right')}>
          Start New Report
        </StandardButton.Primary>
      </Box>
    </MotiView>
  );

  return (
    <Box flex={1} bg={Palette.gray50}>
      {/* Immersive Background */}
      <Box style={StyleSheet.absoluteFill}>
        <MotiView
          from={{ opacity: 0.3, scale: 1, translateX: -50 }}
          animate={{ opacity: 0.6, scale: 1.5, translateX: 50 }}
          transition={{ loop: true, type: 'timing', duration: 15000, repeatReverse: true }}
          style={[styles.blob, { backgroundColor: Palette.blueTint, top: '5%', left: '0%' }]}
        />
        <MotiView
          from={{ opacity: 0.2, scale: 1.2, translateY: 50 }}
          animate={{ opacity: 0.5, scale: 1.8, translateY: -50 }}
          transition={{ loop: true, type: 'timing', duration: 18000, repeatReverse: true }}
          style={[styles.blob, { backgroundColor: Palette.violetTint, bottom: '10%', right: '-10%' }]}
        />
      </Box>

      <SafeAreaView style={{ flex: 1 }}>
        {/* Header Section.
            In a Tabs navigator router.back() pops to the initial tab
            (dashboard), not the concerns landing — so navigate to the "Raise a
            Concern" screen (this screen's parent) explicitly. */}
        <PremiumHeader
          title="My Concerns"
          onBack={() => router.replace('/private_dashboard/your_right')}
        />

        <ScrollView
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 120 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchHistory(true)} />}
        >
          {/* Stats Section */}
          <MotiView from={{ opacity: 0, translateY: 20 }} animate={{ opacity: 1, translateY: 0 }} delay={100}>
            <BlurView intensity={80} tint="light" style={styles.statsContainer}>
              <HStack justifyContent="space-around" py="$4">
                <VStack alignItems="center">
                  <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="700">TOTAL</Text>
                  <Text fontSize={Type.display} fontWeight="800" color={Palette.ink}>{stats.total}</Text>
                </VStack>
                <Box w={1} bg={Palette.gray200} />
                <VStack alignItems="center">
                  <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="700">RESOLVED</Text>
                  <Text fontSize={Type.display} fontWeight="800" color={Palette.teal}>{stats.resolved}</Text>
                </VStack>
                <Box w={1} bg={Palette.gray200} />
                <VStack alignItems="center">
                  <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="700">ACTIVE</Text>
                  <Text fontSize={Type.display} fontWeight="800" color={Palette.blue}>{stats.active}</Text>
                </VStack>
              </HStack>
            </BlurView>
          </MotiView>

          {/* Filter Section */}
          <Box mt="$6">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {['all', 'submitted', 'pending', 'in_progress', 'resolved', 'rejected'].map((f) => (
                <TouchableOpacity
                  key={f}
                  onPress={() => setSelectedFilter(f as any)}
                  style={[
                    styles.filterBadge,
                    selectedFilter === f && styles.filterBadgeActive
                  ]}
                >
                  <Text
                    fontSize={Type.small}
                    fontWeight="700"
                    color={selectedFilter === f ? Palette.white : Palette.gray500}
                  >
                    {f.replace('_', ' ').toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Box>

          {/* Date-range Section */}
          <Box mt="$3">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
              {([
                { key: 'all', label: 'ALL TIME' },
                { key: '30d', label: '30 DAYS' },
                { key: '90d', label: '90 DAYS' },
                { key: 'year', label: '1 YEAR' },
              ] as const).map((r) => (
                <TouchableOpacity
                  key={r.key}
                  onPress={() => setSelectedRange(r.key)}
                  style={[
                    styles.filterBadge,
                    selectedRange === r.key && styles.filterBadgeActive
                  ]}
                >
                  <Text
                    size="xs"
                    fontWeight="700"
                    color={selectedRange === r.key ? 'white' : '#64748b'}
                  >
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </Box>

          {/* Reports List */}
          {isLoading ? (
            <Center mt="$20">
              <Spinner size="large" color={Palette.gold} />
              <Text mt="$3" fontSize={Type.title} fontWeight="600" color={Palette.gray700}>Loading…</Text>
            </Center>
          ) : filteredData.length === 0 ? (
            renderEmptyState()
          ) : (
            <VStack space="md" mt="$6">
              {filteredData.map((report, index) => {
                const config = getStatusConfig(report.status);
                const StatusIcon = config.icon;
                return (
                  <MotiView
                    key={report.right_id}
                    from={{ opacity: 0, translateY: 20 }}
                    animate={{ opacity: 1, translateY: 0 }}
                    transition={{ delay: 200 + index * 50 }}
                  >
                    <Pressable onPress={() => setSelectedReport(report)}>
                      <Box bg={Palette.white} p="$5" rounded={18} style={styles.reportCard}>
                        <HStack justifyContent="space-between" alignItems="flex-start" mb="$3">
                          <VStack flex={1}>
                            <Text fontSize={Type.caption} color={Palette.gray400} fontWeight="800" mb="$1">
                              {report.category.toUpperCase()}
                            </Text>
                            <Heading fontSize={Type.title} fontWeight="800" color={Palette.ink} letterSpacing={-0.5} numberOfLines={1}>
                              {report.title}
                            </Heading>
                          </VStack>
                          <Box bg={config.bg} p="$2" rounded="$xl">
                            <StatusIcon size={18} color={config.color} />
                          </Box>
                        </HStack>

                        <Text fontSize={Type.body} color={Palette.gray500} numberOfLines={2} mb="$4">
                          {report.issue_description}
                        </Text>

                        <HStack justifyContent="space-between" alignItems="center">
                          <HStack space="xs" alignItems="center">
                            <Box w={8} h={8} rounded="$full" bg={report.urgency_level === 'high' || report.urgency_level === 'urgent' ? Palette.errorAlt : Palette.blue} />
                            <Text size="xs" fontWeight="700" color={Palette.gray500}>
                              {report.urgency_level.toUpperCase()}
                            </Text>
                          </HStack>
                          <Text size="xs" color={Palette.gray400}>
                            {format(new Date(report.created_at), 'MMM dd, yyyy')}
                          </Text>
                        </HStack>

                        {/* M3: routing + anonymity chips */}
                        <HStack space="xs" flexWrap="wrap" mt="$3">
                          <Box
                            bg={report.channel === 'external' ? Palette.warningTint : Palette.blueTint}
                            borderColor={report.channel === 'external' ? Palette.gold : Palette.blue}
                            borderWidth={1}
                            px="$2" py="$1" rounded="$md"
                          >
                            <Text fontSize={Type.tiny} fontWeight="700" color={report.channel === 'external' ? Palette.gold : Palette.blue}>
                              {report.channel === 'external'
                                ? (t('concernHistory.destinationKontokaz') || 'Sent to Kiruko Compliance').toUpperCase()
                                : (t('concernHistory.destinationEmployer') || 'Sent to your employer').toUpperCase()}
                            </Text>
                          </Box>
                          {report.is_anonymous && (
                            <Box bg={Palette.gray100} borderColor={Palette.gray300} borderWidth={1} px="$2" py="$1" rounded="$md">
                              <Text fontSize={Type.tiny} fontWeight="700" color={Palette.gray600}>
                                {(t('concernHistory.anonymousBadge') || 'Anonymous').toUpperCase()}
                              </Text>
                            </Box>
                          )}
                          {report.escalated_to_external_at && (
                            <Box bg={Palette.violetTint} borderColor={Palette.violet} borderWidth={1} px="$2" py="$1" rounded="$md">
                              <Text fontSize={Type.tiny} fontWeight="700" color={Palette.violet}>
                                {(t('concernHistory.escalatedBadge') || 'Auto-escalated to Kiruko').toUpperCase()}
                              </Text>
                            </Box>
                          )}
                        </HStack>

                        {/* M3: View thread CTA */}
                        <Pressable
                          onPress={(e) => {
                            // Stop the row press from also opening the details modal.
                            e?.stopPropagation?.();
                            router.push({
                              pathname: '/private_dashboard/concern_thread',
                              params: { right_id: String(report.right_id) },
                            });
                          }}
                        >
                          <Box mt="$3" bg={Palette.blueTint} borderColor={Palette.blueTint} borderWidth={1} rounded="$md" py="$2">
                            <Text textAlign="center" fontSize={Type.small} fontWeight="700" color={Palette.blue}>
                              {t('concernHistory.viewThreadAction') || 'View thread'}
                            </Text>
                          </Box>
                        </Pressable>
                      </Box>
                    </Pressable>
                  </MotiView>
                );
              })}
            </VStack>
          )}
        </ScrollView>

        {/* Floating Action Button */}
        <Box position="absolute" bottom={40} right={20}>
          <TouchableOpacity
            style={styles.fab}
            onPress={() => router.push('/private_dashboard/your_right')}
          >
            <Plus size={28} color={Palette.white} />
          </TouchableOpacity>
        </Box>
      </SafeAreaView>

      {/* Details Modal */}
      <Modal isOpen={!!selectedReport} onClose={() => setSelectedReport(null)}>
        <ModalBackdrop />
        <ModalContent
          style={[
            styles.modalContent,
            // Bound the modal to the safe area so tall content scrolls
            // INSIDE the body instead of overflowing top/bottom — otherwise
            // the header (+ close button) is pushed under the status bar/notch
            // and there's no reachable way to exit the page.
            { maxHeight: SCREEN_HEIGHT - insets.top - insets.bottom - 32 },
          ] as any}
          w="100%"
          mx="$0"
          maxWidth={800}
        >
          {selectedReport && (
            <>
              <ModalHeader>
                <VStack space="xs">
                  <Heading fontSize={Type.h2} color={Palette.ink} fontWeight="800" letterSpacing={-0.5}>{selectedReport.title}</Heading>
                  <HStack space="xs" alignItems="center">
                    <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="800">CATEGORY:</Text>
                    <Badge size="sm" variant="outline" action="info" rounded="$full">
                      <BadgeText fontSize={Type.tiny}>{selectedReport.category.toUpperCase()}</BadgeText>
                    </Badge>
                  </HStack>
                </VStack>
                <ModalCloseButton><CloseIcon /></ModalCloseButton>
              </ModalHeader>
              <ModalBody>
                <ScrollView showsVerticalScrollIndicator={false}>
                  <VStack space="xl" py="$4">
                    <VStack space="md" mb="$6">
                      <Text fontSize={Type.label} color={Palette.gray600} fontWeight="800" letterSpacing={1}>ISSUE DESCRIPTION</Text>
                      <Box bg={Palette.gray50} p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.gray200}>
                        <Text fontSize={Type.title} color={Palette.ink} lineHeight={"$normal" as any} fontWeight="400">
                          {selectedReport.issue_description}
                        </Text>
                      </Box>
                    </VStack>

                    {selectedReport.expected_outcome && (
                      <VStack space="md" mb="$6">
                        <Text fontSize={Type.label} color={Palette.blue} fontWeight="800" letterSpacing={1}>EXPECTED OUTCOME</Text>
                        <Box bg={Palette.blueTint} p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.blueTint}>
                          <Text fontSize={Type.title} color={Palette.blue} lineHeight={"$normal" as any} fontWeight="400">
                            {selectedReport.expected_outcome}
                          </Text>
                        </Box>
                      </VStack>
                    )}

                    <HStack space="md" mb="$6">
                      <Box flex={1} bg={Palette.gray50} p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.gray200}>
                        <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="800" mb="$1">STATUS</Text>
                        <Text fontSize={Type.title} fontWeight="800" color={getStatusConfig(selectedReport.status).color}>{selectedReport.status.toUpperCase()}</Text>
                      </Box>
                      <Box flex={1} bg={Palette.gray50} p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.gray200}>
                        <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="800" mb="$1">URGENCY</Text>
                        <Text fontSize={Type.title} fontWeight="800" color={Palette.ink}>{selectedReport.urgency_level.toUpperCase()}</Text>
                      </Box>
                    </HStack>

                    <Box bg={Palette.gray50} p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.gray200}>
                      <Text fontSize={Type.tiny} color={Palette.gray500} fontWeight="800" mb="$1">SUBMITTED ON</Text>
                      <Text fontSize={Type.title} fontWeight="700" color={Palette.ink}>{format(new Date(selectedReport.created_at), 'MMMM d, yyyy')}</Text>
                    </Box>

                    {/* M8 closeout #25 — attachment scan badge (mirrors the
                        web ScanResultBadge in Complaints.tsx). */}
                    {selectedReport.attachment_url ? (() => {
                      const value = (selectedReport.attachment_scan_result || '').toLowerCase();
                      let bg = Palette.gray100;
                      let fg = Palette.gray700;
                      let border = Palette.gray200;
                      let label = t('concernHistory.attachmentBadgePending') || 'Scan pending';
                      if (value === 'clean') {
                        bg = Palette.greenTint; fg = Palette.teal; border = Palette.greenTint;
                        label = t('concernHistory.attachmentBadgeClean') || 'Attachment scanned · clean';
                      } else if (value.startsWith('rejected')) {
                        bg = Palette.errorTint; fg = Palette.error; border = Palette.errorTint;
                        label = t('concernHistory.attachmentBadgeRejected') || 'Attachment rejected — re-upload required';
                      } else if (value.startsWith('skipped')) {
                        bg = Palette.warningTint; fg = Palette.gold; border = Palette.warningTint;
                        label = t('concernHistory.attachmentBadgeSkipped') || 'Scan skipped';
                      }
                      return (
                        <Box bg={bg} p="$3" rounded="$xl" borderWidth={1} borderColor={border}>
                          <Text fontSize={Type.tiny} color={fg} fontWeight="800" letterSpacing={1}>
                            {label.toUpperCase()}
                          </Text>
                        </Box>
                      );
                    })() : null}

                    {/* Evidence attachment — inline image preview (tap to
                        enlarge), mirroring the schedule proof-photo pattern.
                        Non-image files (PDF/doc) fall back to an open link. */}
                    {selectedReport.attachment_url ? (() => {
                      const resolved = resolveFileUrl(selectedReport.attachment_url);
                      if (!resolved) return null;
                      return (
                        <VStack space="md">
                          <Text fontSize={Type.label} color={Palette.gray600} fontWeight="800" letterSpacing={1}>
                            {t('concernHistory.evidenceLabel') || 'EVIDENCE ATTACHMENT'}
                          </Text>
                          {isImageUrl(selectedReport.attachment_url) ? (
                            <TouchableOpacity activeOpacity={0.85} onPress={() => setImageViewer(resolved)}>
                              <Image
                                source={{ uri: resolved }}
                                style={{ width: '100%', height: 200, borderRadius: 16 }}
                                resizeMode="cover"
                              />
                            </TouchableOpacity>
                          ) : (
                            <TouchableOpacity
                              activeOpacity={0.85}
                              onPress={() => Linking.openURL(resolved).catch(() => undefined)}
                            >
                              <HStack
                                space="sm"
                                alignItems="center"
                                bg={Palette.gray50}
                                p="$4"
                                rounded="$2xl"
                                borderWidth={1}
                                borderColor={Palette.gray200}
                              >
                                <MaterialIcons name="attach-file" size={20} color={Palette.blue} />
                                <Text fontSize={Type.body} color={Palette.blue} fontWeight="700">
                                  {t('concernHistory.openAttachment') || 'Open attachment'}
                                </Text>
                              </HStack>
                            </TouchableOpacity>
                          )}
                        </VStack>
                      );
                    })() : null}

                    {/* M8 closeout — inline thread preview. Pairs with the
                        "View thread" CTA on the row (which opens the full
                        fullscreen concern_thread.tsx with composer). */}
                    <VStack space="md">
                      <HStack justifyContent="space-between" alignItems="center">
                        <Text fontSize={Type.label} color={Palette.gray600} fontWeight="800" letterSpacing={1}>
                          RECENT MESSAGES
                        </Text>
                        <Pressable
                          onPress={() => {
                            const id = selectedReport.right_id;
                            setSelectedReport(null);
                            router.push({
                              pathname: '/private_dashboard/concern_thread',
                              params: { right_id: String(id) },
                            });
                          }}
                        >
                          <Text fontSize={Type.small} color={Palette.blue} fontWeight="700">
                            {t('concernHistory.viewThreadAction') || 'View thread'} →
                          </Text>
                        </Pressable>
                      </HStack>

                      {previewLoading && (
                        <Box py="$3" alignItems="center">
                          <Spinner size="small" color={Palette.gold} />
                        </Box>
                      )}

                      {!previewLoading && previewMessages.length === 0 && (
                        <Box bg={Palette.gray50} p="$3" rounded="$xl" borderWidth={1} borderColor={Palette.gray200}>
                          <Text fontSize={Type.small} color={Palette.gray500} textAlign="center">
                            {t('concernThread.emptyTitle') || 'No messages yet'}
                          </Text>
                        </Box>
                      )}

                      {!previewLoading && previewMessages.map((m) => {
                        const mine = m.author_kind === 'reporter';
                        return (
                          <Box
                            key={m.message_id}
                            alignSelf={mine ? 'flex-end' : 'flex-start'}
                            maxWidth="85%"
                            bg={mine ? Palette.blue : Palette.white}
                            borderColor={mine ? Palette.blue : Palette.gray200}
                            borderWidth={1}
                            rounded="$lg"
                            p="$2"
                          >
                            <Text
                              fontSize={Type.tiny}
                              fontWeight="700"
                              color={mine ? Palette.blueTint : Palette.gray500}
                              mb="$1"
                            >
                              {(
                                m.author_kind === 'reporter' ? t('concernThread.authorReporter')
                                : m.author_kind === 'employer' ? t('concernThread.authorEmployer')
                                : m.author_kind === 'kontokaz' ? t('concernThread.authorKontokaz')
                                : t('concernThread.authorSystem')
                              ).toUpperCase()}
                            </Text>
                            <Text color={mine ? Palette.white : Palette.gray800} fontSize={Type.small}>
                              {m.body}
                            </Text>
                          </Box>
                        );
                      })}
                    </VStack>
                  </VStack>
                </ScrollView>
              </ModalBody>
              <ModalFooter>
                <StandardButton.Secondary w="$full" onPress={() => setSelectedReport(null)}>Close</StandardButton.Secondary>
              </ModalFooter>
            </>
          )}
        </ModalContent>
      </Modal>

      {/* Full-screen evidence-image viewer (schedule-style). */}
      {imageViewer && (
        <RNModal visible transparent animationType="fade" onRequestClose={() => setImageViewer(null)}>
          <Box flex={1} justifyContent="center" style={{ backgroundColor: 'rgba(0,0,0,0.95)' }}>
            <TouchableOpacity
              activeOpacity={1}
              style={{ position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 8 }}
              onPress={() => setImageViewer(null)}
            >
              <MaterialIcons name="close" size={28} color="white" />
            </TouchableOpacity>
            <Image source={{ uri: imageViewer }} style={{ width: '100%', height: '70%' }} resizeMode="contain" />
          </Box>
        </RNModal>
      )}
    </Box>
  );
};

const styles = StyleSheet.create({
  blob: {
    position: 'absolute',
    width: 400,
    height: 400,
    borderRadius: 200,
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'white',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 3,
  },
  statsContainer: {
    marginTop: 20,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    overflow: 'hidden',
    padding: 12,
  },
  filterBadge: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'white',
    borderWidth: 1,
    borderColor: Palette.gray200,
  },
  filterBadgeActive: {
    backgroundColor: Palette.indigo,
    borderColor: Palette.indigo,
  },
  reportCard: {
    borderWidth: 1,
    borderColor: Palette.gray100,
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  fab: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Palette.indigo,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2,
    shadowRadius: 15,
    elevation: 10,
  },
  glassCard: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.05,
    shadowRadius: 30,
    elevation: 5,
  },
  emptyContainer: {
    marginTop: 60,
  },
  modalContent: {
    borderRadius: 32,
    paddingVertical: 8,
  }
});

export default YourRightHistoryScreen;