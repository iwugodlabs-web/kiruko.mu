import { Palette, Type } from '@/app/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Box,
  Button,
  ButtonText,
  Heading,
  HStack,
  Input,
  InputField,
  SafeAreaView,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable } from 'react-native';
import { claimValidate, claimComplete, postSignInUser } from '@/services/api';
import useAuth from '@/app/hooks/useAuth';

/**
 * Account-claim ("set your password") screen — the mobile end of an employee
 * invite. Reached by tapping a `{FRONTEND_URL}/claim?token=…` link, which opens
 * the app via the universal link / `kiruko://` scheme (see app.json). The
 * employer creates a shell account (backend company/invite with role=employee);
 * here the employee sets a password, is logged in, and lands on profile
 * completion.
 */
export default function ClaimScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { login } = useAuth();
  const { token } = useLocalSearchParams<{ token?: string }>();

  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string>('');
  const [invalid, setInvalid] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setInvalid(t('claim.noToken', { defaultValue: 'This link is missing its invitation code.' }));
        setChecking(false);
        return;
      }
      const res = await claimValidate(token);
      if (cancelled) return;
      if ('error' in res) {
        setInvalid(t('claim.invalidToken', { defaultValue: 'This invitation link is invalid or has expired. Ask your employer to resend it.' }));
      } else {
        setEmail(res.email);
        setFirstName(res.first_name || '');
      }
      setChecking(false);
    })();
    return () => { cancelled = true; };
  }, [token]);

  const onSubmit = async () => {
    setFormError(null);
    if (password.length < 8) {
      setFormError(t('claim.pwTooShort', { defaultValue: 'Password must be at least 8 characters.' }));
      return;
    }
    if (password !== confirm) {
      setFormError(t('claim.pwMismatch', { defaultValue: 'Passwords do not match.' }));
      return;
    }
    if (!token || !email) return;

    setSubmitting(true);
    try {
      const done = await claimComplete(token, password);
      if ('error' in done) {
        setFormError(done.error);
        return;
      }
      // Password set + account verified — log in and route into the app.
      const response = await postSignInUser({ identifier: email, password });
      if (response && 'access_token' in response && response.data) {
        const user = response.data;
        await login(
          {
            email: user.email,
            user_id: user.user_id.toString(),
            token: response.access_token,
            isAuthenticated: true,
            onboard_complete: user.onboard_complete,
            user_type: user.user_type,
            private_user_id: user.private_user_id?.toString() || '',
            company: user.company,
            user_name: user.user_name,
            private_user: user.private_user,
            company_onboarding_status: user.company_onboarding_status,
            verification_note: user.verification_note,
            company_roles: user.company_roles,
            is_company_admin: user.is_company_admin,
            company_permissions: user.company_permissions,
            company_rbac_enabled: user.company_rbac_enabled,
          } as any,
          response.access_token,
          (response as any).refresh_token,
        );
        if (user.user_type === 'company') {
          router.replace('/company_dashboard/home');
        } else {
          // A freshly-claimed employee has a blank profile → send them to
          // complete it; the onboarding gate would bounce them there anyway.
          router.replace(user.onboard_complete ? '/private_dashboard/home' : '/private_dashboard/profile');
        }
      } else {
        // Password was set but auto-login failed — send them to sign in.
        router.replace('/login');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Box flex={1} px="$6" justifyContent="center">
          {checking ? (
            <VStack space="md" alignItems="center">
              <ActivityIndicator size="large" color={Palette.gold} />
              <Text color={Palette.gray500}>{t('claim.checking', { defaultValue: 'Checking your invitation…' })}</Text>
            </VStack>
          ) : invalid ? (
            <VStack space="lg" alignItems="center">
              <Box bg={Palette.gray100} p="$6" rounded="$full">
                <MaterialIcons name="link-off" size={40} color={Palette.gray400} />
              </Box>
              <Heading size="md" color={Palette.ink} textAlign="center">
                {t('claim.invalidTitle', { defaultValue: 'Invitation unavailable' })}
              </Heading>
              <Text color={Palette.gray500} textAlign="center">{invalid}</Text>
              <Button bg={Palette.gold} rounded="$xl" onPress={() => router.replace('/login')}>
                <ButtonText color={Palette.white} fontWeight="700">{t('claim.goToLogin', { defaultValue: 'Go to sign in' })}</ButtonText>
              </Button>
            </VStack>
          ) : (
            <VStack space="lg">
              <VStack space="xs">
                <Heading size="xl" color={Palette.ink}>
                  {firstName
                    ? t('claim.welcomeName', { defaultValue: 'Welcome, {{name}}', name: firstName })
                    : t('claim.welcome', { defaultValue: 'Set up your account' })}
                </Heading>
                <Text color={Palette.gray500}>
                  {t('claim.subtitle', { defaultValue: 'Create a password to finish setting up' })}{email ? ` (${email})` : ''}.
                </Text>
              </VStack>

              <VStack space="sm">
                <Text fontSize={Type.small} fontWeight="600" color={Palette.gray600}>{t('claim.passwordLabel', { defaultValue: 'Password' })}</Text>
                <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                  <InputField
                    type={showPw ? 'text' : 'password'}
                    placeholder={t('claim.passwordPlaceholder', { defaultValue: 'At least 8 characters' })}
                    value={password}
                    onChangeText={setPassword}
                    autoCapitalize="none"
                  />
                </Input>
                <Text fontSize={Type.small} fontWeight="600" color={Palette.gray600} mt="$2">{t('claim.confirmLabel', { defaultValue: 'Confirm password' })}</Text>
                <Input size="xl" variant="outline" rounded="$xl" bg={Palette.gray50}>
                  <InputField
                    type={showPw ? 'text' : 'password'}
                    placeholder={t('claim.confirmPlaceholder', { defaultValue: 'Re-enter your password' })}
                    value={confirm}
                    onChangeText={setConfirm}
                    autoCapitalize="none"
                  />
                </Input>
                <Pressable onPress={() => setShowPw((s) => !s)}>
                  <HStack space="xs" alignItems="center" mt="$1">
                    <MaterialIcons name={showPw ? 'visibility-off' : 'visibility'} size={16} color={Palette.gold} />
                    <Text fontSize={Type.small} color={Palette.gold} fontWeight="600">
                      {showPw ? t('claim.hide', { defaultValue: 'Hide password' }) : t('claim.show', { defaultValue: 'Show password' })}
                    </Text>
                  </HStack>
                </Pressable>
              </VStack>

              {formError && <Text fontSize={Type.small} color={Palette.error}>{formError}</Text>}

              <Button bg={Palette.gold} rounded="$xl" h="$16" onPress={onSubmit} isDisabled={submitting}>
                <HStack space="sm" alignItems="center">
                  {submitting && <ActivityIndicator size="small" color={Palette.white} />}
                  <ButtonText color={Palette.white} fontWeight="700">
                    {submitting ? t('claim.settingUp', { defaultValue: 'Setting up…' }) : t('claim.cta', { defaultValue: 'Create account' })}
                  </ButtonText>
                </HStack>
              </Button>
            </VStack>
          )}
        </Box>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
