import { MaterialIcons } from '@expo/vector-icons';
import { Palette } from '@/app/constants/theme';
import {
  Box,
  Heading,
  HStack,
  Pressable,
  Text,
  VStack
} from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';
import React from 'react';
import Animated, { FadeIn } from '@/app/utils/animated';
import { useTranslation } from 'react-i18next';

interface QuickAction {
  id: string;
  title: string;
  subtitle: string;
  icon: string;
  route: string;
  color: {
    bg: string;
    icon: string;
    text: string;
    border: string;
  };
  badge?: string;
  badgeColor?: string;
}

interface QuickActionsProps {
  pendingTasksCount?: number;
  unreadNotifications?: number;
  currentlyWorking?: boolean;
  hasTimeOff?: boolean;
  authLoading?: boolean;
}

const QuickActions: React.FC<QuickActionsProps> = ({
  pendingTasksCount = 0,
  unreadNotifications = 0,
  currentlyWorking = false,
  hasTimeOff = false,
  authLoading = false,
}) => {
  const router = useRouter();
  const { t } = useTranslation();

  const quickActions: QuickAction[] = [
    {
      id: 'rights',
      title: t('privateHomeCards.actionRightsTitle'),
      subtitle: t('privateHomeCards.actionRightsSubtitle'),
      icon: 'gavel',
      route: '/private_dashboard/your_right_history',
      color: {
        bg: '$emerald50',
        icon: Palette.teal,
        text: '$emerald700',
        border: '$emerald200',
      },
    },
    {
      id: 'payroll',
      title: t('privateHomeCards.actionPayrollTitle'),
      subtitle: t('privateHomeCards.actionPayrollSubtitle'),
      icon: 'account-balance-wallet',
      route: '/private_dashboard/calculator',
      color: {
        bg: '$indigo50',
        icon: Palette.blue,
        text: '$indigo700',
        border: '$indigo200',
      },
    },
    {
      id: 'profile',
      title: t('privateHomeCards.actionProfileTitle'),
      subtitle: t('privateHomeCards.actionProfileSubtitle'),
      icon: 'person',
      route: '/private_dashboard/profile',
      color: {
        bg: '$pink50',
        icon: Palette.violet,
        text: '$pink700',
        border: '$pink200',
      },
    },
    {
      id: 'expenses',
      title: t('privateHomeCards.actionExpensesTitle'),
      subtitle: t('privateHomeCards.actionExpensesSubtitle'),
      icon: 'receipt',
      route: '/private_dashboard/expenses',
      color: {
        bg: '$amber50',
        icon: Palette.warning,
        text: '$amber700',
        border: '$amber200',
      },
    },
    {
      id: 'transfers',
      title: t('privateHomeCards.actionTransfersTitle'),
      subtitle: t('privateHomeCards.actionTransfersSubtitle'),
      icon: 'swap-horiz',
      route: '/private_dashboard/transfers',
      color: {
        bg: '$teal50',
        icon: Palette.teal,
        text: '$teal700',
        border: '$teal200',
      },
    },
    {
      id: 'tasks',
      title: t('privateHomeCards.actionScheduleTitle'),
      subtitle: t('privateHomeCards.actionScheduleSubtitle'),
      icon: 'assignment',
      route: '/private_dashboard/tasks',
      color: {
        bg: '$purple50',
        icon: Palette.violet,
        text: '$purple700',
        border: '$purple200',
      },
      badge: pendingTasksCount > 0 ? pendingTasksCount.toString() : undefined,
      badgeColor: '$blue500',
    },
    {
      id: 'clock-history',
      title: t('privateHomeCards.actionWorkHistoryTitle'),
      subtitle: t('privateHomeCards.actionWorkHistorySubtitle'),
      icon: 'history',
      route: '/private_dashboard/clockin_history',
      color: {
        bg: '$cyan50',
        icon: Palette.teal,
        text: '$cyan700',
        border: '$cyan200',
      },
      badge: currentlyWorking ? t('privateHomeCards.badgeActive') : undefined,
      badgeColor: '$green500',
    },
    {
      id: 'leave',
      title: t('privateHomeCards.actionLeaveTitle'),
      subtitle: t('privateHomeCards.actionLeaveSubtitle'),
      icon: 'event-available',
      route: '/private_dashboard/leave',
      color: {
        bg: '$violet50',
        icon: Palette.violet,
        text: '$violet700',
        border: '$violet200',
      },
      badge: hasTimeOff ? t('privateHomeCards.badgeApproved') : undefined,
      badgeColor: '$green500',
    },
    {
      id: 'documents',
      title: t('privateHomeCards.actionDocumentsTitle'),
      subtitle: t('privateHomeCards.actionDocumentsSubtitle'),
      icon: 'lock',
      route: '/private_dashboard/documents',
      color: {
        bg: '$teal50',
        icon: Palette.teal,
        text: '$teal700',
        border: '$teal200',
      },
    },
  ];

  const handleActionPress = (route: string) => {
    if (!authLoading && route && route !== '#') {
      try {
        router.push(route as any);
      } catch (error) {
        console.warn('Navigation error:', error);
        // Fallback - could show a toast or alert here
      }
    }
  };

  return (
    <Animated.View entering={FadeIn.duration(700).delay(400)}>
      <Box
        bg="white"
        p="$6"
        rounded="$3xl"
        shadowColor="$shadowColor"
        shadowOffset={{ width: 0, height: 4 }}
        shadowOpacity={0.1}
        shadowRadius={20}
        elevation={8}
        borderWidth={1}
        borderColor="$borderLight100"
      >
        <HStack alignItems="center" space="sm" mb="$6">
          <Box bg="$orange100" p="$3" rounded="$full">
            <MaterialIcons name="dashboard" size={24} color={Palette.gold} />
          </Box>
          <VStack flex={1}>
            <Heading size="lg" color="$textDark900" fontWeight="700">
              {t('privateHome.quickActions')}
            </Heading>
            <Text color="$textLight600" fontSize={14}>
              {t('privateHomeCards.quickActionsSubtitle')}
            </Text>
          </VStack>
        </HStack>

        <VStack space="sm">
          {quickActions.map((action, index) => (
            <Animated.View
              key={action.id}
              entering={FadeIn.duration(400).delay(100 * index)}
            >
              <Pressable
                onPress={() => handleActionPress(action.route)}
                disabled={authLoading}
                opacity={authLoading ? 0.6 : 1}
              >
                <Box
                  bg={action.color.bg}
                  p="$4"
                  rounded="$xl"
                  borderWidth={1}
                  borderColor={action.color.border}
                  position="relative"
                >
                  <HStack alignItems="center" space="sm">
                    <Box
                      bg="white"
                      p="$3"
                      rounded="$full"
                      shadowColor="$shadowColor"
                      shadowOffset={{ width: 0, height: 2 }}
                      shadowOpacity={0.1}
                      shadowRadius={4}
                      elevation={2}
                    >
                      <MaterialIcons
                        name={action.icon as any}
                        size={24}
                        color={action.color.icon}
                      />
                    </Box>
                    <VStack flex={1}>
                      <Text
                        color={action.color.text}
                        fontWeight="700"
                        fontSize={16}
                        numberOfLines={1}
                      >
                        {action.title}
                      </Text>
                      <Text
                        color="$gray600"
                        fontSize={14}
                        numberOfLines={2}
                      >
                        {action.subtitle}
                      </Text>
                    </VStack>

                    {/* Badge */}
                    {!!action.badge && (
                      <Box
                        bg={action.badgeColor}
                        px="$2"
                        py="$1"
                        rounded="$full"
                        minWidth={24}
                        alignItems="center"
                        justifyContent="center"
                        position="absolute"
                        top="$2"
                        right="$2"
                      >
                        <Text
                          color="white"
                          fontWeight="700"
                          fontSize={10}
                          textAlign="center"
                        >
                          {action.badge}
                        </Text>
                      </Box>
                    )}

                    {/* Arrow Icon */}
                    <Box ml="$2">
                      <MaterialIcons
                        name="chevron-right"
                        size={20}
                        color={Palette.gray400}
                      />
                    </Box>
                  </HStack>
                </Box>
              </Pressable>
            </Animated.View>
          ))}
        </VStack>
      </Box>
    </Animated.View>
  );
};

export default QuickActions;