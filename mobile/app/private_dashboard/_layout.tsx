import { Ionicons } from '@expo/vector-icons';
import { Palette } from '@/app/constants/theme';
import { useToken } from '@gluestack-style/react';
import { Tabs, useRouter } from 'expo-router';
import { BlurView } from 'expo-blur';
import {
  Calculator,
  CheckSquare,
  Clock,
  Home,
  MoreHorizontal,
  Settings,
} from 'lucide-react-native';
import React from 'react';
import { Platform, StyleSheet, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useAuth from '../hooks/useAuth';
import { useRequireAuth } from '@/components/AuthGuard';

export default function DashboardLayout() {
  const primary = useToken('colors', 'primary500');
  const inactive = useToken('colors', 'textDark700');
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();

  // Auth boundary — this runs before any child screen renders, so it gates
  // EVERY page in the private dashboard (including entries via notification
  // taps / deep links that bypass app/index.tsx). Unauthenticated users are
  // redirected to /login; a company user is bounced to their own dashboard.
  const { ready } = useRequireAuth('private');

  // Plan Phase 12.B — soft bounce on navigation. If a deep link or
  // notification routes a non-onboarded user into the private dashboard,
  // bounce them back to /private_dashboard/profile. The profile screen
  // is itself part of this layout so the bounce settles after one cycle.
  React.useEffect(() => {
    if (user && user.user_type === 'private' && user.onboard_complete === false) {
      router.replace('/private_dashboard/profile');
    }
  }, [user, router]);

  // Hold rendering until auth is resolved AND the user is allowed here, so no
  // protected content flashes before a pending redirect settles.
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Palette.white }}>
        <ActivityIndicator size="large" color={primary} />
      </View>
    );
  }

  // insets.bottom covers BOTH iOS's home indicator and Android's gesture-nav
  // reserved area — it isn't iOS-only. Gating it to iOS left Android devices
  // with gesture navigation (no on-screen 3-button bar, so insets.bottom can
  // be 20-48px) with only a flat 8px pad, letting the tab bar's icons/labels
  // collide with or get clipped by the system nav area. `Math.max(..., 8)`
  // keeps the old 8px floor for Android devices that report 0 (older
  // 3-button nav, which doesn't overlap the app at all).
  const tabBarBottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 8 : 0);
  const tabHeight = 60 + tabBarBottomInset;

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: primary,
        tabBarInactiveTintColor: inactive,
        tabBarStyle: {
          position: 'absolute',
          borderTopWidth: 0,
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : 'rgba(255, 255, 255, 0.96)',
          elevation: 10,
          height: tabHeight,
          paddingBottom: tabBarBottomInset,
          paddingTop: 10,
          borderTopColor: 'transparent',
          shadowColor: Palette.black,
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.05,
          shadowRadius: 10,
        },
        tabBarBackground: () => (
          <BlurView
            tint="light"
            intensity={Platform.OS === 'ios' ? 85 : 0}
            style={StyleSheet.absoluteFill}
          />
        ),
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '700',
          marginTop: 4,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        },
        tabBarIconStyle: {
          marginTop: 2,
        },
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => (
            <Home size={24} color={focused ? primary : color} />
          ),
        }}
      />

      <Tabs.Screen
        name="clock-in"
        options={{
          title: 'Clock In',
          tabBarIcon: ({ color, focused }) => (
            <Clock size={24} color={focused ? primary : color} />
          ),
        }}
      />

      <Tabs.Screen
        name="calculator"
        options={{
          title: 'Calculator',
          tabBarIcon: ({ color, focused }) => (
            <Calculator size={24} color={focused ? primary : color} />
          ),
        }}
      />

      <Tabs.Screen
        name="tasks"
        options={{
          title: 'Tasks',
          tabBarIcon: ({ color, focused }) => (
            <CheckSquare size={24} color={focused ? primary : color} />
          ),
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <Settings size={22} color={focused ? primary : color} />
          ),
        }}
      />

      <Tabs.Screen
        name="expenses"
        options={{
          href: null,
          title: 'Expenses',
          headerShown: false,
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="your_right_history"
        options={{
          href: null,
          title: 'My Concerns',
          headerShown: false,
          tabBarStyle: { display: 'none' },
          headerLeft: () => (
            <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 16 }}>
              <Ionicons name="arrow-back" size={24} color="black" />
            </TouchableOpacity>
          ),
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="your_right"
        options={{
          href: null,
          title: 'Raise a Concern',
          headerShown: false,
          tabBarStyle: { display: 'none' },
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="your_right_pin"
        options={{
          href: null,
          title: 'Save Case Access',
          headerShown: false,
          tabBarStyle: { display: 'none' },
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="concern_thread"
        options={{
          href: null,
          title: 'Concern Thread',
          headerShown: false,
          // Full-screen flow — hide the bottom tab bar so it doesn't cover the
          // message composer at the bottom of the thread.
          tabBarStyle: { display: 'none' },
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="payslips"
        options={{
          href: null,
          title: 'Payslips',
          headerShown: false,
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />


      <Tabs.Screen
        name="clockin_history"
        options={{
          href: null,
          title: 'Work History',
          headerShown: false,
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />


      <Tabs.Screen
        name="profile"
        options={{
          href: null,
          title: 'Profile',
          headerShown: false,
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="transfers"
        options={{
          href: null,
          title: 'Transfers',
          headerShown: false,
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="leave"
        options={{
          href: null,
          title: 'Leave Request',
          headerShown: false,
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="notifications"
        options={{
          href: null,
          title: 'Notifications',
          headerShown: false,
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="notification_preferences"
        options={{
          // Hidden from the tab bar — surfaced only from Settings.
          href: null,
          title: 'Notifications',
          headerShown: false,
        }}
      />

      <Tabs.Screen
        name="documents"
        options={{
          href: null,
          title: 'Document Vault',
          headerShown: false,
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="ad_preferences"
        options={{
          // Hidden from the tab bar — surfaced only from Settings.
          href: null,
          title: 'Ad preferences',
          headerShown: false,
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

    </Tabs>
  );
}
