import { Palette, Type } from '@/app/constants/theme';
import {
    getUserNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead,
    confirmOvertimeByEmployer,
    rejectOvertimeByEmployer,
    Notification,
    isApiError,
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
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, SafeAreaView } from 'react-native';
import { useTranslation } from 'react-i18next';

const NotificationType: Record<string, { icon: string; color: string; tint: string }> = {
    overtime_alert: { icon: 'schedule', color: Palette.gold, tint: Palette.goldTint },
    overtime_confirmation: { icon: 'check-circle', color: Palette.teal, tint: Palette.tealTint },
    overtime_approved: { icon: 'verified', color: Palette.success, tint: Palette.greenTint },
    clock_out_reminder: { icon: 'access-time', color: Palette.gold, tint: Palette.goldTint },
};

const defaultStyle = { icon: 'notifications', color: Palette.gray500, tint: Palette.gray100 };

export default function CompanyNotificationsScreen() {
    const router = useRouter();
    const { t } = useTranslation();
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [confirmingId, setConfirmingId] = useState<number | null>(null);
    const [rejectingId, setRejectingId] = useState<number | null>(null);

    const loadNotifications = useCallback(async () => {
        setIsLoading(true);
        const result = await getUserNotifications();
        if (Array.isArray(result)) {
            setNotifications(result);
        }
        setIsLoading(false);
    }, []);

    useFocusEffect(
        useCallback(() => {
            loadNotifications();
        }, [loadNotifications])
    );

    // Refresh list instantly when a push arrives while this screen is open
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

    const handleConfirmOvertime = async (timelogId: number, notificationId: number) => {
        setConfirmingId(notificationId);
        try {
            const result = await confirmOvertimeByEmployer(timelogId);
            if (isApiError(result)) {
                Alert.alert(t('common.errorTitle'), result.error || t('companyDashboard.notifFailConfirm'));
            } else {
                await markNotificationAsRead(notificationId);
                setNotifications(prev =>
                    prev.map(n => n.notification_id === notificationId ? { ...n, is_read: true } : n)
                );
                Alert.alert(t('companyDashboard.notifConfirmedTitle'), t('companyDashboard.notifConfirmedBody'));
            }
        } catch {
            Alert.alert(t('common.errorTitle'), t('companyDashboard.notifSomethingWrong'));
        } finally {
            setConfirmingId(null);
        }
    };

    const handleRejectOvertime = async (timelogId: number, notificationId: number) => {
        setRejectingId(notificationId);
        try {
            const result = await rejectOvertimeByEmployer(timelogId);
            if (isApiError(result)) {
                Alert.alert(t('common.errorTitle'), result.error || t('companyDashboard.notifFailReject'));
            } else {
                await markNotificationAsRead(notificationId);
                setNotifications(prev =>
                    prev.map(n => n.notification_id === notificationId ? { ...n, is_read: true } : n)
                );
                Alert.alert(t('companyDashboard.notifRejectedTitle'), t('companyDashboard.notifRejectedBody'));
            }
        } catch {
            Alert.alert(t('common.errorTitle'), t('companyDashboard.notifSomethingWrong'));
        } finally {
            setRejectingId(null);
        }
    };

    const unreadCount = notifications.filter(n => !n.is_read).length;

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
            {/* Header */}
            <HStack
                px="$4"
                pt="$2"
                pb="$3"
                alignItems="center"
                justifyContent="space-between"
                borderBottomWidth={1}
                borderBottomColor={Palette.gray100}
            >
                <HStack alignItems="center" space="sm" flex={1}>
                    <Pressable onPress={() => router.replace('/company_dashboard/settings')}>
                        <Box
                            w={36}
                            h={36}
                            rounded="$full"
                            bg={Palette.gray100}
                            justifyContent="center"
                            alignItems="center"
                        >
                            <MaterialIcons name="arrow-back" size={20} color={Palette.gray700} />
                        </Box>
                    </Pressable>
                    <VStack>
                        <Text fontSize={Type.h2} fontWeight="800" color={Palette.ink} letterSpacing={-0.5}>{t('companyDashboard.notifTitle')}</Text>
                        {unreadCount > 0 && (
                            <Text fontSize={Type.small} color={Palette.gray500}>{t('companyDashboard.notifUnread', { count: unreadCount })}</Text>
                        )}
                    </VStack>
                </HStack>
                {unreadCount > 0 && (
                    <Pressable onPress={handleMarkAllRead} px="$3" py="$1.5" rounded="$lg" bg={Palette.blueTint}>
                        <Text fontSize={Type.label} fontWeight="600" color={Palette.blue}>{t('companyDashboard.notifMarkAllRead')}</Text>
                    </Pressable>
                )}
            </HStack>

            {isLoading ? (
                <VStack flex={1} justifyContent="center" alignItems="center" space="md">
                    <Spinner size="large" color={Palette.gold} />
                    <Text color={Palette.gray700} fontSize={Type.title}>{t('companyDashboard.activityLoading')}</Text>
                </VStack>
            ) : notifications.length === 0 ? (
                <Box flex={1} justifyContent="center" alignItems="center" px="$8">
                    <MaterialIcons name="notifications-none" size={64} color={Palette.gray300} />
                    <Text fontSize={Type.h3} fontWeight="700" color={Palette.ink} mt="$3" textAlign="center">
                        {t('companyDashboard.notifEmptyTitle')}
                    </Text>
                    <Text fontSize={Type.body} color={Palette.gray500} mt="$1" textAlign="center">
                        {t('companyDashboard.notifEmptyBody')}
                    </Text>
                </Box>
            ) : (
                <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingVertical: 8, paddingHorizontal: 16 }}
                    refreshControl={
                        <RefreshControl refreshing={isLoading} onRefresh={loadNotifications} tintColor={Palette.gold} />
                    }
                >
                    <VStack space="sm">
                        {notifications.map(notification => {
                            const style = NotificationType[notification.notification_type] ?? defaultStyle;
                            const timelog_id = notification.meta?.timelog_id as number | undefined;
                            const isOvertimeAlert = notification.notification_type === 'overtime_alert';

                            return (
                                <Pressable
                                    key={notification.notification_id}
                                    onPress={() => !notification.is_read && handleMarkRead(notification.notification_id)}
                                >
                                    <Box
                                        bg={notification.is_read ? Palette.white : style.tint}
                                        borderRadius={18}
                                        borderWidth={1}
                                        borderColor={Palette.gray100}
                                        p="$3.5"
                                    >
                                        <HStack space="sm" alignItems="flex-start">
                                            {/* Icon chip */}
                                            <Box
                                                style={{ backgroundColor: style.tint, borderRadius: 10, padding: 8 }}
                                                mt="$0.5"
                                            >
                                                <MaterialIcons name={style.icon as any} size={16} color={style.color} />
                                            </Box>

                                            {/* Content */}
                                            <VStack flex={1} space="xs">
                                                <HStack justifyContent="space-between" alignItems="center">
                                                    <Text fontSize={Type.body} fontWeight="700" color={Palette.ink} flex={1} mr="$2">
                                                        {notification.title}
                                                    </Text>
                                                    {!notification.is_read && (
                                                        <Box w={8} h={8} rounded="$full" bg={style.color} />
                                                    )}
                                                </HStack>
                                                <Text fontSize={Type.small} color={Palette.gray600} lineHeight={18}>
                                                    {notification.message}
                                                </Text>
                                                {notification.created_at && (
                                                    <Text fontSize={Type.tiny} color={Palette.gray400} mt="$0.5">
                                                        {new Date(notification.created_at).toLocaleString()}
                                                    </Text>
                                                )}

                                                {/* Confirm + Reject buttons for overtime_alert */}
                                                {isOvertimeAlert && timelog_id && !notification.is_read && (
                                                    <HStack space="sm" mt="$2">
                                                        <Pressable
                                                            flex={1}
                                                            onPress={() => handleConfirmOvertime(timelog_id, notification.notification_id)}
                                                            disabled={confirmingId === notification.notification_id || rejectingId === notification.notification_id}
                                                        >
                                                            <Box
                                                                bg={Palette.gold}
                                                                py="$2"
                                                                rounded="$lg"
                                                                alignItems="center"
                                                                opacity={confirmingId === notification.notification_id ? 0.6 : 1}
                                                            >
                                                                <HStack alignItems="center" space="xs">
                                                                    {confirmingId === notification.notification_id ? (
                                                                        <Spinner size="small" color={Palette.white} />
                                                                    ) : (
                                                                        <MaterialIcons name="check" size={15} color={Palette.white} />
                                                                    )}
                                                                    <Text fontSize={Type.label} fontWeight="700" color={Palette.white}>{t('companyDashboard.notifApprove')}</Text>
                                                                </HStack>
                                                            </Box>
                                                        </Pressable>

                                                        <Pressable
                                                            flex={1}
                                                            onPress={() => handleRejectOvertime(timelog_id, notification.notification_id)}
                                                            disabled={confirmingId === notification.notification_id || rejectingId === notification.notification_id}
                                                        >
                                                            <Box
                                                                bg={Palette.white}
                                                                borderWidth={1.5}
                                                                borderColor={Palette.errorAlt}
                                                                py="$2"
                                                                rounded="$lg"
                                                                alignItems="center"
                                                                opacity={rejectingId === notification.notification_id ? 0.6 : 1}
                                                            >
                                                                <HStack alignItems="center" space="xs">
                                                                    {rejectingId === notification.notification_id ? (
                                                                        <Spinner size="small" color={Palette.gold} />
                                                                    ) : (
                                                                        <MaterialIcons name="close" size={15} color={Palette.errorAlt} />
                                                                    )}
                                                                    <Text fontSize={Type.label} fontWeight="700" color={Palette.errorAlt}>{t('companyDashboard.notifReject')}</Text>
                                                                </HStack>
                                                            </Box>
                                                        </Pressable>
                                                    </HStack>
                                                )}
                                            </VStack>
                                        </HStack>
                                    </Box>
                                </Pressable>
                            );
                        })}
                    </VStack>
                </ScrollView>
            )}
        </SafeAreaView>
    );
}
