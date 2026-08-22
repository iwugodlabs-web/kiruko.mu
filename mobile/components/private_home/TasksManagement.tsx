import React, { useEffect } from 'react';
import { Palette } from '@/app/constants/theme';
import {
  Box,
  Heading,
  HStack,
  Pressable,
  Text,
  VStack,
  ScrollView,
  Toast,
  ToastTitle,
  useToast
} from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Animated, { FadeIn, SlideInRight, useSharedValue, useAnimatedStyle, withRepeat, withTiming, Easing } from '@/app/utils/animated';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';

// Matches TaskData in home.tsx normalization
interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'started' | 'completed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  due_date?: string;
  estimated_hours?: number;
  completed_hours?: number;
  assignedDate?: string;
}

interface TasksManagementProps {
  tasks: Task[];
  selectedTaskFilter: 'all' | 'pending' | 'started' | 'completed';
  onTaskFilterChange: (filter: string) => void;
  isTasksLoading: boolean;
  authLoading: boolean;
  onTaskUpdate: (taskId: string, status: string) => void;
}

const TasksManagement: React.FC<TasksManagementProps> = ({
  tasks = [],
  selectedTaskFilter = 'all',
  onTaskFilterChange,
  isTasksLoading,
  authLoading,
  onTaskUpdate
}) => {
  const router = useRouter();
  const toast = useToast();
  const { t } = useTranslation();

  const priorityLabel = (p: string) => {
    switch (p) {
      case 'urgent': return t('tasksScreen.priorityUrgent');
      case 'high': return t('tasksScreen.priorityHigh');
      case 'medium': return t('tasksScreen.priorityMedium');
      default: return t('tasksScreen.priorityLow');
    }
  };

  // Pulse animation for loading state — hooks must be at top level
  const pulseOpacity = useSharedValue(1);
  useEffect(() => {
    pulseOpacity.value = withRepeat(
      withTiming(0.2, { duration: 700, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulseOpacity.value }));

  const handleTaskStatusUpdate = (taskId: string, newStatus: string) => {
    onTaskUpdate(taskId, newStatus);
    toast.show({
      placement: 'top',
      render: ({ id }) => {
        return (
          <Toast nativeID={'toast-' + id} action="success" variant="accent">
            <VStack space="xs">
              <ToastTitle>{t('tasksScreen.updatingTask')}</ToastTitle>
            </VStack>
          </Toast>
        )
      }
    });
  };

  const filteredTasks = tasks.filter(t => {
    if (selectedTaskFilter === 'all') return t.status !== 'completed';
    return t.status === selectedTaskFilter;
  });

  const getPriorityConfig = (priority: string) => {
    switch (priority) {
      case 'urgent': return { color: Palette.errorAlt, bg: Palette.errorTint, icon: 'priority-high' };
      case 'high': return { color: Palette.gold, bg: Palette.warningTint, icon: 'arrow-upward' };
      case 'medium': return { color: Palette.blue, bg: Palette.blueTint, icon: 'remove' };
      default: return { color: Palette.gray500, bg: Palette.gray100, icon: 'arrow-downward' };
    }
  };

  const formatDate = (dateString?: string) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch (e) {
      return dateString;
    }
  };

  if (isTasksLoading || authLoading) {
    return (
      <Box bg="white" p="$6" rounded="$3xl" height={200} justifyContent="center" alignItems="center">
        <Animated.View style={pulseStyle}>
          <MaterialIcons name="hourglass-empty" size={32} color={Palette.gray300} />
        </Animated.View>
        <Text color="$gray400" mt="$4" fontSize={12} fontWeight="600">{t('tasksScreen.syncingTasks')}</Text>
      </Box>
    );
  }

  return (
    <Animated.View entering={FadeIn.duration(700).delay(300)}>
      <Box
        bg="white"
        p="$6"
        rounded="$3xl"
        shadowColor={Palette.black}
        shadowOffset={{ width: 0, height: 10 }}
        shadowOpacity={0.05}
        shadowRadius={24}
        elevation={5}
        borderWidth={1}
        borderColor="$borderLight50"
      >
        <HStack justifyContent="space-between" alignItems="center" mb="$6">
          <HStack space="md" alignItems="center">
            <Box bg="$violet50" p="$3" rounded="$2xl">
              <MaterialIcons name="assignment-turned-in" size={24} color={Palette.violet} />
            </Box>
            <VStack>
              <Heading size="md" color="$textDark900" fontWeight="800" letterSpacing={-0.5}>
                {t('tasksScreen.myTasks')}
              </Heading>
              <Text color="$textLight400" fontSize={12} fontWeight="600">
                {t('tasksScreen.activeThisWeek', { count: tasks.filter(tk => tk.status !== 'completed').length })}
              </Text>
            </VStack>
          </HStack>
        </HStack>

        <Box mb="$5">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20 }}>
            <HStack space="sm">
              {(['all', 'pending', 'started', 'completed'] as const).map((f) => {
                let label: string = f;
                if (f === 'all') label = t('tasksScreen.filterActive');
                if (f === 'pending') label = t('tasksScreen.filterPending');
                if (f === 'started') label = t('tasksScreen.filterStarted');
                if (f === 'completed') label = t('tasksScreen.filterDone');

                const isActive = selectedTaskFilter === f;
                const activeColors = f === 'all' ? [Palette.gray100, Palette.gray200] :
                  f === 'pending' ? [Palette.warningTint, Palette.warningTint] :
                    f === 'started' ? [Palette.blueTint, Palette.blue] :
                      [Palette.successTint, Palette.greenTint];
                const activeText = f === 'all' ? Palette.gray700 :
                  f === 'pending' ? Palette.gold :
                    f === 'started' ? Palette.blue :
                      Palette.success;

                return (
                  <Pressable key={f} onPress={() => onTaskFilterChange(f)}>
                    {({ pressed }: any) => (
                      <Box
                        bg={isActive ? activeColors[0] : 'transparent'}
                        px="$4"
                        py="$2"
                        rounded="$full"
                        borderWidth={1}
                        borderColor={isActive ? activeColors[1] : '$gray100'}
                        style={{ transform: [{ scale: pressed ? 0.96 : 1 }] }}
                      >
                        <Text
                          fontSize={12}
                          fontWeight={isActive ? "700" : "600"}
                          color={isActive ? activeText : "$gray400"}
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

        <VStack space="lg">
          {filteredTasks.length === 0 ? (
            <Box py="$12" alignItems="center" justifyContent="center" bg="$gray50" rounded="$3xl" borderStyle="dashed" borderWidth={2} borderColor="$gray200" opacity={0.8}>
              <Box bg="white" p="$4" rounded="$full" mb="$4" shadowColor={Palette.black} shadowOpacity={0.05} shadowRadius={8} elevation={2}>
                <MaterialIcons name="check" size={32} color={Palette.teal} />
              </Box>
              <Text color="$gray900" fontWeight="700" fontSize={16}>{t('tasksScreen.allCaughtUp')}</Text>
              <Text color="$gray400" fontSize={13} mt="$1">{t('tasksScreen.noTasksForFilter')}</Text>
            </Box>
          ) : (
            filteredTasks.slice(0, 3).map((task, index) => {
              const priorityConfig = getPriorityConfig(task.priority);
              const progress = task.estimated_hours ? Math.min((task.completed_hours || 0) / task.estimated_hours, 1) : 0;

              return (
                <Animated.View key={task.id} entering={SlideInRight.delay(index * 100).springify()}>
                  <Box
                    bg="white"
                    p="$0"
                    rounded="$3xl"
                    borderWidth={1}
                    borderColor="$gray100"
                    shadowColor={Palette.black}
                    shadowOffset={{ width: 0, height: 4 }}
                    shadowOpacity={0.03}
                    shadowRadius={12}
                    elevation={2}
                    overflow="hidden"
                  >
                    <Box p="$4">
                      <HStack justifyContent="space-between" mb="$3" alignItems="center">
                        <Box bg={priorityConfig.bg} px="$2.5" py="$1" rounded="$lg" flexDirection="row" alignItems="center">
                          <MaterialIcons name={priorityConfig.icon as any} size={12} color={priorityConfig.color} style={{ marginRight: 4 }} />
                          <Text color={priorityConfig.color} fontSize={10} fontWeight="800" textTransform="uppercase" letterSpacing={0.5}>
                            {priorityLabel(task.priority)}
                          </Text>
                        </Box>

                        {task.due_date ? (
                          <Box bg="$gray50" px="$2" py="$1" rounded="$md">
                            <Text color="$gray500" fontSize={11} fontWeight="600">
                              {formatDate(task.due_date)}
                            </Text>
                          </Box>
                        ) : null}
                      </HStack>

                      <VStack space="xs" mb="$4">
                        <Text color="$gray900" fontWeight="800" fontSize={16} numberOfLines={1}>
                          {task.title}
                        </Text>
                        {task.description ? (
                          <Text color="$gray500" fontSize={13} numberOfLines={2} lineHeight={18} fontWeight="500">
                            {task.description}
                          </Text>
                        ) : null}
                      </VStack>

                      {task.estimated_hours ? (
                        <VStack space="xs" mb="$4">
                          <HStack justifyContent="space-between">
                            <Text color="$gray400" fontSize={10} fontWeight="700" letterSpacing={0.5}>{t('tasksScreen.completion')}</Text>
                            <Text color="$violet600" fontSize={10} fontWeight="800">{Math.round(progress * 100)}%</Text>
                          </HStack>
                          <Box h={6} bg="$gray100" rounded="$full" overflow="hidden">
                            <LinearGradient
                              colors={[Palette.violet, Palette.blueTint]}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 0 }}
                              style={{ width: `${progress * 100}%`, height: '100%' }}
                            />
                          </Box>
                        </VStack>
                      ) : null}

                      <HStack justifyContent="flex-end" space="md">
                        {task.status === 'pending' && (
                          <Pressable onPress={() => handleTaskStatusUpdate(task.id, 'started')} style={{ width: '100%' }}>
                            {({ pressed }: any) => (
                              <LinearGradient
                                colors={[Palette.blue, Palette.blue]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={{
                                  paddingVertical: 10,
                                  borderRadius: 14,
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexDirection: 'row',
                                  opacity: pressed ? 0.9 : 1
                                }}
                              >
                                <MaterialIcons name="play-arrow" size={16} color="white" style={{ marginRight: 6 }} />
                                <Text color="white" fontSize={12} fontWeight="700">{t('tasksScreen.startTask')}</Text>
                              </LinearGradient>
                            )}
                          </Pressable>
                        )}

                        {task.status === 'started' && (
                          <Pressable onPress={() => handleTaskStatusUpdate(task.id, 'completed')} style={{ width: '100%' }}>
                            {({ pressed }: any) => (
                              <LinearGradient
                                colors={[Palette.teal, Palette.success]}
                                start={{ x: 0, y: 0 }}
                                end={{ x: 1, y: 1 }}
                                style={{
                                  paddingVertical: 10,
                                  borderRadius: 14,
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  flexDirection: 'row',
                                  opacity: pressed ? 0.9 : 1
                                }}
                              >
                                <MaterialIcons name="check" size={16} color="white" style={{ marginRight: 6 }} />
                                <Text color="white" fontSize={12} fontWeight="700">{t('tasksScreen.markComplete')}</Text>
                              </LinearGradient>
                            )}
                          </Pressable>
                        )}

                        {task.status === 'completed' && (
                          <Box bg="$green50" px="$4" py="$2" rounded="$xl" flexDirection="row" alignItems="center" justifyContent="center" width="100%">
                            <MaterialIcons name="check-circle" size={16} color={Palette.success} style={{ marginRight: 6 }} />
                            <Text color="$green700" fontSize={12} fontWeight="700">{t('tasksScreen.completed')}</Text>
                          </Box>
                        )}
                      </HStack>
                    </Box>
                  </Box>
                </Animated.View>
              );
            })
          )}
        </VStack>

        <Pressable onPress={() => router.push('/private_dashboard/tasks')} mt="$6" mb="$2" alignItems="center" hitSlop={10}>
          <HStack space="xs" alignItems="center">
            <Text color="$blue600" fontSize={13} fontWeight="700">{t('tasksScreen.viewFullSchedule')}</Text>
            <MaterialIcons name="arrow-forward" size={14} color={Palette.blue} />
          </HStack>
        </Pressable>
      </Box>
    </Animated.View>
  );
};

export default TasksManagement;