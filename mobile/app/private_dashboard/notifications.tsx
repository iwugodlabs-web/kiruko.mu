import { Palette, Type } from '@/app/constants/theme';
import {
    getUserNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    dismissNotification,
    dismissAllNotifications,
    Notification,
} from '@/services/api';
import { MaterialIcons } from '@expo/vector-icons';
import {
    Box,
    HStack,
    Pressable,
    ScrollView,
    Spinner,
    Text,
    VStack,
} from '@gluestack-ui/themed';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { formatDateTime } from '@/app/utils/intl';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { PremiumHeader } from '@/components/PremiumHeader';

const NotificationStyle: Record<string, { icon: string; color: string; tint: string }> = {
    overtime_confirmation: { icon: 'notifications-active', color: Palette.gold, tint: Palette.goldTint },
    overtime_approved:    { icon: 'check-circle',          color: Palette.success, tint: Palette.greenTint },
    overtime_rejected:    { icon: 'cancel',                color: Palette.error, tint: Palette.errorTint },
    clock_out_reminder:   { icon: 'access-time',           color: Palette.gold, tint: Palette.goldTint },
};
const defaultStyle = { icon: 'notifications', color: Palette.gray500, tint: Palette.gray100 };

export default function EmployeeNotificationsScreen() {
    const router = useRouter();
    const { t } = useTranslation();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const loadNotifications = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true);
        else setIsLoading(true);

        const result = await getUserNotifications();
        if (Array.isArray(result)) {
            setNotifications(result);
        }

        if (isRefresh) setRefreshing(false);
        else setIsLoading(false);
    }, []);

    useFocusEffect(
        useCallback(() => {
            loadNotifications();
        }, [loadNotifications])
    );

    // Refresh in real time when a push arrives while the screen is open
    useEffect(() => {
        const sub = Notifications.addNotificationReceivedListener(() => {
            loadNotifications();
        });
        return () => sub.remove();
    }, [loadNotifications]);

    const handleMarkRead = async (notificationId: number) => {
        await markNotificationAsRead(notificationId);
        setNotifications(prev =>
            prev.map(n => n.notification_id === notificationId ? { ...n, is_read: true } : n)
        );
    };

    const handleMarkAllRead = async () => {
        await markAllNotificationsAsRead();
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
    };

    const handleDismiss = async (notificationId: number) => {
        // Optimistic remove
        setNotifications(prev => prev.filter(n => n.notification_id !== notificationId));
        await dismissNotification(notificationId);
    };

    const handleDismissAll = () => {
        Alert.alert(
            t('notificationsScreen.clearAllConfirmTitle'),
            t('notificationsScreen.clearAllConfirmBody'),
            [
                { text: t('notificationsScreen.cancel'), style: 'cancel' },
                {
                    text: t('notificationsScreen.clearAllAction'),
                    style: 'destructive',
                    onPress: async () => {
                        setNotifications([]);
                        await dismissAllNotifications();
                    },
                },
            ]
        );
    };

    const unreadCount = notifications.filter(n => !n.is_read).length;

    return (
        <Box flex={1} bg={Palette.gray50}>
            <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
                <PremiumHeader title={t('notificationsScreen.headerTitle')} onBack={() => router.replace('/private_dashboard/settings')} />

                {/* Sub-header: unread summary + actions */}
                <HStack
                    px="$4"
                    py="$3"
                    alignItems="center"
                    justifyContent="space-between"
                    borderBottomWidth={1}
                    borderBottomColor={Palette.gray100}
                    bg={Palette.white}
                >
                    <Text fontSize={Type.label} color={Palette.gray500} fontWeight="600">
                        {unreadCount > 0 ? t('notificationsScreen.unreadCount', { count: unreadCount }) : t('notificationsScreen.allCaughtUp')}
                    </Text>
                    <HStack space="sm" alignItems="center">
                        {unreadCount > 0 && (
                            <Pressable
                                onPress={handleMarkAllRead}
                                px="$3"
                                py="$1.5"
                                rounded="$lg"
                                bg={Palette.blueTint}
                            >
                                <Text fontSize={Type.label} fontWeight="600" color={Palette.blue}>
                                    {t('notificationsScreen.markAllRead')}
                                </Text>
                            </Pressable>
                        )}
                        {notifications.length > 0 && (
                            <Pressable
                                onPress={handleDismissAll}
                                px="$3"
                                py="$1.5"
                                rounded="$lg"
                                bg={Palette.errorTint}
                            >
                                <Text fontSize={Type.label} fontWeight="600" color={Palette.error}>
                                    {t('notificationsScreen.clearAll')}
                                </Text>
                            </Pressable>
                        )}
                    </HStack>
                </HStack>

                {isLoading ? (
                    <Box flex={1} justifyContent="center" alignItems="center">
                        <Spinner size="large" color={Palette.gold} />
                        <Text fontSize={Type.title} color={Palette.gray700} mt="$3">
                            {t('notificationsScreen.headerTitle')}
                        </Text>
                    </Box>
                ) : notifications.length === 0 ? (
                    <Box flex={1} justifyContent="center" alignItems="center" px="$8">
                        <Box bg={Palette.gray100} p="$6" rounded="$full" mb="$4">
                            <MaterialIcons name="notifications-none" size={48} color={Palette.gray300} />
                        </Box>
                        <Text fontSize={Type.h3} fontWeight="700" color={Palette.ink} textAlign="center">
                            {t('notificationsScreen.emptyTitle')}
                        </Text>
                        <Text fontSize={Type.body} color={Palette.gray500} mt="$2" textAlign="center">
                            {t('notificationsScreen.emptyHint')}
                        </Text>
                    </Box>
                ) : (
                    <ScrollView
                        showsVerticalScrollIndicator={false}
                        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
                        refreshControl={
                            <RefreshControl
                                refreshing={refreshing}
                                onRefresh={() => loadNotifications(true)}
                                tintColor={Palette.blue}
                            />
                        }
                    >
                        <VStack space="sm">
                            {notifications.map(notification => {
                                const style = NotificationStyle[notification.notification_type] ?? defaultStyle;
                                const isUnread = !notification.is_read;

                                return (
                                    <Pressable
                                        key={notification.notification_id}
                                        onPress={() => isUnread && handleMarkRead(notification.notification_id)}
                                    >
                                        {({ pressed }: any) => (
                                            <Box
                                                bg={isUnread ? style.tint : Palette.white}
                                                borderRadius={18}
                                                borderWidth={1}
                                                borderColor={Palette.gray100}
                                                p="$4"
                                                opacity={pressed ? 0.85 : isUnread ? 1 : 0.6}
                                                shadowColor={Palette.black}
                                                shadowOffset={{ width: 0, height: isUnread ? 2 : 1 }}
                                                shadowOpacity={isUnread ? 0.05 : 0.02}
                                                shadowRadius={8}
                                                elevation={isUnread ? 2 : 1}
                                            >
                                                <HStack space="md" alignItems="flex-start">
                                                    {/* Icon chip */}
                                                    <Box
                                                        bg={style.tint}
                                                        borderRadius={10}
                                                        p="$2"
                                                        justifyContent="center"
                                                        alignItems="center"
                                                    >
                                                        <MaterialIcons name={style.icon as any} size={16} color={style.color} />
                                                    </Box>

                                                    {/* Content */}
                                                    <VStack flex={1} space="xs">
                                                        <HStack justifyContent="space-between" alignItems="center">
                                                            <Text
                                                                fontSize={Type.body}
                                                                fontWeight="700"
                                                                color={Palette.ink}
                                                                flex={1}
                                                                mr="$2"
                                                                numberOfLines={1}
                                                            >
                                                                {notification.title}
                                                            </Text>
                                                            <HStack space="xs" alignItems="center">
                                                                {isUnread && (
                                                                    <Box w={8} h={8} rounded="$full" bg={style.color} />
                                                                )}
                                                                {/* Dismiss button */}
                                                                <Pressable
                                                                    onPress={(e) => {
                                                                        e.stopPropagation?.();
                                                                        handleDismiss(notification.notification_id);
                                                                    }}
                                                                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                                                    p="$1"
                                                                    rounded="$full"
                                                                >
                                                                    <MaterialIcons name="close" size={15} color={Palette.gray400} />
                                                                </Pressable>
                                                            </HStack>
                                                        </HStack>

                                                        <Text fontSize={Type.small} color={Palette.gray600} lineHeight={18}>
                                                            {notification.message}
                                                        </Text>

                                                        {notification.created_at && (
                                                            <HStack alignItems="center" space="xs" mt="$1">
                                                                <MaterialIcons name="access-time" size={11} color={Palette.gray400} />
                                                                <Text fontSize={Type.tiny} color={Palette.gray400}>
                                                                    {formatDateTime(notification.created_at)}
                                                                </Text>
                                                            </HStack>
                                                        )}
                                                    </VStack>
                                                </HStack>
                                            </Box>
                                        )}
                                    </Pressable>
                                );
                            })}
                        </VStack>
                    </ScrollView>
                )}
            </SafeAreaView>
        </Box>
    );
}
