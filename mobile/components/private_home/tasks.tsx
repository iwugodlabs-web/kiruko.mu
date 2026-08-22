import { MaterialIcons } from '@expo/vector-icons';
import { Palette } from '@/app/constants/theme';
import {
    Badge,
    BadgeText,
    Box,
    Button,
    ButtonText,
    ChevronDownIcon,
    CloseIcon,
    FormControl,
    FormControlLabel,
    FormControlLabelText,
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
    Toast,
    ToastDescription,
    ToastTitle,
    VStack as ToastVStack,
    useToast,
    VStack
} from '@gluestack-ui/themed';
import { format } from 'date-fns';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, TextInput } from 'react-native';
import Animated, { FadeInUp, SlideInRight } from '@/app/utils/animated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getSchedulesForUser, Schedule, updateMyScheduleStatus, isPermissionDeniedError } from '../../services/api';
import useAuth from '@/app/hooks/useAuth';
import { useTranslation } from 'react-i18next';

interface TaskFilters {
  status: 'all' | 'pending' | 'started' | 'completed' | 'cancelled' | 'active';
  sortBy: 'date' | 'status' | 'title';
  sortOrder: 'asc' | 'desc';
}

const TasksScreen = () => {
  const { user } = useAuth();
  const toast = useToast();
  const { t } = useTranslation();

  const statusLabel = (status?: string) => {
    switch ((status || 'pending').toLowerCase()) {
      case 'started': return t('tasksScreen.statusStarted');
      case 'completed': return t('tasksScreen.statusCompleted');
      case 'cancelled': return t('tasksScreen.statusCancelled');
      default: return t('tasksScreen.statusPending');
    }
  };
  
  // State management
  const [tasks, setTasks] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Schedule | null>(null);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [filters, setFilters] = useState<TaskFilters>({
    status: 'all',
    sortBy: 'date',
    sortOrder: 'desc'
  });
  const [updateStatus, setUpdateStatus] = useState<string>('');
  const [updateNotes, setUpdateNotes] = useState<string>('');
  const [isUpdating, setIsUpdating] = useState(false);

  // Fetch tasks from API
  const fetchTasks = useCallback(async (isRefresh = false) => {
    if (!user?.private_user_id) return;

    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setIsLoading(true);
      }

      console.log('📋 Fetching tasks for user:', user.private_user_id);
      const result = await getSchedulesForUser(Number(user.private_user_id));
      
      if ('error' in result) {
        if (!isPermissionDeniedError(result)) console.error('❌ Error fetching tasks:', result.error);
        toast.show({
          placement: "top",
          render: ({ id }) => (
            <Toast nativeID={id} action="error" variant="solid">
              <ToastVStack space="xs">
                <ToastTitle>{t('tasksScreen.errorTitle')}</ToastTitle>
                <ToastDescription>{t('tasksScreen.failedToLoad')}</ToastDescription>
              </ToastVStack>
            </Toast>
          ),
        });
        setTasks([]);
      } else {
        console.log('✅ Tasks loaded successfully:', result.length);
        // Ensure all tasks have required properties with defaults
        const tasksWithDefaults = result.map(task => ({
          ...task,
          status: task.status || 'pending',
          title: task.title || t('tasksScreen.untitledTask'),
          notes: task.notes || '',
          location: task.location || ''
        }));
        setTasks(tasksWithDefaults);
      }
    } catch (error) {
      console.error('❌ Error fetching tasks:', error);
      setTasks([]);
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [user?.private_user_id, toast]);

  // Load tasks on component mount
  useEffect(() => {
    if (user?.private_user_id) {
      fetchTasks();
    }
  }, [fetchTasks]);

  // Helper functions for styling and logic
  const getStatusColor = (status: string) => {
    if (!status) return '$gray500';
    switch (status.toLowerCase()) {
      case 'pending': return '$orange500';
      case 'started': return '$blue500';
      case 'completed': return '$green500';
      case 'cancelled': return '$red500';
      default: return '$gray500';
    }
  };

  const getStatusIcon = (status: string) => {
    if (!status) return 'help-outline';
    switch (status.toLowerCase()) {
      case 'pending': return 'pending';
      case 'started': return 'play-arrow';
      case 'completed': return 'check-circle';
      case 'cancelled': return 'cancel';
      default: return 'help-outline';
    }
  };

  const formatTaskDate = (dateString: string) => {
    if (!dateString) return t('tasksScreen.noDateSet');
    const date = new Date(dateString);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    const isTomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toDateString() === date.toDateString();
    const isYesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toDateString() === date.toDateString();
    
    if (isToday) return t('tasksScreen.dateToday');
    if (isTomorrow) return t('tasksScreen.dateTomorrow');
    if (isYesterday) return t('tasksScreen.dateYesterday');
    
    return format(date, 'MMM dd, yyyy');
  };

  const isTaskOverdue = (task: Schedule) => {
    if (!task.start_time) return false;
    const startTime = new Date(task.start_time);
    const now = new Date();
    return startTime < now && ['pending', 'started'].includes(task.status || 'pending');
  };

  // Filtered and sorted tasks based on current filters
  const filteredTasks = useMemo(() => {
    let filtered = tasks.filter(task => {
      // Handle status filtering
      if (filters.status === 'all') {
        return true;
      } else if (filters.status === 'active') {
        return ['pending', 'started'].includes(task.status || 'pending');
      } else {
        return (task.status || 'pending') === filters.status;
      }
    });

    // Sort tasks
    filtered.sort((a, b) => {
      let aValue, bValue;
      
      switch (filters.sortBy) {
        case 'title':
          aValue = (a.title || 'Untitled Task').toLowerCase();
          bValue = (b.title || 'Untitled Task').toLowerCase();
          break;
        case 'status':
          aValue = a.status || 'pending';
          bValue = b.status || 'pending';
          break;
        case 'date':
        default:
          aValue = new Date(a.start_time || 0).getTime();
          bValue = new Date(b.start_time || 0).getTime();
          break;
      }
      
      if (filters.sortOrder === 'asc') {
        return aValue < bValue ? -1 : aValue > bValue ? 1 : 0;
      } else {
        return aValue > bValue ? -1 : aValue < bValue ? 1 : 0;
      }
    });

    return filtered;
  }, [tasks, filters]);

  // Task statistics
  const taskStats = useMemo(() => {
    const total = tasks.length;
    const pending = tasks.filter(t => (t.status || 'pending') === 'pending').length;
    const started = tasks.filter(t => (t.status || 'pending') === 'started').length;
    const completed = tasks.filter(t => (t.status || 'pending') === 'completed').length;
    const cancelled = tasks.filter(t => ((t.status || 'pending') as string) === 'cancelled').length;
    const active = pending + started;
    const overdue = tasks.filter(t => isTaskOverdue(t)).length;
    
    return { total, pending, started, completed, cancelled, active, overdue };
  }, [tasks]);

  // Handle task status update (employee marks their own personal status)
  const handleUpdateTask = async () => {
    if (!selectedTask || !updateStatus) {
      toast.show({
        placement: "top",
        render: ({ id }) => (
          <Toast nativeID={id} action="error" variant="solid">
            <ToastVStack space="xs">
              <ToastTitle>{t('tasksScreen.validationError')}</ToastTitle>
              <ToastDescription>{t('tasksScreen.selectStatusError')}</ToastDescription>
            </ToastVStack>
          </Toast>
        ),
      });
      return;
    }

    try {
      setIsUpdating(true);

      // Call the per-employee endpoint — does NOT overwrite other assignees' statuses
      console.log('🔄 Updating MY status on task:', selectedTask.schedule_id, '->', updateStatus);
      const result = await updateMyScheduleStatus(
        selectedTask.schedule_id,
        updateStatus as 'pending' | 'started' | 'completed',
        updateNotes
      );
      
      if ('error' in result) {
        toast.show({
          placement: "top",
          render: ({ id }) => (
            <Toast nativeID={id} action="error" variant="solid">
              <ToastVStack space="xs">
                <ToastTitle>{t('tasksScreen.updateFailed')}</ToastTitle>
                <ToastDescription>{result.error}</ToastDescription>
              </ToastVStack>
            </Toast>
          ),
        });
      } else {
        // Refresh tasks list so co-assignee statuses also update
        await fetchTasks();
        
        // Close modal and reset form
        setShowUpdateModal(false);
        setSelectedTask(null);
        setUpdateStatus('');
        setUpdateNotes('');
        
        toast.show({
          placement: "top",
          render: ({ id }) => (
            <Toast nativeID={id} action="success" variant="solid">
              <ToastVStack space="xs">
                <ToastTitle>{t('tasksScreen.taskUpdated')}</ToastTitle>
                <ToastDescription>{t('tasksScreen.taskUpdatedDesc')}</ToastDescription>
              </ToastVStack>
            </Toast>
          ),
        });
      }
    } catch (error) {
      console.error('❌ Error updating task:', error);
      toast.show({
        placement: "top",
        render: ({ id }) => (
          <Toast nativeID={id} action="error" variant="solid">
            <ToastVStack space="xs">
              <ToastTitle>{t('tasksScreen.errorTitle')}</ToastTitle>
              <ToastDescription>{t('tasksScreen.failedToUpdate')}</ToastDescription>
            </ToastVStack>
          </Toast>
        ),
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const onRefresh = () => {
    fetchTasks(true);
  };

  const openUpdateModal = (task: Schedule) => {
    setSelectedTask(task);
    setUpdateStatus(task.status || 'pending');
    const myId = user?.private_user_id ? Number(user.private_user_id) : undefined;
    const myStatus = task.assignee_statuses?.find(s => s.private_user_id === myId);
    setUpdateNotes(myStatus?.note || '');
    setShowUpdateModal(true);
  };

  // Loading state
  if (isLoading && tasks.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
        <Box flex={1} justifyContent="center" alignItems="center">
          <Spinner size="large" color="$blue600" />
          <Text mt="$4" color="$blue600">{t('tasksScreen.loadingTasks')}</Text>
        </Box>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <ScrollView 
        style={{ flex: 1 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <Box flex={1} pt="$4" px="$4" pb="$10">
          {/* Header */}
          <Animated.View entering={FadeInUp.duration(500)}>
            <HStack alignItems="center" space="md" mb="$6">
            
              <VStack flex={1}>
                <Heading size="xl" color="$textDark900" fontWeight="700">
                  {t('tasksScreen.myTasks')}
                </Heading>
                <Text color="$textLight600" fontSize={14}>
                  {t('tasksScreen.subtitle')}
                </Text>
              </VStack>
              <Box bg="$blue600" p="$2" rounded="$full">
                <MaterialIcons name="assignment" size={24} color="white" />
              </Box>
            </HStack>
          </Animated.View>

          {/* Statistics Cards */}
          <Animated.View entering={SlideInRight.duration(700).delay(100)}>
            <VStack space="md" mb="$6">
              {/* Summary Card */}
              <Box bg="$blue50" p="$4" rounded="$2xl" borderWidth={1} borderColor="$blue200">
                <VStack space="sm">
                  <HStack alignItems="center" space="sm">
                    <Box bg="$blue100" p="$2" rounded="$full">
                      <MaterialIcons name="assignment" size={20} color={Palette.blue} />
                    </Box>
                    <Text color="$blue800" fontWeight="700" fontSize={16}>
                      {t('tasksScreen.taskOverview')}
                    </Text>
                  </HStack>
                  <HStack justifyContent="space-around" mt="$2">
                    <VStack alignItems="center">
                      <Text color="$blue800" fontWeight="700" fontSize={18}>
                        {taskStats.total}
                      </Text>
                      <Text color="$blue600" fontSize={11}>{t('tasksScreen.statTotal')}</Text>
                    </VStack>
                    <VStack alignItems="center">
                      <Text color="$orange700" fontWeight="700" fontSize={18}>
                        {taskStats.active}
                      </Text>
                      <Text color="$orange600" fontSize={11}>{t('tasksScreen.statActive')}</Text>
                    </VStack>
                    <VStack alignItems="center">
                      <Text color="$green700" fontWeight="700" fontSize={18}>
                        {taskStats.completed}
                      </Text>
                      <Text color="$green600" fontSize={11}>{t('tasksScreen.statDone')}</Text>
                    </VStack>
                    <VStack alignItems="center">
                      <Text color="$red700" fontWeight="700" fontSize={18}>
                        {taskStats.overdue}
                      </Text>
                      <Text color="$red600" fontSize={11}>{t('tasksScreen.statOverdue')}</Text>
                    </VStack>
                  </HStack>
                </VStack>
              </Box>

              {/* Filters */}
              <Box bg="white" p="$4" rounded="$2xl" shadowColor="$backgroundLight900" shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.1} shadowRadius={4} elevation={3}>
                <VStack space="sm">
                  <Text color="$gray700" fontWeight="600" fontSize={14}>
                    {t('tasksScreen.filterSortTitle')}
                  </Text>
                  <HStack space="sm">
                    <Box flex={1}>
                      <Select 
                        selectedValue={filters.status} 
                        onValueChange={(value) => setFilters(prev => ({ ...prev, status: value as any }))}
                      >
                        <SelectTrigger size="md" variant="rounded">
                          <SelectInput placeholder={t('tasksScreen.statusPlaceholder')} />
                          <SelectIcon as={ChevronDownIcon} mr="$3" />
                        </SelectTrigger>
                        <SelectPortal>
                          <SelectBackdrop />
                          <SelectContent>
                            <SelectItem label={t('tasksScreen.optAllTasks')} value="all" />
                            <SelectItem label={t('tasksScreen.optActiveTasks')} value="active" />
                            <SelectItem label={t('tasksScreen.optPending')} value="pending" />
                            <SelectItem label={t('tasksScreen.optStarted')} value="started" />
                            <SelectItem label={t('tasksScreen.optCompleted')} value="completed" />
                            <SelectItem label={t('tasksScreen.optCancelled')} value="cancelled" />
                          </SelectContent>
                        </SelectPortal>
                      </Select>
                    </Box>
                    <Box flex={1}>
                      <Select 
                        selectedValue={filters.sortBy} 
                        onValueChange={(value) => setFilters(prev => ({ ...prev, sortBy: value as any }))}
                      >
                        <SelectTrigger size="md" variant="rounded">
                          <SelectInput placeholder={t('tasksScreen.sortByPlaceholder')} />
                          <SelectIcon as={ChevronDownIcon} mr="$3" />
                        </SelectTrigger>
                        <SelectPortal>
                          <SelectBackdrop />
                          <SelectContent>
                            <SelectItem label={t('tasksScreen.optDate')} value="date" />
                            <SelectItem label={t('tasksScreen.optStatus')} value="status" />
                            <SelectItem label={t('tasksScreen.optTitle')} value="title" />
                          </SelectContent>
                        </SelectPortal>
                      </Select>
                    </Box>
                  </HStack>
                  <HStack space="sm" alignItems="center">
                    <Text color="$gray600" fontSize={12}>
                      {t('tasksScreen.sortOrder')}
                    </Text>
                    <Pressable
                      onPress={() => setFilters(prev => ({ 
                        ...prev, 
                        sortOrder: prev.sortOrder === 'asc' ? 'desc' : 'asc' 
                      }))}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        backgroundColor: Palette.gray100,
                        paddingHorizontal: 12,
                        paddingVertical: 6,
                        borderRadius: 16,
                      }}
                    >
                      <MaterialIcons 
                        name={filters.sortOrder === 'asc' ? 'arrow-upward' : 'arrow-downward'} 
                        size={14} 
                        color={Palette.gray500} 
                      />
                      <Text color="$gray600" fontSize={12} ml="$1">
                        {filters.sortOrder === 'asc' ? t('tasksScreen.ascending') : t('tasksScreen.descending')}
                      </Text>
                    </Pressable>
                  </HStack>
                </VStack>
              </Box>

              {/* Quick Filter Buttons */}
              <HStack space="sm" flexWrap="wrap">
                {[
                  { label: t('tasksScreen.filterAll'), value: 'all', count: taskStats.total },
                  { label: t('tasksScreen.filterActive'), value: 'active', count: taskStats.active },
                  { label: t('tasksScreen.filterPending'), value: 'pending', count: taskStats.pending },
                  { label: t('tasksScreen.filterStarted'), value: 'started', count: taskStats.started },
                  { label: t('tasksScreen.optCompleted'), value: 'completed', count: taskStats.completed }
                ].map((filter) => (
                  <Pressable
                    key={filter.value}
                    onPress={() => setFilters(prev => ({ ...prev, status: filter.value as any }))}
                    style={{
                      backgroundColor: filters.status === filter.value ? Palette.blue : Palette.gray100,
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 16,
                      marginBottom: 4,
                    }}
                  >
                    <HStack alignItems="center" space="xs">
                      <Text 
                        color={filters.status === filter.value ? 'white' : '$gray700'} 
                        fontSize={12} 
                        fontWeight="600"
                      >
                        {filter.label}
                      </Text>
                      <Text 
                        color={filters.status === filter.value ? 'white' : '$gray500'} 
                        fontSize={10}
                        bg={filters.status === filter.value ? '$blue700' : '$gray200'}
                        px="$1"
                        py="$0"
                        rounded="$full"
                        minWidth={16}
                        textAlign="center"
                      >
                        {filter.count}
                      </Text>
                    </HStack>
                  </Pressable>
                ))}
              </HStack>
            </VStack>
          </Animated.View>

          {/* Tasks List */}
          <Animated.View entering={FadeInUp.duration(800).delay(200)}>
            <VStack space="sm">
              <Text color="$gray700" fontWeight="700" fontSize={16} mb="$2">
                {t('tasksScreen.myTasksCount', { count: filteredTasks.length })}
              </Text>

              {filteredTasks.length === 0 ? (
                <Box bg="white" p="$8" rounded="$2xl" alignItems="center">
                  <Box bg="$gray100" p="$4" rounded="$full" mb="$4">
                    <MaterialIcons name="assignment" size={48} color={Palette.gray400} />
                  </Box>
                  <Text color="$gray600" fontSize={16} textAlign="center" mb="$2">
                    {t('tasksScreen.noTasksFound')}
                  </Text>
                  <Text color="$gray500" fontSize={14} textAlign="center">
                    {filters.status !== 'all'
                      ? t('tasksScreen.adjustFilters')
                      : t('tasksScreen.noAssignedTasks')
                    }
                  </Text>
                </Box>
              ) : (
                filteredTasks.map((task) => {
                  const isOverdue = isTaskOverdue(task);
                  return (
                  <Pressable key={task.schedule_id} onPress={() => openUpdateModal(task)}>
                    <Box 
                      bg={isOverdue ? "$red50" : "white"} 
                      p="$4" 
                      rounded="$xl" 
                      mb="$2" 
                      shadowColor="$backgroundLight900" 
                      shadowOffset={{ width: 0, height: 1 }} 
                      shadowOpacity={0.05} 
                      shadowRadius={2} 
                      elevation={2}
                      borderWidth={isOverdue ? 1 : 0}
                      borderColor={isOverdue ? "$red200" : "transparent"}
                    >
                      <VStack space="sm">
                        <HStack justifyContent="space-between" alignItems="flex-start">
                          <VStack flex={1} mr="$2">
                            <HStack alignItems="center" space="sm">
                              <Text color={isOverdue ? "$red800" : "$gray800"} fontWeight="700" fontSize={16} numberOfLines={2} flex={1}>
                                {task.title || t('tasksScreen.untitledTask')}
                              </Text>
                              {isOverdue && (
                                <MaterialIcons name="warning" size={16} color={Palette.error} />
                              )}
                            </HStack>
                            <Text color="$gray600" fontSize={14} numberOfLines={2} mt="$1">
                              {task.notes || t('tasksScreen.noDescription')}
                            </Text>
                            {task.location && (
                              <Text color="$gray500" fontSize={12} mt="$1">
                                📍 {task.location}
                              </Text>
                            )}
                          </VStack>
                          <VStack alignItems="flex-end" space="xs">
                            <Badge bg={getStatusColor(task.status || 'pending')} borderRadius="$full">
                              <BadgeText color="white" fontSize={10}>
                                {statusLabel(task.status)}
                              </BadgeText>
                            </Badge>
                            {isOverdue && (
                              <Badge bg="$red500" borderRadius="$full">
                                <BadgeText color="white" fontSize={9}>
                                  {t('tasksScreen.badgeOverdue')}
                                </BadgeText>
                              </Badge>
                            )}
                          </VStack>
                        </HStack>

                        <HStack justifyContent="space-between" alignItems="center">
                          <HStack alignItems="center" space="xs">
                            <MaterialIcons 
                              name={getStatusIcon(task.status || 'pending') as any} 
                              size={14} 
                              color={isOverdue ? Palette.error : Palette.gray500} 
                            />
                            <Text color={isOverdue ? "$red600" : "$gray600"} fontSize={12} fontWeight="600">
                              {t('tasksScreen.scheduleTask')}
                            </Text>
                          </HStack>
                          <VStack alignItems="flex-end">
                            <Text color={isOverdue ? "$red600" : "$gray500"} fontSize={12} fontWeight="500">
                              {formatTaskDate(task.start_time || '')}
                            </Text>
                            {task.start_time && (
                              <Text color="$gray400" fontSize={10}>
                                {format(new Date(task.start_time), 'HH:mm')}
                              </Text>
                            )}
                          </VStack>
                        </HStack>

                        {task.notes && (
                          <Box bg="$gray50" p="$2" rounded="$lg" mt="$1">
                            <Text color="$gray700" fontSize={12} numberOfLines={2}>
                              📝 {task.notes}
                            </Text>
                          </Box>
                        )}
                      </VStack>
                    </Box>
                  </Pressable>
                  );
                })
              )}
            </VStack>
          </Animated.View>
        </Box>
      </ScrollView>

      {/* Update Task Modal */}
      <Modal
        isOpen={showUpdateModal}
        onClose={() => {
          setShowUpdateModal(false);
          setSelectedTask(null);
          setUpdateStatus('');
          setUpdateNotes('');
        }}
        size="lg"
      >
        <ModalBackdrop />
        <ModalContent maxHeight="85%">
          <ModalHeader>
            <Heading size="lg">{t('tasksScreen.myTaskStatus')}</Heading>
            <ModalCloseButton>
              <CloseIcon />
            </ModalCloseButton>
          </ModalHeader>
          <ModalBody>
            {selectedTask && (
              <VStack space="md">
                {/* Task info */}
                <VStack space="xs">
                  <Text color="$gray700" fontWeight="600" fontSize={14}>
                    {selectedTask.title || t('tasksScreen.untitledTask')}
                  </Text>
                  <HStack alignItems="center" space="xs">
                    <Text color="$gray500" fontSize={12}>{t('tasksScreen.overallStatus')}</Text>
                    <Badge bg={getStatusColor(selectedTask.status || 'pending')} borderRadius="$full">
                      <BadgeText color="white" fontSize={10}>
                        {statusLabel(selectedTask.status)}
                      </BadgeText>
                    </Badge>
                  </HStack>
                </VStack>

                {/* Co-assignee progress — only visible when more than 1 person is assigned */}
                {selectedTask.assigned_employees && selectedTask.assigned_employees.length > 1 && (
                  <Box bg="$blue50" p="$3" rounded="$xl" borderWidth={1} borderColor="$blue100">
                    <Text color="$blue800" fontWeight="600" fontSize={12} mb="$2">
                      👥 {t('tasksScreen.teamProgress', {
                        done: (selectedTask.assignee_statuses || []).filter(s => s.status === 'completed').length,
                        total: selectedTask.assigned_employees.length,
                      })}
                    </Text>
                    <VStack space="xs">
                      {selectedTask.assigned_employees.map((emp) => {
                        const empStatus = (selectedTask.assignee_statuses || []).find(
                          s => s.private_user_id === emp.private_user_id
                        );
                        const myStatus = empStatus?.status || 'pending';
                        const isMe = emp.private_user_id === Number(user?.private_user_id);
                        return (
                          <HStack key={emp.private_user_id} alignItems="center" space="sm" justifyContent="space-between">
                            <Text color={isMe ? "$blue800" : "$gray600"} fontSize={12} fontWeight={isMe ? "700" : "400"}>
                              {isMe ? `👤 ${t('tasksScreen.you')}` : `${emp.first_name} ${emp.last_name}`}
                            </Text>
                            <Badge
                              bg={myStatus === 'completed' ? '$green500' : myStatus === 'started' ? '$blue500' : '$gray400'}
                              borderRadius="$full"
                            >
                              <BadgeText color="white" fontSize={9}>
                                {statusLabel(myStatus)}
                              </BadgeText>
                            </Badge>
                          </HStack>
                        );
                      })}
                    </VStack>
                  </Box>
                )}

                {/* My status selector */}
                <FormControl>
                  <FormControlLabel>
                    <FormControlLabelText>{t('tasksScreen.myStatusLabel')}</FormControlLabelText>
                  </FormControlLabel>
                  <Select 
                    selectedValue={updateStatus} 
                    onValueChange={setUpdateStatus}
                  >
                    <SelectTrigger>
                      <SelectInput placeholder={t('tasksScreen.markProgress')} />
                      <SelectIcon as={ChevronDownIcon} mr="$3" />
                    </SelectTrigger>
                    <SelectPortal>
                      <SelectBackdrop />
                      <SelectContent>
                        <SelectItem label={t('tasksScreen.selectPending')} value="pending" />
                        <SelectItem label={t('tasksScreen.selectStarted')} value="started" />
                        <SelectItem label={t('tasksScreen.selectCompleted')} value="completed" />
                      </SelectContent>
                    </SelectPortal>
                  </Select>
                </FormControl>

                <Text color="$gray400" fontSize={11}>
                  {t('tasksScreen.ownStatusNote')}
                </Text>

                {/* Message from your employer */}
                {selectedTask.notes ? (
                  <Box bg="$blue50" p="$3" rounded="$xl" borderWidth={1} borderColor="$blue100">
                    <Text color="$blue800" fontWeight="700" fontSize={11} mb="$1">
                      📝 {t('tasksScreen.employerMessage')}
                    </Text>
                    <Text color="$gray700" fontSize={13} style={{ lineHeight: 19 }}>
                      {selectedTask.notes}
                    </Text>
                  </Box>
                ) : null}

                {/* My note — visible to the employer, per-assignee */}
                <FormControl>
                  <FormControlLabel>
                    <FormControlLabelText>{t('tasksScreen.myNoteLabel')}</FormControlLabelText>
                  </FormControlLabel>
                  <TextInput
                    value={updateNotes}
                    onChangeText={setUpdateNotes}
                    multiline
                    numberOfLines={3}
                    placeholder={t('tasksScreen.myNotePlaceholder')}
                    placeholderTextColor="$gray400"
                    textAlignVertical="top"
                    style={{
                      borderWidth: 1,
                      borderColor: Palette.gray200,
                      borderRadius: 12,
                      padding: 12,
                      minHeight: 84,
                      fontSize: 14,
                      color: Palette.ink,
                      backgroundColor: Palette.white,
                    }}
                  />
                </FormControl>
              </VStack>
            )}
          </ModalBody>
          <ModalFooter>
            <HStack space="md" w="100%">
              <Button 
                variant="outline" 
                flex={1} 
                onPress={() => {
                  setShowUpdateModal(false);
                  setSelectedTask(null);
                  setUpdateStatus('');
                  setUpdateNotes('');
                }}
              >
                <ButtonText>{t('common.cancel')}</ButtonText>
              </Button>
              <Button 
                flex={1} 
                onPress={handleUpdateTask}
                isDisabled={isUpdating || !updateStatus}
              >
                {isUpdating ? <Spinner color="white" size="small" /> : <ButtonText>{t('tasksScreen.saveMyStatus')}</ButtonText>}
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </SafeAreaView>
  );
};

export default TasksScreen;