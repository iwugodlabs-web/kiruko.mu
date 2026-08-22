import { Palette, Type } from '@/app/constants/theme';
import {
  Box,
  Button,
  ButtonText,
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
  SafeAreaView,
  ScrollView,
  Text,
  VStack,
  Icon,
} from '@gluestack-ui/themed';
import { useRouter } from 'expo-router';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import React, { useContext, useState, useEffect } from 'react';
import Constants from 'expo-constants';
import Animated, { FadeInUp, FadeIn } from '@/app/utils/animated';
import { useTranslation } from 'react-i18next';
import LanguageContext from '@/app/context/LanguageContext';
import useAuth from "../hooks/useAuth";
import useCurrency from "../hooks/useCurrency";
import { qualifiesForModeChoice, setEntryMode } from '@/services/entryMode';
import { StandardButton } from '../design-system';
import { StyleSheet, ActivityIndicator, Platform, ScrollView as RNScrollView, Alert, Linking } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { PremiumHeader } from '@/components/PremiumHeader';
import { deleteAccount, getCountries, updateUserProfile, type Country } from '@/services/api';

const CURRENCY_FLAGS: Record<string, string> = {
  USD: '🇺🇸', EUR: '🇪🇺', GBP: '🇬🇧', JPY: '🇯🇵', AUD: '🇦🇺',
  CAD: '🇨🇦', CHF: '🇨🇭', CNY: '🇨🇳', INR: '🇮🇳', PKR: '🇵🇰',
  MUR: '🇲🇺', KRW: '🇰🇷', RUB: '🇷🇺', ZAR: '🇿🇦', MGA: '🇲🇬',
  BRL: '🇧🇷', MXN: '🇲🇽', SGD: '🇸🇬', HKD: '🇭🇰', NOK: '🇳🇴',
};

// Mirrors mobile/app/signup/signup_company.tsx's COUNTRY_FLAGS — kept as a
// separate small local map here (not a shared constant) for the same reason
// as that one: two countries isn't worth a shared module yet.
const COUNTRY_FLAGS: Record<string, string> = { MU: '🇲🇺', TZ: '🇹🇿' };

export default function Settings() {
  const router = useRouter();
  const { t } = useTranslation();
  const langCtx = useContext(LanguageContext);
  const { logout, user, checkAuth } = useAuth();
  const { currency, currencyInfo, baseCurrency, updateCurrency, updateBaseCurrency, availableCurrencies, getCurrencyInfo } = useCurrency();
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);
  const [showBaseCurrencyModal, setShowBaseCurrencyModal] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  // Country — only meaningful for independent users (no company_id). A
  // company employee's own country is always their employer's, so this
  // section is hidden for them entirely rather than offering a setting
  // that would silently do nothing (see core/model.py:149-176).
  const isIndependentUser = !user?.private_user?.company_id;
  const [showCountryModal, setShowCountryModal] = useState(false);
  const [countries, setCountries] = useState<Country[]>([]);
  const [countriesLoading, setCountriesLoading] = useState(false);
  const [isSavingCountry, setIsSavingCountry] = useState(false);
  const currentCountryCode = user?.private_user?.country_code || user?.private_user?.effective_country_code;

  useEffect(() => {
    if (!isIndependentUser) return;
    let cancelled = false;
    setCountriesLoading(true);
    (async () => {
      const result = await getCountries();
      if (!cancelled && Array.isArray(result)) setCountries(result);
      if (!cancelled) setCountriesLoading(false);
    })();
    return () => { cancelled = true; };
  }, [isIndependentUser]);

  const currentCountryName = countries.find((c) => c.code === currentCountryCode)?.name
    ?? (currentCountryCode ? currentCountryCode : undefined);

  const saveCountry = async (code: string) => {
    if (!user?.user_id) return;
    setIsSavingCountry(true);
    try {
      // country_code is a top-level field on UpdateUser (schema/user_schema.py),
      // not nested under private_user, even though it's stored on the
      // PrivateUser row server-side.
      const result = await updateUserProfile(Number(user.user_id), { country_code: code } as any);
      if ((result as any)?.error) {
        Alert.alert(t('common.errorTitle'), (result as any).error);
        return;
      }
      await checkAuth({ silent: true });
      setShowCountryModal(false);
    } catch (e) {
      Alert.alert(t('common.errorTitle'), t('settings.countryUpdateFailed'));
    } finally {
      setIsSavingCountry(false);
    }
  };

  // Country dictates salary/display currency. Switching to a non-MUR country
  // silently rewrites the user's stored amounts/currency, so confirm first —
  // a one-way door most users won't expect from tapping "Country".
  const handleCountryChange = (code: string) => {
    const selected = countries.find((c) => c.code === code);
    const usesNonMUR = !!selected && selected.currency.toUpperCase() !== 'MUR';
    if (usesNonMUR) {
      Alert.alert(
        t('settings.confirmNonMURTitle', { currency: selected.currency }),
        t('settings.confirmNonMURBody', { name: selected.name, currency: selected.currency }),
        [
          { text: t('common.cancel', 'Cancel'), style: 'cancel' },
          { text: t('settings.confirmContinue', 'Continue'), onPress: () => saveCountry(code) },
        ],
      );
      return;
    }
    saveCountry(code);
  };

  const SUPPORTED_LANGUAGES = ['en', 'fr', 'mg', 'hi', 'sw'] as const;
  type SupportedLang = typeof SUPPORTED_LANGUAGES[number];

  const handleLanguageChange = async (lang: SupportedLang) => {
    if (langCtx) {
      await langCtx.changeLanguage(lang);
    }
    setShowLanguageModal(false);
  };

  const currentLang = (langCtx?.language ?? 'en') as SupportedLang;
  const currentLangLabel = t(`languages.${SUPPORTED_LANGUAGES.includes(currentLang) ? currentLang : 'en'}` as
    | 'languages.en' | 'languages.fr' | 'languages.mg' | 'languages.hi' | 'languages.sw');

  const handleCurrencyChange = async (currencyCode: string) => {
    try {
      await updateCurrency(currencyCode);
      setShowCurrencyModal(false);
    } catch (error) {
      console.error('Settings: Error updating display currency:', error);
    }
  };

  const handleBaseCurrencyChange = async (currencyCode: string) => {
    try {
      await updateBaseCurrency(currencyCode);
      setShowBaseCurrencyModal(false);
    } catch (error) {
      console.error('Settings: Error updating base currency:', error);
    }
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

  const sections = [
    {
      title: t('settings.sectionAccount'),
      options: [
        // Only for users who are also an employer-side actor: jump to the
        // employer side without logging out.
        ...(qualifiesForModeChoice(user) ? [{
          label: t('chooseMode.employerTitle'),
          subtitle: t('chooseMode.employerDesc'),
          icon: 'swap-horiz',
          color: Palette.indigo,
          onPress: async () => {
            await setEntryMode('employer');
            router.replace('/company_dashboard/home');
          },
        }] : []),
        {
          label: t('settings.myProfile'),
          subtitle: t('settings.myProfileSubtitle'),
          icon: 'person',
          color: Palette.gold,
          onPress: () => router.push("/private_dashboard/profile"),
        },
        {
          label: t('settings.displayCurrency'),
          subtitle: t('settings.displayCurrencySubtitle', { name: currencyInfo.name }),
          icon: 'payments',
          color: Palette.blue,
          onPress: () => setShowCurrencyModal(true),
        },
        {
          label: t('settings.baseCurrency'),
          subtitle: t('settings.baseCurrencySubtitle', { name: getCurrencyInfo(baseCurrency).name }),
          icon: 'account-balance',
          color: Palette.violet,
          onPress: () => setShowBaseCurrencyModal(true),
        },
        // Independent users only — a company employee's country always
        // comes from their employer, so this row would offer a setting
        // that silently does nothing for them.
        ...(isIndependentUser ? [{
          label: t('settings.country'),
          subtitle: currentCountryName
            ? t('settings.countrySubtitle', { name: currentCountryName })
            : t('settings.countrySubtitle', { name: '—' }),
          icon: 'public',
          color: Palette.teal,
          onPress: () => setShowCountryModal(true),
        }] : []),
      ]
    },
    {
      title: t('settings.sectionPreferences'),
      options: [
        {
          label: t('settings.language'),
          subtitle: t('settings.languageSubtitle', { name: currentLangLabel }),
          icon: 'language',
          color: Palette.violet,
          onPress: () => setShowLanguageModal(true),
        },
        {
          label: t('settings.notifications'),
          subtitle: t('settings.notificationsSubtitle'),
          icon: 'notifications',
          color: Palette.gold,
          onPress: () => router.push('/private_dashboard/notifications'),
        },
        {
          label: t('notificationPrefs.settingsRow'),
          subtitle: t('notificationPrefs.settingsRowSubtitle'),
          icon: 'tune',
          color: Palette.violet,
          onPress: () => router.push('/private_dashboard/notification_preferences'),
        },
        {
          label: t('settings.expenses'),
          subtitle: t('settings.expensesSubtitle'),
          icon: 'receipt-long',
          color: Palette.success,
          onPress: () => router.push("/private_dashboard/expenses"),
        },
        {
          label: t('settings.transfers'),
          subtitle: t('settings.transfersSubtitle'),
          icon: 'swap-horiz',
          color: Palette.teal,
          onPress: () => router.push("/private_dashboard/transfers"),
        },
        {
          label: t('settings.documentVault'),
          subtitle: t('settings.documentVaultSubtitle'),
          icon: 'lock',
          color: Palette.teal,
          onPress: () => router.push("/private_dashboard/documents"),
        },
        {
          label: t('settings.payslips'),
          subtitle: t('settings.payslipsSubtitle'),
          icon: 'receipt',
          color: Palette.success,
          onPress: () => router.push("/private_dashboard/payslips"),
        },
        {
          label: t('settings.yourRights'),
          subtitle: t('settings.yourRightsSubtitle'),
          icon: 'gavel',
          color: Palette.error,
          onPress: () => router.push("/private_dashboard/your_right"),
        },
        // M12 — Ad preferences. DPA Article 7 requires withdrawal to be
        // at least as easy as consent; this row lives next to the other
        // privacy-adjacent toggles (notifications, documents).
        {
          label: t('sponsored.adPreferencesRow'),
          subtitle: t('sponsored.adPreferencesSubtitle'),
          icon: 'campaign',
          color: Palette.warning,
          onPress: () => router.push("/private_dashboard/ad_preferences"),
        },
      ]
    },
    {
      title: t('settings.sectionSupport'),
      options: [
        {
          label: t('settings.contactUs'),
          subtitle: t('settings.contactUsSubtitle'),
          icon: 'headset-mic',
          color: Palette.gray600,
          onPress: openContact,
        },
        {
          label: t('settings.privacyPolicy'),
          subtitle: t('settings.privacyPolicySubtitle'),
          icon: 'privacy-tip',
          color: Palette.gray600,
          onPress: () => Linking.openURL('https://app.kiruko.mu/privacy'),
        },
        {
          label: t('settings.termsOfService'),
          subtitle: t('settings.termsOfServiceSubtitle'),
          icon: 'description',
          color: Palette.gray600,
          onPress: () => Linking.openURL('https://app.kiruko.mu/terms'),
        },
      ]
    }
  ];

  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    try {
      const status = await logout();
      if (status) {
        router.replace('/login');
      }
    } catch (error) {
      alert(t('settings.logoutFailed'));
    } finally {
      setIsLoggingOut(false);
    }
  };

  const handleDeleteAccount = () => {
    // Two deliberate destructive confirmations (cross-platform; no accidental taps).
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
                    setIsDeletingAccount(true);
                    try {
                      const result = await deleteAccount();
                      if (result?.error) {
                        Alert.alert(t('settings.deleteAccountFailedTitle'), result.error);
                      } else {
                        await logout();
                        router.replace('/login');
                      }
                    } catch (e) {
                      Alert.alert(t('settings.deleteAccountFailedTitle'), t('settings.deleteAccountFailed'));
                    } finally {
                      setIsDeletingAccount(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <PremiumHeader title={t('settings.title')} />
      {/* Background Decorations */}
      <Box position="absolute" top={-50} right={-50} w={200} h={200} rounded="$full" bg={Palette.goldTint} />
      <Box position="absolute" bottom={-100} left={-50} w={300} h={300} rounded="$full" bg={Palette.blueTint} />

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
        {/* User Quick Info */}

        {/* User Quick Info */}
        <Box px="$6" mb="$8">
          <Animated.View entering={FadeIn.delay(200)}>
            <Box bg={Palette.white} rounded="$3xl" p="$5" shadowColor={Palette.black} shadowOffset={{ width: 0, height: 4 }} shadowOpacity={0.05} shadowRadius={10} elevation={4} borderWidth={1} borderColor={Palette.gray100}>
              <HStack space="md" alignItems="center">
                <Box bg={Palette.goldTint} p="$3" rounded="$2xl">
                  <MaterialIcons name="account-circle" size={32} color={Palette.gold} />
                </Box>
                <VStack>
                  <Text fontSize={Type.title} fontWeight="700" color={Palette.ink}>{user?.private_user?.first_name} {user?.private_user?.last_name}</Text>
                  <Text fontSize={Type.small} color={Palette.gray500}>{user?.email}</Text>
                </VStack>
              </HStack>
            </Box>
          </Animated.View>
        </Box>

        {/* Settings Sections */}
        <VStack space="md" px="$6">
          {sections.map((section, sIdx) => (
            <VStack key={sIdx} space="md">
              <Text fontSize={Type.label} fontWeight="700" color={Palette.gray500} textTransform="uppercase" letterSpacing={1} px="$1">
                {section.title}
              </Text>
              <VStack space="sm">
                {section.options.map((option, oIdx) => (
                  <Animated.View key={oIdx} entering={FadeInUp.delay(300 + sIdx * 100 + oIdx * 50)}>
                    <Pressable onPress={option.onPress}>
                      {({ pressed }: any) => (
                        <Box
                          bg={Palette.white}
                          rounded="$3xl"
                          p="$4"
                          borderWidth={1}
                          borderColor={pressed ? option.color : Palette.gray100}
                          style={[
                            { transform: [{ scale: pressed ? 0.98 : 1 }] },
                            styles.cardShadow
                          ]}
                        >
                          <HStack space="md" alignItems="center">
                            <Box style={{ backgroundColor: option.color, borderRadius: 10, padding: 7 }}>
                              <MaterialIcons name={option.icon as any} size={16} color={Palette.white} />
                            </Box>
                            <VStack flex={1}>
                              <Text fontSize={Type.body} fontWeight="600" color={Palette.ink}>{option.label}</Text>
                              <Text fontSize={Type.small} color={Palette.gray500} numberOfLines={1}>{option.subtitle}</Text>
                            </VStack>
                            <MaterialIcons name="chevron-right" size={24} color={Palette.gray300} />
                          </HStack>
                        </Box>
                      )}
                    </Pressable>
                  </Animated.View>
                ))}
              </VStack>
            </VStack>
          ))}

          {/* Logout Button */}
          <Animated.View entering={FadeInUp.delay(800)}>
            <Pressable onPress={handleLogout} disabled={isLoggingOut}>
              {({ pressed }: any) => (
                <Box
                  bg={Palette.white}
                  rounded="$3xl"
                  p="$4"
                  borderWidth={1}
                  borderColor={pressed ? Palette.error : Palette.gray100}
                  style={[
                    { transform: [{ scale: pressed ? 0.98 : 1 }] },
                    styles.cardShadow
                  ]}
                >
                  <HStack space="md" alignItems="center">
                    <Box style={{ backgroundColor: Palette.error, borderRadius: 10, padding: 7 }}>
                      {isLoggingOut ? <ActivityIndicator size="small" color={Palette.white} /> : <MaterialIcons name="logout" size={16} color={Palette.white} />}
                    </Box>
                    <VStack flex={1}>
                      <Text fontSize={Type.body} fontWeight="600" color={Palette.error}>
                        {isLoggingOut ? t('settings.loggingOut') : t('settings.logout')}
                      </Text>
                      <Text fontSize={Type.small} color={Palette.gray500}>{t('settings.logoutSubtitle')}</Text>
                    </VStack>
                    <MaterialIcons name="chevron-right" size={24} color={Palette.error} />
                  </HStack>
                </Box>
              )}
            </Pressable>
          </Animated.View>

          {/* Delete Account (danger zone) */}
          <Animated.View entering={FadeInUp.delay(850)}>
            <Pressable onPress={handleDeleteAccount} disabled={isDeletingAccount} style={{ marginTop: 12 }}>
              {({ pressed }: any) => (
                <Box
                  bg={Palette.white}
                  rounded="$3xl"
                  p="$4"
                  borderWidth={1}
                  borderColor={pressed ? Palette.error : Palette.gray100}
                  style={[
                    { transform: [{ scale: pressed ? 0.98 : 1 }] },
                    styles.cardShadow
                  ]}
                >
                  <HStack space="md" alignItems="center">
                    <Box style={{ backgroundColor: Palette.error, borderRadius: 10, padding: 7 }}>
                      {isDeletingAccount ? <ActivityIndicator size="small" color={Palette.white} /> : <MaterialIcons name="delete-forever" size={16} color={Palette.white} />}
                    </Box>
                    <VStack flex={1}>
                      <Text fontSize={Type.body} fontWeight="600" color={Palette.error}>
                        {t('settings.deleteAccount')}
                      </Text>
                      <Text fontSize={Type.small} color={Palette.gray500}>{t('settings.deleteAccountSubtitle')}</Text>
                    </VStack>
                    <MaterialIcons name="chevron-right" size={24} color={Palette.error} />
                  </HStack>
                </Box>
              )}
            </Pressable>
          </Animated.View>

          {/* App Version Footer */}
          <Animated.View entering={FadeInUp.delay(900)}>
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
                    {t('settings.rightsReserved')}
                  </Text>
                  <Text fontSize={Type.caption} color={Palette.gray500} textAlign="center" fontWeight="600">
                    Powered by Zilwa Eklere Ltd
                  </Text>
                </VStack>
              </Box>
            </Box>
          </Animated.View>
        </VStack>
      </ScrollView>

      {/* Currency Selection Modals (Restyled) */}
      <Modal isOpen={showCurrencyModal} onClose={() => setShowCurrencyModal(false)}>
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
                <MaterialIcons name="attach-money" size={24} color={Palette.gold} />
              </Box>
              <VStack flex={1}>
                <Text color={Palette.white} fontWeight="700" fontSize={Type.h2}>{t('settings.displayCurrencyModalTitle')}</Text>
                <Text color={Palette.white} fontSize={Type.label}>{t('settings.displayCurrencyModalSubtitle')}</Text>
              </VStack>
            </HStack>
          </LinearGradient>
          <ModalBody px="$4" pt="$4" pb="$2">
            <RNScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              <VStack space="sm" pb="$2">
                {availableCurrencies.map((c) => (
                  <Pressable key={c.code} onPress={() => handleCurrencyChange(c.code)}>
                    <Box
                      p="$4"
                      rounded="$2xl"
                      bg={currency === c.code ? Palette.goldTint : Palette.white}
                      borderWidth={currency === c.code ? 2 : 1}
                      borderColor={currency === c.code ? Palette.gold : Palette.gray100}
                      style={styles.cardShadow}
                    >
                      <HStack justifyContent="space-between" alignItems="center">
                        <HStack space="md" alignItems="center" flex={1}>
                          <Text fontSize={Type.display}>{CURRENCY_FLAGS[c.code] ?? '💱'}</Text>
                          <VStack flex={1}>
                            <Text fontWeight="700" color={Palette.ink} numberOfLines={1}>{c.name}</Text>
                            <Text fontSize={Type.small} color={Palette.gray500}>{c.code} · {c.symbol}</Text>
                          </VStack>
                        </HStack>
                        {currency === c.code
                          ? <MaterialIcons name="check-circle" size={22} color={Palette.gold} />
                          : <Box w={36} h={36} rounded="$full" bg={Palette.gray50} justifyContent="center" alignItems="center" borderWidth={1} borderColor={Palette.gray200}>
                              <Text fontSize={Type.body} fontWeight="800" color={Palette.gold}>{c.symbol}</Text>
                            </Box>
                        }
                      </HStack>
                    </Box>
                  </Pressable>
                ))}
              </VStack>
            </RNScrollView>
          </ModalBody>
          <ModalFooter borderTopWidth={1} borderTopColor={Palette.gray100} px="$4" py="$3">
            <Button flex={1} onPress={() => setShowCurrencyModal(false)} variant="outline" borderColor={Palette.gold} rounded="$xl">
              <ButtonText color={Palette.gold} fontWeight="600">{t('common.close')}</ButtonText>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal isOpen={showBaseCurrencyModal} onClose={() => setShowBaseCurrencyModal(false)}>
        <ModalBackdrop />
        <ModalContent maxHeight="85%" rounded="$3xl" overflow="hidden" my="$4" mx="$0" width="100%">
          <LinearGradient
            colors={[Palette.violet, Palette.violetTint]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 20, paddingBottom: 18 }}
          >
            <HStack alignItems="center" space="md">
              <Box bg={Palette.white} p="$3" rounded="$full" opacity={0.9}>
                <MaterialIcons name="account-balance-wallet" size={24} color={Palette.violet} />
              </Box>
              <VStack flex={1}>
                <Text color={Palette.white} fontWeight="700" fontSize={Type.h2}>{t('settings.baseCurrencyModalTitle')}</Text>
                <Text color={Palette.white} fontSize={Type.label}>{t('settings.baseCurrencyModalSubtitle')}</Text>
              </VStack>
            </HStack>
          </LinearGradient>
          <ModalBody px="$4" pt="$4" pb="$2">
            <RNScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
              <VStack space="sm" pb="$2">
                {availableCurrencies.map((c) => (
                  <Pressable key={c.code} onPress={() => handleBaseCurrencyChange(c.code)}>
                    <Box
                      p="$4"
                      rounded="$2xl"
                      bg={baseCurrency === c.code ? Palette.violetTint : Palette.white}
                      borderWidth={baseCurrency === c.code ? 2 : 1}
                      borderColor={baseCurrency === c.code ? Palette.violet : Palette.gray100}
                      style={styles.cardShadow}
                    >
                      <HStack justifyContent="space-between" alignItems="center">
                        <HStack space="md" alignItems="center" flex={1}>
                          <Text fontSize={Type.display}>{CURRENCY_FLAGS[c.code] ?? '💱'}</Text>
                          <VStack flex={1}>
                            <Text fontWeight="700" color={Palette.ink} numberOfLines={1}>{c.name}</Text>
                            <Text fontSize={Type.small} color={Palette.gray500}>{c.code} · {c.symbol}</Text>
                          </VStack>
                        </HStack>
                        {baseCurrency === c.code
                          ? <MaterialIcons name="check-circle" size={22} color={Palette.violet} />
                          : <Box w={36} h={36} rounded="$full" bg={Palette.gray50} justifyContent="center" alignItems="center" borderWidth={1} borderColor={Palette.gray200}>
                              <Text fontSize={Type.body} fontWeight="800" color={Palette.violet}>{c.symbol}</Text>
                            </Box>
                        }
                      </HStack>
                    </Box>
                  </Pressable>
                ))}
              </VStack>
            </RNScrollView>
          </ModalBody>
          <ModalFooter borderTopWidth={1} borderTopColor={Palette.gray100} px="$4" py="$3">
            <Button flex={1} onPress={() => setShowBaseCurrencyModal(false)} variant="outline" borderColor={Palette.violet} rounded="$xl">
              <ButtonText color={Palette.violet} fontWeight="600">{t('common.close')}</ButtonText>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Language picker — minimal version, mirrors the currency modal layout */}
      <Modal isOpen={showLanguageModal} onClose={() => setShowLanguageModal(false)}>
        <ModalBackdrop />
        <ModalContent maxHeight="85%" rounded="$3xl" overflow="hidden" my="$4" mx="$0" width="100%">
          <LinearGradient
            colors={[Palette.violet, Palette.violet]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 20, paddingBottom: 18 }}
          >
            <HStack alignItems="center" space="md">
              <Box bg={Palette.white} p="$3" rounded="$full" opacity={0.9}>
                <MaterialIcons name="language" size={24} color={Palette.violet} />
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
                    bg={currentLang === lang ? Palette.violetTint : Palette.white}
                    borderWidth={currentLang === lang ? 2 : 1}
                    borderColor={currentLang === lang ? Palette.violet : Palette.gray100}
                    style={styles.cardShadow}
                  >
                    <HStack justifyContent="space-between" alignItems="center">
                      <VStack flex={1}>
                        <Text fontWeight="700" color={Palette.ink}>
                          {t(`languages.${lang}` as 'languages.en' | 'languages.fr' | 'languages.mg' | 'languages.hi' | 'languages.sw')}
                        </Text>
                        <Text fontSize={Type.small} color={Palette.gray500}>{lang.toUpperCase()}</Text>
                      </VStack>
                      {currentLang === lang && <MaterialIcons name="check-circle" size={22} color={Palette.violet} />}
                    </HStack>
                  </Box>
                </Pressable>
              ))}
            </VStack>
          </ModalBody>
          <ModalFooter borderTopWidth={1} borderTopColor={Palette.gray100} px="$4" py="$3">
            <Button flex={1} onPress={() => setShowLanguageModal(false)} variant="outline" borderColor={Palette.violet} rounded="$xl">
              <ButtonText color={Palette.violet} fontWeight="600">{t('common.close')}</ButtonText>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Country picker — independent users only, mirrors the language modal layout */}
      <Modal isOpen={showCountryModal} onClose={() => setShowCountryModal(false)}>
        <ModalBackdrop />
        <ModalContent maxHeight="85%" rounded="$3xl" overflow="hidden" my="$4" mx="$0" width="100%">
          <LinearGradient
            colors={[Palette.teal, Palette.teal]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 20, paddingBottom: 18 }}
          >
            <HStack alignItems="center" space="md">
              <Box bg={Palette.white} p="$3" rounded="$full" opacity={0.9}>
                <MaterialIcons name="public" size={24} color={Palette.teal} />
              </Box>
              <VStack flex={1}>
                <Text color={Palette.white} fontWeight="700" fontSize={Type.h2}>{t('settings.countryModalTitle')}</Text>
                <Text color={Palette.white} fontSize={Type.label}>{t('settings.countryModalSubtitle')}</Text>
              </VStack>
            </HStack>
          </LinearGradient>
          <ModalBody px="$4" pt="$4" pb="$2">
            {countriesLoading ? (
              <Box py="$8" alignItems="center">
                <ActivityIndicator size="small" color={Palette.teal} />
              </Box>
            ) : (
              <RNScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                <VStack space="sm" pb="$2">
                  {countries.map((c) => (
                    <Pressable key={c.code} onPress={() => handleCountryChange(c.code)} disabled={isSavingCountry}>
                      <Box
                        p="$4"
                        rounded="$2xl"
                        bg={currentCountryCode === c.code ? Palette.tealTint : Palette.white}
                        borderWidth={currentCountryCode === c.code ? 2 : 1}
                        borderColor={currentCountryCode === c.code ? Palette.teal : Palette.gray100}
                        style={styles.cardShadow}
                      >
                        <HStack justifyContent="space-between" alignItems="center">
                          <HStack space="md" alignItems="center" flex={1}>
                            <Text fontSize={Type.display}>{COUNTRY_FLAGS[c.code] ?? '🌍'}</Text>
                            <VStack flex={1}>
                              <Text fontWeight="700" color={Palette.ink} numberOfLines={1}>{c.name}</Text>
                              <Text fontSize={Type.small} color={Palette.gray500}>{c.code} · {c.currency}</Text>
                            </VStack>
                          </HStack>
                          {currentCountryCode === c.code && <MaterialIcons name="check-circle" size={22} color={Palette.teal} />}
                        </HStack>
                      </Box>
                    </Pressable>
                  ))}
                </VStack>
              </RNScrollView>
            )}
          </ModalBody>
          <ModalFooter borderTopWidth={1} borderTopColor={Palette.gray100} px="$4" py="$3">
            <Button flex={1} onPress={() => setShowCountryModal(false)} variant="outline" borderColor={Palette.teal} rounded="$xl" disabled={isSavingCountry}>
              <ButtonText color={Palette.teal} fontWeight="600">{t('common.close')}</ButtonText>
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

    </SafeAreaView >
  );
}

const styles = StyleSheet.create({
  cardShadow: {
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 4,
  }
});
