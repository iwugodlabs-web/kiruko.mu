import React, { useState, useEffect, useCallback } from 'react';
import { Palette, Type } from '@/app/constants/theme';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

interface IdleLockScreenProps {
  onUnlock: () => void;
  onLogout: () => void;
  userName?: string;
}

export default function IdleLockScreen({ onUnlock, onLogout, userName }: IdleLockScreenProps) {
  const { t } = useTranslation();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasBiometrics, setHasBiometrics] = useState(false);

  useEffect(() => {
    LocalAuthentication.hasHardwareAsync().then(async (compatible) => {
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setHasBiometrics(compatible && enrolled);
    });
  }, []);

  const triggerAuth = useCallback(async () => {
    // If the device has no lock set, skip authentication entirely
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) {
      onUnlock();
      return;
    }

    setIsAuthenticating(true);
    setError(null);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('idleLock.promptMessage'),
        fallbackLabel: t('idleLock.fallbackLabel'),
        cancelLabel: t('common.cancel'),
        disableDeviceFallback: false,
      });
      if (result.success) {
        onUnlock();
      } else {
        // Silently ignore cancellations and "no lock configured" errors
        const silentErrors = [
          'user_cancel',
          'system_cancel',
          'not_enrolled',
          'passcode_not_set',
          'PasscodeNotSet',
        ];
        if (!silentErrors.includes(result.error as string)) {
          setError(t('idleLock.authFailed'));
        }
      }
    } catch {
      setError(t('idleLock.authFailed'));
    } finally {
      setIsAuthenticating(false);
    }
  }, [onUnlock, t]);

  useEffect(() => {
    triggerAuth();
  }, [triggerAuth]);

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <View style={styles.lockIcon}>
          <MaterialIcons name="lock" size={40} color={Palette.indigo} />
        </View>

        <Text style={styles.title}>{t('idleLock.sessionLocked')}</Text>
        <Text style={styles.subtitle}>
          {userName ? t('idleLock.subtitleWithName', { name: userName }) : t('idleLock.subtitleNoName')}
        </Text>

        {error && (
          <Text style={styles.errorText}>{error}</Text>
        )}

        {isAuthenticating ? (
          <ActivityIndicator size="large" color={Palette.gold} style={styles.spinner} />
        ) : (
          <TouchableOpacity style={styles.unlockButton} onPress={triggerAuth}>
            <MaterialIcons
              name={hasBiometrics ? (Platform.OS === 'ios' ? 'face' : 'fingerprint') : 'pin'}
              size={22}
              color={Palette.white}
            />
            <Text style={styles.unlockButtonText}>
              {hasBiometrics
                ? (Platform.OS === 'ios' ? t('idleLock.unlockFaceId') : t('idleLock.unlockFingerprint'))
                : t('idleLock.unlockPasscode')}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.logoutButton} onPress={onLogout}>
          <Text style={styles.logoutText}>{t('idleLock.signOutInstead')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  card: {
    backgroundColor: Palette.white,
    borderRadius: 24,
    padding: 32,
    alignItems: 'center',
    width: '80%',
    maxWidth: 340,
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 10,
  },
  lockIcon: {
    backgroundColor: Palette.blueTint,
    borderRadius: 50,
    padding: 16,
    marginBottom: 16,
  },
  title: {
    fontSize: Type.h2,
    fontWeight: '700',
    color: Palette.ink,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: Type.body,
    color: Palette.gray500,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  errorText: {
    fontSize: Type.label,
    color: Palette.error,
    marginBottom: 16,
    textAlign: 'center',
  },
  spinner: {
    marginBottom: 24,
  },
  unlockButton: {
    backgroundColor: Palette.indigo,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    justifyContent: 'center',
    marginBottom: 12,
  },
  unlockButtonText: {
    color: Palette.white,
    fontWeight: '600',
    fontSize: Type.title,
  },
  logoutButton: {
    paddingVertical: 10,
  },
  logoutText: {
    color: Palette.gray400,
    fontSize: Type.label,
  },
});
