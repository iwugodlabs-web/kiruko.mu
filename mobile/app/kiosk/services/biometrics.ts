/**
 * Device-biometric wrapper for the kiosk — admin unlock only.
 *
 * Deliberately scoped: on a SHARED tablet the OS biometric (Touch ID /
 * Face ID / Android fingerprint) belongs to whoever enrolled it, which is
 * the admin, not the employees. So device biometrics are only used to open
 * the admin gate (exit kiosk mode, re-enter token). Employee identity stays
 * on the PIN + photo path; a true employee-fingerprint path needs a separate
 * USB scanner + server-side template store (see doc/KIOSK_FINGERPRINT_PLAN.md).
 *
 * Thin wrapper over expo-local-authentication so the kiosk screens don't
 * inline the hasHardware/isEnrolled/authenticate dance (the mobile app's
 * IdleLockScreen does this inline; we centralize here to share it).
 */

import * as LocalAuthentication from "expo-local-authentication";

export interface BiometricState {
  available: boolean;
  label: string;
}

/**
 * Whether the device can authenticate an admin with biometrics right now,
 * and a human label for the button ("Face ID" / "Fingerprint" / "Iris").
 */
export async function getBiometricState(): Promise<BiometricState> {
  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return { available: false, label: "Biometric" };
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) return { available: false, label: "Biometric" };
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    const label = types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
      ? "Face ID"
      : types.includes(LocalAuthentication.AuthenticationType.IRIS)
        ? "Iris"
        : "Fingerprint";
    return { available: true, label };
  } catch {
    return { available: false, label: "Biometric" };
  }
}

/**
 * Prompt the OS biometric dialog. Returns true on success, false on
 * cancel / mismatch / any error. Cancellation is a normal outcome on a
 * kiosk (admin changes their mind) so it is NOT surfaced as an error.
 */
export async function authenticateWithBiometric(promptMessage: string): Promise<boolean> {
  try {
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      disableDeviceFallback: false,
      cancelLabel: "Cancel",
    });
    return result.success;
  } catch {
    return false;
  }
}
