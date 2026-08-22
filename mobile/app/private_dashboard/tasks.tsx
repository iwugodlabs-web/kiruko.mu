import { MaterialIcons } from '@expo/vector-icons';
import { Palette, Type } from '@/app/constants/theme';
import {
  Box,
  Heading,
  HStack,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalContent,
  ModalHeader,
  Pressable,
  ScrollView,
  Text,
  Toast,
  ToastDescription,
  ToastTitle,
  VStack as ToastVStack,
  useToast,
  VStack,
  Input,
  InputField
} from '@gluestack-ui/themed';
import { format, startOfWeek, addWeeks, subWeeks, isSameDay } from 'date-fns';
import React, { useCallback, useMemo, useState } from 'react';
import { RefreshControl, View, ActivityIndicator, KeyboardAvoidingView, Platform, StatusBar } from 'react-native';
import Animated, { FadeInUp, Layout, SlideInRight } from '@/app/utils/animated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { getSchedulesForUser, Schedule, updateMyScheduleStatus, uploadTaskProof, resolveFileUrl, isPermissionDeniedError } from '../../services/api';
import * as ImagePicker from 'expo-image-picker';
import { Image, TextInput } from 'react-native';
import useAuth from '../hooks/useAuth';
import { useRouter, useFocusEffect } from 'expo-router';
import { PremiumHeader } from '@/components/PremiumHeader';
import { WeekStrip } from '@/components/schedule/WeekStrip';
import { useTranslation } from 'react-i18next';

interface TaskFilters {
  status: 'all' | 'pending' | 'started' | 'completed' | 'cancelled';
  sortBy: 'date' | 'status' | 'title';
  sortOrder: 'asc' | 'desc';
}

const TasksScreen = () => {
  const { user } = useAuth();
  const toast = useToast();
  const router = useRouter();
  const { t } = useTranslation();

  // State
  const [tasks, setTasks] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Schedule | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [filters, setFilters] = useState<TaskFilters>({
    status: 'all',
    sortBy: 'date',
    sortOrder: 'asc'
  });

  // Update Form State
  const [updateStatus, setUpdateStatus] = useState<string>('');
  const [updateNotes, setUpdateNotes] = useState<string>('');
  const [updateLocation, setUpdateLocation] = useState<string>(''); // Kept in state but will be read-only in UI
  const [isUpdating, setIsUpdating] = useState(false);
  // #4 — local URI of a photo the employee attaches as proof of completion.
  const [proofUri, setProofUri] = useState<string | null>(null);
  // #4 — the employee's previously-uploaded proof (server URL) so they can
  // revisit their own evidence after saving.
  const [existingProofUrl, setExistingProofUrl] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  // Fetch Logic
  const fetchTasks = useCallback(async (isRefresh = false) => {
    if (!user?.private_user_id) {
      // User not yet loaded — clear loading state so the screen doesn't hang
      setIsLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      if (isRefresh) setRefreshing(true);
      else setIsLoading(true);

      const result = await getSchedulesForUser(Number(user.private_user_id));

      if ('error' in result) {
        if (!isPermissionDeniedError(result)) console.error('Error fetching tasks:', result.error);
        if (!isRefresh) setTasks([]);
      } else {
        const normalized = result.map(t => ({
          ...t,
          status: t.status || 'pending',
          title: t.title || 'Untitled Task',
          notes: t.notes || '',
          location: t.location || ''
        }));
        setTasks(normalized);
      }
    } catch (error) {
      console.error('Fetch error:', error);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [user?.private_user_id]);

  useFocusEffect(
    useCallback(() => {
      fetchTasks();
    }, [fetchTasks])
  );

  // Stats for the top cards — exclude drafts (employees shouldn't see them)
  const stats = useMemo(() => {
    const visible = tasks.filter(t => t.status !== 'draft');
    const total = visible.length;
    const pending = visible.filter(t => t.status === 'pending').length;
    const started = visible.filter(t => t.status === 'started').length;
    const completed = visible.filter(t => t.status === 'completed').length;
    return { total, pending, started, completed };
  }, [tasks]);

  // Derived State
  const filteredTasks = useMemo(() => {
    // Hide drafts from employees completely
    let result = tasks.filter(t => t.status !== 'draft');

    if (filters.status !== 'all') {
      result = result.filter(t => t.status === filters.status);
    }

    let sorted = result.sort((a, b) => {
      const dateA = new Date(a.start_time || 0).getTime();
      const dateB = new Date(b.start_time || 0).getTime();
      return filters.sortOrder === 'asc' ? dateA - dateB : dateB - dateA;
    });

    if (selectedDay) {
      sorted = sorted.filter(t => {
        if (!t.start_time) return false;
        try { return isSameDay(new Date(t.start_time), selectedDay); } catch { return false; }
      });
    }

    return sorted;
  }, [tasks, filters, selectedDay]);

  // Modal Handlers
  const myPrivateUserId = user?.private_user_id ? Number(user.private_user_id) : undefined;

  const openUpdateModal = (task: Schedule) => {
    setSelectedTask(task);
    const myStatus = task.assignee_statuses?.find(s => s.private_user_id === myPrivateUserId);
    setUpdateStatus(myStatus?.status || task.status || 'pending');
    setUpdateNotes(myStatus?.note || '');
    setUpdateLocation(task.location || '');
    setProofUri(null);
    setExistingProofUrl(myStatus?.proof_image_url ? String(resolveFileUrl(myStatus.proof_image_url)) : null);
    setShowUpdateModal(true);
  };

  const pickProofImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets?.[0]?.uri) {
      setProofUri(result.assets[0].uri);
    }
  };

  const handleUpdate = async () => {
    if (!selectedTask || !updateStatus) return;

    const myStatus = selectedTask.assignee_statuses?.find(s => s.private_user_id === myPrivateUserId);
    if (myStatus?.status === 'completed') {
      toast.show({
        placement: "top",
        render: ({ id }) => (
          <Toast nativeID={id} action="info" variant="accent" rounded="$xl">
            <ToastTitle>{t('scheduleScreen.toastArchivedTitle')}</ToastTitle>
            <ToastDescription>{t('scheduleScreen.toastArchivedBody')}</ToastDescription>
          </Toast>
        )
      });
      return;
    }

    setIsUpdating(true);
    try {
      // Save per-assignee: our own status + our own note. This never
      // overwrites the employer's shared message or other assignees' notes.
      const result = await updateMyScheduleStatus(selectedTask.schedule_id, updateStatus as any, updateNotes);
      if ('error' in result) {
        throw new Error(result.error);
      }

      // #4 — upload the photo proof (if attached) for this assignee.
      if (proofUri) {
        const proofRes = await uploadTaskProof(selectedTask.schedule_id, proofUri);
        if ('error' in proofRes) {
          throw new Error(proofRes.error);
        }
      }

      await fetchTasks();
      setShowUpdateModal(false);
      toast.show({
        placement: "top",
        render: ({ id }) => (
          <Toast nativeID={id} action="success" variant="accent">
            <ToastTitle>{t('scheduleScreen.toastUpdatedTitle')}</ToastTitle>
            <ToastDescription>{t('scheduleScreen.toastUpdatedBody', { status: updateStatus === 'started' ? t('scheduleScreen.filterInProgress') : updateStatus })}</ToastDescription>
          </Toast>
        )
      });
    } catch (e) {
      toast.show({
        placement: "top",
        render: ({ id }) => (
          <Toast nativeID={id} action="error" variant="accent">
            <ToastTitle>{t('scheduleScreen.toastUpdateFailedTitle')}</ToastTitle>
            <ToastDescription>{t('scheduleScreen.toastUpdateFailedBody')}</ToastDescription>
          </Toast>
        )
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return { bg: Palette.greenTint, text: Palette.success, border: Palette.teal, icon: 'check-circle' };
      case 'started': return { bg: Palette.blueTint, text: Palette.blue, border: Palette.blue, icon: 'play-circle-filled' };
      case 'cancelled': return { bg: Palette.errorTint, text: Palette.error, border: Palette.errorAlt, icon: 'cancel' };
      default: return { bg: Palette.warningTint, text: Palette.gold, border: Palette.warning, icon: 'schedule' };
    }
  };

  return (
    <Box flex={1} bg={Palette.white}>
      <StatusBar barStyle="dark-content" />

      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        {/* Premium Header */}
        <PremiumHeader title={t('scheduleScreen.pageTitle')} />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchTasks(true)} tintColor={Palette.gray700} />}
        >
          {/* Stats Section */}
          <Box mt="$4" mb="$4" px="$6">
            <HStack space="sm">
              {/* Total (spans full left column) */}
              <Box flex={1} rounded="$2xl" overflow="hidden" shadowColor={Palette.ink} shadowOffset={{ width: 0, height: 4 }} shadowOpacity={0.15} shadowRadius={8} elevation={4}>
                <LinearGradient colors={[Palette.gray700, Palette.ink]} style={{ padding: 14, flex: 1, justifyContent: 'center' }}>
                  <HStack alignItems="center" space="sm" mb="$1">
                    <MaterialIcons name="assignment" size={14} color="rgba(255,255,255,0.7)" />
                    <Text color="rgba(255,255,255,0.7)" fontSize={Type.tiny} fontWeight="700" letterSpacing={0.8}>{t('scheduleScreen.statTotal')}</Text>
                  </HStack>
                  <Text color={Palette.white} fontSize={Type.h1} fontWeight="800" lineHeight={30}>{stats.total}</Text>
                </LinearGradient>
              </Box>
              {/* Right 3 in a column */}
              <VStack flex={2} space="sm">
                <HStack space="sm">
                  <Box flex={1} bg={Palette.blueTint} p="$3" rounded="$2xl" borderWidth={1} borderColor={Palette.gray100} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={6} elevation={1}>
                    <HStack alignItems="center" space="xs" mb="$0.5">
                      <Box w={6} h={6} rounded="$full" bg={Palette.warningTint} alignItems="center" justifyContent="center">
                        <MaterialIcons name="schedule" size={8} color={Palette.gold} />
                      </Box>
                      <Text color={Palette.ink} fontSize={Type.tiny} fontWeight="700" letterSpacing={0.4}>{t('scheduleScreen.statPending')}</Text>
                    </HStack>
                    <Text color={Palette.ink} fontSize={Type.h2} fontWeight="800">{stats.pending}</Text>
                  </Box>
                  <Box flex={1} bg={Palette.tealTint} p="$3" rounded="$2xl" borderWidth={1} borderColor={Palette.gray100} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={6} elevation={1}>
                    <HStack alignItems="center" space="xs" mb="$0.5">
                      <Box w={6} h={6} rounded="$full" bg={Palette.tealTint} alignItems="center" justifyContent="center">
                        <MaterialIcons name="play-arrow" size={8} color={Palette.teal} />
                      </Box>
                      <Text color={Palette.ink} fontSize={Type.tiny} fontWeight="700" letterSpacing={0.4}>{t('scheduleScreen.statInProgress')}</Text>
                    </HStack>
                    <Text color={Palette.ink} fontSize={Type.h2} fontWeight="800">{stats.started}</Text>
                  </Box>
                </HStack>
                <Box bg={Palette.greenTint} p="$3" rounded="$2xl" borderWidth={1} borderColor={Palette.gray100} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={6} elevation={1}>
                  <HStack alignItems="center" justifyContent="space-between">
                    <HStack alignItems="center" space="xs">
                      <Box w={6} h={6} rounded="$full" bg={Palette.greenTint} alignItems="center" justifyContent="center">
                        <MaterialIcons name="check" size={8} color={Palette.success} />
                      </Box>
                      <Text color={Palette.ink} fontSize={Type.tiny} fontWeight="700" letterSpacing={0.4}>{t('scheduleScreen.statCompleted')}</Text>
                    </HStack>
                    <Text color={Palette.ink} fontSize={Type.h2} fontWeight="800">{stats.completed}</Text>
                  </HStack>
                </Box>
              </VStack>
            </HStack>
          </Box>

          {/* Week Strip */}
          <Box px="$6" mb="$2">
            <HStack justifyContent="space-between" alignItems="center" mb="$3">
              <HStack alignItems="center" space="xs">
                <MaterialIcons name="date-range" size={14} color={Palette.gray400} />
                <Text fontSize={Type.small} fontWeight="700" color={Palette.gray400} style={{ textTransform: 'uppercase', letterSpacing: 1 }}>{t('scheduleScreen.browseByDate')}</Text>
              </HStack>
              {selectedDay ? (
                <Pressable onPress={() => setSelectedDay(null)}>
                  <HStack bg={Palette.ink} px="$3" py="$1.5" rounded="$full" alignItems="center" space="xs">
                    <Text fontSize={Type.small} fontWeight="700" color="white">{format(selectedDay, 'EEE, MMM d')}</Text>
                    <MaterialIcons name="close" size={13} color={Palette.gray400} />
                  </HStack>
                </Pressable>
              ) : (
                <Text fontSize={Type.caption} color={Palette.gray300} fontWeight="600">{t('scheduleScreen.tapToFilter')}</Text>
              )}
            </HStack>
            <WeekStrip
              schedules={tasks}
              weekStart={weekStart}
              selectedDay={selectedDay}
              onDaySelect={setSelectedDay}
              onWeekChange={(dir) => {
                setSelectedDay(null);
                setWeekStart(prev => dir === 1 ? addWeeks(prev, 1) : subWeeks(prev, 1));
              }}
              accentColor={Palette.indigo}
            />
          </Box>

          {/* Filter Section */}
          <Box px="$6" mb="$6">
            <HStack justifyContent="space-between" alignItems="center" mb="$4">
              <VStack>
                <Heading size="md" color={Palette.ink} fontWeight="800" letterSpacing={-0.5}>
                  {selectedDay ? format(selectedDay, 'EEEE, MMMM d') : 'All Tasks'}
                </Heading>
                <Text fontSize={Type.small} color={Palette.gray400} fontWeight="500" mt="$0.5">
                  {selectedDay
                    ? `${filteredTasks.length} task${filteredTasks.length !== 1 ? 's' : ''} scheduled`
                    : 'Tap a day above to filter by date'}
                </Text>
              </VStack>
              <Box bg={Palette.gray100} px="$2" py="$1" rounded="$md">
                <Text fontSize={Type.tiny} fontWeight="800" color={Palette.gray700}>{t('scheduleScreen.itemsCount', { count: filteredTasks.length })}</Text>
              </Box>
            </HStack>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <HStack space="sm">
                {(['all', 'pending', 'started', 'completed'] as const).map((f) => {
                  let label: string = f;
                  if (f === 'all') label = t('scheduleScreen.filterAll');
                  if (f === 'pending') label = t('scheduleScreen.filterPending');
                  if (f === 'started') label = t('scheduleScreen.filterInProgress');
                  if (f === 'completed') label = t('scheduleScreen.filterDone');

                  const isActive = filters.status === f;
                  return (
                    <Pressable key={f} onPress={() => {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      setFilters(prev => ({ ...prev, status: f }));
                    }}>
                      {({ pressed }: any) => (
                        <Box
                          bg={isActive ? Palette.ink : Palette.white}
                          px="$5"
                          py="$2.5"
                          rounded="$full"
                          borderWidth={1}
                          borderColor={isActive ? Palette.ink : Palette.gray200}
                          style={{
                            transform: [{ scale: pressed ? 0.96 : 1 }],
                            shadowColor: isActive ? Palette.ink : Palette.black,
                            shadowOffset: { width: 0, height: isActive ? 4 : 0 },
                            shadowOpacity: isActive ? 0.2 : 0,
                            shadowRadius: 8,
                            elevation: isActive ? 4 : 0
                          }}
                        >
                          <Text
                            fontSize={Type.label}
                            fontWeight={isActive ? "700" : "600"}
                            color={isActive ? Palette.white : Palette.gray600}
                          >
                            {label}
                          </Text>
                        </Box>
                      )}
                    </Pressable>
                  );
                })}
              </HStack>
            </ScrollView>
          </Box>

          {/* Task List */}
          <VStack space="lg" px="$6">
            {isLoading && !refreshing && tasks.length === 0 ? (
              <Box py="$20" alignItems="center">
                <ActivityIndicator size="large" color={Palette.gold} />
                <Text mt="$4" fontSize={Type.title} color={Palette.gray700} fontWeight="600">{t('scheduleScreen.loading')}</Text>
              </Box>
            ) : filteredTasks.length === 0 ? (
              <Animated.View entering={FadeInUp}>
                <Box bg={Palette.white} p="$10" rounded="$3xl" alignItems="center" borderWidth={1} borderColor={Palette.gray100} borderStyle="dashed">
                  <Box bg={Palette.gray50} p="$6" rounded="$full" mb="$4">
                    <MaterialIcons name="assignment-late" size={48} color={Palette.gray300} />
                  </Box>
                  <Heading size="md" color={Palette.ink} fontWeight="700" textAlign="center">{t('scheduleScreen.emptyTitle')}</Heading>
                  <Text fontSize={Type.body} color={Palette.gray500} textAlign="center" mt="$2">{t('scheduleScreen.emptyBody')}</Text>
                </Box>
              </Animated.View>
            ) : (
              filteredTasks.map((task, index) => {
                const colors = getStatusColor(task.status);
                const isCompleted = task.status === 'completed';
                const myStatus = task.assignee_statuses?.find(s => s.private_user_id === myPrivateUserId);
                const myCompleted = isCompleted || myStatus?.status === 'completed';

                return (
                  <Animated.View
                    key={task.schedule_id}
                    entering={FadeInUp.delay(index * 100).springify().damping(15)}
                    layout={Layout.springify()}
                  >
                    <Pressable onPress={() => {
                      if (myCompleted) {
                        toast.show({
                          placement: "top",
                          render: ({ id }) => (
                            <Toast nativeID={id} action="info" variant="accent" rounded="$xl">
                              <ToastVStack space="xs">
                                <ToastTitle>{t('scheduleScreen.toastArchivedTitle')}</ToastTitle>
                                <ToastDescription>{t('scheduleScreen.toastArchivedBody')}</ToastDescription>
                              </ToastVStack>
                            </Toast>
                          )
                        });
                        return;
                      }
                      openUpdateModal(task);
                    }}>
                      {({ pressed }: any) => (
                        <Box
                          bg={Palette.white}
                          p="$5"
                          rounded="$3xl"
                          borderWidth={1}
                          borderColor={pressed ? colors.border : Palette.gray100}
                          shadowColor={pressed ? colors.border : Palette.black}
                          shadowOffset={{ width: 0, height: pressed ? 8 : 4 }}
                          shadowOpacity={pressed ? 0.1 : 0.03}
                          shadowRadius={12}
                          elevation={pressed ? 4 : 2}
                          opacity={myCompleted ? 0.7 : 1}
                          style={{ transform: [{ scale: pressed ? 0.98 : 1 }] }}
                        >
                          {/* Date + Status row */}
                          <HStack justifyContent="space-between" alignItems="center" mb="$3">
                            <Box
                              style={{
                                backgroundColor: colors.bg,
                                paddingHorizontal: 6,
                                paddingVertical: 2,
                                borderRadius: 6,
                                flexDirection: 'row',
                                alignItems: 'center',
                                borderWidth: 1,
                                borderColor: colors.border + '30',
                              }}
                            >
                              <Box
                                style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: colors.text, marginRight: 4 }}
                              />
                              <Text color={colors.text} fontSize={Type.small} fontWeight="700" style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
                                {task.status === 'started' ? 'In Progress' : task.status}
                              </Text>
                            </Box>
                            {task.start_time && (
                              <HStack bg={Palette.gray50} px="$2.5" py="$1" rounded="$lg" borderWidth={1} borderColor={Palette.gray200} alignItems="center" space="xs">
                                <MaterialIcons name="event" size={11} color={Palette.gray500} />
                                <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray700}>
                                  {format(new Date(task.start_time), 'MMM d')}
                                </Text>
                                <Box w={3} h={3} rounded="$full" bg={Palette.gray300} />
                                <Text fontSize={Type.caption} fontWeight="600" color={Palette.gray500}>
                                  {format(new Date(task.start_time), 'h:mm a')}
                                </Text>
                              </HStack>
                            )}
                          </HStack>

                          {/* Title */}
                          <Text fontSize={Type.title} fontWeight="800" color={myCompleted ? Palette.gray400 : Palette.ink} numberOfLines={2} lineHeight={23} textDecorationLine={myCompleted ? 'line-through' : 'none'} mb={task.location || task.notes ? '$3' : '$0'}>
                            {task.title}
                          </Text>

                          {(task.location || task.notes) && (
                            <VStack space="sm" bg={Palette.gray50} p="$3" rounded="$2xl" mt="$3">
                              {task.location && (
                                <HStack space="xs" alignItems="center">
                                  <MaterialIcons name="location-on" size={14} color={Palette.gray500} />
                                  <Text fontSize={Type.small} color={Palette.gray700} fontWeight="600" numberOfLines={1} flex={1}>{task.location}</Text>
                                </HStack>
                              )}
                              {task.notes && (
                                <Text fontSize={Type.small} color={Palette.gray600} numberOfLines={2} lineHeight={16}>
                                  {task.notes}
                                </Text>
                              )}
                            </VStack>
                          )}

                          {(() => {
                            const myStatus = task.assignee_statuses?.find(s => s.private_user_id === myPrivateUserId);
                            const myProof = myStatus?.proof_image_url ? String(resolveFileUrl(myStatus.proof_image_url)) : null;
                            if (!myProof) return null;
                            return (
                              <HStack space="sm" alignItems="center" mt="$3">
                                <Image source={{ uri: myProof }} style={{ width: 56, height: 56, borderRadius: 12 }} resizeMode="cover" />
                                <VStack flex={1}>
                                  <HStack space="xs" alignItems="center">
                                    <MaterialIcons name="verified" size={14} color={Palette.teal} />
                                    <Text fontSize={Type.caption} fontWeight="700" color={Palette.teal} style={{ textTransform: 'uppercase', letterSpacing: 0.4 }}>
                                      Evidence uploaded
                                    </Text>
                                  </HStack>
                                  <Text fontSize={Type.small} color={Palette.gray600}>
                                    Your proof is saved on this task.
                                  </Text>
                                </VStack>
                              </HStack>
                            );
                          })()}

                          {!myCompleted && (
                            <HStack justifyContent="flex-end" mt="$4">
                              <Box bg={Palette.indigo} px="$4" py="$1.5" rounded="$full">
                                <HStack space="xs" alignItems="center">
                                  <Text fontSize={Type.caption} color={Palette.white} fontWeight="800">Update</Text>
                                  <MaterialIcons name="chevron-right" size={14} color={Palette.white} />
                                </HStack>
                              </Box>
                            </HStack>
                          )}
                        </Box>
                      )}
                    </Pressable>
                  </Animated.View>
                );
              })
            )}
          </VStack>
        </ScrollView>

        {/* Update Modal */}
        <Modal
          isOpen={showUpdateModal}
          onClose={() => setShowUpdateModal(false)}
          avoidKeyboard
        >
          <ModalBackdrop bg="rgba(0,0,0,0.6)" />
          <ModalContent w="90%" maxWidth={400} maxHeight="85%" bg={Palette.white} rounded="$3xl" p="$0" softShadow="4">
            <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ height: '100%' }}>
              {/* Modal Header */}
              <LinearGradient
                colors={[Palette.ink, Palette.gray800]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 20, borderTopLeftRadius: 24, borderTopRightRadius: 24 }}
              >
                <HStack justifyContent="space-between" alignItems="flex-start">
                  <VStack flex={1} mr="$3">
                    <Text fontSize={Type.caption} color="rgba(255,255,255,0.5)" fontWeight="700" style={{ textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>Update Task</Text>
                    <Heading size="md" color={Palette.white} numberOfLines={2} lineHeight={22}>
                      {selectedTask?.title || 'Task'}
                    </Heading>
                    {selectedTask?.start_time && (
                      <HStack space="xs" alignItems="center" mt="$2">
                        <MaterialIcons name="event" size={13} color="rgba(255,255,255,0.55)" />
                        <Text fontSize={Type.small} color="rgba(255,255,255,0.7)" fontWeight="600">
                          {format(new Date(selectedTask.start_time), "EEE, MMM d '\u00b7' h:mm a")}
                        </Text>
                      </HStack>
                    )}
                  </VStack>
                  <Pressable onPress={() => setShowUpdateModal(false)} p="$2" bg="rgba(255,255,255,0.1)" rounded="$full">
                    <MaterialIcons name="close" size={20} color={Palette.white} />
                  </Pressable>
                </HStack>
              </LinearGradient>

              <ModalBody px="$0" py="$0">
                <ScrollView
                  contentContainerStyle={{ padding: 24 }}
                  showsVerticalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                >
                  <VStack space="2xl">
                    {/* Status Selection */}
                    <VStack space="md">
                      <Text fontSize={Type.small} fontWeight="800" color={Palette.gray400} textTransform="uppercase" letterSpacing={1}>
                        Update Status
                      </Text>
                      <HStack space="sm" flexWrap="wrap">
                        {['pending', 'started', 'completed'].map((statusOption) => {
                          const isSelected = updateStatus === statusOption;
                          let items = { icon: 'schedule', color: Palette.gold, bg: Palette.warningTint, label: t('scheduleScreen.filterPending') };
                          if (statusOption === 'started') items = { icon: 'play-arrow', color: Palette.teal, bg: Palette.tealTint, label: t('scheduleScreen.filterInProgress') };
                          if (statusOption === 'completed') items = { icon: 'check-circle', color: Palette.success, bg: Palette.greenTint, label: t('scheduleScreen.statusCompleted') };

                          return (
                            <Pressable key={statusOption} onPress={() => setUpdateStatus(statusOption)}>
                              <HStack
                                px="$3"
                                py="$2"
                                rounded="$full"
                                bg={isSelected ? items.bg : Palette.white}
                                borderWidth={isSelected ? 1.5 : 1}
                                borderColor={isSelected ? items.color : Palette.gray200}
                                alignItems="center"
                                space="xs"
                              >
                                <MaterialIcons name={items.icon as any} size={14} color={isSelected ? items.color : Palette.gray400} />
                                <Text fontSize={Type.label} fontWeight={isSelected ? '800' : '600'} color={isSelected ? items.color : Palette.gray400}>
                                  {items.label}
                                </Text>
                              </HStack>
                            </Pressable>
                          );
                        })}
                      </HStack>
                    </VStack>

                    {/* Read Only Location */}
                    <VStack space="md">
                      <HStack space="xs" alignItems="center">
                        <MaterialIcons name="location-on" size={16} color={Palette.gray400} />
                        <Text fontSize={Type.small} fontWeight="800" color={Palette.gray400} textTransform="uppercase" letterSpacing={1}>
                          Location (Read Only)
                        </Text>
                      </HStack>
                      <Box bg={Palette.gray50} p="$4" rounded="$xl" borderWidth={1} borderColor={Palette.gray100}>
                        <Text fontSize={Type.body} color={Palette.gray700} fontWeight="600">
                          {updateLocation || 'No location specified'}
                        </Text>
                      </Box>
                    </VStack>

                    {/* Message from your employer */}
                    {selectedTask?.notes ? (
                      <VStack space="md">
                        <HStack space="xs" alignItems="center">
                          <MaterialIcons name="message" size={16} color={Palette.indigo} />
                          <Text fontSize={Type.small} fontWeight="800" color={Palette.gray400} textTransform="uppercase" letterSpacing={1}>
                            Message from your employer
                          </Text>
                        </HStack>
                        <Box bg={Palette.blueTint} p="$4" rounded="$xl" borderWidth={1} borderColor={Palette.blue}>
                          <Text fontSize={Type.body} color={Palette.ink} style={{ lineHeight: 20 }}>
                            {selectedTask.notes}
                          </Text>
                        </Box>
                      </VStack>
                    ) : null}

                    {/* Editable Notes */}
                    <VStack space="md">
                      <HStack space="xs" alignItems="center">
                        <MaterialIcons name="notes" size={16} color={Palette.gray400} />
                        <Text fontSize={Type.small} fontWeight="800" color={Palette.gray400} textTransform="uppercase" letterSpacing={1}>
                          Your Note (visible to your employer)
                        </Text>
                      </HStack>
                      <TextInput
                        placeholder={t("scheduleScreen.commentsPlaceholder")}
                        placeholderTextColor={Palette.gray400}
                        value={updateNotes}
                        onChangeText={setUpdateNotes}
                        multiline
                        numberOfLines={4}
                        textAlignVertical="top"
                        autoCapitalize="sentences"
                        style={{
                          borderWidth: 1,
                          borderColor: Palette.gray200,
                          borderRadius: 14,
                          padding: 14,
                          height: 120,
                          fontSize: Type.body,
                          color: Palette.ink,
                          backgroundColor: Palette.white,
                        }}
                      />
                    </VStack>

                    {/* #4 — photo proof of completion */}
                    <VStack space="sm">
                      <HStack space="xs" alignItems="center">
                        <MaterialIcons name="photo-camera" size={16} color={Palette.teal} />
                        <Text fontSize={Type.label} fontWeight="700" color={Palette.ink}>
                          Photo proof
                        </Text>
                      </HStack>
                      {proofUri ? (
                        <Box style={{ position: 'relative' }}>
                          <Image source={{ uri: proofUri }} style={{ width: '100%', height: 160, borderRadius: 16 }} resizeMode="cover" />
                          <Pressable onPress={() => setProofUri(null)} style={{ position: 'absolute', top: 8, right: 8 }}>
                            <Box bg={Palette.ink} rounded="$full" p="$1">
                              <MaterialIcons name="close" size={16} color={Palette.white} />
                            </Box>
                          </Pressable>
                        </Box>
                      ) : existingProofUrl ? (
                        <VStack space="xs">
                          <Image source={{ uri: existingProofUrl }} style={{ width: '100%', height: 160, borderRadius: 16 }} resizeMode="cover" />
                          <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="600">
                            Your uploaded proof — saved on this task.
                          </Text>
                          <Pressable onPress={pickProofImage} hitSlop={8}>
                            <HStack space="xs" alignItems="center">
                              <MaterialIcons name="cached" size={14} color={Palette.teal} />
                              <Text fontSize={Type.small} color={Palette.teal} fontWeight="700">
                                Replace photo
                              </Text>
                            </HStack>
                          </Pressable>
                        </VStack>
                      ) : (
                        <Pressable onPress={pickProofImage}>
                          <Box
                            borderWidth={1.5}
                            borderColor={Palette.gray200}
                            rounded="$xl"
                            py="$5"
                            alignItems="center"
                            justifyContent="center"
                            style={{ borderStyle: 'dashed' }}
                          >
                            <MaterialIcons name="add-a-photo" size={24} color={Palette.gray400} />
                            <Text fontSize={Type.small} color={Palette.gray500} mt="$1">
                              Add a photo
                            </Text>
                          </Box>
                        </Pressable>
                      )}
                    </VStack>

                  </VStack>
                </ScrollView>
              </ModalBody>

              <Box p="$6" pt="$4" borderTopWidth={1} borderTopColor={Palette.gray100} bg={Palette.white}>
                <Pressable
                  onPress={handleUpdate}
                  disabled={isUpdating}
                  style={{ opacity: isUpdating ? 0.7 : 1 }}
                >
                  <LinearGradient
                    colors={[Palette.indigo, Palette.ink]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{
                      paddingVertical: 18,
                      borderRadius: 20,
                      alignItems: 'center',
                      shadowColor: Palette.indigo,
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.3,
                      shadowRadius: 8,
                      elevation: 4
                    }}
                  >
                    {isUpdating ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <HStack space="sm" alignItems="center">
                        <MaterialIcons name="save-alt" size={20} color={Palette.white} />
                        <Text fontWeight="800" fontSize={Type.title} color={Palette.white}>Save Changes</Text>
                      </HStack>
                    )}
                  </LinearGradient>
                </Pressable>
              </Box>
            </KeyboardAvoidingView>
          </ModalContent>
        </Modal>

      </SafeAreaView>
    </Box>
  );
};

export default TasksScreen;