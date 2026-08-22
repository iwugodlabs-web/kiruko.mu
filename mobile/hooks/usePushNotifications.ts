import { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { registerPushToken } from '../services/api';
import useAuth from '@/app/hooks/useAuth';

// A route parked because the user tapped a notification while logged out. It's
// replayed once authentication succeeds so the legit deep-link UX is preserved
// without ever routing an unauthenticated user into protected screens.
let pendingRoute: string | null = null;

// Map a notification payload to its destination route. Returns null for
// payloads that shouldn't navigate anywhere.
function routeFor(data: any): string | null {
  if (!data) return null;
  // Clock-in/out reminders -> open the clock screen so the user can punch manually
  if (data.type === 'clock_reminder') return '/private_dashboard/clock-in';
  return null;
}

// Route a tapped notification to the right screen — but never into protected
// space while logged out. If unauthenticated, park the route and send the user
// to login; it is replayed after a successful sign-in (see the effect below).
function handleNotificationNavigation(data: any, isAuthenticated: boolean) {
  const target = routeFor(data);
  if (!target) return;
  if (!isAuthenticated) {
    pendingRoute = target;
    router.replace('/login');
    return;
  }
  router.push(target as any);
}

// Set up the notification handler
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export default function usePushNotifications() {
  const [expoPushToken, setExpoPushToken] = useState<string | undefined>();
  const [notification, setNotification] = useState<Notifications.Notification | undefined>();
  const notificationListener = useRef<any>();
  const responseListener = useRef<any>();
  const { isAuthenticated } = useAuth();
  // The notification listeners are registered once (empty-deps effect below);
  // read auth through a ref so their callbacks always see the current value
  // instead of the stale `false` captured at mount.
  const isAuthenticatedRef = useRef(isAuthenticated);
  isAuthenticatedRef.current = isAuthenticated;

  useEffect(() => {
    registerForPushNotificationsAsync().then(token => {
      if (token) {
        setExpoPushToken(token);
        // Register token with backend
        registerPushToken(token);
      }
    });

    // Listen for incoming notifications while the app is active
    notificationListener.current = Notifications.addNotificationReceivedListener(notification => {
      setNotification(notification);
    });

    // If the app was launched by tapping a notification, route once on mount
    Notifications.getLastNotificationResponseAsync().then(response => {
      if (response) {
        handleNotificationNavigation(
          response.notification.request.content.data,
          isAuthenticatedRef.current,
        );
      }
    });

    // Listen for user interaction with notifications (tap -> navigate)
    responseListener.current = Notifications.addNotificationResponseReceivedListener(response => {
      handleNotificationNavigation(
        response.notification.request.content.data,
        isAuthenticatedRef.current,
      );
    });

    return () => {
      Notifications.removeNotificationSubscription(notificationListener.current);
      Notifications.removeNotificationSubscription(responseListener.current);
    };
  }, []);

  // Replay a parked notification route once the user becomes authenticated.
  useEffect(() => {
    if (isAuthenticated && pendingRoute) {
      const target = pendingRoute;
      pendingRoute = null;
      router.push(target as any);
    }
  }, [isAuthenticated]);

  return {
    expoPushToken,
    notification,
  };
}

async function registerForPushNotificationsAsync() {
  let token;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'default',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#FF231F7C',
    });
  }

  if (Device.isDevice) {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== 'granted') {
      console.warn('[Push] Notification permission denied — push notifications disabled');
      return;
    }
    
    // Check if the user is using a real physical device as Expo Push Service 
    // often fails on simulators for iOS
    try {
      const projectId =
        Constants.expoConfig?.extra?.eas?.projectId ??
        (Constants as any).easConfig?.projectId;
      token = (await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      )).data;
      console.log('[Push] Token generated:', token);
    } catch (e) {
      console.warn('[Push] Could not generate push token (simulator or missing projectId):', e);
    }
  } else {
    console.log('Must use physical device for Push Notifications');
  }

  return token;
}
