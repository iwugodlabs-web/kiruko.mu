import { getUsersByCompany, isApiError, User } from '../../services/api';
import PermissionGate from '@/components/PermissionGate';
import { Palette, Type } from '@/app/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Box, ButtonText, HStack, Input, InputField, InputSlot,
  Modal, ModalBackdrop, ModalBody, ModalContent,
  Pressable, ScrollView, Spinner, Text, VStack, Badge, BadgeText,
  Avatar, AvatarFallbackText
} from '@gluestack-ui/themed';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, SafeAreaView, Platform } from 'react-native';
import Animated, { FadeInUp, SlideInRight, FadeIn } from '@/app/utils/animated';
import { format } from 'date-fns';

import useAuth from '../hooks/useAuth';
import { PremiumHeader } from '@/components/PremiumHeader';
import { useTranslation } from 'react-i18next';

const roleConfig = {
  company: { color: Palette.gold, bgColor: Palette.goldTint, textColor: Palette.gold, icon: 'business' },
  admin: { color: Palette.blue, bgColor: Palette.blueTint, textColor: Palette.blue, icon: 'admin-panel-settings' },
  manager: { color: Palette.teal, bgColor: Palette.tealTint, textColor: Palette.teal, icon: 'manage-accounts' },
  employee: { color: Palette.green, bgColor: Palette.greenTint, textColor: Palette.green, icon: 'person' }
};

export default function EmployeesPage() {
  return (
    <PermissionGate permission="view_employee" label="employees">
      <EmployeesPageInner />
    </PermissionGate>
  );
}

function EmployeesPageInner() {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showManageModal, setShowManageModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filtered users based on search (backend already filters out company users)
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;

    const query = searchQuery.toLowerCase().trim();
    return users.filter(u => {
      const fullName = `${u.private_user?.first_name || ''} ${u.private_user?.last_name || ''}`.toLowerCase();
      const email = (u.email || '').toLowerCase();
      const role = (u.user_type || '').toLowerCase();

      return fullName.includes(query) ||
        email.includes(query) ||
        role.includes(query);
    });
  }, [users, searchQuery]);

  // Analytics data - excluding company-type users
  const stats = useMemo(() => {
    return {
      total: filteredUsers.length,
      employees: filteredUsers.length,
      managers: filteredUsers.filter(u => (u.user_type || '').toLowerCase() === 'manager').length,
      departments: 1
    };
  }, [filteredUsers]);

  // Helper functions for premium features
  const getRoleConfig = (role: string) => roleConfig[role.toLowerCase() as keyof typeof roleConfig] || roleConfig.employee;

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName?.charAt(0) || ''}${lastName?.charAt(0) || ''}`.toUpperCase() || 'U';
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('companyEmployees.greetingMorning');
    if (hour < 18) return t('companyEmployees.greetingAfternoon');
    return t('companyEmployees.greetingEvening');
  };

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Check for company ID — private-type admins store it in private_user.company_id
    const companyId =
      user?.private_user?.company_id ||
      user?.company?.company_id ||
      (user?.company as any)?.id ||
      (user as any)?.company_id;

    if (!companyId) {
      setError('No company ID found');
      setLoading(false);
      return;
    }

    try {
      const response = await getUsersByCompany(companyId);
      if (isApiError(response)) {
        setError(response.error || 'Failed to load employees');
      } else {
        setUsers(response);
        setError(null);
      }
    } catch (err) {
      console.error('Error fetching users:', err);
      setError('Network error. Please check your connection.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchUsers();
    setRefreshing(false);
  }, [fetchUsers]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Palette.gray50 }}>
        <VStack flex={1} px="$6" py="$8">
          <Box mb="$8">
            <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink} letterSpacing={-0.5} mb="$2">
              {t('companyEmployees.teamMembers')}
            </Text>
            <Text color={Palette.gray700} fontSize={Type.title}>
              {t('companyEmployees.loadingTeam')}
            </Text>
          </Box>

          <Animated.View entering={FadeIn.duration(400)}>
            <VStack space="lg" alignItems="center" py="$12">
              <Spinner size="large" color={Palette.gold} />
              <Text fontSize={Type.title} fontWeight="600" color={Palette.gray700}>
                {t('companyEmployees.loadingEmployees')}
              </Text>
            </VStack>
          </Animated.View>
        </VStack>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: Palette.gray50 }}>
        <VStack flex={1} px="$6" py="$8">
          <Box mb="$8">
            <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink} letterSpacing={-0.5} mb="$2">
              {t('companyEmployees.teamMembers')}
            </Text>
            <Text color={Palette.gray700} fontSize={Type.title}>
              {t('companyEmployees.unableToLoad')}
            </Text>
          </Box>

          <Animated.View entering={SlideInRight.duration(500)}>
            <Box bg={Palette.errorTint} p="$8" rounded="$2xl" alignItems="center">
              <MaterialIcons name="error-outline" size={48} color={Palette.error} />
              <Text color={Palette.error} fontWeight="700" fontSize={Type.h3} textAlign="center" mb="$2">
                {t('companyEmployees.connectionError')}
              </Text>
              <Text color={Palette.gray700} textAlign="center" fontSize={Type.body} mb="$4">
                {error}
              </Text>
              <Pressable onPress={() => fetchUsers()}>
                <Box bg={Palette.gold} px="$6" py="$3" rounded="$xl">
                  <Text color={Palette.white} fontWeight="600">{t('companyEmployees.tryAgain')}</Text>
                </Box>
              </Pressable>
            </Box>
          </Animated.View>
        </VStack>
      </SafeAreaView>
    );
  }

  return (
    <LinearGradient
      colors={[Palette.gray50, Palette.gray100, Palette.white]}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={{ flex: 1 }}>
        {/* Sticky Header */}
        <PremiumHeader
          title={t('companyEmployees.teamMembers')}
          onBack={() => router.push('/company_dashboard/home')}
          rightElement={
            <Pressable onPress={onRefresh}>
              <Box p="$0.5" rounded="$full" borderWidth={1.5} borderColor={Palette.gray100} bg={Palette.white}>
                <Avatar size="sm" bgColor={Palette.gold}>
                  <AvatarFallbackText>{getInitials(user?.private_user?.first_name || 'U', user?.private_user?.last_name || 'B')}</AvatarFallbackText>
                </Avatar>
              </Box>
            </Pressable>
          }
        />


        <ScrollView
          flex={1}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Palette.gold} />
          }
        >
          <VStack space="md" px="$5" pt="$4">
            {/* Summary Dashboard */}
            <Animated.View entering={FadeInUp.duration(600)}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20 }}>
                <HStack space="md">
                  {/* Total Employees Card */}
                  <Box
                    p="$4" width={160}
                    borderWidth={1} borderColor={Palette.blue + '22'}
                    style={{
                      backgroundColor: Palette.blueTint, borderRadius: 18,
                      shadowColor: Palette.black, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2
                    }}
                  >
                    <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                      <Box style={{ backgroundColor: Palette.blue, borderRadius: 10, padding: 7 }}>
                        <MaterialIcons name="people" size={16} color={Palette.white} />
                      </Box>
                      <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>{stats.total}</Text>
                    </HStack>
                    <Text fontSize={Type.label} color={Palette.ink} fontWeight="700">{t('companyEmployees.statTotal')}</Text>
                    <Text fontSize={Type.tiny} color={Palette.gray500} mt="$1">{t('companyEmployees.statTotalSubtitle')}</Text>
                  </Box>

                  {/* Managers Card */}
                  <Box
                    p="$4" width={160}
                    borderWidth={1} borderColor={Palette.violet + '22'}
                    style={{
                      backgroundColor: Palette.violetTint, borderRadius: 18,
                      shadowColor: Palette.black, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2
                    }}
                  >
                    <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                      <Box style={{ backgroundColor: Palette.violet, borderRadius: 10, padding: 7 }}>
                        <MaterialIcons name="verified-user" size={16} color={Palette.white} />
                      </Box>
                      <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>{stats.managers}</Text>
                    </HStack>
                    <Text fontSize={Type.label} color={Palette.ink} fontWeight="700">{t('companyEmployees.statManagers')}</Text>
                    <Text fontSize={Type.tiny} color={Palette.gray500} mt="$1">{t('companyEmployees.statManagersSubtitle')}</Text>
                  </Box>

                  {/* Departments Card */}
                  <Box
                    p="$4" width={160}
                    borderWidth={1} borderColor={Palette.success + '22'}
                    style={{
                      backgroundColor: Palette.successTint, borderRadius: 18,
                      shadowColor: Palette.black, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.04, shadowRadius: 8, elevation: 2
                    }}
                  >
                    <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                      <Box style={{ backgroundColor: Palette.success, borderRadius: 10, padding: 7 }}>
                        <MaterialIcons name="business" size={16} color={Palette.white} />
                      </Box>
                      <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>{stats.departments}</Text>
                    </HStack>
                    <Text fontSize={Type.label} color={Palette.ink} fontWeight="700">{t('companyEmployees.statDepartments')}</Text>
                    <Text fontSize={Type.tiny} color={Palette.gray500} mt="$1">{t('companyEmployees.statDepartmentsSubtitle')}</Text>
                  </Box>
                </HStack>
              </ScrollView>
            </Animated.View>

            {/* Enhanced Search Input */}
            <Box
              bg={Palette.white}
              borderWidth={1}
              borderColor={Palette.gray100}
              style={{
                borderRadius: 18,
                shadowColor: Palette.black,
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.04,
                shadowRadius: 8,
                elevation: 2,
              }}
            >
              <Input
                variant="outline"
                size="xl"
                borderWidth={0}
                minHeight={56}
              >
                <InputSlot pl="$4">
                  <MaterialIcons name="search" size={24} color={Palette.gray400} />
                </InputSlot>
                <InputField
                  placeholder={t("companyEmployees.searchPlaceholder")}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  color={Palette.ink}
                  fontSize={Type.title}
                  placeholderTextColor={Palette.gray400}
                />
              </Input>
            </Box>

            {searchQuery && (
              <Box px="$2">
                <Text fontSize={Type.small} color={Palette.gray500} fontWeight="700" letterSpacing={1}>
                  SHOWING {filteredUsers.length} RESULT{filteredUsers.length !== 1 ? 's' : ''}
                </Text>
              </Box>
            )}

            {/* List Content */}
            {filteredUsers.length === 0 ? (
              <Animated.View entering={FadeIn.duration(600)}>
                <Box bg={Palette.white} p="$10" alignItems="center" borderWidth={1} borderColor={Palette.gray100} style={{ borderRadius: 18 }}>
                  <Box bg={Palette.gray100} p="$5" rounded="$full" mb="$4">
                    <MaterialIcons name={searchQuery ? "search-off" : "people-outline"} size={48} color={Palette.gray400} />
                  </Box>
                  <Text fontSize={Type.h3} fontWeight="700" color={Palette.ink} textAlign="center">
                    {searchQuery ? t('companyEmployees.noResults') : t('companyEmployees.noTeamMembers')}
                  </Text>
                  <Text color={Palette.gray500} textAlign="center" mt="$2" fontSize={Type.body}>
                    {searchQuery ? t('companyEmployees.noResultsBody', { query: searchQuery }) : t('companyEmployees.noTeamMembersBody')}
                  </Text>
                </Box>
              </Animated.View>
            ) : (
              <VStack space="md">
                {filteredUsers.map((u, index) => {
                  const fullName = `${u.private_user?.first_name || ''} ${u.private_user?.last_name || ''}`.trim() || 'System User';
                  const roleCfg = getRoleConfig(u.user_type || 'employee');

                  return (
                    <Animated.View
                      key={u.user_id}
                      entering={FadeInUp.delay(index * 60).duration(400)}
                    >
                      <Pressable
                        onPress={() => router.push(`/company_dashboard/employees/${u.user_id}` as any)}
                        style={({ pressed }) => ({
                          opacity: pressed ? 0.95 : 1,
                          transform: pressed ? [{ scale: 0.99 }] : [{ scale: 1 }]
                        })}
                      >
                        <Box
                          bg={Palette.white}
                          p="$4"
                          borderWidth={1}
                          borderColor={Palette.gray100}
                          style={{
                            borderRadius: 18,
                            shadowColor: Palette.black,
                            shadowOffset: { width: 0, height: 2 },
                            shadowOpacity: 0.04,
                            shadowRadius: 8,
                            elevation: 2
                          }}
                        >
                          <HStack space="md" alignItems="center">
                            {/* Avatar */}
                            <Box>
                              <Box
                                w={56} h={56} rounded="$2xl"
                                bg={roleCfg.bgColor}
                                alignItems="center" justifyContent="center"
                                borderWidth={1} borderColor={roleCfg.color + '20'}
                              >
                                <Text color={roleCfg.color} fontSize={Type.h3} fontWeight="800">
                                  {getInitials(u.private_user?.first_name || '', u.private_user?.last_name || '')}
                                </Text>
                              </Box>
                              <Box
                                position="absolute"
                                bottom={-4}
                                right={-4}
                                bg={Palette.white}
                                w={24}
                                h={24}
                                rounded="$full"
                                alignItems="center"
                                justifyContent="center"
                                shadowColor={Palette.black}
                                shadowOffset={{ width: 0, height: 2 }}
                                shadowOpacity={0.1}
                                shadowRadius={2}
                                elevation={2}
                                borderWidth={1}
                                borderColor={Palette.gray100}
                              >
                                <MaterialIcons name={roleCfg.icon as any} size={14} color={roleCfg.color} />
                              </Box>
                            </Box>

                            {/* Info */}
                            <VStack flex={1} space="xs">
                              <Text fontSize={Type.title} fontWeight="800" color={Palette.ink} numberOfLines={1}>
                                {fullName}
                              </Text>
                              <Text fontSize={Type.label} color={Palette.gray500} numberOfLines={1} fontWeight="500">
                                {u.email}
                              </Text>
                              <HStack space="xs" alignItems="center">
                                <Box bg={roleCfg.bgColor} px="$2.5" py="$1" rounded="$lg">
                                  <Text color={roleCfg.color} fontSize={Type.tiny} fontWeight="800" textTransform="uppercase" letterSpacing={0.5}>
                                    {u.user_type || 'employee'}
                                  </Text>
                                </Box>
                                {u.private_user?.department && (
                                  <HStack alignItems="center" space="xs">
                                    <Box w={3} h={3} rounded="$full" bg={Palette.gray400} />
                                    <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="600">
                                      {typeof u.private_user.department === 'string'
                                        ? u.private_user.department
                                        : u.private_user.department?.name}
                                    </Text>
                                  </HStack>
                                )}
                              </HStack>
                            </VStack>

                            <Box bg={Palette.gray50} p="$2" rounded="$full">
                              <MaterialIcons name="chevron-right" size={20} color={Palette.gray400} />
                            </Box>
                          </HStack>
                        </Box>
                      </Pressable>
                    </Animated.View>
                  );
                })}
              </VStack>
            )}
          </VStack>
        </ScrollView>
      </SafeAreaView >

      {/* Management Modal */}
      <Modal isOpen={showManageModal} onClose={() => setShowManageModal(false)} size="full">
        <ModalBackdrop />
        <ModalContent maxHeight="85%" bg={Palette.white} rounded="$3xl" overflow="hidden" my="$2" mx="$4" p="$0">
          <LinearGradient
            colors={[Palette.ink, Palette.gray800]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 16, paddingBottom: 24 }}
          >
            <HStack space="md" alignItems="center" justifyContent="space-between">
              <HStack space="md" alignItems="center" flex={1}>
                <Box bg="rgba(255,255,255,0.2)" p="$3" rounded="$2xl">
                  <MaterialIcons name="settings" size={22} color={Palette.white} />
                </Box>
                <VStack flex={1}>
                  <Text color="rgba(255,255,255,0.8)" fontSize={Type.small} fontWeight="700" textTransform="uppercase">Management</Text>
                  <Text fontSize={Type.title} color={Palette.white} fontWeight="800">{t('companyEmployees.teamSettingsTitle')}</Text>
                  <Text fontSize={Type.small} color="rgba(255,255,255,0.6)" fontWeight="500">{t('companyEmployees.teamSettingsBody')}</Text>
                </VStack>
              </HStack>
              <Pressable onPress={() => setShowManageModal(false)}>
                <Box bg="rgba(255,255,255,0.2)" p="$2" rounded="$full">
                  <MaterialIcons name="close" size={20} color={Palette.white} />
                </Box>
              </Pressable>
            </HStack>
          </LinearGradient>

          <ModalBody px="$4" pb="$6" pt="$4">
            <VStack space="md">
              <Pressable
                onPress={() => {
                  setShowManageModal(false);
                  router.push('/company_dashboard/settings' as any);
                }}
              >
                <Box
                  bg={Palette.gray50}
                  p="$4"
                  rounded="$2xl"
                  borderWidth={1}
                  borderColor={Palette.gray100}
                >
                  <HStack space="md" alignItems="center">
                    <Box style={{ backgroundColor: Palette.gold, borderRadius: 10, padding: 7 }}>
                      <MaterialIcons name="settings" size={16} color={Palette.white} />
                    </Box>
                    <VStack flex={1}>
                      <Text fontWeight="800" color={Palette.ink} fontSize={Type.body}>{t('companyEmployees.goToSettings')}</Text>
                      <Text fontSize={Type.small} color={Palette.gray500} fontWeight="500">Manage all organization preferences</Text>
                    </VStack>
                    <MaterialIcons name="chevron-right" size={20} color={Palette.gray400} />
                  </HStack>
                </Box>
              </Pressable>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>
    </LinearGradient>
  );
}