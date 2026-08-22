import React, { useState } from 'react';
import { Palette } from '@/app/constants/theme';
import { View, Text, TextInput, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { api } from '@/services/apiClient';

interface Bucket {
  code: string;
  label: string;
  hours: string;
  multiplier: string;
  amount: string;
}

interface PreviewResult {
  shift_date: string;
  currency: string;
  buckets: Bucket[];
  total: string;
}

function isErr(v: unknown): v is { error: string } {
  return typeof v === 'object' && v !== null && 'error' in v;
}

function fmtMoney(amount: string, currency: string): string {
  const n = Number(amount);
  if (Number.isNaN(n)) return `${currency} ${amount}`;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/**
 * Forward-looking single-shift pay preview. Calls the bucketed overtime
 * engine (GET /overtime/preview-shift) so a worker can see "this Saturday
 * shift pays 2× rest-day" before accepting it. Uses the worker's actual
 * same-week clock-ins for accurate weekly-threshold context.
 */
export default function ShiftPayPreview({
  privateUserId,
  primary = Palette.blue,
}: {
  privateUserId?: number;
  primary?: string;
}) {
  const { t } = useTranslation();
  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('17:00');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  // "Ineligible" is an expected, non-error state: this preview only applies to
  // hourly-paid employees with a company (the engine needs a per-hour rate to
  // project bucket amounts). Salaried/monthly and independent users land here.
  // We show a calm note rather than a red error so the feature doesn't read as
  // broken for the (majority) staff it simply doesn't apply to.
  const [ineligible, setIneligible] = useState<string | null>(null);

  const valid = DATE_RE.test(date) && TIME_RE.test(start) && TIME_RE.test(end);

  // Backend gate reasons are stable, non-localized HTTPException constants
  // (backend/api/v1/payroll.py) — safe to match on. Keep in sync if they change.
  function ineligibleReason(detail: unknown): string | null {
    if (typeof detail !== 'string') return null;
    const d = detail.toLowerCase();
    if (d.includes('hourly-paid')) {
      return t('shiftPreview.hourlyOnly', {
        defaultValue: 'This preview is available for hourly-paid staff — your pay is set monthly, so shift premiums are already included in your salary.',
      });
    }
    if (d.includes('no company')) {
      return t('shiftPreview.companyOnly', {
        defaultValue: 'This preview is available for employees paid by a company.',
      });
    }
    return null;
  }

  async function handlePreview() {
    if (!privateUserId) {
      setError(t('shiftPreview.noEmployee', { defaultValue: 'No employee profile found.' }));
      return;
    }
    if (!valid) {
      setError(t('shiftPreview.invalidInput', { defaultValue: 'Enter date as YYYY-MM-DD and times as HH:MM.' }));
      return;
    }
    setLoading(true);
    setError(null);
    setIneligible(null);
    setResult(null);
    try {
      const r = await api.get('/overtime/preview-shift', {
        params: { private_user_id: privateUserId, shift_date: date, start_hhmm: start, end_hhmm: end },
      });
      setResult(r.data);
    } catch (e: any) {
      const detail = e?.response?.data?.detail;
      const calm = ineligibleReason(detail);
      if (calm) {
        setIneligible(calm);
      } else {
        setError(
          typeof detail === 'string'
            ? detail
            : t('shiftPreview.unavailable', {
                defaultValue: 'Preview unavailable — this works for hourly-paid employees once an overtime rule is set.',
              }),
        );
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <MaterialIcons name="schedule" size={18} color={primary} />
        <Text style={styles.title}>{t('shiftPreview.title', { defaultValue: 'Shift pay preview' })}</Text>
      </View>
      <Text style={styles.subtitle}>
        {t('shiftPreview.subtitle', {
          defaultValue: 'See how a shift would be paid (overtime, rest-day, holiday, night premiums) before you take it.',
        })}
      </Text>

      {ineligible ? (
        <View style={styles.noteBox}>
          <MaterialIcons name="info-outline" size={16} color={Palette.gray400} />
          <Text style={styles.note}>{ineligible}</Text>
        </View>
      ) : (
        <>
          <View style={styles.fieldRow}>
            <Field label={t('shiftPreview.date', { defaultValue: 'Date' })} value={date} onChange={setDate} placeholder="YYYY-MM-DD" flex={1.4} />
            <Field label={t('shiftPreview.start', { defaultValue: 'Start' })} value={start} onChange={setStart} placeholder="HH:MM" flex={1} />
            <Field label={t('shiftPreview.end', { defaultValue: 'End' })} value={end} onChange={setEnd} placeholder="HH:MM" flex={1} />
          </View>

          <Pressable
            onPress={handlePreview}
            disabled={loading}
            style={[styles.button, { backgroundColor: primary, opacity: loading ? 0.6 : 1 }]}
          >
            {loading ? (
              <ActivityIndicator color="white" size="small" />
            ) : (
              <Text style={styles.buttonText}>{t('shiftPreview.cta', { defaultValue: 'Preview pay' })}</Text>
            )}
          </Pressable>
        </>
      )}

      {error && <Text style={styles.error}>{error}</Text>}

      {result && (
        <View style={styles.resultBox}>
          {result.buckets.length === 0 ? (
            <Text style={styles.muted}>{t('shiftPreview.noHours', { defaultValue: 'No payable hours for this shift.' })}</Text>
          ) : (
            result.buckets.map((b) => {
              const mult = Number(b.multiplier);
              const showMult = !Number.isNaN(mult) && mult !== 1;
              return (
                <View key={b.code} style={styles.bucketRow}>
                  <View style={{ flex: 1 }}>
                    <View style={styles.bucketLabelRow}>
                      <Text style={styles.bucketLabel}>{b.label}</Text>
                      {showMult && (
                        <View style={styles.multBadge}>
                          <Text style={styles.multBadgeText}>{mult.toFixed(2).replace(/\.?0+$/, '')}×</Text>
                        </View>
                      )}
                    </View>
                    <Text style={styles.bucketMeta}>{Number(b.hours).toFixed(2)}h</Text>
                  </View>
                  <Text style={styles.bucketAmount}>{fmtMoney(b.amount, result.currency)}</Text>
                </View>
              );
            })
          )}
          {result.buckets.length > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t('shiftPreview.total', { defaultValue: 'Total' })}</Text>
              <Text style={styles.totalAmount}>{fmtMoney(result.total, result.currency)}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function Field({
  label, value, onChange, placeholder, flex,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  flex: number;
}) {
  return (
    <View style={{ flex }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Palette.gray400}
        autoCapitalize="none"
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'white',
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: Palette.gray100,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 15, fontWeight: '800', color: Palette.ink },
  subtitle: { fontSize: 12, color: Palette.gray500, marginTop: 4, lineHeight: 16 },
  fieldRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  fieldLabel: { fontSize: 10, fontWeight: '700', color: Palette.gray500, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: Palette.gray200,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: Palette.ink,
  },
  button: { marginTop: 12, borderRadius: 10, paddingVertical: 11, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: 'white', fontWeight: '700', fontSize: 14 },
  error: { marginTop: 10, fontSize: 12, color: Palette.error },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 12,
    padding: 12,
    borderRadius: 10,
    backgroundColor: Palette.gray50,
  },
  note: { flex: 1, fontSize: 12, color: Palette.gray500, lineHeight: 17 },
  resultBox: { marginTop: 12, borderTopWidth: 1, borderTopColor: Palette.gray100, paddingTop: 8 },
  muted: { fontSize: 12, color: Palette.gray400, fontStyle: 'italic' },
  bucketRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 6 },
  bucketLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  bucketLabel: { fontSize: 13, fontWeight: '600', color: Palette.ink },
  bucketMeta: { fontSize: 10, color: Palette.gray400, marginTop: 1 },
  bucketAmount: { fontSize: 13, fontWeight: '700', color: Palette.ink, fontVariant: ['tabular-nums'] },
  multBadge: { backgroundColor: Palette.warningTint, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  multBadgeText: { fontSize: 10, fontWeight: '800', color: Palette.gold },
  totalRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: Palette.gray100,
  },
  totalLabel: { fontSize: 13, fontWeight: '700', color: Palette.gray600 },
  totalAmount: { fontSize: 16, fontWeight: '800', color: Palette.success, fontVariant: ['tabular-nums'] },
});
