import { createOnboardJob, createSalary, getJobById, getUserDetail, searchCompanies, updateJob, updateUserProfile, type CompanySearchResult } from '@/services/api';
import { profileLock } from '@/services/payroll-api';
import { Palette, Type } from '@/app/constants/theme';
import { PremiumHeader } from '@/components/PremiumHeader';
import { StandardButton } from '@/app/design-system';
import { Box, Button, ButtonText, HStack, Heading, Pressable, Text } from '@gluestack-ui/themed';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Modal, Platform, SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useAuth from '@/app/hooks/useAuth';

// ---------------------------------------------------------------------------
// Progressive-onboarding profile shared helpers.
//
// Every section screen (workschedule / pay / identity / compliance) loads the
// same underlying profile+job+salary rows and persists its own slice. We
// persist through POST /user/onboard (which upserts and recomputes the
// server-authoritative onboard_complete flag) rather than PATCH, so partial
// writes can't strand the gate.
// ---------------------------------------------------------------------------

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DEDUCTION_REASONS = ['Food', 'Lodging', 'Transport', 'Uniform'] as const;
export const AUTO_LOCK_REASON = 'Auto-locked on admin company-edit';

export const toBoolStr = (val: any): 'true' | 'false' | '' =>
  val === true ? 'true' : val === false ? 'false' : '';

export const str = (val: any): string => (val !== null && val !== undefined ? String(val) : '');

// Time/date helpers ---------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Date-only strings are parsed/formatted in LOCAL time so the calendar never
 *  shifts by a day (toISOString()/new Date('YYYY-MM-DD') are UTC and jump in
 *  non-UTC locales — that was the "date jumps backwards" bug). */
export const formatDate = (value: Date | string | undefined): string => {
  if (!value) return '';
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = value instanceof Date ? value : new Date(value as any);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};

/** Always returns `HH:MM` (24h). Never uses toLocaleTimeString, which returns
 *  locale formats like "08 h 00" that the backend's time parser rejects. Also
 *  normalizes legacy values ("08 h 00", "8:0", "08:00:00") on read. */
export const formatTime = (value: Date | string | undefined): string => {
  if (!value) return '';
  if (typeof value === 'string') {
    const m = value.match(/(\d{1,2})\s*(?::|h|H)\s*(\d{2})/);
    if (m) return `${pad2(Number(m[1]))}:${m[2]}`;
  }
  const d = value instanceof Date ? value : new Date(value as any);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

export const parseTimeDate = (value: string): Date => {
  const m = (value || '').match(/(\d{1,2})\s*(?::|h|H)\s*(\d{2})/);
  const h = m ? Number(m[1]) : 9;
  const min = m ? Number(m[2]) : 0;
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 9, Number.isFinite(min) ? min : 0, 0, 0);
  return d;
};

export const parseDate = (value: string): Date => {
  if (value) {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  }
  const d = value ? new Date(value) : new Date();
  return Number.isNaN(d.getTime()) ? new Date() : d;
};

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

export interface ProfileBootstrap {
  user: any;
  privateUserId?: number;
  job: any | null;
  salary: any | null;
  lockState: any | null;
  isIndependentUser: boolean;
  identityLocked: boolean;
  companyLocked: boolean;
  loading: boolean;
  reload: () => Promise<void>;
  refreshAuth: () => Promise<void>;
}

export function useProfileBootstrap(): ProfileBootstrap {
  const { user, login } = useAuth();
  const [job, setJob] = useState<any | null>(null);
  const [salary, setSalary] = useState<any | null>(null);
  const [lockState, setLockState] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  const privateUserId =
    user?.private_user?.private_user_id ??
    (user as any)?.private_user_id ??
    (user?.user_id !== undefined ? Number(user.user_id) : undefined);

  const reload = useCallback(async () => {
    if (!privateUserId) {
      setLoading(false);
      return;
    }
    try {
      const jobData: any = await getJobById(privateUserId);
      if (jobData && !('error' in jobData)) {
        setJob(jobData);
        setSalary(jobData?.salaries?.[0] ?? null);
      }
    } catch (e) {
      console.warn('profile section: failed to load job', e);
    }
    try {
      const r: any = await profileLock.get(privateUserId);
      if (!('error' in r)) setLockState(r);
    } catch (e) {
      console.warn('profile section: failed to load lock', e);
    }
    setLoading(false);
  }, [privateUserId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const refreshAuth = useCallback(async () => {
    try {
      if (login && user?.user_id !== undefined) {
        const latest = await getUserDetail(user.user_id as any);
        if (latest && !('error' in latest)) {
          await login(latest as any, (user as any).token);
        }
      }
    } catch {
      // Non-fatal — the server-side write already persisted.
    }
  }, [login, user]);

  const identityVerified = !!lockState?.identity_verified;
  const companyLocked = !!lockState?.is_locked;
  const manualLock = companyLocked && lockState?.lock_reason !== AUTO_LOCK_REASON;
  const identityLocked = identityVerified || manualLock;

  return {
    user,
    privateUserId,
    job,
    salary,
    lockState,
    isIndependentUser: !user?.private_user?.company_id,
    identityLocked,
    companyLocked,
    loading,
    reload,
    refreshAuth,
  };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export const toBool = (val: string | undefined): boolean => val === 'true';

/** Extract the always-required Job columns from the loaded job so a slice
 *  update (e.g. compliance-only) still satisfies the Job schema. */
export function jobBase(job: any, privateUserId: number) {
  return {
    private_user_id: privateUserId,
    job_title: job?.job_title ?? '',
    employer_name: job?.employer_name ?? null,
    employer_brn: job?.employer_brn ?? null,
  };
}

export async function submitOnboard(payload: Record<string, any>): Promise<void> {
  const res: any = await createOnboardJob(payload);
  if (res?.error) throw new Error(res.error);
  if (res?.status && res.status !== 'success') {
    throw new Error(res?.message || 'Failed to save');
  }
}

// ---------------------------------------------------------------------------
// UI atoms
// ---------------------------------------------------------------------------

export const SectionShell: React.FC<{
  title: string;
  subtitle?: string;
  onSave: () => void;
  saving: boolean;
  saveDisabled?: boolean;
  children: React.ReactNode;
}> = ({ title, subtitle, onSave, saving, saveDisabled, children }) => {
  const router = useRouter();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Palette.white }}>
      <PremiumHeader title={title} subtitle={subtitle} onBack={() => router.back()} />
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 140 }}
      >
        {children}
      </ScrollView>
      <Box
        px="$4"
        pt="$3"
        bg={Palette.white}
        borderTopWidth={1}
        borderTopColor={Palette.gray100}
        style={{ paddingBottom: Math.max(insets.bottom, 12) + 12 }}
      >
        <StandardButton.Primary onPress={onSave} isLoading={saving} isDisabled={saving || saveDisabled}>
          {t('profile.save', { defaultValue: 'Save' })}
        </StandardButton.Primary>
      </Box>
    </SafeAreaView>
  );
};

export const Card: React.FC<{ color?: string; children: React.ReactNode }> = ({ color = Palette.gold, children }) => (
  <Box bg={Palette.white} rounded="$2xl" p="$5" mb="$4" borderWidth={1} borderColor={Palette.gray200}>
    {children}
  </Box>
);

export const FieldLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Text fontSize={Type.small} fontWeight="700" color={Palette.gray600} mb="$1">
    {children}
  </Text>
);

export const YesNo: React.FC<{ value: string; onChange: (v: 'true' | 'false') => void; disabled?: boolean; color?: string }> = ({
  value,
  onChange,
  disabled,
  color = Palette.gold,
}) => {
  const { t } = useTranslation();
  const Pill = ({ label, v }: { label: string; v: 'true' | 'false' }) => {
    const active = value === v;
    return (
      <Pressable
        onPress={() => !disabled && onChange(v)}
        disabled={disabled}
        flex={1}
        opacity={disabled ? 0.5 : 1}
        style={[
          styles.pill,
          active && { borderColor: color, backgroundColor: color + '10' },
        ]}
      >
        <Text fontWeight="700" fontSize={Type.body} color={active ? color : Palette.gray500} textAlign="center">
          {label}
        </Text>
      </Pressable>
    );
  };
  return (
    <HStack space="sm">
      <Pill label={t('common.yes', { defaultValue: 'Yes' })} v="true" />
      <Pill label={t('common.no', { defaultValue: 'No' })} v="false" />
    </HStack>
  );
};

/**
 * Cross-platform date/time picker.
 *  - iOS: bottom-sheet modal with a spinner + explicit Done (an inline
 *    spinner inside a ScrollView rendered as a blank area / could not be
 *    dismissed — that was the "blank screen" report).
 *  - Android: the native dialog via `display="default"`.
 */
export const MobileDatePicker: React.FC<{
  visible: boolean;
  mode: 'date' | 'time';
  value: Date;
  onClose: () => void;
  onChange: (d: Date) => void;
  minimumDate?: Date;
  maximumDate?: Date;
  title?: string;
}> = ({ visible, mode, value, onClose, onChange, minimumDate, maximumDate, title }) => {
  const { t } = useTranslation();
  if (!visible) return null;

  if (Platform.OS === 'ios') {
    return (
      <Modal transparent animationType="slide" visible onRequestClose={onClose}>
        <View style={styles.pickerOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
          <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0 }}>
            <Box bg={Palette.white} borderTopLeftRadius={16} borderTopRightRadius={16} overflow="hidden">
              <HStack justifyContent="space-between" alignItems="center" p="$4" borderBottomWidth={1} borderBottomColor={Palette.gray200}>
                <Box w={60} />
                {title ? <Heading size="sm" color={Palette.ink}>{title}</Heading> : <Box />}
                <Button variant="link" onPress={onClose}>
                  <ButtonText color={Palette.blue} fontSize={17} fontWeight="600">
                    {t('common.done', { defaultValue: 'Done' })}
                  </ButtonText>
                </Button>
              </HStack>
              <Box bg={Palette.white}>
                <DateTimePicker
                  value={value}
                  mode={mode}
                  display="spinner"
                  is24Hour
                  textColor={Palette.black}
                  minimumDate={minimumDate}
                  maximumDate={maximumDate}
                  onChange={(_e: any, d?: Date) => {
                    if (d) onChange(d);
                  }}
                />
              </Box>
            </Box>
          </View>
        </View>
      </Modal>
    );
  }

  return (
    <DateTimePicker
      value={value}
      mode={mode}
      display="default"
      is24Hour
      minimumDate={minimumDate}
      maximumDate={maximumDate}
      onChange={(e: any, d?: Date) => {
        onClose();
        if (e?.type !== 'dismissed' && d) onChange(d);
      }}
    />
  );
};

/**
 * Employer autocomplete dropdown. Render it directly beneath a BRN input: it
 * watches `query` (the BRN text), debounces a BRN-or-name search, and lists up
 * to a handful of matches. Tapping one calls `onSelect(company)` — the parent
 * decides what to fill. Self-contained (no input of its own) so it drops into
 * both the setup and Work & Schedule screens without disturbing their fields.
 */
export const EmployerSuggestions: React.FC<{
  query: string;
  onSelect: (company: CompanySearchResult) => void;
  disabled?: boolean;
  /** A value that must NOT auto-open the dropdown — e.g. the BRN pre-filled
   *  from signup/job (which arrives asynchronously). Only a query that differs
   *  from this (i.e. the user actually changed it) triggers a search. */
  suppressQuery?: string;
}> = ({ query, onSelect, disabled, suppressQuery }) => {
  const { t } = useTranslation();
  const [results, setResults] = useState<CompanySearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  // The query value we were just dismissed for (after a pick), so selecting a
  // row — which sets the BRN to the exact value — doesn't immediately reopen.
  const dismissedFor = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const term = (query || '').trim();
    const suppressed = (suppressQuery || '').trim();
    if (timer.current) clearTimeout(timer.current);
    if (disabled || term.length < 3 || term === dismissedFor.current || (!!suppressed && term === suppressed)) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const r = await searchCompanies(term);
      setResults(r);
      setSearching(false);
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, disabled, suppressQuery]);

  const pick = (c: CompanySearchResult) => {
    dismissedFor.current = c.brn ?? '';
    setResults([]);
    setSearching(false);
    onSelect(c);
  };

  if (disabled) return null;
  if (!searching && results.length === 0) return null;

  return (
    <Box mt="$1" bg={Palette.white} rounded="$xl" borderWidth={1} borderColor={Palette.gray200} overflow="hidden">
      {searching && results.length === 0 ? (
        <HStack space="sm" alignItems="center" p="$3">
          <ActivityIndicator size="small" color={Palette.gray400} />
          <Text fontSize={Type.small} color={Palette.gray400}>
            {t('profile.searching', { defaultValue: 'Searching…' })}
          </Text>
        </HStack>
      ) : (
        results.map((c, i) => (
          <Pressable key={c.company_id} onPress={() => pick(c)}>
            <Box
              p="$3"
              borderTopWidth={i === 0 ? 0 : 1}
              borderTopColor={Palette.gray100}
            >
              <Text fontSize={Type.body} fontWeight="700" color={Palette.ink} numberOfLines={1}>
                {c.company_name}
              </Text>
              {!!c.brn && (
                <Text fontSize={Type.caption} color={Palette.gray500}>
                  {c.brn}
                </Text>
              )}
            </Box>
          </Pressable>
        ))
      )}
    </Box>
  );
};

export const SavingOverlay = () => (
  <Box flex={1} alignItems="center" justifyContent="center" style={{ minHeight: 200 }}>
    <ActivityIndicator size="large" color={Palette.gold} />
  </Box>
);

export const saveSuccess = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
export const saveFailed = () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);

const styles = StyleSheet.create({
  pill: {
    borderWidth: 1.5,
    borderColor: Palette.gray200,
    borderRadius: 999,
    paddingVertical: 12,
    paddingHorizontal: 8,
    backgroundColor: Palette.gray50,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
});

// Re-export a couple of raw API calls so section screens don't each import
// from the big services barrel (keeps this feature cohesive).
export { createSalary, updateJob, updateUserProfile };
