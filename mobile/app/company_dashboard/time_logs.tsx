import { getTimeLogsByCompany, isApiError } from '@/services/api';
import { Palette, Type } from '@/app/constants/theme';
import { MaterialIcons } from '@expo/vector-icons';
import { Badge, BadgeText, Box, Button, ButtonText, Heading, HStack, Input, InputField, InputSlot, ScrollView, Spinner, Text, VStack, RefreshControl, Pressable, Avatar, AvatarFallbackText, Modal, ModalBackdrop, ModalContent, ModalBody } from '@gluestack-ui/themed';
import { differenceInHours, differenceInMinutes, format, isToday, isYesterday, startOfDay, endOfDay, isWithinInterval, subDays, startOfWeek, endOfWeek, subWeeks, subMonths, startOfMonth, endOfMonth } from 'date-fns';
import { LinearGradient } from 'expo-linear-gradient';
import { CalendarIcon, MapPinIcon, ClockIcon } from 'lucide-react-native';
import { MotiView } from 'moti';
import React, { useMemo, useState, useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import { Platform } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import useAuth from '../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';
import { enrichLogsWithPlaceNames, extractCoords, realAddress, mapsUrl } from '@/utils/placeName';
import PermissionGate, { NoAccess } from '@/components/PermissionGate';

export default function TimeLogsPage() {
  return (
    <PermissionGate permission="view_attendance" label="time logs">
      <TimeLogsPageInner />
    </PermissionGate>
  );
}

function TimeLogsPageInner() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const [logs, setLogs] = useState<any[]>([]);
  const [selectedLog, setSelectedLog] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('today'); // today, yesterday, this_week, last_week, this_month
  const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());
  // Set when the fetch comes back 403 — the backend denied attendance access
  // even though the client let us in (e.g. RBAC just toggled). Show the same
  // no-access card the screen guard would, instead of a blank list.
  const [accessDenied, setAccessDenied] = useState(false);

  // Summary Statistics
  const summaryStats = useMemo(() => {
    const todayLogs = logs.filter(log => isToday(new Date(log.start_time || log.created_at)));
    const activeLogs = logs.filter(log => !log.end_time);

    // Calculate total hours for today (completed logs only for accuracy, or include active duration?)
    // Let's include completed logs from today + duration of active logs started today
    let totalMinutes = 0;
    todayLogs.forEach(log => {
      if (log.hours_worked) {
        totalMinutes += log.hours_worked * 60;
      } else if (log.start_time && !log.end_time) {
        const start = new Date(log.start_time);
        const now = new Date();
        totalMinutes += differenceInMinutes(now, start);
      }
    });

    return {
      activeCount: activeLogs.length,
      todayHours: (totalMinutes / 60).toFixed(1),
      totalStaff: new Set(logs.map(l => l.private_user_id)).size
    };
  }, [logs]);

  // Greeting Logic
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t('companyTimeLogs.greetingMorning');
    if (hour < 18) return t('companyTimeLogs.greetingAfternoon');
    return t('companyTimeLogs.greetingEvening');
  };

  // Company-admin accounts have no `private_user` — check company_name too,
  // not just the (nonexistent) top-level user.first_name.
  const displayName = user?.private_user?.first_name || user?.company?.company_name || 'User';

  const loadLogs = useCallback(async () => {
    // @ts-ignore
    const companyId = user?.private_user?.company_id || user?.company_id || user?.company?.company_id;
    console.log("Loading logs for companyId:", companyId);

    if (!companyId) {
      setLogs([]);
      setLoading(false);
      return;
    }

    try {
      const res = await getTimeLogsByCompany(companyId);

      // Additional check for response validity
      if (res && Array.isArray(res)) {
        setAccessDenied(false);
        console.log("Time Logs Response (First Item):", res.length > 0 ? res[0] : "Empty Array");
        setLogs(res);
        // Coordinate-only locations (kiosk clock-ins, or mobile geocode-fail
        // fallbacks) get a place name resolved lazily, then re-rendered.
        enrichLogsWithPlaceNames(res)
          .then((enriched) => { if (enriched !== res) setLogs(enriched); })
          .catch(() => {});
      } else {
        // Permission denied → show the no-access card; any other unexpected
        // shape → just an empty list.
        setAccessDenied(isApiError(res) && res.status === 403);
        setLogs([]);
      }
      setLastRefreshTime(new Date());
    } catch (error) {
      console.error("Failed to fetch time logs", error);
      setLogs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  // Refetch on every focus (mount + tab revisits) so attendance loads
  // automatically instead of waiting for a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      loadLogs();
    }, [loadLogs])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadLogs();
  }, [loadLogs]);

  // Filtered logs based on search and status
  const filteredLogs = useMemo(() => {
    let filtered = logs;

    // Filter by date
    const now = new Date();
    filtered = filtered.filter(log => {
      const logDate = new Date(log.start_time || log.created_at);

      switch (dateFilter) {
        case 'today':
          return isToday(logDate);
        case 'yesterday':
          return isYesterday(logDate);
        case 'this_week':
          return isWithinInterval(logDate, { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) });
        case 'last_week':
          const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
          const lastWeekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
          return isWithinInterval(logDate, { start: lastWeekStart, end: lastWeekEnd });
        case 'this_month':
          return isWithinInterval(logDate, { start: startOfMonth(now), end: endOfMonth(now) });
        default: // 'all'
          return true;
      }
    });

    // Filter by search query (employee name, job title, or ID)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(log => {
        const name = (log.employee_name || '').toLowerCase();
        const title = (log.job_title || '').toLowerCase();
        const id = (log.private_user_id || '').toString();

        // Construct the fallback display name to ensure we match what the user sees
        const displayName = name || `staff #${id}`;

        return displayName.includes(query) || title.includes(query) || id.includes(query);
      });
    }

    // Filter by status (active/completed)
    if (statusFilter) {
      if (statusFilter === 'active') {
        filtered = filtered.filter(log => !log.end_time);
      } else if (statusFilter === 'completed') {
        filtered = filtered.filter(log => log.end_time);
      }
    }

    return filtered;
  }, [logs, searchQuery, statusFilter, dateFilter]);

  // Group logs by date
  const groupedLogs = useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    filteredLogs.forEach(log => {
      const date = log.start_time ? format(new Date(log.start_time), 'yyyy-MM-dd') : 'unknown';
      if (!groups[date]) groups[date] = [];
      groups[date].push(log);
    });

    // Sort dates in descending order (most recent first)
    const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));
    const result: { date: string; logs: any[]; formattedDate: string }[] = [];

    sortedDates.forEach(date => {
      const dateObj = new Date(date);
      let formattedDate = format(dateObj, 'EEEE, MMMM d, yyyy');

      if (isToday(dateObj)) {
        formattedDate = t('companyTimeLogs.dateToday');
      } else if (isYesterday(dateObj)) {
        formattedDate = t('companyTimeLogs.dateYesterday');
      }

      result.push({
        date,
        logs: groups[date].sort((a, b) => {
          const aTime = new Date(a.start_time || a.created_at).getTime();
          const bTime = new Date(b.start_time || b.created_at).getTime();
          return bTime - aTime; // Most recent first
        }),
        formattedDate
      });
    });

    return result;
  }, [filteredLogs]);

  // Get status for a time log
  const getLogStatus = (log: any) => {
    if (!log.end_time) {
      return { status: 'Active', color: Palette.success, bgColor: Palette.greenTint, icon: 'fiber-manual-record' }; // Green-100
    }
    return { status: 'Completed', color: Palette.gray600, bgColor: Palette.gray100, icon: 'check-circle' }; // Gray-100
  };

  // Format time duration
  const formatDuration = (startTime: string, endTime: string | null, hoursWorked: number | null) => {
    if (hoursWorked) {
      return `${hoursWorked.toFixed(2)} hrs`;
    }

    if (!endTime && startTime) {
      // Calculate current duration
      const start = new Date(startTime);
      const now = new Date();
      const hours = differenceInHours(now, start);
      const minutes = differenceInMinutes(now, start) % 60;
      return `${hours}h ${minutes}m`;
    }

    if (startTime && endTime) {
      const start = new Date(startTime);
      const end = new Date(endTime);
      const hours = differenceInHours(end, start);
      const minutes = differenceInMinutes(end, start) % 60;
      return `${hours}h ${minutes}m`;
    }

    return '--';
  };

  // Format time
  const formatTime = (dateString: string) => {
    if (!dateString) return '--:--';
    return format(new Date(dateString), 'h:mm a');
  };

  const getInitials = (name?: string) => {
    if (!name) return 'U';
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Calculate total break time
  const getBreakDuration = (breaks: any[]) => {
    if (!breaks || breaks.length === 0) return '0m';

    let totalMinutes = 0;
    breaks.forEach(b => {
      const start = new Date(b.start_time);
      const end = b.end_time ? new Date(b.end_time) : new Date();
      totalMinutes += differenceInMinutes(end, start);
    });

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
  };

  if (accessDenied) {
    return <NoAccess label="time logs" />;
  }

  return (
    <LinearGradient
      colors={[Palette.gray50, Palette.gray100, Palette.white]}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={{ flex: 1 }} edges={['top', 'left', 'right']}>
        {/* Sticky Header */}
        <Box zIndex={50} overflow="hidden" borderBottomLeftRadius="$3xl" borderBottomRightRadius="$3xl">
          <BlurView intensity={Platform.OS === 'ios' ? 80 : 0} tint="light" style={{ width: '100%' }}>
            <Box bg={Platform.OS === 'android' ? Palette.white : 'rgba(255,255,255,0.6)'} px="$5" pt="$2" pb="$4">
              <HStack justifyContent="space-between" alignItems="center">
                <VStack>
                  <HStack alignItems="center" space="xs" mb="$1">
                    <Text fontSize={Type.h3} fontWeight="600" color={Palette.gray400}>
                      {getGreeting()},
                    </Text>
                    <Text fontSize={Type.h3} fontWeight="700" color={Palette.ink}>
                      {displayName}
                    </Text>
                  </HStack>
                  <HStack alignItems="center" space="xs">
                    <Box bg={Palette.goldTint} px="$2" py="$1" rounded="$md">
                      <Text fontSize={Type.caption} fontWeight="700" color={Palette.gold} letterSpacing={0.5}>
                        {format(new Date(), 'EEEE, MMM d').toUpperCase()}
                      </Text>
                    </Box>
                    <Text fontSize={Type.caption} color={Palette.gray500}>
                      • {t('companyTimeLogs.subtitle')}
                    </Text>
                  </HStack>
                </VStack>

                {/* Right side - Avatar */}
                <Pressable onPress={onRefresh} opacity={refreshing ? 0.5 : 1}>
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
                    <Avatar size="md" bgColor={Palette.indigo}>
                      <AvatarFallbackText>{getInitials(displayName)}</AvatarFallbackText>
                    </Avatar>
                  </Box>
                </Pressable>
              </HStack>
            </Box>
          </BlurView>
        </Box>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Palette.gold} />
          }
        >
          <VStack space="md" px="$4" pt="$4">

            {/* Summary Dashboard */}
            <MotiView
              from={{ opacity: 0, translateY: -10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 400 }}
            >
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingRight: 20 }}>
                <HStack space="md">
                  {/* Active Staff Card */}
                  <Box
                    bg={Palette.greenTint} p="$4" rounded="$2xl" width={160}
                    borderWidth={1} borderColor={Palette.success + '22'}
                    shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.03} shadowRadius={8} elevation={2}
                  >
                    <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                      <Box style={{ backgroundColor: Palette.success, borderRadius: 10, padding: 7 }}>
                        <MaterialIcons name="people" size={16} color={Palette.white} />
                      </Box>
                      <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>{summaryStats.activeCount}</Text>
                    </HStack>
                    <Text fontSize={Type.label} color={Palette.ink} fontWeight="700">{t('companyTimeLogs.activeStaff')}</Text>
                    <Text fontSize={Type.tiny} color={Palette.gray500}>{t('companyTimeLogs.activeStaffSubtitle')}</Text>
                  </Box>

                  {/* Today's Hours Card */}
                  <Box
                    bg={Palette.blueTint} p="$4" rounded="$2xl" width={160}
                    borderWidth={1} borderColor={Palette.blue + '22'}
                    shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.03} shadowRadius={8} elevation={2}
                  >
                    <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                      <Box style={{ backgroundColor: Palette.blue, borderRadius: 10, padding: 7 }}>
                        <MaterialIcons name="schedule" size={16} color={Palette.white} />
                      </Box>
                      <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>{summaryStats.todayHours}</Text>
                    </HStack>
                    <Text fontSize={Type.label} color={Palette.ink} fontWeight="700">Today's Hours</Text>
                    <Text fontSize={Type.tiny} color={Palette.gray500}>{t('companyTimeLogs.totalHoursSubtitle')}</Text>
                  </Box>

                  {/* Total Staff Card (Optional) */}
                  <Box
                    bg={Palette.gray50} p="$4" rounded="$2xl" width={160}
                    borderWidth={1} borderColor={Palette.gray400 + '22'}
                    shadowColor={Palette.black} shadowOffset={{ width: 0, height: 2 }} shadowOpacity={0.03} shadowRadius={8} elevation={2}
                  >
                    <HStack justifyContent="space-between" alignItems="flex-start" mb="$2">
                      <Box style={{ backgroundColor: Palette.gray500, borderRadius: 10, padding: 7 }}>
                        <MaterialIcons name="group" size={16} color={Palette.white} />
                      </Box>
                      <Text fontSize={Type.h1} fontWeight="800" color={Palette.ink}>{summaryStats.totalStaff}</Text>
                    </HStack>
                    <Text fontSize={Type.label} color={Palette.ink} fontWeight="700">{t('companyTimeLogs.totalStaff')}</Text>
                    <Text fontSize={Type.tiny} color={Palette.gray500}>{t('companyTimeLogs.totalStaffSubtitle')}</Text>
                  </Box>
                </HStack>
              </ScrollView>
            </MotiView>

            {/* Controls Container */}
            <MotiView
              from={{ opacity: 0, translateY: 10 }}
              animate={{ opacity: 1, translateY: 0 }}
              transition={{ type: 'timing', duration: 400, delay: 100 }}
            >
              <VStack space="md">
                {/* Search */}
                <Box
                  bg={Palette.white}
                  rounded="$2xl"
                  shadowColor={Palette.black}
                  shadowOffset={{ width: 0, height: 2 }}
                  shadowOpacity={0.03}
                  shadowRadius={8}
                  elevation={2}
                  borderWidth={1}
                  borderColor={Palette.gray100}
                >
                  <Input
                    variant="outline"
                    size="xl"
                    borderWidth={0}
                    minHeight={56}
                  >
                    <InputSlot pl="$4">
                      <MaterialIcons name="search" size={24} color={Palette.gray400} />
                    </InputSlot>
                    <InputField
                      placeholder={t("companyTimeLogs.searchPlaceholder")}
                      value={searchQuery}
                      onChangeText={setSearchQuery}
                      color={Palette.gray800}
                      fontSize={Type.title}
                      placeholderTextColor={Palette.gray400}
                    />
                  </Input>
                </Box>

                {/* Filter Chips (Status) + Date Filter */}
                <VStack space="sm">
                  {/* Date Filter */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <HStack space="sm" pb="$1">
                      {[
                        { id: 'today', label: t('companyTimeLogs.filterToday') },
                        { id: 'yesterday', label: t('companyTimeLogs.filterYesterday') },
                        { id: 'this_week', label: t('companyTimeLogs.filterThisWeek') },
                        { id: 'last_week', label: t('companyTimeLogs.filterLastWeek') },
                        { id: 'this_month', label: t('companyTimeLogs.filterThisMonth') },
                        { id: 'all', label: t('companyTimeLogs.filterAllTime') },
                      ].map((item) => {
                        const isActive = dateFilter === item.id;
                        return (
                          <Pressable key={item.id} onPress={() => setDateFilter(item.id)}>
                            <Box
                              bg={isActive ? Palette.ink : 'transparent'}
                              px="$3" py="$1.5" rounded="$full"
                              borderWidth={1} borderColor={isActive ? Palette.ink : Palette.gray200}
                            >
                              <Text color={isActive ? Palette.white : Palette.gray500} fontSize={Type.small} fontWeight="600">
                                {item.label}
                              </Text>
                            </Box>
                          </Pressable>
                        )
                      })}
                    </HStack>
                  </ScrollView>

                  {/* Status Filter */}
                  <HStack space="sm">
                    {['', 'active', 'completed'].map((filter) => {
                      const isActive = statusFilter === filter;
                      const label = filter === '' ? t('companyTimeLogs.statusAll') : filter.charAt(0).toUpperCase() + filter.slice(1);
                      return (
                        <Pressable key={filter} onPress={() => setStatusFilter(filter)} flex={1}>
                          <Box
                            bg={isActive ? Palette.ink : Palette.white}
                            py="$3"
                            rounded="$xl"
                            alignItems="center"
                            justifyContent="center"
                            borderWidth={1}
                            borderColor={isActive ? Palette.ink : Palette.gray200}
                            shadowColor={Palette.black}
                            shadowOffset={{ width: 0, height: 2 }}
                            shadowOpacity={isActive ? 0.1 : 0.05}
                            shadowRadius={4}
                            elevation={isActive ? 1 : 1}
                          >
                            <Text
                              color={isActive ? Palette.white : Palette.gray500}
                              fontWeight={isActive ? "700" : "500"}
                              fontSize={Type.body}
                            >
                              {label}
                            </Text>
                          </Box>
                        </Pressable>
                      )
                    })}
                  </HStack>
                </VStack>

                {/* Summary Count */}
                <HStack justifyContent="flex-end">
                  <Text fontSize={Type.small} color={Palette.gray400} fontWeight="600">
                    Showing {filteredLogs.length} records
                  </Text>
                </HStack>
              </VStack>
            </MotiView>


            {/* Loading State */}
            {loading && !refreshing ? (
              <MotiView
                from={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ type: 'timing', duration: 400 }}
              >
                <Box>
                  {[1, 2, 3].map((key) => (
                    <MotiView
                      key={key}
                      from={{ opacity: 0.5 }}
                      animate={{ opacity: 1 }}
                      transition={{ type: 'timing', duration: 1000, loop: true }}
                      style={{ marginBottom: 16 }}
                    >
                      <Box bg={Palette.white} rounded="$2xl" p="$4" height={140} borderWidth={1} borderColor={Palette.gray100} />
                    </MotiView>
                  ))}
                </Box>
              </MotiView>
            ) : (
              <VStack space="2xl" mt="$4">
                {groupedLogs.length === 0 ? (
                  // Empty State
                  <MotiView
                    from={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ type: 'timing', duration: 400 }}
                  >
                    <Box
                      bg={Palette.white}
                      p="$10"
                      rounded="$3xl"
                      alignItems="center"
                      borderWidth={1}
                      borderColor={Palette.gray200}
                      style={{ borderStyle: 'dashed' }}
                    >
                      <Box bg={Palette.gray100} p="$6" rounded="$full" mb="$6">
                        <MaterialIcons name="history-toggle-off" size={48} color={Palette.gray400} />
                      </Box>
                      <Heading size="md" color={Palette.ink} fontWeight="700" textAlign="center" mb="$2">
                        {searchQuery || statusFilter ? t('companyTimeLogs.noMatching') : t('companyTimeLogs.noActivity')}
                      </Heading>
                      <Text color={Palette.gray500} textAlign="center" fontSize={Type.body} lineHeight={22} px="$4">
                        {searchQuery || statusFilter
                          ? t('companyTimeLogs.noMatchingBody')
                          : t('companyTimeLogs.noActivityBody')
                        }
                      </Text>
                    </Box>
                  </MotiView>
                ) : (
                  // Grouped Time Logs
                  groupedLogs.map((group, groupIndex) => (
                    <MotiView
                      key={group.date}
                      from={{ opacity: 0, translateY: 20 }}
                      animate={{ opacity: 1, translateY: 0 }}
                      transition={{
                        type: 'timing',
                        duration: 400,
                        delay: groupIndex * 100
                      }}
                    >
                      <VStack space="md">
                        {/* Date Header */}
                        <HStack alignItems="center" space="xs" ml="$2">
                          <Text fontSize={Type.label} fontWeight="700" color={Palette.gray400} letterSpacing={1}>
                            {group.formattedDate.toUpperCase()}
                          </Text>
                          <Box flex={1} h={1} bg={Palette.gray100} rounded="$full" ml="$2" />
                        </HStack>

                        {/* Time Log Cards */}
                        <VStack space="md">
                          {group.logs.map((log: any) => {
                            const statusConfig = getLogStatus(log);
                            const duration = formatDuration(log.start_time, log.end_time, log.hours_worked);
                            const breakDuration = getBreakDuration(log.breaks);

                            // Get location: resolved place name → real address →
                            // GPS hint (tapping the card opens the map link).
                            let locationName = 'Unknown Location';
                            if (log._place) locationName = log._place;
                            else {
                              const addr = realAddress(log.location);
                              if (addr) locationName = addr;
                              else if (extractCoords(log.location)) locationName = 'GPS location (tap to map)';
                            }

                            return (
                              <MotiView
                                key={log.timelog_id}
                                from={{ opacity: 0, scale: 0.98 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ type: 'timing', duration: 300 }}
                              >
                                <Pressable onPress={() => setSelectedLog(log)}>
                                  <Box
                                    bg={Palette.white}
                                    rounded="$2xl"
                                    shadowColor={Palette.black}
                                    shadowOffset={{ width: 0, height: 4 }}
                                    shadowOpacity={0.04}
                                    shadowRadius={12}
                                    elevation={3}
                                    overflow="hidden"
                                    borderWidth={1}
                                    borderColor={statusConfig.status === 'Active' ? Palette.greenTint : Palette.gray100}
                                  >
                                    {/* Header Section */}
                                    <Box p="$4" pb="$3">
                                      <HStack justifyContent="space-between" alignItems="flex-start">
                                        <HStack flex={1} space="sm" alignItems="center">
                                          <Box
                                            w={40}
                                            h={40}
                                            rounded="$full"
                                            bg={statusConfig.status === 'Active' ? Palette.greenTint : Palette.gray100}
                                            alignItems="center"
                                            justifyContent="center"
                                            borderWidth={2}
                                            borderColor={statusConfig.status === 'Active' ? Palette.greenTint : Palette.gray200}
                                          >
                                            <Text fontWeight="700" fontSize={Type.body} color={statusConfig.status === 'Active' ? Palette.success : Palette.gray500}>
                                              {getInitials(log.employee_name)}
                                            </Text>
                                          </Box>

                                          <VStack>
                                            <Text fontWeight="700" fontSize={Type.title} color={Palette.ink}>
                                              {log.employee_name || `Staff #${log.private_user_id}`}
                                            </Text>
                                            <Text fontSize={Type.label} color={Palette.gray500} fontWeight="500">
                                              {log.job_title || 'Employee'}
                                            </Text>
                                          </VStack>
                                        </HStack>

                                        <Badge
                                          action="muted"
                                          size="sm"
                                          rounded="$full"
                                          px="$3"
                                          py="$1.5"
                                          bg={statusConfig.bgColor}
                                        >
                                          <HStack alignItems="center" space="xs">
                                            <MaterialIcons
                                              name={statusConfig.icon as any}
                                              size={10}
                                              color={statusConfig.status === 'Active' ? Palette.success : Palette.gray600}
                                            />
                                            <Text
                                              fontSize={Type.small}
                                              fontWeight="600"
                                              color={statusConfig.status === 'Active' ? Palette.success : Palette.gray600}
                                            >
                                              {statusConfig.status}
                                            </Text>
                                          </HStack>
                                        </Badge>
                                      </HStack>
                                    </Box>

                                    {/* Work Session Block */}
                                    <Box
                                      bg={statusConfig.status === 'Active' ? Palette.greenTint : Palette.gray50}
                                      borderTopWidth={1}
                                      borderBottomWidth={1}
                                      borderColor={Palette.gray100}
                                      px="$4"
                                      py="$3"
                                    >
                                      <VStack space="xs">
                                        <HStack alignItems="center" space="xs" mb="$1">
                                          <MaterialIcons name="work" size={14} color={statusConfig.status === 'Active' ? Palette.success : Palette.gray500} />
                                          <Text fontSize={Type.small} color={statusConfig.status === 'Active' ? Palette.success : Palette.gray500} fontWeight="700" letterSpacing={0.5}>{t('companyTimeLogs.workSession')}</Text>
                                        </HStack>

                                        <HStack justifyContent="space-between" alignItems="flex-end">
                                          <VStack>
                                            <HStack alignItems="center" space="xs">
                                              <Text fontSize={Type.body} color={Palette.ink} fontWeight="600">{formatTime(log.start_time)}</Text>
                                              <MaterialIcons name="arrow-right-alt" size={16} color={Palette.gray400} />
                                              {log.end_time ? (
                                                <Text fontSize={Type.body} color={Palette.ink} fontWeight="600">{formatTime(log.end_time)}</Text>
                                              ) : (
                                                <Text fontSize={Type.body} color={Palette.success} fontWeight="600" fontStyle="italic">Active</Text>
                                              )}
                                            </HStack>
                                          </VStack>
                                          <Text fontSize={Type.h3} color={Palette.ink} fontWeight="800">{duration}</Text>
                                        </HStack>
                                      </VStack>
                                    </Box>

                                    {/* Break Block (if breaks exist) */}
                                    {breakDuration !== '0m' && (
                                      <Box px="$4" py="$3" bg={Palette.warningTint} borderBottomWidth={1} borderColor={Palette.gray100}>
                                        <HStack justifyContent="space-between" alignItems="center">
                                          <HStack alignItems="center" space="xs">
                                            <Box bg={Palette.warningTint} p={4} rounded="$full">
                                              <MaterialIcons name="free-breakfast" size={12} color={Palette.gold} />
                                            </Box>
                                            <Text fontSize={Type.label} color={Palette.gold} fontWeight="600">{t('companyTimeLogs.breakTaken')}</Text>
                                          </HStack>
                                          <Text fontSize={Type.body} color={Palette.gold} fontWeight="700">{breakDuration}</Text>
                                        </HStack>
                                      </Box>
                                    )}

                                    {/* Location Footer */}
                                    <Box px="$4" py="$3" bg={Palette.white}>
                                      <HStack alignItems="center" space="xs">
                                        <MaterialIcons name="location-pin" size={14} color={Palette.gray400} />
                                        <Text fontSize={Type.small} color={Palette.gray500} numberOfLines={1} ellipsizeMode="tail" flex={1}>
                                          {locationName}
                                        </Text>
                                      </HStack>
                                    </Box>

                                  </Box>
                                </Pressable>
                              </MotiView>
                            );
                          })}
                        </VStack>
                      </VStack>
                    </MotiView>
                  ))
                )}
              </VStack>
            )}
          </VStack>
        </ScrollView>
      </SafeAreaView>

      {/* Details Modal */}
      <Modal isOpen={!!selectedLog} onClose={() => setSelectedLog(null)} size="full">
        <ModalBackdrop />
        <ModalContent maxHeight="85%" bg={Palette.white} rounded="$3xl" overflow="hidden" my="$2" mx="$4" p="$0">
          {selectedLog && (() => {
            const statusConfig = getLogStatus(selectedLog);
            const duration = formatDuration(selectedLog.start_time, selectedLog.end_time, selectedLog.hours_worked);

            // Get location details: resolved place name → real address →
            // coordinates. `selCoords` drives the "View on map" link below.
            const selCoords = extractCoords(selectedLog.location);
            let locationName = 'Unknown Location';
            if (selectedLog._place) locationName = selectedLog._place;
            else {
              const addr = realAddress(selectedLog.location);
              if (addr) locationName = addr;
              else if (selCoords) locationName = `Coordinates: ${selCoords.latitude.toFixed(4)}, ${selCoords.longitude.toFixed(4)}`;
            }

            return (
              <>
                <LinearGradient
                  colors={[Palette.blue, Palette.blue]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={{ padding: 16, paddingBottom: 24 }}
                >
                  <HStack justifyContent="space-between" alignItems="flex-start">
                    <HStack space="md" alignItems="center" flex={1}>
                      <Box bg="rgba(255,255,255,0.2)" p="$3" rounded="$2xl">
                        <MaterialIcons name="access-time" size={22} color="white" />
                      </Box>
                      <VStack flex={1}>
                        <Text color="rgba(255,255,255,0.8)" fontSize={Type.small} fontWeight="700" textTransform="uppercase">{t('companyTimeLogs.timeLog')}</Text>
                        <Heading size="md" color="white" fontWeight="900" numberOfLines={1}>
                          {selectedLog.employee_name || `Staff #${selectedLog.private_user_id}`}
                        </Heading>
                        <HStack space="xs" alignItems="center" mt="$0.5">
                          <MaterialIcons name="work-outline" size={12} color="rgba(255,255,255,0.6)" />
                          <Text fontSize={Type.small} color="rgba(255,255,255,0.6)" fontWeight="500">
                            {selectedLog.job_title || 'Employee'}
                          </Text>
                        </HStack>
                      </VStack>
                    </HStack>
                    <Pressable onPress={() => setSelectedLog(null)}>
                      <Box bg="rgba(255,255,255,0.2)" p="$2" rounded="$full">
                        <MaterialIcons name="close" size={20} color="white" />
                      </Box>
                    </Pressable>
                  </HStack>
                </LinearGradient>

                <ModalBody minHeight={300} px="$4" pb="$6">
                  <VStack space="lg" pt="$2">
                    {/* Status & Duration Summary */}
                    <HStack space="md">
                      <Box flex={1} bg={Palette.gray50} p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.gray100}>
                        <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray500} letterSpacing={1} mb="$2">
                          STATUS
                        </Text>
                        <Badge action={statusConfig.status === 'Active' ? 'success' : 'muted'} variant="solid" rounded="$lg" alignSelf="flex-start">
                          <BadgeText>{statusConfig.status}</BadgeText>
                        </Badge>
                      </Box>
                      <Box flex={1} bg={Palette.gray50} p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.gray100}>
                        <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray500} letterSpacing={1} mb="$2">
                          DURATION
                        </Text>
                        <Text fontSize={Type.h3} fontWeight="800" color={Palette.ink}>{duration}</Text>
                      </Box>
                    </HStack>

                    {/* Timeline */}
                    <Box bg={Palette.gray50} p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.gray100}>
                      <Text fontSize={Type.caption} fontWeight="700" color={Palette.gray500} letterSpacing={1} mb="$4">
                        {t('companyTimeLogs.sessionTimeline')}
                      </Text>
                      <VStack space="md">
                        <HStack space="md" alignItems="center">
                          <Box bg={Palette.greenTint} p="$2" rounded="$full">
                            <MaterialIcons name="login" size={16} color={Palette.success} />
                          </Box>
                          <VStack>
                            <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="600">{t('companyTimeLogs.clockIn')}</Text>
                            <Text fontSize={Type.body} fontWeight="700" color={Palette.ink}>
                              {selectedLog.start_time ? format(new Date(selectedLog.start_time), 'h:mm a · EEE, MMM dd') : '--'}
                            </Text>
                          </VStack>
                        </HStack>

                        <Box h={20} w={2} bg={Palette.gray200} ml={18} />

                        <HStack space="md" alignItems="center">
                          <Box bg={selectedLog.end_time ? Palette.gray100 : Palette.warningTint} p="$2" rounded="$full">
                            <MaterialIcons name="logout" size={16} color={selectedLog.end_time ? Palette.gray600 : Palette.warning} />
                          </Box>
                          <VStack>
                            <Text fontSize={Type.caption} color={Palette.gray500} fontWeight="600">{t('companyTimeLogs.clockOut')}</Text>
                            <Text fontSize={Type.body} fontWeight="700" color={selectedLog.end_time ? Palette.ink : Palette.warning}>
                              {selectedLog.end_time ? format(new Date(selectedLog.end_time), 'h:mm a · EEE, MMM dd') : t('companyTimeLogs.currentlyActive')}
                            </Text>
                          </VStack>
                        </HStack>
                      </VStack>
                    </Box>

                    {/* Break Summary */}
                    <Box bg={Palette.warningTint} p="$4" rounded="$2xl" borderWidth={1} borderColor={Palette.warningTint}>
                      <HStack justifyContent="space-between" alignItems="center">
                        <HStack space="sm" alignItems="center">
                          <Box bg={Palette.warningTint} p="$2" rounded="$full">
                            <MaterialIcons name="free-breakfast" size={16} color={Palette.gold} />
                          </Box>
                          <Text fontSize={Type.body} fontWeight="700" color={Palette.gold}>{t('companyTimeLogs.totalBreakTime')}</Text>
                        </HStack>
                        <Text fontSize={Type.title} fontWeight="800" color={Palette.gold}>{getBreakDuration(selectedLog.breaks)}</Text>
                      </HStack>
                    </Box>

                    {/* Location & Notes */}
                    <VStack space="md">
                      <HStack space="md" alignItems="flex-start">
                        <Box p="$2" rounded="$full" bg={Palette.gray100}>
                          <MaterialIcons name="place" size={20} color={Palette.gray600} />
                        </Box>
                        <VStack flex={1}>
                          <Text fontSize={Type.label} color={Palette.gray500} fontWeight="700">{t('companyTimeLogs.locationLabel')}</Text>
                          <Text fontSize={Type.body} color={Palette.ink} fontWeight="500" lineHeight={20}>{locationName}</Text>
                          {selCoords && (
                            <Pressable onPress={() => Linking.openURL(mapsUrl(selCoords))} mt="$1">
                              <HStack alignItems="center" space="xs">
                                <MaterialIcons name="map" size={14} color={Palette.blue} />
                                <Text fontSize={Type.small} color={Palette.blue} fontWeight="600">View on map</Text>
                              </HStack>
                            </Pressable>
                          )}
                        </VStack>
                      </HStack>

                      {selectedLog.notes && (
                        <HStack space="md" alignItems="flex-start">
                          <Box p="$2" rounded="$full" bg={Palette.gray100}>
                            <MaterialIcons name="notes" size={20} color={Palette.gray600} />
                          </Box>
                          <VStack flex={1}>
                            <Text fontSize={Type.label} color={Palette.gray500} fontWeight="700">NOTES</Text>
                            <Text fontSize={Type.body} color={Palette.ink} fontWeight="500" lineHeight={20}>{selectedLog.notes}</Text>
                          </VStack>
                        </HStack>
                      )}
                    </VStack>
                  </VStack>
                </ModalBody>
              </>
            );
          })()}
        </ModalContent>
      </Modal>
    </LinearGradient>
  );
}
