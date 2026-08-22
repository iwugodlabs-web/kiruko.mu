import { MaterialIcons } from '@expo/vector-icons';
import { Palette } from '@/app/constants/theme';
import { addDays, format, isSameDay, isToday } from 'date-fns';
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Schedule } from '@/services/api';

export interface WeekStripProps {
  schedules: Schedule[];
  weekStart: Date;
  selectedDay: Date | null;
  onDaySelect: (day: Date | null) => void;
  onWeekChange: (direction: -1 | 1) => void;
  accentColor?: string;
}

export function WeekStrip({
  schedules,
  weekStart,
  selectedDay,
  onDaySelect,
  onWeekChange,
  accentColor = Palette.error,
}: WeekStripProps) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const weekLabel = `${format(weekStart, 'MMM d')} – ${format(addDays(weekStart, 6), 'MMM d')}`;

  const dotCountForDay = (day: Date): number =>
    schedules.filter(s => {
      if (!s.start_time) return false;
      try { return isSameDay(new Date(s.start_time), day); } catch { return false; }
    }).length;

  return (
    <View style={ws.container}>
      {/* Week navigation header */}
      <View style={ws.header}>
        <TouchableOpacity
          onPress={() => onWeekChange(-1)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={ws.arrow}
        >
          <MaterialIcons name="chevron-left" size={22} color={Palette.gray700} />
        </TouchableOpacity>

        <View style={ws.weekLabelRow}>
          <MaterialIcons name="calendar-today" size={12} color={Palette.gray400} style={{ marginRight: 5 }} />
          <Text style={ws.weekLabel}>{weekLabel}</Text>
        </View>

        <TouchableOpacity
          onPress={() => onWeekChange(1)}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={ws.arrow}
        >
          <MaterialIcons name="chevron-right" size={22} color={Palette.gray700} />
        </TouchableOpacity>
      </View>

      {/* Day pills */}
      <View style={ws.daysRow}>
        {days.map((day, i) => {
          const today = isToday(day);
          const selected = selectedDay !== null && isSameDay(day, selectedDay);
          const count = dotCountForDay(day);

          const pillBg = selected ? accentColor : today ? Palette.blueTint : 'white';
          const pillBorder = selected ? accentColor : today ? Palette.blueTint : Palette.gray200;
          const dayNameColor = selected ? 'rgba(255,255,255,0.8)' : today ? Palette.blue : Palette.gray400;
          const dayNumColor = selected ? 'white' : today ? Palette.blue : Palette.gray800;

          return (
            <TouchableOpacity
              key={i}
              onPress={() => onDaySelect(selected ? null : day)}
              activeOpacity={0.75}
              style={[ws.dayPill, { backgroundColor: pillBg, borderColor: pillBorder }]}
            >
              <Text style={[ws.dayName, { color: dayNameColor }]}>{format(day, 'EEE')}</Text>
              <Text style={[ws.dayNum, { color: dayNumColor, fontWeight: (selected || today) ? '700' : '500' }]}>
                {format(day, 'd')}
              </Text>
              <View style={ws.dotsRow}>
                {count > 0 ? (
                  count <= 3
                    ? Array.from({ length: count }).map((_, di) => (
                        <View
                          key={di}
                          style={[
                            ws.dot,
                            { backgroundColor: selected ? 'rgba(255,255,255,0.75)' : accentColor },
                          ]}
                        />
                      ))
                    : <Text style={[ws.dotCount, { color: selected ? 'rgba(255,255,255,0.75)' : accentColor }]}>{count}</Text>
                ) : (
                  <View style={ws.dotPlaceholder} />
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Selected day label */}
      {selectedDay && (
        <View style={ws.selectedDayBar}>
          <Text style={ws.selectedDayText}>{format(selectedDay, 'EEEE, MMMM d')}</Text>
          <TouchableOpacity
            onPress={() => onDaySelect(null)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <MaterialIcons name="close" size={14} color={Palette.gray500} />
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const ws = StyleSheet.create({
  container: {
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: Palette.gray100,
    shadowColor: Palette.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  arrow: { padding: 4 },
  weekLabelRow: { flexDirection: 'row', alignItems: 'center' },
  weekLabel: { fontSize: 13, fontWeight: '600', color: Palette.gray700 },
  daysRow: { flexDirection: 'row', justifyContent: 'space-between' },
  dayPill: {
    flex: 1,
    marginHorizontal: 2,
    alignItems: 'center',
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  dayName: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginBottom: 3,
  },
  dayNum: { fontSize: 15, lineHeight: 18 },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 8,
    marginTop: 4,
  },
  dot: { width: 4, height: 4, borderRadius: 2, marginHorizontal: 1.5 },
  dotPlaceholder: { height: 4 },
  dotCount: { fontSize: 9, fontWeight: '700', lineHeight: 10 },
  selectedDayBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Palette.gray100,
  },
  selectedDayText: { fontSize: 13, fontWeight: '600', color: Palette.gray700 },
});
