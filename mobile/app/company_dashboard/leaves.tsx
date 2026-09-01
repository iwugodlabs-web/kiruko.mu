import { approveLeaveRequest, getLeaveRequestsByCompany } from '../../services/api';
import { Palette, Type } from '@/app/constants/theme';
import { leaveTypes as leaveTypesApi } from '@/services/payroll-api';
import { MaterialIcons } from '@expo/vector-icons';
import {
  AlertCircleIcon, Badge, Box, Button, ButtonText, CheckCircleIcon, Heading, HStack,
  Input, InputField, InputSlot, Modal, ModalBackdrop, ModalBody,
  ModalContent, ModalFooter, ScrollView, Spinner, Text, Textarea,
  TextareaInput, VStack, Avatar, AvatarFallbackText, Pressable
} from '@gluestack-ui/themed';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { XCircleIcon } from 'lucide-react-native';
import { MotiView } from 'moti';
import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Alert, Platform, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { useRouter, useFocusEffect } from 'expo-router';
import useAuth from '../hooks/useAuth';
import { hasCompanyPermission } from '@/services/permissions';
import { PremiumHeader } from '@/components/PremiumHeader';

// Isolated, memoized comment box. Typing updates ONLY this component's local
// state (mirrored into a parent ref), so a keystroke never re-renders LeavesPage
// or the gluestack Modal — that whole-tree re-render was the source of the
// per-keystroke flicker. The parent reads the value from the ref on submit.
const ApprovalTextarea = React.memo(function ApprovalTextarea({
  valueRef,
  placeholder,
  resetKey,
}: {
  valueRef: React.MutableRefObject<string>;
  placeholder: string;
  resetKey: string;
}) {
  const [val, setVal] = useState('');
  useEffect(() => { setVal(''); valueRef.current = ''; }, [resetKey, valueRef]);
  return (
    <Textarea h={110} rounded="$xl" borderColor={Palette.gray300} bg={Palette.gray50}>
      <TextareaInput
        placeholder={placeholder}
        value={val}
        onChangeText={(t) => { setVal(t); valueRef.current = t; }}
        textAlignVertical="top"
      />
    </Textarea>
  );
});


export default function LeavesPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  // Viewing leave is open to all company users, but approving/rejecting needs
  // the approve_leave permission (web parity) — hide the actions otherwise so a
  // role can't trigger a 403 on a button it shouldn't see.
  const canApproveLeave = hasCompanyPermission(user, 'approve_leave');
  const [leaves, setLeaves] = useState<any[]>([]);
  // Map leave-type codes → friendly labels ("maternity" → "Maternity leave (14 weeks)")
  // so the employer view matches what employees see. Best-effort; falls back to the code.
  const [typeLabels, setTypeLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  // Approval modal state
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [selectedLeave, setSelectedLeave] = useState<any>(null);
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject'>('approve');
  const rejectionReasonRef = useRef('');
  const approverCommentsRef = useRef('');
  const [processingApproval, setProcessingApproval] = useState(false);

  // Summary Statistics
  const summaryStats = useMemo(() => {
    return {
      total: leaves.length,
      pending: leaves.filter(lv => lv.status?.toLowerCase() === 'pending').length,
      approved: leaves.filter(lv => lv.status?.toLowerCase() === 'approved').length,
    };
  }, [leaves]);

  // Filtered leaves based on search and status
  const filteredLeaves = useMemo(() => {
    let filtered = leaves;

    // Filter by search query
    if (searchQuery.trim()) {
      filtered = filtered.filter(lv =>
        (lv.requester_name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (lv.reason || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (lv.leave_type || '').toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    // Filter by status
    if (statusFilter !== 'all') {
      filtered = filtered.filter(lv => lv.status?.toLowerCase() === statusFilter.toLowerCase());
    }

    return filtered;
  }, [leaves, searchQuery, statusFilter]);

  // Helper functions for premium UI
  const getInitials = (name?: string) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('companyLeaves.greetingMorning');
    if (hour < 18) return t('companyLeaves.greetingAfternoon');
    return t('companyLeaves.greetingEvening');
  };

  // Get status color and icon
  const getStatusConfig = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'approved':
        return { color: Palette.success, bgColor: Palette.successTint, icon: 'check-circle' };
      case 'pending':
        return { color: Palette.gold, bgColor: Palette.warningTint, icon: 'schedule' };
      case 'rejected':
        return { color: Palette.error, bgColor: Palette.errorTint, icon: 'cancel' };
      default:
        return { color: Palette.gray600, bgColor: Palette.gray50, icon: 'help-outline' };
    }
  };

  // Format date
  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  // Calculate leave duration
  const calculateDuration = (startDate: string, endDate: string) => {
    if (!startDate || !endDate) return 'N/A';
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffTime = Math.abs(end.getTime() - start.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates
    return `${diffDays} day${diffDays !== 1 ? 's' : ''}`;
  };

  // Handle approval modal
  const handleApprovalAction = (leave: any, action: 'approve' | 'reject') => {
    setSelectedLeave(leave);
    setApprovalAction(action);
    rejectionReasonRef.current = '';
    approverCommentsRef.current = '';
    setShowApprovalModal(true);
  };

  // Submit approval/rejection
  const submitApproval = async () => {
    if (!selectedLeave) return;
    if (approvalAction === 'reject' && !rejectionReasonRef.current.trim()) {
      Alert.alert(t('common.errorTitle'), 'Please enter a reason for rejection.');
      return;
    }

    setProcessingApproval(true);
    try {
      const approvalData = {
        action: approvalAction,
        rejection_reason: approvalAction === 'reject' ? rejectionReasonRef.current : undefined,
        approver_comments: approverCommentsRef.current || undefined,
      };

      const result = await approveLeaveRequest(selectedLeave.leave_id, approvalData);

      if ('error' in result) {
        throw new Error(result.error);
      }

      // Update local state
      setLeaves(prevLeaves =>
        prevLeaves.map(leave =>
          leave.leave_id === selectedLeave.leave_id
            ? {
              ...leave,
              status: approvalAction === 'approve' ? 'approved' : 'rejected',
              approved_by: user?.user_id,
              approved_at: new Date().toISOString(),
              rejection_reason: approvalAction === 'reject' ? rejectionReasonRef.current : null,
              approver_comments: approverCommentsRef.current || null,
            }
            : leave
        )
      );

      setShowApprovalModal(false);
      setSelectedLeave(null);

      Alert.alert(
        t('common.successTitle'),
        approvalAction === 'approve' ? t('companyLeaves.approvedToast') : t('companyLeaves.rejectedToast')
      );
    } catch (error: any) {
      Alert.alert(t('common.errorTitle'), error.message || t('companyLeaves.processFailedBody'));
    } finally {
      setProcessingApproval(false);
    }
  };

  const loadData = useCallback(async (isRefreshing = false) => {
    if (isRefreshing) setRefreshing(true);
    else setLoading(true);

    // Employers carry the company under user.company (private_user is undefined
    // for company users), so check that FIRST — omitting it left companyId
    // undefined and the list silently empty.
    const companyId = user?.company?.company_id || user?.private_user?.company_id || (user as any)?.company_id;
    if (!companyId) {
      setLeaves([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const res = await getLeaveRequestsByCompany(companyId);
      setLeaves(Array.isArray(res) ? res : []);
      try {
        const lts = await leaveTypesApi.list(companyId, false);
        if (Array.isArray(lts)) {
          const m: Record<string, string> = {};
          for (const lt of lts) if (lt?.code) m[lt.code] = lt.label ?? lt.code;
          setTypeLabels(m);
        }
      } catch { /* labels best-effort — fall back to raw code */ }
    } catch (err) {
      console.error('Error loading leaves:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  const onRefresh = () => loadData(true);

  // Refetch on every focus (mount + tab revisits), so the list stays current
  // without needing a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  return (
    <LinearGradient
      colors={[Palette.gray50, Palette.gray100, Palette.white]}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <PremiumHeader
          title={t('companyLeaves.title')}
          onBack={() => router.push('/company_dashboard/home')}
          rightElement={
            <Box p="$0.5" rounded="$full" borderWidth={1.5} borderColor={Palette.gray200} bg={Palette.white}>
              <Avatar size="sm" bgColor={Palette.gold}>
                <AvatarFallbackText>{getInitials(user?.private_user?.first_name || '')}</AvatarFallbackText>
              </Avatar>
            </Box>
          }
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Palette.gold} />
          }
        >
          <VStack space="xl" px="$5" pt="$5" pb="$0">
            {/* Summary Dashboard */}
            <MotiView
              from={{ opacity: 0, translateY: -10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 400 }}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20 }}>
                <HStack space="md">
                  {/* Total Requests Card */}
                  <Box
                    bg={Palette.blueTint} p="$4" rounded="$2xl" width={140}
                    borderWidth={1} borderColor={Palette.blue + '22'}
                    shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2}
                  >
                    <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                      <Box style={{ backgroundColor: Palette.blue, borderRadius: 10, padding: 7 }}>
                        <MaterialIcons name="assignment" size={16} color={Palette.white} />
                      </Box>
                      <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>{summaryStats.total}</Text>
                    </HStack>
                    <Text fontSize={Type.label} color={Palette.ink} fontWeight="600">{t('companyLeaves.statTotal')}</Text>
                    <Text fontSize={Type.tiny} color={Palette.gray500}>{t('companyLeaves.statTotalSubtitle')}</Text>
                  </Box>

                  {/* Pending Card */}
                  <Box
                    bg={Palette.warningTint} p="$4" rounded="$2xl" width={140}
                    borderWidth={1} borderColor={Palette.gold + '22'}
                    shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2}
                  >
                    <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                      <Box style={{ backgroundColor: Palette.gold, borderRadius: 10, padding: 7 }}>
                        <MaterialIcons name="hourglass-empty" size={16} color={Palette.white} />
                      </Box>
                      <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>{summaryStats.pending}</Text>
                    </HStack>
                    <Text fontSize={Type.label} color={Palette.ink} fontWeight="600">{t('companyLeaves.statPending')}</Text>
                    <Text fontSize={Type.tiny} color={Palette.gray500}>{t('companyLeaves.statPendingSubtitle')}</Text>
                  </Box>

                  {/* Approved Card */}
                  <Box
                    bg={Palette.greenTint} p="$4" rounded="$2xl" width={140}
                    borderWidth={1} borderColor={Palette.success + '22'}
                    shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2}
                  >
                    <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                      <Box style={{ backgroundColor: Palette.success, borderRadius: 10, padding: 7 }}>
                        <MaterialIcons name="check-circle" size={16} color={Palette.white} />
                      </Box>
                      <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>{summaryStats.approved}</Text>
                    </HStack>
                    <Text fontSize={Type.label} color={Palette.ink} fontWeight="600">{t('companyLeaves.statApproved')}</Text>
                    <Text fontSize={Type.tiny} color={Palette.gray500}>{t('companyLeaves.statApprovedSubtitle')}</Text>
                  </Box>
                </HStack>
              </ScrollView>
            </MotiView>

            {/* Search and Filter */}
            <VStack space="md">
              <Input
                size="lg"
                variant="outline"
                bg={Palette.white}
                borderWidth={1}
                rounded="$2xl"
                shadowColor={Palette.black}
                shadowOffset={{ width: 0, height: 2 }}
                shadowOpacity={0.04}
                shadowRadius={8}
                elevation={2}
                borderColor={Palette.gray100}
              >
                <InputSlot pl="$4">
                  <MaterialIcons name="search" size={20} color={Palette.gray400} />
                </InputSlot>
                <InputField
                  placeholder={t("companyLeaves.searchPlaceholder")}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  color={Palette.gray800}
                  placeholderTextColor={Palette.gray400}
                  fontSize={Type.body}
                />
              </Input>

              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <HStack space="sm" pb="$1">
                  {[
                    { id: 'all', label: t('companyLeaves.filterAll') },
                    { id: 'pending', label: t('companyLeaves.filterPending') },
                    { id: 'approved', label: t('companyLeaves.filterApproved') },
                    { id: 'rejected', label: t('companyLeaves.filterRejected') },
                  ].map((item) => {
                    const isActive = statusFilter === item.id;
                    return (
                      <Pressable key={item.id} onPress={() => setStatusFilter(item.id)}>
                        <Box
                          bg={isActive ? Palette.gold : Palette.white}
                          px="$4" py="$2" rounded="$xl"
                          borderWidth={1} borderColor={isActive ? Palette.gold : Palette.gray200}
                          shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.03} shadowRadius={4} elevation={1}
                        >
                          <Text color={isActive ? Palette.white : Palette.gray600} fontSize={Type.label} fontWeight="600">
                            {item.label}
                          </Text>
                        </Box>
                      </Pressable>
                    )
                  })}
                </HStack>
              </ScrollView>
            </VStack>

            {/* Main Content */}
            <Box flex={1}>
              {loading && !refreshing ? (
                <Box py="$10" alignItems="center">
                  <Spinner size="large" color={Palette.gold} />
                  <Text mt="$4" color={Palette.gray700} fontSize={Type.title}>{t('companyLeaves.loading')}</Text>
                </Box>
              ) : (
                <VStack space="md">
                  {filteredLeaves.length === 0 ? (
                    <MotiView
                      from={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: 'timing', duration: 400 }}
                    >
                      <Box
                        bg={Palette.white} p="$10" rounded="$3xl" alignItems="center"
                        borderWidth={1} borderColor={Palette.gray100}
                      >
                        <Box bg={Palette.gray100} p="$5" rounded="$full" mb="$4">
                          <MaterialIcons name="event-busy" size={48} color={Palette.gray400} />
                        </Box>
                        <Heading size="md" color={Palette.ink} textAlign="center" fontSize={Type.h3} fontWeight="700">
                          {searchQuery || statusFilter !== 'all' ? t('companyLeaves.noMatches') : t('companyLeaves.noLeaveRequests')}
                        </Heading>
                        <Text color={Palette.gray500} textAlign="center" mt="$2" fontSize={Type.body}>
                          {searchQuery || statusFilter !== 'all'
                            ? 'Try clearing your filters or changing your search terms.'
                            : 'All incoming leave requests from your team will appear here.'
                          }
                        </Text>
                      </Box>
                    </MotiView>
                  ) : (
                    filteredLeaves.map((lv: any, index) => {
                      const statusConfig = getStatusConfig(lv.status);
                      const duration = calculateDuration(lv.start_date, lv.end_date);

                      return (
                        <MotiView
                          key={lv.leave_id}
                          from={{ opacity: 0, translateY: 15 }}
                          animate={{ opacity: 1, translateY: 0 }}
                          transition={{ type: 'timing', duration: 300, delay: index * 40 }}
                        >
                          <Box
                            bg={Palette.white} p="$4" rounded="$2xl"
                            borderWidth={1} borderColor={Palette.gray100}
                            shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={8} elevation={2}
                          >
                            <VStack space="md">
                              {/* Header */}
                              <HStack justifyContent="space-between" alignItems="center" space="md">
                                <HStack space="md" alignItems="center" flex={1}>
                                  <Avatar size="md" bgColor={Palette.gold} rounded="$xl">
                                    <AvatarFallbackText>{getInitials(lv.requester_name)}</AvatarFallbackText>
                                  </Avatar>
                                  <VStack flex={1}>
                                    <Text fontWeight="800" fontSize={Type.title} color={Palette.ink} numberOfLines={1}>
                                      {lv.requester_name || 'Employee'}
                                    </Text>
                                    <Text color={Palette.gray500} fontSize={Type.label} fontWeight="500">
                                      {(typeLabels[lv.leave_type] || lv.leave_type || '')} • {duration}
                                    </Text>
                                  </VStack>
                                </HStack>
                                <Box bg={statusConfig.bgColor} px="$2.5" py="$1" rounded="$full" borderWidth={1} borderColor={statusConfig.color + '22'}>
                                  <HStack alignItems="center" space="xs">
                                    <MaterialIcons name={statusConfig.icon as any} size={14} color={statusConfig.color} />
                                    <Text fontSize={Type.small} fontWeight="700" color={statusConfig.color} textTransform="uppercase" letterSpacing={0.5}>
                                      {lv.status}
                                    </Text>
                                  </HStack>
                                </Box>
                              </HStack>

                              {/* Dates Section */}
                              <Box bg={Palette.gray50} p="$3" rounded="$xl" borderWidth={1} borderColor={Palette.gray200}>
                                <HStack justifyContent="space-between" alignItems="center">
                                  <VStack>
                                    <Text color={Palette.gray400} fontSize={Type.caption} fontWeight="700" textTransform="uppercase">Start Date</Text>
                                    <Text color={Palette.gray800} fontSize={Type.body} fontWeight="600">{formatDate(lv.start_date)}</Text>
                                  </VStack>
                                  <Box h={20} w={1} bg={Palette.gray200} />
                                  <VStack alignItems="flex-end">
                                    <Text color={Palette.gray400} fontSize={Type.caption} fontWeight="700" textTransform="uppercase">End Date</Text>
                                    <Text color={Palette.gray800} fontSize={Type.body} fontWeight="600">{formatDate(lv.end_date)}</Text>
                                  </VStack>
                                </HStack>
                              </Box>

                              {/* Reason */}
                              {lv.reason && (
                                <HStack space="sm" alignItems="flex-start" px="$1">
                                  <MaterialIcons name="notes" size={18} color={Palette.gray400} />
                                  <Text color={Palette.gray600} fontSize={Type.body} flex={1} lineHeight={20}>
                                    {lv.reason}
                                  </Text>
                                </HStack>
                              )}

                              {/* Actions */}
                              {lv.status?.toLowerCase() === 'pending' && canApproveLeave && (
                                <HStack space="md" pt="$2">
                                  <Pressable
                                    flex={1}
                                    onPress={() => handleApprovalAction(lv, 'approve')}
                                  >
                                    <Box bg={Palette.gold} py="$3" rounded="$xl" alignItems="center" shadowColor={Palette.gold} shadowOffset={{ width: 0, height: 4 }} shadowOpacity={0.2} shadowRadius={8} elevation={4}>
                                      <Text color={Palette.white} fontWeight="700" fontSize={Type.body}>{t('companyLeaves.actionApprove')}</Text>
                                    </Box>
                                  </Pressable>
                                  <Pressable
                                    flex={1}
                                    onPress={() => handleApprovalAction(lv, 'reject')}
                                  >
                                    <Box bg={Palette.white} py="$3" rounded="$xl" alignItems="center" borderWidth={1} borderColor={Palette.gray300}>
                                      <Text color={Palette.gray600} fontWeight="700" fontSize={Type.body}>{t('companyLeaves.actionReject')}</Text>
                                    </Box>
                                  </Pressable>
                                </HStack>
                              )}

                              {/* Resolution Details */}
                              {(lv.status?.toLowerCase() === 'approved' || lv.status?.toLowerCase() === 'rejected') && (
                                <Box pt="$2" borderTopWidth={1} borderColor={Palette.gray100}>
                                  <HStack space="xs" alignItems="center">
                                    <Text fontSize={Type.small} color={Palette.gray500}>
                                      {lv.status?.toLowerCase() === 'approved' ? 'Approved' : 'Rejected'} by Admin on {formatDate(lv.approved_at)}
                                    </Text>
                                  </HStack>
                                  {(lv.approver_comments || lv.rejection_reason) && (
                                    <Text fontSize={Type.label} color={Palette.gray600} italic mt="$1">
                                      "{lv.approver_comments || lv.rejection_reason}"
                                    </Text>
                                  )}
                                </Box>
                              )}
                            </VStack>
                          </Box>
                        </MotiView>
                      );
                    })
                  )}
                </VStack>
              )}
            </Box>
          </VStack>
          <Box h={100} />
        </ScrollView>
      </SafeAreaView >

      {/* Approval Modal */}
      <Modal
        isOpen={showApprovalModal}
        onClose={() => setShowApprovalModal(false)}
        size="full"
        avoidKeyboard
      >
        <ModalBackdrop />
        <ModalContent maxHeight="85%" bg={Palette.white} rounded="$3xl" overflow="hidden" my="$2" mx="$4" p="$0">
          <LinearGradient
            colors={approvalAction === 'approve' ? [Palette.teal, Palette.success] : [Palette.error, Palette.errorAlt]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 16, paddingBottom: 24 }}
          >
            <HStack space="md" alignItems="center" justifyContent="space-between">
              <HStack space="md" alignItems="center" flex={1}>
                <Box bg="rgba(255,255,255,0.2)" p="$3" rounded="$2xl">
                  <MaterialIcons name={approvalAction === 'approve' ? 'check-circle' : 'cancel'} size={24} color={Palette.white} />
                </Box>
                <VStack flex={1}>
                  <Text color="rgba(255,255,255,0.8)" fontSize={Type.small} fontWeight="700" textTransform="uppercase">{t('companyLeaves.modalKicker')}</Text>
                  <Heading size="md" color={Palette.white} fontWeight="900">
                    {approvalAction === 'approve' ? t('companyLeaves.modalTitleApprove') : t('companyLeaves.modalTitleReject')}
                  </Heading>
                  <Text fontSize={Type.small} color="rgba(255,255,255,0.7)" fontWeight="500" numberOfLines={1}>
                    {selectedLeave?.requester_name}
                  </Text>
                </VStack>
              </HStack>
              <Pressable onPress={() => setShowApprovalModal(false)}>
                <Box bg="rgba(255,255,255,0.2)" p="$2" rounded="$full">
                  <MaterialIcons name="close" size={20} color={Palette.white} />
                </Box>
              </Pressable>
            </HStack>
          </LinearGradient>

          <ModalBody px="$4" pb="$4" pt="$4">
            <VStack space="lg">
              <Box bg={Palette.white} p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.gray100}>
                <VStack space="xs">
                  <Text color={Palette.gray400} fontSize={Type.caption} fontWeight="800" textTransform="uppercase">Leave Details</Text>
                  <Text fontWeight="700" color={Palette.ink}>
                    {(selectedLeave && typeLabels[selectedLeave.leave_type]) || selectedLeave?.leave_type || 'General Leave'}
                  </Text>
                  <Text color={Palette.gray700} fontSize={Type.label}>
                    {formatDate(selectedLeave?.start_date)} - {formatDate(selectedLeave?.end_date)} ({calculateDuration(selectedLeave?.start_date, selectedLeave?.end_date)})
                  </Text>
                </VStack>
              </Box>

              {approvalAction === 'reject' ? (
                <VStack space="xs">
                  <Text fontWeight="700" fontSize={Type.body} color={Palette.ink}>Final Reason for Rejection</Text>
                  <ApprovalTextarea
                    valueRef={rejectionReasonRef}
                    placeholder={t("companyLeaves.rejectReasonPlaceholder")}
                    resetKey={`${selectedLeave?.leave_id ?? 'none'}-reject`}
                  />
                </VStack>
              ) : (
                <VStack space="xs">
                  <Text fontWeight="700" fontSize={Type.body} color={Palette.ink}>Internal Comments (Optional)</Text>
                  <ApprovalTextarea
                    valueRef={approverCommentsRef}
                    placeholder={t("companyLeaves.approvalNotesPlaceholder")}
                    resetKey={`${selectedLeave?.leave_id ?? 'none'}-approve`}
                  />
                </VStack>
              )}
            </VStack>
          </ModalBody>

          <ModalFooter borderTopWidth={0} p="$6" bg={Palette.white}>
            <HStack space="md" flex={1}>
              <Pressable
                flex={1}
                onPress={submitApproval}
                disabled={processingApproval}
              >
                <Box
                  bg={approvalAction === 'approve' ? Palette.teal : Palette.error}
                  p="$3.5" rounded="$2xl" alignItems="center"
                  opacity={processingApproval ? 0.5 : 1}
                >
                  <HStack space="xs" justifyContent="center" alignItems="center">
                    <MaterialIcons name={approvalAction === 'approve' ? 'check' : 'close'} size={18} color={Palette.white} />
                    <Text color={Palette.white} fontWeight="900" fontSize={Type.body}>
                      {processingApproval ? t('companyLeaves.processing') : approvalAction === 'approve' ? t('companyLeaves.actionApprove') : t('companyLeaves.actionReject')}
                    </Text>
                  </HStack>
                </Box>
              </Pressable>
              <Pressable flex={1} onPress={() => setShowApprovalModal(false)}>
                <Box bg={Palette.gray100} p="$3.5" rounded="$2xl" alignItems="center">
                  <Text color={Palette.gray700} fontWeight="700" fontSize={Type.body}>Cancel</Text>
                </Box>
              </Pressable>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </LinearGradient>
  );
}
