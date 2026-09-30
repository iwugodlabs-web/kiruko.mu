import React, { useState, useEffect, useCallback, useRef } from 'react';
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

// Brute-force escalation: this many failed biometric/passcode attempts ends
// the session instead of letting retries continue indefinitely.
const MAX_FAILED_ATTEMPTS = 5;

// A real user needs at least this long to interact with the OS prompt
// (dialog animation alone is hundreds of ms). Anything resolving faster had
// no human interaction — OS lockout, busy hardware, auto-dismissed prompt —
// and must not count as an attempt, or failures cascade with no breathing
// room: dialogs flash in/out and the user can never reach the PIN entry.
const MIN_HUMAN_AUTH_MS = 1000;

export default function IdleLockScreen({ onUnlock, onLogout, userName }: IdleLockScreenProps) {
  const { t } = useTranslation();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasBiometrics, setHasBiometrics] = useState(false);
  // Attempt counting, in-flight state, and callbacks live in refs — NOT in
  // triggerAuth's deps. A failedAttempts state dep re-fires the auto-prompt
  // effect on every failure, reopening the system dialog before the user can
  // read the error (flash loop); unstable parent callbacks would do the same
  // on every re-render. Auto-prompt runs once on mount; retries are manual
  // via the unlock button.
  const failedAttemptsRef = useRef(0);
  const authInFlightRef = useRef(false);
  const callbacksRef = useRef({ onUnlock, onLogout });
  useEffect(() => {
    callbacksRef.current = { onUnlock, onLogout };
  }, [onUnlock, onLogout]);

  useEffect(() => {
    LocalAuthentication.hasHardwareAsync().then(async (compatible) => {
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setHasBiometrics(compatible && enrolled);
    });
  }, []);

  const triggerAuth = useCallback(async () => {
    // Never stack prompts — a second call while one is open would layer
    // system dialogs and produce the same flashing symptom.
    if (authInFlightRef.current) return;
    // No device passcode/biometric to authenticate against. Previously we just
    // called onUnlock() here, which made the idle lock a silent no-op on any
    // unsecured device — the timeout would fire and instantly dismiss. For a
    // payroll app that's a real gap, so end the session instead: the user must
    // log back in. Devices WITH biometrics keep the fast unlock path below.
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) {
      callbacksRef.current.onLogout();
      return;
    }

    authInFlightRef.current = true;
    setIsAuthenticating(true);
    setError(null);
    const startedAt = Date.now();
    // Counts one genuine (human-driven) failure toward escalation.
    const registerFailure = (): void => {
      if (Date.now() - startedAt < MIN_HUMAN_AUTH_MS) {
        setError(t('idleLock.authFailed'));
        return;
      }
      failedAttemptsRef.current += 1;
      const remaining = MAX_FAILED_ATTEMPTS - failedAttemptsRef.current;
      if (remaining <= 0) {
        callbacksRef.current.onLogout();
        return;
      }
      setError(
        `${t('idleLock.authFailed')} ${t('idleLock.attemptsLeft', { count: remaining })}`,
      );
    };
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: t('idleLock.promptMessage'),
        fallbackLabel: t('idleLock.fallbackLabel'),
        cancelLabel: t('common.cancel'),
        disableDeviceFallback: false,
      });
      if (result.success) {
        callbacksRef.current.onUnlock();
        return;
      }
      // Silently ignore cancellations and "no lock configured" errors
      const silentErrors = [
        'user_cancel',
        'system_cancel',
        'not_enrolled',
        'passcode_not_set',
        'PasscodeNotSet',
      ];
      if (!silentErrors.includes(result.error as string)) {
        // Escalation: repeated biometric failures end the session instead
        // of letting an attacker retry indefinitely against the lock.
        registerFailure();
      }
    } catch {
      registerFailure();
    } finally {
      authInFlightRef.current = false;
      setIsAuthenticating(false);
    }
  }, [t]);

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
