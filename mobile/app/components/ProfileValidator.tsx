import React, { useEffect, useState } from 'react';
import { Palette } from '@/app/constants/theme';
import { Box, VStack, Heading, Text, Button, ButtonText, Pressable } from '@gluestack-ui/themed';
import { MaterialIcons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { LinearGradient } from 'expo-linear-gradient';
import { View } from 'react-native';
import type { User } from '@/services/api';

type ProfileValidatorProps = {
  user: User | null;
  isAuthenticated: boolean;
  authLoading: boolean;
  children: React.ReactNode;
};

const ProfileValidator = ({ user, isAuthenticated, authLoading, children }: ProfileValidatorProps) => {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [hasCheckedProfile, setHasCheckedProfile] = useState(false);

  useEffect(() => {
    if (!authLoading) {
      if (!isAuthenticated) {
        setError('AUTH_REQUIRED');
      } else if (!user) {
        setError('USER_NOT_FOUND');
      } else if (user.user_type !== 'company' && !user.private_user_id) {
        setError('INCOMPLETE_ONBOARDING');
      } else if (!user.private_user || !user.private_user.first_name || !user.private_user.last_name) {
        setError('INCOMPLETE_PROFILE');
      } else if (user.user_type === 'company' && !user.company) {
        setError('INCOMPLETE_PROFILE');
      } else {
        setError(null);
      }
      setHasCheckedProfile(true);
    }
  }, [user, isAuthenticated, authLoading]);

  // Loading State
  if (authLoading || !hasCheckedProfile) {
    return (
      <Box flex={1} bg="white" justifyContent="center" alignItems="center">
        <View>
          <VStack space="xl" alignItems="center">
            <Box p="$6" bg="$blue50" rounded="$full" borderWidth={6} borderColor="$blue50" overflow="hidden">
              <Box bg="white" p="$4" rounded="$full">
                <MaterialIcons name="refresh" size={32} color={Palette.blue} />
              </Box>
            </Box>
            <VStack space="xs" alignItems="center">
              <Heading size="md" color="$gray900">{t('profileValidator.oneMoment')}</Heading>
              <Text color="$gray500" fontSize={14}>
                {authLoading ? t('profileValidator.verifyingSession') : t('profileValidator.checkingProfile')}
              </Text>
            </VStack>
          </VStack>
        </View>
      </Box>
    );
  }

  // Error/Incomplete State
  if (error) {
    const isProfileIssue = error.includes('INCOMPLETE');
    const accentColor1 = isProfileIssue ? Palette.gold : Palette.errorAlt;
    const accentColor2 = isProfileIssue ? Palette.gold : Palette.error;
    const bgTone = isProfileIssue ? Palette.goldTint : Palette.errorTint;
    const iconName = isProfileIssue ? 'person-outline' : 'lock-outline';

    const title = error === 'AUTH_REQUIRED' ? t('profileValidator.titleAccessRestricted') :
      error === 'USER_NOT_FOUND' ? t('profileValidator.titleUserNotFound') :
        t('profileValidator.titleSetupRequired');

    const description = error === 'AUTH_REQUIRED' ? t('profileValidator.descAuthRequired') :
      error === 'USER_NOT_FOUND' ? t('profileValidator.descUserNotFound') :
        t('profileValidator.descSetupRequired');

    const buttonLabel = error === 'AUTH_REQUIRED' ? t('profileValidator.btnLogIn') :
      error === 'USER_NOT_FOUND' ? t('profileValidator.btnBackToLogin') :
        t('profileValidator.btnCompleteSetup');

    const action = () => {
      if (error === 'AUTH_REQUIRED' || error === 'USER_NOT_FOUND') {
        router.replace('/login');
      } else {
        router.push('/private_dashboard/profile');
      }
    };

    return (
      <Box flex={1} bg="white" justifyContent="center" px="$6">
        <View>
          <VStack space="2xl" alignItems="center">

            {/* Visual Header */}
            <Box position="relative" alignItems="center">
              <Box
                position="absolute"
                w={200} h={200}
                bg={bgTone}
                rounded="$full"
                opacity={0.5}
                style={{ transform: [{ scale: 1.2 }] }}
              />
              <LinearGradient
                colors={[Palette.white, bgTone as string]}
                style={{ borderRadius: 999, padding: 2 }}
              >
                <Box bg="white" p="$8" rounded="$full" shadowColor={bgTone} shadowOpacity={0.2} shadowRadius={20} elevation={10}>
                  <MaterialIcons name={iconName} size={48} color={accentColor1} />
                </Box>
              </LinearGradient>
            </Box>

            {/* Content Text */}
            <VStack space="sm" alignItems="center" maxWidth={300}>
              <Heading size="2xl" color="$gray900" textAlign="center" lineHeight={36}>
                {title}
              </Heading>
              <Text color="$gray500" fontSize={16} textAlign="center" lineHeight={24}>
                {description}
              </Text>
            </VStack>

            {/* Action Button */}
            <Pressable onPress={action} style={{ width: '100%', maxWidth: 300 }}>
              <LinearGradient
                colors={[accentColor1, accentColor2]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  paddingVertical: 18,
                  borderRadius: 20,
                  alignItems: 'center',
                  shadowColor: accentColor1,
                  shadowOffset: { width: 0, height: 8 },
                  shadowOpacity: 0.3,
                  shadowRadius: 16,
                  elevation: 8,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8
                }}
              >
                <Text color="white" fontWeight="700" fontSize={16}>{buttonLabel}</Text>
                <MaterialIcons name="arrow-forward" size={20} color="white" />
              </LinearGradient>
            </Pressable>

            {error === 'USER_NOT_FOUND' && (
              <Pressable onPress={() => router.replace('/login')} mt="$2">
                <Text color="$gray400" fontSize={13} fontWeight="600">{t('profileValidator.needHelp')}</Text>
              </Pressable>
            )}

          </VStack>
        </View>
      </Box>
    );
  }

  return <>{children}</>;
};

export default ProfileValidator;