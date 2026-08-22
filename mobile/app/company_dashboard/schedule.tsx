import { Palette, Type } from '@/app/constants/theme';
import PermissionGate from '@/components/PermissionGate';
import {
  getSchedulesByCompany,
  createSchedule,
  updateSchedule,
  getUsersByCompany,
  resolveFileUrl,
  type Schedule,
  type CreateSchedulePayload,
} from '../../services/api';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Box,
  Heading,
  HStack,
  Input,
  InputField,
  InputSlot,
  Pressable,
  ScrollView,
  Spinner,
  Text,
  VStack,
} from '@gluestack-ui/themed';
import { LinearGradient } from 'expo-linear-gradient';
import { MotiView } from 'moti';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, BackHandler, Image, KeyboardAvoidingView, Modal as RNModal, Platform, RefreshControl, StyleSheet, TextInput, TouchableOpacity, useWindowDimensions, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { format, parseISO, isBefore, startOfWeek, endOfWeek, addWeeks, subWeeks, isSameDay, isWithinInterval, differenceInMinutes } from 'date-fns';
import { useRouter } from 'expo-router';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import useAuth from '../hooks/useAuth';
import { PremiumHeader } from '@/components/PremiumHeader';
import { WeekStrip } from '@/components/schedule/WeekStrip';
import { Calendar, Clock, MapPin, Users, Plus } from 'lucide-react-native';
import * as Location from 'expo-location';
import { useTranslation } from 'react-i18next';

// ─── Status helpers ──────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  draft: Palette.gray500,
  pending: Palette.warning,
  started: Palette.blue,
  completed: Palette.teal,
};

const STATUS_BG: Record<string, string> = {
  draft: Palette.gray100,
  pending: Palette.warningTint,
  started: Palette.blueTint,
  completed: Palette.tealTint,
};

// ─── Empty state ─────────────────────────────────────────────────────────────
function EmptyState({ hasFilters = false }: { hasFilters?: boolean }) {
  return (
    <MotiView
      from={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'timing', duration: 400 }}
    >
      <Box
        bg={Palette.white} p="$10" rounded="$3xl" alignItems="center"
        borderWidth={1} borderColor={Palette.gray100}
      >
        <Box bg={Palette.gray50} p="$5" rounded="$full" mb="$4">
          <Calendar size={48} color={Palette.gray300} />
        </Box>
        <Heading size="md" color={Palette.ink} textAlign="center">
          {hasFilters ? 'No matches found' : 'No schedules yet'}
        </Heading>
        <Text color={Palette.gray500} textAlign="center" mt="$2" fontSize={Type.body}>
          {hasFilters
            ? 'Try clearing your filters or changing your search terms.'
            : 'Tap the + button to create your first schedule and assign it to your team.'}
        </Text>
      </Box>
    </MotiView>
  );
}

// ─── Schedule card ────────────────────────────────────────────────────────────
function ScheduleCard({ item, index, onPress }: { item: Schedule; index: number; onPress: () => void }) {
  const status = item.status || 'pending';
  const color = STATUS_COLORS[status] ?? Palette.gray500;
  const bg = STATUS_BG[status] ?? Palette.gray100;

  const startLabel = item.start_time
    ? format(parseISO(item.start_time), 'dd MMM yyyy, HH:mm')
    : '—';
  const endLabel = item.end_time
    ? format(parseISO(item.end_time), 'HH:mm')
    : '—';

  const names = (item.assigned_employees ?? [])
    .map((e) => `${e.first_name} ${e.last_name}`)
    .join(', ');

  const hasEvidence = (item.assignee_statuses ?? []).some(
    (as) => as.proof_image_url
  );

  return (
    <MotiView
      from={{ opacity: 0, translateY: 15 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 300, delay: index * 40 }}
    >
      <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
        <Box
          bg="white" rounded="$2xl" overflow="hidden" mb="$3"
          borderWidth={1} borderColor={Palette.gray100}
          shadowColor={Palette.black} shadowOffset={{ width: 0, height: 4 }}
          shadowOpacity={0.04} shadowRadius={12} elevation={3}
        >
          {/* Left status accent bar */}
          <Box
            position="absolute" left={0} top={0} bottom={0} w={4}
            bg={color}
          />
          <Box pl="$5" pr="$4" py="$4">
            <HStack justifyContent="space-between" alignItems="flex-start" mb="$3">
              <Text fontWeight="700" fontSize={Type.body} color={Palette.ink} flex={1} mr="$2">
                {item.title}
              </Text>
              <HStack space="xs" alignItems="center">
                <Box bg={bg} px="$2.5" py="$1" rounded="$full">
                  <Text fontSize={Type.caption} fontWeight="700" color={color} style={{ textTransform: 'capitalize' }}>
                    {status}
                  </Text>
                </Box>
                <MaterialIcons name="edit" size={14} color={Palette.gray400} />
              </HStack>
            </HStack>

            <VStack space="xs">
              <HStack space="xs" alignItems="center">
                <MapPin size={13} color={Palette.gray500} />
                <Text fontSize={Type.label} color={Palette.gray500} flex={1} numberOfLines={1}>{item.location || '—'}</Text>
              </HStack>

              <HStack space="xs" alignItems="center">
                <Clock size={13} color={Palette.gray500} />
                <Text fontSize={Type.label} color={Palette.gray500} flex={1} numberOfLines={1}>
                  {startLabel} – {endLabel}
                </Text>
              </HStack>

              {names.length > 0 && (
                <HStack space="xs" alignItems="center">
                  <Users size={13} color={Palette.gray500} />
                  <Text fontSize={Type.label} color={Palette.gray500} flex={1} numberOfLines={1}>
                    {names}
                  </Text>
                </HStack>
              )}

              {hasEvidence && (
                <HStack space="xs" alignItems="center" mt="$1">
                  <MaterialIcons name="photo-camera" size={13} color={Palette.teal} />
                  <Text fontSize={Type.label} color={Palette.teal} fontWeight="600">
                    Evidence uploaded
                  </Text>
                </HStack>
              )}
            </VStack>
          </Box>
        </Box>
      </TouchableOpacity>
    </MotiView>
  );
}

// ─── Day Timeline ────────────────────────────────────────────────────────────
function DayTimeline({ schedules, selectedDay, onPress }: {
  schedules: Schedule[];
  selectedDay: Date;
  onPress: (s: Schedule) => void;
}) {
  const HOUR_HEIGHT = 60;
  const { t } = useTranslation();

  const daySchedules = schedules
    .filter(s => {
      if (!s.start_time) return false;
      try { return isSameDay(parseISO(s.start_time), selectedDay); } catch { return false; }
    })
    .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime());

  if (daySchedules.length === 0) {
    return (
      <View style={{ backgroundColor: 'white', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Palette.gray100, alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <MaterialIcons name="event-busy" size={16} color={Palette.gray400} />
          <Text style={{ fontSize: Type.label, color: Palette.gray400 }}>{t('companySchedule.emptyDay')}</Text>
        </View>
      </View>
    );
  }

  const startHours = daySchedules.map(s => new Date(s.start_time).getHours());
  const endHours = daySchedules.map(s => {
    const e = new Date(s.end_time);
    return e.getHours() + (e.getMinutes() > 0 ? 1 : 0);
  });
  const startHour = Math.max(0, Math.min(...startHours) - 1);
  const endHour = Math.min(24, Math.max(...endHours) + 1);
  const totalHours = endHour - startHour;
  const timelineHeight = totalHours * HOUR_HEIGHT;

  return (
    <View style={{ backgroundColor: 'white', borderRadius: 20, borderWidth: 1, borderColor: Palette.gray100, overflow: 'hidden' }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: Palette.gray50 }}>
        <Text style={{ fontSize: Type.caption, fontWeight: '700', color: Palette.gray400, letterSpacing: 0.8, textTransform: 'uppercase' }}>
          Timeline — {format(selectedDay, 'EEEE, MMM d')}
        </Text>
      </View>
      <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false} nestedScrollEnabled scrollEnabled>
        <View style={{ height: timelineHeight + 32, paddingBottom: 16 }}>
          {/* Hour labels + grid lines */}
          {Array.from({ length: totalHours + 1 }, (_, i) => (
            <View key={i} style={{ position: 'absolute', top: 16 + i * HOUR_HEIGHT, left: 0, right: 0, flexDirection: 'row', alignItems: 'center' }}>
              <Text style={{ fontSize: Type.tiny, color: Palette.gray400, width: 46, textAlign: 'right', paddingRight: 8 }}>
                {format(new Date(2000, 0, 1, startHour + i, 0), 'HH:mm')}
              </Text>
              <View style={{ flex: 1, height: 1, backgroundColor: Palette.gray100, marginRight: 8 }} />
            </View>
          ))}
          {/* Schedule blocks */}
          {daySchedules.map(s => {
            const start = new Date(s.start_time);
            const end = new Date(s.end_time);
            const startMinFromBase = (start.getHours() - startHour) * 60 + start.getMinutes();
            const durationMin = Math.max(30, differenceInMinutes(end, start));
            const topPx = 16 + (startMinFromBase / 60) * HOUR_HEIGHT;
            const heightPx = Math.max(32, (durationMin / 60) * HOUR_HEIGHT - 4);
            const color = STATUS_COLORS[s.status ?? 'pending'] ?? Palette.gray500;
            const bg = STATUS_BG[s.status ?? 'pending'] ?? Palette.gray100;
            return (
              <TouchableOpacity
                key={s.schedule_id}
                onPress={() => onPress(s)}
                activeOpacity={0.8}
                style={{
                  position: 'absolute',
                  top: topPx + 2,
                  left: 54,
                  right: 8,
                  height: heightPx,
                  backgroundColor: bg,
                  borderRadius: 8,
                  borderLeftWidth: 3,
                  borderLeftColor: color,
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  justifyContent: 'center',
                }}
              >
                <Text style={{ fontSize: Type.small, fontWeight: '700', color: Palette.ink }} numberOfLines={1}>{s.title}</Text>
                <Text style={{ fontSize: Type.tiny, color: Palette.gray500 }} numberOfLines={1}>
                  {format(start, 'HH:mm')} – {format(end, 'HH:mm')}{s.location ? ` · ${s.location}` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Kanban board card ────────────────────────────────────────────────────────
function KanbanCard({ item, index, isUpdating, onPress, onMoveStatus, onDuplicate }: { 
  item: Schedule; index: number; isUpdating: boolean; onPress: () => void; onMoveStatus: (status: string) => void; onDuplicate: () => void;
}) {
  const { t } = useTranslation();
  const status = item.status || 'pending';
  const color = STATUS_COLORS[status] ?? Palette.gray500;
  const bg = STATUS_BG[status] ?? Palette.gray100;

  const startLabel = item.start_time
    ? format(parseISO(item.start_time), 'MMM d, HH:mm')
    : '—';
  
  const names = (item.assigned_employees ?? [])
    .map((e) => `${e.first_name} ${e.last_name}`)
    .join(', ');

  const isOverdue = status === 'pending' && item.start_time && isBefore(parseISO(item.start_time), new Date());

  return (
    <MotiView
      from={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: 'timing', duration: 250, delay: Math.min(index * 30, 300) }}
    >
      <TouchableOpacity onPress={onPress} activeOpacity={0.85} disabled={isUpdating}>
        <Box
          bg="white" rounded="$xl" overflow="hidden" mb="$3"
          borderWidth={isOverdue ? 2 : 1} borderColor={isOverdue ? Palette.errorAlt : Palette.gray100}
          shadowColor={isOverdue ? Palette.errorAlt : Palette.black} shadowOffset={{ width: 0, height: 2 }}
          shadowOpacity={isOverdue ? 0.1 : 0.03} shadowRadius={8} elevation={2}
          opacity={isUpdating ? 0.6 : 1}
        >
          <Box position="absolute" left={0} top={0} bottom={0} w={3} bg={color} />
          <Box pl="$4" pr="$3" py="$3">
            <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
              <Text fontWeight="700" fontSize={Type.body} color={isOverdue ? Palette.error : Palette.ink} flex={1} mr="$2" numberOfLines={2}>
                {item.title}
              </Text>
              {isUpdating && <Spinner size="small" color={color} />}
            </HStack>

            <VStack space="xs" mb="$3">
              <HStack space="xs" alignItems="center">
                <MapPin size={12} color={Palette.gray500} />
                <Text fontSize={Type.small} color={Palette.gray500} flex={1} numberOfLines={1}>{item.location || '—'}</Text>
              </HStack>
              <HStack space="xs" alignItems="center">
                <Clock size={12} color={isOverdue ? Palette.errorAlt : Palette.gray500} />
                <Text fontSize={Type.small} color={isOverdue ? Palette.errorAlt : Palette.gray500} flex={1} numberOfLines={1}>{startLabel}</Text>
              </HStack>
              {names.length > 0 && (
                <HStack space="xs" alignItems="center">
                  <Users size={12} color={Palette.gray500} />
                  <Text fontSize={Type.small} color={Palette.gray500} flex={1} numberOfLines={1}>{names}</Text>
                </HStack>
              )}
            </VStack>

            {/* Quick Actions */}
            <HStack justifyContent="space-between" alignItems="center" pt="$2" borderTopWidth={1} borderTopColor={Palette.gray100}>
              <TouchableOpacity onPress={onDuplicate} style={{ paddingHorizontal: 8, paddingVertical: 6 }}>
                <MaterialIcons name="content-copy" size={16} color={Palette.gray500} />
              </TouchableOpacity>
              <HStack space="sm">
                {status === 'draft' && (
                  <TouchableOpacity onPress={() => onMoveStatus('pending')} style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: STATUS_BG['pending'], borderRadius: 6 }}>
                    <Text fontSize={Type.caption} fontWeight="600" color={STATUS_COLORS['pending']}>Publish</Text>
                  </TouchableOpacity>
                )}
                {status === 'pending' && (
                  <TouchableOpacity onPress={() => onMoveStatus('started')} style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: STATUS_BG['started'], borderRadius: 6 }}>
                    <Text fontSize={Type.caption} fontWeight="600" color={STATUS_COLORS['started']}>{t("companySchedule.startTask")}</Text>
                  </TouchableOpacity>
                )}
                {status === 'started' && (
                  <TouchableOpacity onPress={() => onMoveStatus('completed')} style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: STATUS_BG['completed'], borderRadius: 6 }}>
                    <Text fontSize={Type.caption} fontWeight="600" color={STATUS_COLORS['completed']}>Complete</Text>
                  </TouchableOpacity>
                )}
                {status === 'completed' && (
                  <TouchableOpacity onPress={() => onMoveStatus('pending')} style={{ paddingHorizontal: 12, paddingVertical: 6, backgroundColor: STATUS_BG['pending'], borderRadius: 6 }}>
                    <Text fontSize={Type.caption} fontWeight="600" color={STATUS_COLORS['pending']}>Reopen</Text>
                  </TouchableOpacity>
                )}
              </HStack>
            </HStack>
          </Box>
        </Box>
      </TouchableOpacity>
    </MotiView>
  );
}

// ─── Schedule form modal (create + edit) ─────────────────────────────────────
interface ScheduleFormModalProps {
  visible: boolean;
  companyId: number;
  schedule: Schedule | null;
  prefillDate?: Date | null;
  pastLocations?: string[];
  allSchedules?: Schedule[];
  onClose: () => void;
  onSaved: () => void;
}

function ScheduleFormModal({ visible, companyId, schedule, prefillDate, pastLocations = [], allSchedules = [], onClose, onSaved }: ScheduleFormModalProps) {
  const { t } = useTranslation();

  const [title, setTitle] = useState('');
  const [location, setLocation] = useState('');
  const [nominatimResults, setNominatimResults] = useState<{ display_name: string; lat: string; lon: string }[]>([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [fetchingGPS, setFetchingGPS] = useState(false);
  const searchTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [notes, setNotes] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date(Date.now() + 60 * 60 * 1000));
  const [activePicker, setActivePicker] = useState<'start' | 'end' | null>(null);
  const [tempDate, setTempDate] = useState(new Date());
  const [employees, setEmployees] = useState<any[]>([]);
  const [empLoading, setEmpLoading] = useState(false);
  // Distinguishes "this company genuinely has no employees" from "the fetch
  // failed" (403/network) — previously both showed the same empty message,
  // which hid auth/permission failures behind a silent "no employees".
  const [empError, setEmpError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<Schedule['status']>('draft');
  const [proofViewer, setProofViewer] = useState<{ uri: string; name: string } | null>(null);

  const loadEmployees = React.useCallback(async () => {
    if (!companyId) return;
    setEmpLoading(true);
    setEmpError(null);
    const res = await getUsersByCompany(companyId);
    if (Array.isArray(res)) {
      setEmployees(res);
    } else {
      // getUsersByCompany returns { error, status } on failure. Surface it so a
      // 403 (permission) or network failure isn't mistaken for an empty roster.
      setEmployees([]);
      const status = (res as { status?: number })?.status;
      setEmpError(
        status === 403
          ? t('companySchedule.employeesForbidden') || "You don't have permission to view this company's employees."
          : (res as { error?: string })?.error || t('companySchedule.employeesLoadFailed') || 'Could not load employees. Tap to retry.'
      );
    }
    setEmpLoading(false);
  }, [companyId, t]);

  // Populate form + load employees when modal opens
  useEffect(() => {
    if (!visible || !companyId) return;
    if (schedule) {
      setTitle(schedule.title);
      setLocation(schedule.location);
      setNotes(schedule.notes ?? '');
      setStartDate(parseISO(schedule.start_time));
      setEndDate(parseISO(schedule.end_time));
      setSelectedIds(new Set(schedule.assigned_employees.map((e) => e.private_user_id)));
      setStatus(schedule.status ?? 'draft');
    } else {
      setStatus('draft');
      if (prefillDate) {
        const s = new Date(prefillDate); s.setHours(8, 0, 0, 0);
        const e = new Date(prefillDate); e.setHours(17, 0, 0, 0);
        setStartDate(s);
        setEndDate(e);
      } else {
        setStartDate(new Date());
        setEndDate(new Date(Date.now() + 60 * 60 * 1000));
      }
    }
    loadEmployees();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setTitle('');
    setLocation('');
    setNotes('');
    setStartDate(new Date());
    setEndDate(new Date(Date.now() + 60 * 60 * 1000));
    setActivePicker(null);
    setSelectedIds(new Set());
    setSearch('');
    setSubmitting(false);
    setStatus('draft');
  };

  const handleClose = () => {
    reset();
    setNominatimResults([]);
    onClose();
  };

  const searchNominatim = async (query: string) => {
    if (query.trim().length < 3) {
      setNominatimResults([]);
      return;
    }
    setLocationLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`,
        { headers: { 'Accept-Language': 'en' } }
      );
      const data = await res.json();
      setNominatimResults(Array.isArray(data) ? data : []);
    } catch {
      setNominatimResults([]);
    } finally {
      setLocationLoading(false);
    }
  };

  const handleLocationChange = (text: string) => {
    setLocation(text);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (text.trim().length < 3) {
      setNominatimResults([]);
      return;
    }
    searchTimerRef.current = setTimeout(() => searchNominatim(text), 350);
  };

  const selectNominatimResult = (result: { display_name: string }) => {
    const short = result.display_name.split(',').slice(0, 3).join(',').trim();
    setLocation(short);
    setNominatimResults([]);
  };

  const useCurrentLocation = async () => {
    setFetchingGPS(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('companySchedule.alertPermissionDeniedTitle'), t('companySchedule.alertPermissionDeniedBody'));
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${pos.coords.latitude}&lon=${pos.coords.longitude}`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json();
        const short = data.display_name?.split(',').slice(0, 3).join(',').trim() || 'Current Location';
        setLocation(short);
      } catch {
        setLocation(`${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}`);
      }
    } catch {
      Alert.alert(t('common.errorTitle'), t('companySchedule.alertLocationFetchFailed'));
    } finally {
      setFetchingGPS(false);
      setNominatimResults([]);
    }
  };

  const filteredEmployees = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => {
      const name = `${e.private_user?.first_name ?? ''} ${e.private_user?.last_name ?? ''}`.toLowerCase();
      return name.includes(q);
    });
  }, [employees, search]);

  const toggleEmployee = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!title.trim()) return Alert.alert(t('companySchedule.alertValidationTitle'), t('companySchedule.valTitleRequired'));
    if (!location.trim()) return Alert.alert(t('companySchedule.alertValidationTitle'), t('companySchedule.valLocationRequired'));
    if (status !== 'draft' && selectedIds.size === 0) return Alert.alert(t('companySchedule.alertValidationTitle'), t('companySchedule.valEmployeeRequired'));
    if (endDate <= startDate) return Alert.alert(t('companySchedule.alertValidationTitle'), t('companySchedule.valEndAfterStart'));

    // Conflict Check
    const overlapping = allSchedules.filter(s => {
      if (s.schedule_id === schedule?.schedule_id) return false;
      if (s.status === 'completed') return false;
      
      const sStart = new Date(s.start_time);
      const sEnd = new Date(s.end_time);
      const timeOverlap = startDate < sEnd && sStart < endDate;
      
      if (!timeOverlap) return false;
      const sEmpIds = s.assigned_employees?.map(e => e.private_user_id) || [];
      return Array.from(selectedIds).some(id => sEmpIds.includes(id));
    });

    if (overlapping.length > 0) {
      if (Platform.OS === 'web') {
        const confirm = window.confirm(`The selected employees are already scheduled for an overlapping task (${overlapping[0].title}). Proceed anyway?`);
        if (!confirm) return;
        proceedWithSubmit();
      } else {
        return Alert.alert(
          'Shift Conflict',
          `The selected employees are already scheduled for an overlapping task (${overlapping[0].title}). Proceed anyway?`,
          [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Proceed', onPress: proceedWithSubmit }
          ]
        );
      }
    } else {
      proceedWithSubmit();
    }
  };

  const proceedWithSubmit = async () => {
    setSubmitting(true);
    try {
      const payload: CreateSchedulePayload = {
        title: title.trim(),
        company_id: companyId,
        location: location.trim(),
        notes: notes.trim() || undefined,
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        status,
        assigned_employee_ids: Array.from(selectedIds),
      };
      const result = schedule
        ? await updateSchedule(schedule.schedule_id, payload)
        : await createSchedule(payload);
      if (result && typeof result === 'object' && 'error' in result) {
        Alert.alert(t('common.errorTitle'), (result as any).error);
      } else {
        handleClose();
        onSaved();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const insets = useSafeAreaInsets();

  // Android hardware back button dismiss
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (visible) { handleClose(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [visible]);

  // Android: open date then time pickers imperatively (avoids inline component errors inside overlay)
  const openAndroidPicker = (which: 'start' | 'end') => {
    const current = which === 'start' ? startDate : endDate;

    DateTimePickerAndroid.open({
      value: current,
      mode: 'date',
      is24Hour: true,
      onChange: (event, pickedDate) => {
        if (event?.type !== 'set' || !pickedDate) return;

        const afterDate = new Date(
          pickedDate.getFullYear(),
          pickedDate.getMonth(),
          pickedDate.getDate(),
          current.getHours(),
          current.getMinutes(),
        );

        DateTimePickerAndroid.open({
          value: afterDate,
          mode: 'time',
          is24Hour: true,
          onChange: (timeEvent, pickedTime) => {
            if (timeEvent?.type !== 'set' || !pickedTime) return;
            const final = new Date(
              pickedDate.getFullYear(),
              pickedDate.getMonth(),
              pickedDate.getDate(),
              pickedTime.getHours(),
              pickedTime.getMinutes(),
            );
            if (which === 'start') setStartDate(final);
            else setEndDate(final);
          },
        });
      },
    });
  };

  if (!visible) return null;

  // iOS: native pageSheet. Android: in-tree absolute overlay.
  // IMPORTANT: do NOT define ModalWrapper as a component inside render —
  // that causes a new component type on every keystroke → remount → keyboard dismissed.
  const inner = (
    <>
    <View style={{
      flex: 1,
      backgroundColor: 'white',
      paddingTop: insets.top,
      paddingBottom: insets.bottom,
    }}>
          {/* ── Header ── */}
          <Box bg={Palette.white} px="$5" py="$4" borderBottomWidth={1} borderBottomColor={Palette.gray100}>
            <HStack justifyContent="space-between" alignItems="center">
              <Heading size="md" color={Palette.ink}>{schedule ? t('companySchedule.titleEdit') : t('companySchedule.titleNew')}</Heading>
              <TouchableOpacity
                onPress={handleClose}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <MaterialIcons name="close" size={22} color={Palette.gray500} />
              </TouchableOpacity>
            </HStack>
          </Box>

          {/* ── Body ── */}
          <KeyboardAvoidingView
            behavior="padding"
            style={{ flex: 1 }}
            keyboardVerticalOffset={0}
          >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          >
            {/* Title */}
            <Text fontSize={Type.label} fontWeight="600" color={Palette.gray600} mb="$1.5">{t('companySchedule.fieldTitle')}</Text>
            <TextInput
              style={ms.input}
              placeholder={t("companySchedule.placeholderTitle")}
              placeholderTextColor={Palette.gray400}
              value={title}
              onChangeText={setTitle}
              returnKeyType="next"
            />

            {/* Location */}
            <Text fontSize={Type.label} fontWeight="600" color={Palette.gray600} mb="$1.5">{t('companySchedule.fieldLocation')}</Text>
            <HStack space="xs" alignItems="center" mb={nominatimResults.length > 0 ? 0 : '$3'}>
              <TextInput
                style={[ms.input, { flex: 1, marginBottom: 0 }]}
                placeholder={t("companySchedule.placeholderSearchAddress")}
                placeholderTextColor={Palette.gray400}
                value={location}
                onChangeText={handleLocationChange}
                returnKeyType="next"
              />
              {locationLoading ? (
                <Spinner size="small" color={Palette.blue} style={{ marginLeft: 6 }} />
              ) : (
                <TouchableOpacity
                  onPress={useCurrentLocation}
                  disabled={fetchingGPS}
                  style={{
                    backgroundColor: Palette.blueTint,
                    borderRadius: 10,
                    padding: 10,
                    borderWidth: 1,
                    borderColor: Palette.blueTint,
                    marginLeft: 6,
                    opacity: fetchingGPS ? 0.6 : 1,
                  }}
                >
                  <MapPin size={18} color={Palette.blue} />
                </TouchableOpacity>
              )}
            </HStack>
            {nominatimResults.length > 0 && (
              <Box
                bg="white"
                borderWidth={1}
                borderColor={Palette.gray200}
                rounded="$lg"
                mb="$3"
                overflow="hidden"
                shadowColor={Palette.black}
                shadowOffset={{ width: 0, height: 2 }}
                shadowOpacity={0.06}
                shadowRadius={4}
                elevation={3}
              >
                {nominatimResults.map((r, i) => (
                  <TouchableOpacity
                    key={r.display_name + i}
                    onPress={() => selectNominatimResult(r)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderBottomWidth: i < nominatimResults.length - 1 ? 1 : 0,
                      borderBottomColor: Palette.gray100,
                    }}
                  >
                    <MapPin size={13} color={Palette.gray400} style={{ marginRight: 8 }} />
                    <Text style={{ fontSize: Type.label, color: Palette.gray700, flex: 1 }} numberOfLines={2}>
                      {r.display_name.split(',').slice(0, 4).join(', ')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </Box>
            )}

            {/* Start Time */}
            <Text fontSize={Type.label} fontWeight="600" color={Palette.gray600} mb="$1.5">{t('companySchedule.fieldStart')}</Text>
            <TouchableOpacity
              style={ms.dateRow}
              onPress={() => {
                if (Platform.OS === 'android') openAndroidPicker('start');
                else { setTempDate(startDate); setActivePicker('start'); }
              }}
              activeOpacity={0.7}
            >
              <HStack alignItems="center" space="sm" flex={1}>
                <Clock size={15} color={Palette.gray500} />
                <Text fontSize={Type.body} color={Palette.gray700} flex={1}>
                  {format(startDate, 'dd MMM yyyy, HH:mm')}
                </Text>
                <MaterialIcons name="edit" size={16} color={Palette.gray400} />
              </HStack>
            </TouchableOpacity>

            {/* End Time */}
            <Text fontSize={Type.label} fontWeight="600" color={Palette.gray600} mb="$1.5">{t('companySchedule.fieldEnd')}</Text>
            <TouchableOpacity
              style={ms.dateRow}
              onPress={() => {
                if (Platform.OS === 'android') openAndroidPicker('end');
                else { setTempDate(endDate); setActivePicker('end'); }
              }}
              activeOpacity={0.7}
            >
              <HStack alignItems="center" space="sm" flex={1}>
                <Clock size={15} color={Palette.gray500} />
                <Text fontSize={Type.body} color={Palette.gray700} flex={1}>
                  {format(endDate, 'dd MMM yyyy, HH:mm')}
                </Text>
                <MaterialIcons name="edit" size={16} color={Palette.gray400} />
              </HStack>
            </TouchableOpacity>

            {/* DateTime picker — iOS only (Android uses imperative DateTimePickerAndroid.open) */}
            {activePicker !== null && (
                <RNModal transparent animationType="fade" visible statusBarTranslucent>
                  <TouchableOpacity
                    activeOpacity={1}
                    onPress={() => setActivePicker(null)}
                    style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }}
                  >
                    <TouchableOpacity activeOpacity={1}>
                      <Box bg="white" rounded="$3xl" pb="$4" overflow="hidden">
                        {/* Toolbar */}
                        <HStack justifyContent="space-between" alignItems="center" px="$5" py="$3" borderBottomWidth={1} borderBottomColor={Palette.gray100}>
                          <TouchableOpacity onPress={() => setActivePicker(null)}>
                            <Text color={Palette.gray500} fontWeight="600">{t("common.cancel")}</Text>
                          </TouchableOpacity>
                          <Text fontWeight="700" color={Palette.ink}>
                            {activePicker === 'start' ? 'Start Time' : 'End Time'}
                          </Text>
                          <TouchableOpacity onPress={() => {
                            if (activePicker === 'start') setStartDate(tempDate);
                            else setEndDate(tempDate);
                            setActivePicker(null);
                          }}>
                            <Text color={Palette.blue} fontWeight="700">Done</Text>
                          </TouchableOpacity>
                        </HStack>
                        <DateTimePicker
                          value={tempDate}
                          mode="datetime"
                          display="spinner"
                          onChange={(_, date) => { if (date) setTempDate(date); }}
                          style={{ height: 200 }}
                          textColor={Palette.gray800}
                        />
                      </Box>
                    </TouchableOpacity>
                  </TouchableOpacity>
                </RNModal>
            )}

            {/* Status */}
            <Text fontSize={Type.label} fontWeight="600" color={Palette.gray600} mb="$1.5">Status</Text>
            <HStack space="sm" mb="$4" flexWrap="wrap">
              {(['draft', 'pending', 'started', 'completed'] as const).map((s) => (
                <TouchableOpacity
                  key={s}
                  onPress={() => setStatus(s)}
                  activeOpacity={0.8}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 20,
                    borderWidth: 1.5,
                    borderColor: status === s ? STATUS_COLORS[s] : Palette.gray200,
                    backgroundColor: status === s ? STATUS_BG[s] : 'transparent',
                    marginBottom: 4,
                  }}
                >
                  <Text
                    style={{
                      fontSize: Type.label,
                      fontWeight: status === s ? '700' : '500',
                      color: status === s ? STATUS_COLORS[s] : Palette.gray500,
                      textTransform: 'capitalize',
                    }}
                  >
                    {s}
                  </Text>
                </TouchableOpacity>
              ))}
            </HStack>

            {/* Notes */}
            <Text fontSize={Type.label} fontWeight="600" color={Palette.gray600} mb="$1.5">{t('companySchedule.fieldNotes')}</Text>
            <TextInput
              style={[ms.input, ms.textarea]}
              placeholder={t("companySchedule.placeholderNotes")}
              placeholderTextColor={Palette.gray400}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {/* Employees */}
            <Text fontSize={Type.label} fontWeight="600" color={Palette.gray600} mb="$1.5">
              Assign Employees ({selectedIds.size} selected)
            </Text>
            <TextInput
              style={ms.input}
              placeholder={t("companySchedule.placeholderSearchName")}
              placeholderTextColor={Palette.gray400}
              value={search}
              onChangeText={setSearch}
            />
            <Box
              borderWidth={1} borderColor={Palette.gray100}
              rounded="$xl" overflow="hidden" maxHeight={210}
            >
              <ScrollView
                nestedScrollEnabled
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {empLoading ? (
                  <Box p="$4" alignItems="center">
                    <Spinner color={Palette.blue} />
                  </Box>
                ) : empError ? (
                  <TouchableOpacity onPress={loadEmployees} activeOpacity={0.7}>
                    <Box p="$4" alignItems="center">
                      <Text fontSize={Type.label} color={Palette.error} textAlign="center">{empError}</Text>
                      <Text fontSize={Type.caption} color={Palette.blue} mt="$1">{t('common.retry') || 'Tap to retry'}</Text>
                    </Box>
                  </TouchableOpacity>
                ) : filteredEmployees.length === 0 ? (
                  <Box p="$4" alignItems="center">
                    <Text fontSize={Type.label} color={Palette.gray400}>{t('companySchedule.noEmployees')}</Text>
                  </Box>
                ) : (
                  filteredEmployees.map((emp) => {
                    const pid: number =
                      emp.private_user?.private_user_id ?? emp.private_user_id;
                    const name =
                      `${emp.private_user?.first_name ?? ''} ${emp.private_user?.last_name ?? ''}`.trim() ||
                      emp.email;
                    const checked = selectedIds.has(pid);
                    return (
                      <TouchableOpacity
                        key={pid}
                        onPress={() => toggleEmployee(pid)}
                        style={ms.empRow}
                        activeOpacity={0.7}
                      >
                        <Box
                          w={22} h={22} rounded="$sm"
                          borderWidth={2}
                          borderColor={checked ? Palette.blue : Palette.gray300}
                          bg={checked ? Palette.blue : 'white'}
                          alignItems="center" justifyContent="center"
                        >
                          {checked && (
                            <MaterialIcons name="check" size={12} color="white" />
                          )}
                        </Box>
                        <Text fontSize={Type.body} color={Palette.gray800} flex={1}>{name}</Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </Box>

            {/* Assignee progress & evidence — read-only, shown when the task
                already has per-assignee statuses (photo proof, notes, who started). */}
            {schedule?.assignee_statuses && schedule.assignee_statuses.length > 0 && (
              <Box
                borderWidth={1} borderColor={Palette.gray100}
                rounded="$xl" p="$4" bg={Palette.gray50}
              >
                <HStack space="xs" alignItems="center" mb="$3">
                  <MaterialIcons name="assignment-turned-in" size={15} color={Palette.blue} />
                  <Text fontSize={Type.label} fontWeight="700" color={Palette.ink}>
                    Assignee progress & evidence
                  </Text>
                </HStack>
                <VStack space="sm">
                  {schedule.assignee_statuses.map((as) => {
                    const emp = schedule.assigned_employees?.find(
                      (e) => e.private_user_id === as.private_user_id
                    );
                    const empName =
                      `${emp?.first_name ?? ''} ${emp?.last_name ?? ''}`.trim() ||
                      `Employee #${as.private_user_id}`;
                    const st = as.status || 'pending';
                    const stColor =
                      st === 'completed'
                        ? Palette.success
                        : st === 'started'
                          ? Palette.blue
                          : Palette.gray400;
                    const stBg =
                      st === 'completed'
                        ? Palette.greenTint
                        : st === 'started'
                          ? Palette.blueTint
                          : Palette.gray100;
                    return (
                      <Box key={as.private_user_id}>
                        <HStack space="sm" alignItems="center">
                          <Box bg={stBg} px="$2" py="$1" rounded="$full">
                            <Text fontSize={Type.caption} fontWeight="700" color={stColor} style={{ textTransform: 'capitalize' }}>
                              {st}
                            </Text>
                          </Box>
                          <Text fontSize={Type.body} color={Palette.ink} fontWeight="600" flex={1} numberOfLines={1}>
                            {empName}
                          </Text>
                        </HStack>
                        {as.note ? (
                          <Text fontSize={Type.label} color={Palette.gray600} mt="$1" ml="$1">
                            “{as.note}”
                          </Text>
                        ) : null}
                        {as.proof_image_url ? (
                          <TouchableOpacity
                            activeOpacity={0.8}
                            onPress={() => setProofViewer({ uri: String(resolveFileUrl(as.proof_image_url)), name: empName })}
                          >
                            <Image
                              source={{ uri: String(resolveFileUrl(as.proof_image_url)) }}
                              style={{ width: '100%', height: 120, borderRadius: 12, marginTop: 8 }}
                              resizeMode="cover"
                            />
                          </TouchableOpacity>
                        ) : null}
                      </Box>
                    );
                  })}
                </VStack>
              </Box>
            )}
          </ScrollView>
          </KeyboardAvoidingView>

          {/* ── Footer (always visible, outside KAV) ── */}
          <Box bg={Palette.white} px="$5" py="$4" borderTopWidth={1} borderTopColor={Palette.gray100}>
            <HStack space="md">
              <TouchableOpacity
                onPress={handleClose}
                disabled={submitting}
                style={[ms.btn, ms.btnCancel]}
              >
                <Text fontWeight="600" color={Palette.gray700}>{t("common.cancel")}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSubmit}
                disabled={submitting}
                style={[ms.btn, ms.btnSubmit, { flex: 2 }]}
              >
                {submitting
                  ? <Spinner color="white" size="small" />
                  : <Text fontWeight="700" color="white">{schedule ? t('companySchedule.actionSave') : t('companySchedule.actionCreate')}</Text>
                }
              </TouchableOpacity>
            </HStack>
          </Box>
      </View>

      {/* Full-screen photo-proof viewer */}
      {proofViewer && (
        <RNModal visible transparent animationType="fade" onRequestClose={() => setProofViewer(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' }}>
            <TouchableOpacity
              activeOpacity={1}
              style={{ position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 8 }}
              onPress={() => setProofViewer(null)}
            >
              <MaterialIcons name="close" size={28} color="white" />
            </TouchableOpacity>
            <Text style={{ color: '#fff', textAlign: 'center', fontSize: Type.body, fontWeight: '700', marginBottom: 12, paddingHorizontal: 24 }}>
              {proofViewer.name}
            </Text>
            <Image
              source={{ uri: proofViewer.uri }}
              style={{ width: '100%', height: '70%' }}
              resizeMode="contain"
            />
          </View>
        </RNModal>
      )}
    </>
  );

  if (Platform.OS === 'ios') {
    return (
      <RNModal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
        {inner}
      </RNModal>
    );
  }

  // Android: render as in-tree absolute overlay (bottom: 60 clears the tab bar)
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 999, bottom: 60 }]}>
      {inner}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────
export default function SchedulePage() {
  return (
    <PermissionGate permission="view_schedule" label="the schedule">
      <SchedulePageInner />
    </PermissionGate>
  );
}

function SchedulePageInner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [timeFrameFilter, setTimeFrameFilter] = useState<'all' | 'today' | 'this_week' | 'next_week'>('this_week');
  const [employeeFilter, setEmployeeFilter] = useState<number | 'all'>('all');
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }));
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [sortBy, setSortBy] = useState<'date_asc' | 'date_desc' | 'title' | 'status'>('date_asc');
  const [hasLocationFilter, setHasLocationFilter] = useState(false);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const [allEmployees, setAllEmployees] = useState<{ id: number; name: string }[]>([]);
  const { width } = useWindowDimensions();
  const isLargeScreen = width >= 768;

  const companyId: number | undefined =
    user?.private_user?.company_id ?? (user as any)?.company?.company_id ?? (user as any)?.company_id;

  useEffect(() => {
    if (companyId) {
      getUsersByCompany(companyId).then(res => {
        if (Array.isArray(res)) {
          setAllEmployees(res.map(e => ({
            id: (e.private_user?.private_user_id ?? e.private_user_id) as number,
            name: `${e.private_user?.first_name ?? ''} ${e.private_user?.last_name ?? ''}`.trim() || e.email
          })));
        }
      });
    }
  }, [companyId]);

  const summaryStats = useMemo(() => ({
    total: schedules.length,
    draft: schedules.filter(s => s.status === 'draft').length,
    pending: schedules.filter(s => s.status === 'pending').length,
    started: schedules.filter(s => s.status === 'started').length,
    completed: schedules.filter(s => s.status === 'completed').length,
  }), [schedules]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (statusFilter !== 'all') count++;
    if (employeeFilter !== 'all') count++;
    if (timeFrameFilter !== 'all') count++;
    if (hasLocationFilter) count++;
    if (sortBy !== 'date_asc') count++;
    return count;
  }, [statusFilter, employeeFilter, timeFrameFilter, hasLocationFilter, sortBy]);

  const filteredSchedules = useMemo(() => {
    let filtered = schedules;
    
    // Status Filter (List View)
    if (statusFilter !== 'all') {
      filtered = filtered.filter(s => s.status === statusFilter);
    }
    
    // Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(s =>
        (s.title ?? '').toLowerCase().includes(q) ||
        (s.location ?? '').toLowerCase().includes(q)
      );
    }
    
    // Employee Filter
    if (employeeFilter !== 'all') {
      filtered = filtered.filter(s => 
        s.assigned_employees?.some(e => e.private_user_id === employeeFilter)
      );
    }
    
    // Time Frame Filter
    if (timeFrameFilter !== 'all') {
      const now = new Date();
      filtered = filtered.filter(s => {
        if (!s.start_time) return false;
        const sDate = parseISO(s.start_time);
        if (timeFrameFilter === 'today') {
          return format(sDate, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd');
        } else if (timeFrameFilter === 'this_week') {
          return isWithinInterval(sDate, { start: startOfWeek(now), end: endOfWeek(now) });
        } else if (timeFrameFilter === 'next_week') {
          const nextWeek = addWeeks(now, 1);
          return isWithinInterval(sDate, { start: startOfWeek(nextWeek), end: endOfWeek(nextWeek) });
        }
        return true;
      });
    }

    // Day filter from WeekStrip selection
    if (selectedDay) {
      filtered = filtered.filter(s => {
        if (!s.start_time) return false;
        try { return isSameDay(new Date(s.start_time), selectedDay); } catch { return false; }
      });
    }

    // Has location filter
    if (hasLocationFilter) {
      filtered = filtered.filter(s => s.location && s.location.trim().length > 0);
    }

    // Sort
    filtered = [...filtered].sort((a, b) => {
      if (sortBy === 'date_asc') {
        return new Date(a.start_time || 0).getTime() - new Date(b.start_time || 0).getTime();
      } else if (sortBy === 'date_desc') {
        return new Date(b.start_time || 0).getTime() - new Date(a.start_time || 0).getTime();
      } else if (sortBy === 'title') {
        return (a.title ?? '').localeCompare(b.title ?? '');
      } else if (sortBy === 'status') {
        const order: Record<string, number> = { draft: 0, pending: 1, started: 2, completed: 3 };
        return (order[a.status ?? ''] ?? 4) - (order[b.status ?? ''] ?? 4);
      }
      return 0;
    });

    return filtered;
  }, [schedules, statusFilter, searchQuery, employeeFilter, timeFrameFilter, selectedDay, hasLocationFilter, sortBy]);

  const totalHours = useMemo(() => {
    if (employeeFilter === 'all') return null;
    let totalMins = 0;
    filteredSchedules.forEach(s => {
      if (s.start_time && s.end_time) {
        totalMins += Math.max(0, differenceInMinutes(parseISO(s.end_time), parseISO(s.start_time)));
      }
    });
    return (totalMins / 60).toFixed(1);
  }, [filteredSchedules, employeeFilter]);

  const loadData = useCallback(
    async (isRefreshing = false) => {
      if (isRefreshing) setRefreshing(true);
      else setLoading(true);

      if (!companyId) {
        setSchedules([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      try {
        const res = await getSchedulesByCompany(companyId);
        setSchedules(Array.isArray(res) ? res : []);
      } catch (err) {
        console.error('Error loading schedules:', err);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [companyId]
  );

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = () => loadData(true);

  const handleUpdateStatus = async (id: number, newStatus: string) => {
    setUpdatingId(id);
    try {
      const scheduleToUpdate = schedules.find(s => s.schedule_id === id);
      if (!scheduleToUpdate) return;

      const safeStatus = newStatus as Schedule['status'];
      const payload: CreateSchedulePayload = {
        title: scheduleToUpdate.title,
        company_id: scheduleToUpdate.company_id,
        location: scheduleToUpdate.location,
        notes: scheduleToUpdate.notes,
        start_time: scheduleToUpdate.start_time,
        end_time: scheduleToUpdate.end_time,
        status: safeStatus,
        assigned_employee_ids: scheduleToUpdate.assigned_employees?.map(e => e.private_user_id) || [],
      };
      
      const result = await updateSchedule(id, payload);
      if (result && typeof result === 'object' && 'error' in result) {
        Alert.alert(t('common.errorTitle'), (result as any).error);
      } else {
        setSchedules(prev => prev.map(s => s.schedule_id === id ? { ...s, status: safeStatus } : s));
      }
    } catch (err) {
      console.error(err);
      Alert.alert(t('common.errorTitle'), t('companySchedule.alertStatusUpdateFailed'));
    } finally {
      setUpdatingId(null);
    }
  };

  const handleDuplicate = (s: Schedule) => {
    setSelectedSchedule({ ...s, schedule_id: 0, status: 'draft' });
    setShowCreate(true);
  };

  return (
    <LinearGradient colors={[Palette.gray50, Palette.gray100, Palette.white]} style={{ flex: 1 }}>
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        <PremiumHeader
          title="Schedules"
          onBack={() => router.push('/company_dashboard/home')}
          rightElement={
            <TouchableOpacity
              onPress={() => { setSelectedSchedule(null); setShowCreate(true); }}
              style={{
                backgroundColor: Palette.indigo,
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Plus size={20} color="white" />
            </TouchableOpacity>
          }
        />

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Palette.gold} />
          }
        >
          <VStack space="xl" px="$5" pt="$4">

            {/* Summary Cards */}
            <MotiView
              from={{ opacity: 0, translateY: -10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 400 }}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20 }}>
                <HStack space="md">
                  {([
                    { label: t('companySchedule.total'),     value: summaryStats.total,     icon: 'calendar-today',      iconBg: Palette.gray100, iconColor: Palette.gray600, textColor: Palette.ink },
                    { label: t('companySchedule.draft'),     value: summaryStats.draft,     icon: 'edit',                iconBg: Palette.gray100, iconColor: Palette.gray600, textColor: Palette.ink },
                    { label: t('companySchedule.pending'),   value: summaryStats.pending,   icon: 'hourglass-empty',     iconBg: Palette.warningTint, iconColor: Palette.gold, textColor: Palette.gold },
                    { label: t('companySchedule.started'),   value: summaryStats.started,   icon: 'play-circle-filled',  iconBg: Palette.blueTint, iconColor: Palette.blue, textColor: Palette.blue },
                    { label: t('companySchedule.completed'), value: summaryStats.completed, icon: 'check-circle',        iconBg: Palette.greenTint, iconColor: Palette.success, textColor: Palette.success },
                  ] as const).map(({ label, value, icon, iconBg, iconColor, textColor }) => (
                    <Box
                      key={label}
                      bg={Palette.white} p="$4" rounded="$3xl" width={160}
                      borderWidth={1} borderColor={Palette.gray100}
                      shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.04} shadowRadius={10} elevation={3}
                    >
                      <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                        <Box p="$2" rounded="$full" bg={iconBg}>
                          <MaterialIcons name={icon as any} size={20} color={iconColor} />
                        </Box>
                        <Text fontSize={Type.h1} fontWeight="800" color={textColor}>{value}</Text>
                      </HStack>
                      <Text fontSize={Type.small} color={Palette.gray500} fontWeight="600">{label}</Text>
                    </Box>
                  ))}
                </HStack>
              </ScrollView>
            </MotiView>

            {/* Week Strip */}
            <WeekStrip
              schedules={schedules}
              weekStart={weekStart}
              selectedDay={selectedDay}
              onDaySelect={(day) => {
                setSelectedDay(day);
                if (day) setTimeFrameFilter('all');
              }}
              onWeekChange={(dir) => {
                setSelectedDay(null);
                setWeekStart(prev => dir === 1 ? addWeeks(prev, 1) : subWeeks(prev, 1));
                setTimeFrameFilter('all');
              }}
              accentColor={Palette.blue}
            />

            {/* Day Timeline — shown when a day is selected in WeekStrip */}
            {selectedDay && (
              <DayTimeline
                schedules={schedules}
                selectedDay={selectedDay}
                onPress={(s) => { setSelectedSchedule(s); setShowCreate(true); }}
              />
            )}

            {/* ── Filter & Search Panel ──────────────────────────────────── */}
            <VStack space="md" bg="white" p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.gray100} shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.03} shadowRadius={8} elevation={2}>

              {/* Search row */}
              <Input
                size="lg" variant="outline" bg={Palette.gray50} borderWidth={1}
                rounded="$xl" borderColor={Palette.gray200}
              >
                <InputSlot pl="$4">
                  <MaterialIcons name="search" size={18} color={Palette.gray400} />
                </InputSlot>
                <InputField
                  placeholder={t("companySchedule.placeholderSearchTitleLocation")}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  color={Palette.gray800}
                  placeholderTextColor={Palette.gray400}
                  fontSize={Type.body}
                />
                {searchQuery.length > 0 && (
                  <InputSlot pr="$3">
                    <Pressable onPress={() => setSearchQuery('')}>
                      <MaterialIcons name="close" size={16} color={Palette.gray400} />
                    </Pressable>
                  </InputSlot>
                )}
              </Input>

              {/* Header row */}
              <HStack justifyContent="space-between" alignItems="center">
                <HStack space="sm" alignItems="center">
                  <MaterialIcons name="filter-list" size={16} color={Palette.gray700} />
                  <Text fontSize={Type.label} fontWeight="700" color={Palette.gray800}>Filters &amp; Sort</Text>
                  {activeFilterCount > 0 && (
                    <Box bg={Palette.gold} px="$2" py="$0.5" rounded="$full">
                      <Text fontSize={Type.tiny} fontWeight="800" color="white">{activeFilterCount} active</Text>
                    </Box>
                  )}
                </HStack>
                {activeFilterCount > 0 && (
                  <Pressable onPress={() => {
                    setStatusFilter('all');
                    setEmployeeFilter('all');
                    setTimeFrameFilter('all');
                    setHasLocationFilter(false);
                    setSortBy('date_asc');
                    setSelectedDay(null);
                    setSearchQuery('');
                  }}>
                    <Text fontSize={Type.small} fontWeight="600" color={Palette.gold}>{t("companySchedule.clearAll")}</Text>
                  </Pressable>
                )}
              </HStack>

              {/* ── Status ── */}
              <VStack space="xs">
                <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray400} letterSpacing={0.8} textTransform="uppercase">Status</Text>
                <HStack space="xs" flexWrap="wrap">
                  {([
                    { id: 'all',       label: t('companySchedule.all'),       icon: 'check-box-outline-blank', color: Palette.gray500 },
                    { id: 'draft',     label: t('companySchedule.draft'),     icon: 'edit',                    color: Palette.gray500 },
                    { id: 'pending',   label: t('companySchedule.pending'),   icon: 'hourglass-empty',          color: Palette.gold },
                    { id: 'started',   label: t('companySchedule.inProgress'), icon: 'play-arrow',             color: Palette.blue },
                    { id: 'completed', label: t('companySchedule.completed'), icon: 'check-circle',             color: Palette.success },
                  ] as const).map(({ id, label, icon, color }) => {
                    const active = statusFilter === id;
                    return (
                      <Pressable key={id} onPress={() => setStatusFilter(id)} style={{ marginBottom: 4 }}>
                        <HStack px="$3" py="$2" rounded="$lg" space="xs" alignItems="center"
                          bg={active ? color : Palette.gray50}
                          borderWidth={1.5}
                          borderColor={active ? color : Palette.gray200}
                        >
                          <MaterialIcons name={icon as any} size={13} color={active ? 'white' : color} />
                          <Text fontSize={Type.small} fontWeight="700" color={active ? 'white' : Palette.gray700}>{label}</Text>
                        </HStack>
                      </Pressable>
                    );
                  })}
                </HStack>
              </VStack>

              {/* ── View mode ── */}
              <VStack space="xs">
                <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray400} letterSpacing={0.8} textTransform="uppercase">{t("companySchedule.viewLabel")}</Text>
                <HStack bg={Palette.gray100} p="$1" rounded="$xl">
                  {([
                    { id: 'list',   label: t('companySchedule.viewList'),  icon: 'view-list' },
                    { id: 'kanban', label: t('companySchedule.viewKanban'), icon: 'view-column' },
                  ] as const).map(({ id, label, icon }) => (
                    <Pressable key={id} flex={1} onPress={() => setViewMode(id)}>
                      <HStack py="$2" px="$2" alignItems="center" justifyContent="center" space="xs"
                        bg={viewMode === id ? 'white' : 'transparent'} rounded="$lg"
                        shadowColor={viewMode === id ? Palette.black : 'transparent'} shadowOffset={{ width: 0, height: 1 }} shadowOpacity={0.08} shadowRadius={2} elevation={viewMode === id ? 1 : 0}
                      >
                        <MaterialIcons name={icon as any} size={14} color={viewMode === id ? Palette.gray800 : Palette.gray400} />
                        <Text fontSize={Type.small} fontWeight="600" color={viewMode === id ? Palette.ink : Palette.gray400}>{label}</Text>
                      </HStack>
                    </Pressable>
                  ))}
                </HStack>
              </VStack>

              {/* ── Time Period ── */}
              <VStack space="xs">
                <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray400} letterSpacing={0.8} textTransform="uppercase">Time Period</Text>
                <HStack space="xs" flexWrap="wrap">
                  {([
                    { id: 'all',       label: t('companySchedule.dateAllTime') },
                    { id: 'today',     label: t('companySchedule.dateToday') },
                    { id: 'this_week', label: t('companySchedule.dateThisWeek') },
                    { id: 'next_week', label: t('companySchedule.dateNextWeek') },
                  ] as const).map(({ id, label }) => {
                    const active = timeFrameFilter === id;
                    return (
                      <Pressable key={id} onPress={() => { setTimeFrameFilter(id); setSelectedDay(null); }} style={{ marginBottom: 4 }}>
                        <Box px="$3" py="$2" rounded="$lg"
                          bg={active ? Palette.gray800 : Palette.gray50}
                          borderWidth={1.5} borderColor={active ? Palette.gray800 : Palette.gray200}
                        >
                          <Text fontSize={Type.small} fontWeight="700" color={active ? 'white' : Palette.gray700}>{label}</Text>
                        </Box>
                      </Pressable>
                    );
                  })}
                </HStack>
              </VStack>

              {/* ── Sort By ── */}
              <VStack space="xs">
                <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray400} letterSpacing={0.8} textTransform="uppercase">Sort By</Text>
                <HStack space="xs" flexWrap="wrap">
                  {([
                    { id: 'date_asc',  label: t('companySchedule.sortDateAsc') },
                    { id: 'date_desc', label: t('companySchedule.sortDateDesc') },
                    { id: 'title',     label: t('companySchedule.sortTitle') },
                    { id: 'status',    label: t('companySchedule.sortStatus') },
                  ] as const).map(({ id, label }) => {
                    const active = sortBy === id;
                    return (
                      <Pressable key={id} onPress={() => setSortBy(id)} style={{ marginBottom: 4 }}>
                        <Box px="$3" py="$2" rounded="$lg"
                          bg={active ? Palette.violet : Palette.gray50}
                          borderWidth={1.5} borderColor={active ? Palette.violet : Palette.gray200}
                        >
                          <Text fontSize={Type.small} fontWeight="700" color={active ? 'white' : Palette.gray700}>{label}</Text>
                        </Box>
                      </Pressable>
                    );
                  })}
                </HStack>
              </VStack>

              {/* ── Employee ── */}
              <VStack space="xs">
                <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray400} letterSpacing={0.8} textTransform="uppercase">{t("companySchedule.employeeLabel")}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <HStack space="xs">
                    <Pressable onPress={() => setEmployeeFilter('all')}>
                      <Box px="$3" py="$2" rounded="$lg"
                        bg={employeeFilter === 'all' ? Palette.gray800 : Palette.gray50}
                        borderWidth={1.5} borderColor={employeeFilter === 'all' ? Palette.gray800 : Palette.gray200}
                      >
                        <Text fontSize={Type.small} fontWeight="700" color={employeeFilter === 'all' ? 'white' : Palette.gray700}>{t('companySchedule.everyone')}</Text>
                      </Box>
                    </Pressable>
                    {allEmployees.map(emp => {
                      const active = employeeFilter === emp.id;
                      return (
                        <Pressable key={emp.id} onPress={() => setEmployeeFilter(active ? 'all' : emp.id)}>
                          <Box px="$3" py="$2" rounded="$lg"
                            bg={active ? Palette.gray800 : Palette.gray50}
                            borderWidth={1.5} borderColor={active ? Palette.gray800 : Palette.gray200}
                          >
                            <Text fontSize={Type.small} fontWeight="700" color={active ? 'white' : Palette.gray700}>{emp.name}</Text>
                          </Box>
                        </Pressable>
                      );
                    })}
                  </HStack>
                </ScrollView>
                {totalHours !== null && (
                  <HStack alignItems="center" space="xs" mt="$1">
                    <MaterialIcons name="schedule" size={12} color={Palette.blue} />
                    <Text fontSize={Type.small} fontWeight="600" color={Palette.blue}>{totalHours} hrs total for selected employee</Text>
                  </HStack>
                )}
              </VStack>

              {/* ── Quick Filters ── */}
              <VStack space="xs">
                <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray400} letterSpacing={0.8} textTransform="uppercase">Quick Filters</Text>
                <Pressable onPress={() => setHasLocationFilter(prev => !prev)}>
                  <HStack px="$3" py="$2" rounded="$lg" space="sm" alignItems="center" style={{ alignSelf: 'flex-start' }}
                    bg={hasLocationFilter ? Palette.blue : Palette.gray50}
                    borderWidth={1.5} borderColor={hasLocationFilter ? Palette.blue : Palette.gray200}
                  >
                    <MaterialIcons name="location-on" size={13} color={hasLocationFilter ? 'white' : Palette.gray500} />
                    <Text fontSize={Type.small} fontWeight="700" color={hasLocationFilter ? 'white' : Palette.gray700}>Has Location</Text>
                    {hasLocationFilter && <MaterialIcons name="check" size={13} color="white" />}
                  </HStack>
                </Pressable>
              </VStack>

            </VStack>

            {/* Result count */}
            <HStack justifyContent="space-between" alignItems="center" px="$1">
              <Text fontSize={Type.label} fontWeight="600" color={Palette.gray500}>
                {filteredSchedules.length} schedule{filteredSchedules.length !== 1 ? 's' : ''} found
              </Text>
              {activeFilterCount > 0 && (
                <Text fontSize={Type.small} color={Palette.gold} fontWeight="600">{activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''} applied</Text>
              )}
            </HStack>

            {/* Content */}
            <Box>
              {loading && !refreshing ? (
                <Box py="$10" alignItems="center">
                  <Spinner size="large" color={Palette.gold} />
                  <Text mt="$4" color={Palette.gray700} fontSize={Type.title}>{t("companySchedule.loadingSchedules")}</Text>
                </Box>
              ) : filteredSchedules.length === 0 ? (
                <EmptyState hasFilters={statusFilter !== 'all' || searchQuery.trim().length > 0} />
              ) : viewMode === 'list' ? (
                <VStack space="sm">
                  {filteredSchedules.map((s, index) => (
                    <ScheduleCard
                      key={s.schedule_id}
                      item={s}
                      index={index}
                      onPress={() => { setSelectedSchedule(s); setShowCreate(true); }}
                    />
                  ))}
                </VStack>
              ) : (
                <ScrollView 
                  horizontal={!isLargeScreen}
                  showsHorizontalScrollIndicator={false} 
                  snapToInterval={!isLargeScreen ? width * 0.85 + 16 : undefined}
                  decelerationRate="fast"
                  contentContainerStyle={{ paddingBottom: 20 }}
                  style={isLargeScreen ? { flexDirection: 'row', width: '100%' } : {}}
                >
                  <HStack space="md" alignItems="flex-start" w="100%">
                    {['draft', 'pending', 'started', 'completed'].map((colStatus) => {
                      const colTasks = filteredSchedules.filter(s => s.status === colStatus);
                      return (
                        <Box 
                          key={colStatus} 
                          w={isLargeScreen ? `${100 / 4}%` : width * 0.85} 
                          flex={isLargeScreen ? 1 : undefined}
                          bg={Palette.gray50} rounded="$2xl" p="$3" borderWidth={1} borderColor={Palette.gray100}
                        >
                          <HStack justifyContent="space-between" alignItems="center" mb="$3" px="$1">
                            <Text fontWeight="700" fontSize={Type.title} color={Palette.ink} style={{ textTransform: 'capitalize' }}>{colStatus}</Text>
                            <Box bg={STATUS_BG[colStatus] || Palette.gray100} px="$2.5" py="$1" rounded="$full">
                              <Text fontSize={Type.small} fontWeight="700" color={STATUS_COLORS[colStatus] || Palette.gray500}>{colTasks.length}</Text>
                            </Box>
                          </HStack>
                          <VStack space="sm">
                            {colTasks.length === 0 ? (
                              <Box py="$6" alignItems="center" borderStyle="dashed" borderWidth={1} borderColor={Palette.gray200} rounded="$xl">
                                <Text color={Palette.gray400} fontSize={Type.label}>{t("companySchedule.noTasks")}</Text>
                              </Box>
                            ) : (
                              colTasks.map((s, index) => (
                                <KanbanCard
                                  key={s.schedule_id || `temp-${index}`}
                                  item={s}
                                  index={index}
                                  isUpdating={updatingId === s.schedule_id}
                                  onPress={() => { setSelectedSchedule(s); setShowCreate(true); }}
                                  onMoveStatus={(newStatus) => handleUpdateStatus(s.schedule_id, newStatus)}
                                  onDuplicate={() => handleDuplicate(s)}
                                />
                              ))
                            )}
                          </VStack>
                        </Box>
                      );
                    })}
                  </HStack>
                </ScrollView>
              )}
            </Box>

          </VStack>
        </ScrollView>

        {companyId && (
          <ScheduleFormModal
            visible={showCreate}
            companyId={companyId}
            schedule={selectedSchedule}
            prefillDate={selectedDay}
            pastLocations={[
              ...new Set(
                schedules.map((s) => s.location).filter((l): l is string => !!l && l.trim().length > 0)
              ),
            ]}
            allSchedules={schedules}
            onClose={() => { setShowCreate(false); setSelectedSchedule(null); }}
            onSaved={() => loadData()}
          />
        )}
      </SafeAreaView>
    </LinearGradient>
  );
}

const ms = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderColor: Palette.gray200,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: Type.title,
    color: Palette.gray800,
    backgroundColor: Palette.white,
    marginBottom: 16,
  },
  textarea: {
    height: 96,
    paddingTop: 12,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Palette.gray200,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    backgroundColor: Palette.white,
    marginBottom: 16,
  },
  empRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: Palette.gray50,
    gap: 12,
  },
  btn: {
    flex: 1,
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnCancel: {
    borderWidth: 1.5,
    borderColor: Palette.gray200,
    backgroundColor: 'white',
  },
  btnSubmit: {
    backgroundColor: Palette.indigo,
  },
});
