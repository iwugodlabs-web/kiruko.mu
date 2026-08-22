import { MaterialIcons } from '@expo/vector-icons';
import { Palette, Type } from '@/app/constants/theme';
import {
  Avatar,
  AvatarFallbackText,
  Box,
  Button,
  ButtonText,
  Heading,
  HStack,
  Modal,
  ModalBackdrop,
  ModalBody,
  ModalContent,
  ModalFooter,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  VStack
} from '@gluestack-ui/themed';
import { PremiumHeader } from '@/components/PremiumHeader';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  ArrowLeftRight,
  Bell,
  Clock1,
  FileText,
  FolderOpen,
  Globe,
  HandCoins,
  LogOut,
  Mail,
  MapPin,
  ShieldCheck,
  Tablet,
  Trash2,
  User
} from 'lucide-react-native';
import { qualifiesForModeChoice, setEntryMode } from '@/services/entryMode';
import { hasCompanyPermission } from '@/services/permissions';
import { deleteAccount } from '@/services/api';
import React, { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, Linking, Alert, Dimensions } from 'react-native';
import Constants from 'expo-constants';
import { format } from 'date-fns';
import Animated, { FadeInUp } from '@/app/utils/animated';
import LanguageContext from '@/app/context/LanguageContext';
import useAuth from "../hooks/useAuth";
import { KIOSK_TABLET_MIN_WIDTH } from "../kiosk/constants";

const SUPPORTED_LANGUAGES = ['en', 'fr', 'mg', 'hi', 'sw'] as const;
type SupportedLang = typeof SUPPORTED_LANGUAGES[number];

// Same tablet gate as the login screen's kiosk affordance — phones never
// surface the "set up as kiosk" row; only genuine tablets do.
const IS_TABLET = Dimensions.get('window').width >= KIOSK_TABLET_MIN_WIDTH;

export default function Settings() {
  const router = useRouter();
  const { t } = useTranslation();
  const langCtx = useContext(LanguageContext);
  const { user, logout } = useAuth();
  const [showLanguageModal, setShowLanguageModal] = useState(false);

  const currentLang = (langCtx?.language ?? 'en') as SupportedLang;

  const handleLanguageChange = async (lang: SupportedLang) => {
    if (langCtx) {
      await langCtx.changeLanguage(lang);
    }
    setShowLanguageModal(false);
  };

  // Open the mail composer; fall back to showing the address if no mail
  // app is configured (e.g. a simulator), so the tap never feels dead.
  const openContact = async () => {
    const url = 'mailto:hello@kiruko.mu';
    try {
      if (await Linking.canOpenURL(url)) {
        await Linking.openURL(url);
        return;
      }
    } catch {}
    Alert.alert(t('settings.contactUs'), 'hello@kiruko.mu');
  };

  const settingsOptions = [
    {
      label: t('companySettings.companyProfile'),
      desc: t('companySettings.companyProfileDesc'),
      icon: User,
      tint: Palette.blue,
      isLogout: false,
      // Owner-only — the backend (PUT /company/{id}) rejects this write for
      // any delegated role (HR, manager, admin) regardless of permissions;
      // this hides the tile so someone who switched into employer mode
      // doesn't fill out the form only to hit a 403 on save.
      ownerOnly: true,
      onPress: () => router.push("/company_dashboard/profile"),
    },
    {
      label: t('companySettings.employees'),
      desc: t('companySettings.employeesDesc'),
      icon: User,
      tint: Palette.teal,
      isLogout: false,
      requiredPerm: 'view_employee',
      onPress: () => router.push("/company_dashboard/employees"),
    },
    {
      label: t('companySettings.documents'),
      desc: t('companySettings.documentsDesc'),
      icon: FolderOpen,
      tint: Palette.violet,
      isLogout: false,
      requiredPerm: 'view_documents',
      onPress: () => router.push("/company_dashboard/documents"),
    },
    {
      label: t('companySettings.leaves'),
      desc: t('companySettings.leavesDesc'),
      icon: Clock1,
      tint: Palette.green,
      isLogout: false,
      onPress: () => router.push("/company_dashboard/leaves"),
    },
    {
      label: t('companySettings.notifications'),
      desc: t('companySettings.notificationsDesc'),
      icon: Bell,
      tint: Palette.gold,
      isLogout: false,
      onPress: () => router.push('/company_dashboard/notifications'),
    },
    {
      label: t('notificationPrefs.settingsRow'),
      desc: t('notificationPrefs.settingsRowSubtitle'),
      icon: Bell,
      tint: Palette.indigo,
      isLogout: false,
      onPress: () => router.push('/company_dashboard/notification_preferences'),
    },
    {
      label: t('companySettings.language'),
      desc: t('companySettings.languageDesc'),
      icon: Globe,
      tint: Palette.indigo,
      isLogout: false,
      onPress: () => setShowLanguageModal(true),
    },
    {
      label: t('companySettings.geofencing'),
      desc: t('companySettings.geofencingDesc'),
      icon: MapPin,
      tint: Palette.teal,
      isLogout: false,
      ownerOnly: true,
      onPress: () => router.push('/company_dashboard/geofencing'),
    },
    // Tablet-only + owner-only — mirrors the login-screen affordance for the
    // case where the owner is already signed in on the device they want to
    // turn into a kiosk. Phones and non-owners never see this row.
    ...(IS_TABLET ? [{
      label: t('kiosk.setupAsTablet', 'Set up this tablet as a kiosk'),
      desc: t('kiosk.setupAsTabletDesc', 'Turn this tablet into a shared clock-in station for your team.'),
      icon: Tablet,
      tint: Palette.ink,
      isLogout: false,
      ownerOnly: true,
      onPress: () => router.push('/kiosk/setup'),
    }] : []),
    {
      label: t('companySettings.contactUs'),
      desc: t('companySettings.contactUsDesc'),
      icon: Mail,
      tint: Palette.blue,
      isLogout: false,
      onPress: openContact,
    },
    {
      label: t('settings.privacyPolicy'),
      desc: t('settings.privacyPolicySubtitle'),
      icon: ShieldCheck,
      tint: Palette.blue,
      isLogout: false,
      onPress: () => Linking.openURL('https://app.kiruko.mu/privacy'),
    },
    {
      label: t('settings.termsOfService'),
      desc: t('settings.termsOfServiceSubtitle'),
      icon: FileText,
      tint: Palette.blue,
      isLogout: false,
      onPress: () => Linking.openURL('https://app.kiruko.mu/terms'),
    },
    // Only for users who are both an employer-side actor AND an employee:
    // jump straight to the employee side without logging out.
    ...(qualifiesForModeChoice(user) ? [{
      label: t('chooseMode.employeeTitle'),
      desc: t('chooseMode.employeeDesc'),
      icon: ArrowLeftRight,
      tint: Palette.indigo,
      isLogout: false,
      onPress: async () => {
        await setEntryMode('employee');
        router.replace('/private_dashboard/home');
      },
    }] : []),
    {
      label: t('companySettings.logout'),
      desc: t('companySettings.logoutDesc'),
      icon: LogOut,
      tint: Palette.error,
      isLogout: true,
      onPress: async () => {
        await logout();
        // Navigation is handled inside AuthProvider.logout (router.replace('/'))
      }
    },
    {
      label: t('settings.deleteAccount'),
      desc: t('settings.deleteAccountSubtitle'),
      icon: Trash2,
      tint: Palette.error,
      isLogout: true,
      onPress: () => {
        // Two deliberate destructive confirmations (cross-platform).
        Alert.alert(
          t('settings.deleteAccountTitle'),
          t('settings.deleteAccountWarning'),
          [
            { text: t('settings.deleteAccountCancel'), style: 'cancel' },
            {
              text: t('settings.deleteAccountContinue'),
              style: 'destructive',
              onPress: () => {
                Alert.alert(
                  t('settings.deleteAccountFinalTitle'),
                  t('settings.deleteAccountFinalWarning'),
                  [
                    { text: t('settings.deleteAccountCancel'), style: 'cancel' },
                    {
                      text: t('settings.deleteAccountConfirm'),
                      style: 'destructive',
                      onPress: async () => {
                        const result = await deleteAccount();
                        if (result?.error) {
                          Alert.alert(t('settings.deleteAccountFailedTitle'), result.error);
                        } else {
                          await logout();
                        }
                      },
                    },
                  ]
                );
              },
            },
          ]
        );
      }
    }
  ];

  const getInitials = (name?: string) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  return (
    <LinearGradient
      colors={[Palette.gray50, Palette.gray100, Palette.white]}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={{ flex: 1 }}>
        <PremiumHeader
          title={t('companySettings.headerTitle')}
          rightElement={
            <Box
              p="$1"
              rounded="$full"
              borderWidth={2}
              borderColor={Palette.gray100}
              bg={Palette.white}
              shadowColor={Palette.black}
              shadowOffset={{ width: 0, height: 2 }}
              shadowOpacity={0.1}
              shadowRadius={4}
              elevation={2}
            >
              <Avatar size="sm" bgColor={Palette.blue}>
                <AvatarFallbackText>{getInitials(user?.private_user?.first_name || user?.company?.company_name || 'User')}</AvatarFallbackText>
              </Avatar>
            </Box>
          }
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 24, paddingBottom: 40 }}
        >
          {/* Settings Options */}
          <VStack space="md">
            {settingsOptions
              .filter((o: any) => !o.requiredPerm || hasCompanyPermission(user, o.requiredPerm))
              .filter((o: any) => !o.ownerOnly || user?.user_type === 'company')
              .map(({ label, desc, icon: IconComp, tint, isLogout, onPress }, index) => (
              <Animated.View
                key={index}
                entering={FadeInUp.delay(index * 80).duration(500)}
              >
                <Pressable
                  onPress={onPress}
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.92 : 1,
                    transform: pressed ? [{ scale: 0.97 }] : [{ scale: 1 }],
                  })}
                >
                  <Box
                    style={{
                      backgroundColor: Palette.white,
                      borderRadius: 18,
                      padding: 16,
                      borderWidth: 1,
                      borderColor: Palette.gray100,
                    }}
                  >
                    <HStack alignItems="center" space="md">
                      {/* Icon chip */}
                      <Box style={{ backgroundColor: tint, borderRadius: 10, padding: 7 }}>
                        <IconComp color={Palette.white} size={16} strokeWidth={2.5} />
                      </Box>

                      {/* Content */}
                      <VStack flex={1} space="xs">
                        <Text
                          fontSize={Type.body}
                          color={isLogout ? Palette.error : Palette.ink}
                          fontWeight="600"
                        >
                          {label}
                        </Text>
                        <Text fontSize={Type.small} color={Palette.gray500} lineHeight={16}>
                          {desc}
                        </Text>
                      </VStack>

                      {/* Arrow */}
                      <MaterialIcons
                        name="chevron-right"
                        size={22}
                        color={isLogout ? Palette.error : Palette.gray300}
                      />
                    </HStack>
                  </Box>
                </Pressable>
              </Animated.View>
            ))}
          </VStack>

          {/* App Info Footer */}
          <Box mt="$10" mb="$4" alignItems="center">
            <Box
              style={{
                paddingVertical: 16,
                paddingHorizontal: 24,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: Palette.gray100,
                backgroundColor: Palette.gray50,
              }}
            >
              <VStack space="xs" alignItems="center">
                <Text fontSize={Type.small} color={Palette.gray600} textAlign="center" fontWeight="600">
                  Kiruko
                </Text>
                <Text fontSize={Type.caption} color={Palette.gray400} textAlign="center">
                  v{Constants.expoConfig?.version || '1.0.0'} ({Platform.OS === 'ios' ? 'iOS' : 'Android'})
                </Text>
                <Text fontSize={Type.caption} color={Palette.gray400} textAlign="center">
                  {t('companySettings.rightsReserved')}
                </Text>
                <Text fontSize={Type.caption} color={Palette.gray500} textAlign="center" fontWeight="600">
                  Powered by Zilwa Eklere Ltd
                </Text>
              </VStack>
            </Box>
          </Box>
        </ScrollView>

        {/* Language picker */}
        <Modal isOpen={showLanguageModal} onClose={() => setShowLanguageModal(false)}>
          <ModalBackdrop />
          <ModalContent maxHeight="85%" rounded="$3xl" overflow="hidden" my="$4" mx="$0" width="100%">
            <LinearGradient
              colors={[Palette.gold, Palette.gold]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={{ padding: 20, paddingBottom: 18 }}
            >
              <HStack alignItems="center" space="md">
                <Box bg={Palette.white} p="$3" rounded="$full" opacity={0.9}>
                  <Globe size={24} color={Palette.gold} />
                </Box>
                <VStack flex={1}>
                  <Text color={Palette.white} fontWeight="700" fontSize={Type.h2}>{t('settings.languageModalTitle')}</Text>
                  <Text color={Palette.white} fontSize={Type.label}>{t('settings.languageModalSubtitle')}</Text>
                </VStack>
              </HStack>
            </LinearGradient>
            <ModalBody px="$4" pt="$4" pb="$2">
              <VStack space="sm" pb="$2">
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <Pressable key={lang} onPress={() => handleLanguageChange(lang)}>
                    <Box
                      p="$4"
                      rounded="$2xl"
                      bg={currentLang === lang ? Palette.goldTint : Palette.white}
                      borderWidth={currentLang === lang ? 2 : 1}
                      borderColor={currentLang === lang ? Palette.gold : Palette.gray100}
                    >
                      <HStack justifyContent="space-between" alignItems="center">
                        <VStack flex={1}>
                          <Text fontWeight="700" color={Palette.ink}>
                            {t(`languages.${lang}` as 'languages.en' | 'languages.fr' | 'languages.mg' | 'languages.hi' | 'languages.sw')}
                          </Text>
                          <Text fontSize={Type.small} color={Palette.gray500}>{lang.toUpperCase()}</Text>
                        </VStack>
                        {currentLang === lang && <MaterialIcons name="check-circle" size={22} color={Palette.gold} />}
                      </HStack>
                    </Box>
                  </Pressable>
                ))}
              </VStack>
            </ModalBody>
            <ModalFooter borderTopWidth={1} borderTopColor={Palette.gray100} px="$4" py="$3">
              <Button flex={1} onPress={() => setShowLanguageModal(false)} variant="outline" borderColor={Palette.gold} rounded="$xl">
                <ButtonText color={Palette.gold} fontWeight="600">{t('common.close')}</ButtonText>
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}
