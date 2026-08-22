import { Ionicons } from '@expo/vector-icons';
import { Palette } from '@/app/constants/theme';
import { useToken } from '@gluestack-style/react';
import { Tabs } from 'expo-router';
import { BlurView } from 'expo-blur';
import {
  Calendar,
  Clock,
  Home,
  MoreHorizontal,
  Settings,
  TrendingUp
} from 'lucide-react-native';
import React from 'react';
import { Platform, StyleSheet, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useAuth from '../hooks/useAuth';
import { hasCompanyPermission } from '@/services/permissions';
import { useRequireAuth } from '@/components/AuthGuard';

export default function DashboardCompanyLayout() {
  const primary = useToken('colors', 'primary500');
  const inactive = useToken('colors', 'textDark700');
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // Auth boundary — gates every page in the company dashboard against
  // unauthenticated entry (notification taps / deep links). A private user is
  // bounced to their own dashboard.
  const { ready } = useRequireAuth('company');

  // Role guides — mirror the web sidebar: hide tabs the role can't open.
  // Owners/admins pass implicitly via hasCompanyPermission. Home and Settings
  // are always visible (the web shows them to every company user).
  const canViewAttendance = hasCompanyPermission(user, 'view_attendance');
  const canViewSchedule = hasCompanyPermission(user, 'view_schedule');
  const canViewSalary = hasCompanyPermission(user, ['view_salary', 'view_payslip', 'manage_payroll']);

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
        name="employees"
        options={{
          href: null,
          title: 'Employees',
          headerShown: false,
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="schedule"
        options={{
          href: canViewSchedule ? undefined : null,
          title: 'Schedule',
          tabBarIcon: ({ color, focused }) => (
            <Calendar size={24} color={focused ? primary : color} />
          ),
        }}
      />

      <Tabs.Screen
        name="time_logs"
        options={{
          href: canViewAttendance ? undefined : null,
          title: 'Time',
          tabBarIcon: ({ color, focused }) => (
            <Clock size={24} color={focused ? primary : color} />
          ),
        }}
      />

      <Tabs.Screen
        name="leaves"
        options={{
          href: null,
          title: 'Leaves',
          headerShown: false,
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="payroll"
        options={{
          href: null,
          title: 'Payroll',
          headerShown: false,
          tabBarIcon: ({ color }) => <MoreHorizontal size={24} color={color} />,
        }}
      />

      <Tabs.Screen
        name="salaries"
        options={{
          href: canViewSalary ? undefined : null,
          title: 'Salaries',
          tabBarIcon: ({ color, focused }) => (
            <TrendingUp size={24} color={focused ? primary : color} />
          ),
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, focused }) => (
            <Settings size={24} color={focused ? primary : color} />
          ),
        }}
      />

      {/* Hidden routes for navigation */}
      <Tabs.Screen
        name="employees/[id]"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="notification_preferences"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="documents"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="clockin_history"
        options={{
          href: null,
        }}
      />
      <Tabs.Screen
        name="geofencing"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
