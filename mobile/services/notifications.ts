import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Day name → expo weekday number (1=Sun, 2=Mon, ..., 7=Sat)
const DAY_TO_WEEKDAY: Record<string, number> = {
  Sunday: 1,
  Monday: 2,
  Tuesday: 3,
  Wednesday: 4,
  Thursday: 5,
  Friday: 6,
  Saturday: 7,
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const ANDROID_CHANNEL_ID = 'default';

async function requestPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Ensure the high-importance Android channel exists before scheduling. On
 * Android 8+, a scheduled notification with no channel lands on a silent
 * fallback channel (no banner/sound) — which is why reminders appeared to
 * "not trigger". Idempotent: calling repeatedly just updates the channel.
 */
async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Clock Reminders',
    importance: Notifications.AndroidImportance.MAX,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#FF231F7C',
  });
}

function parseTime(timeStr: string): { hour: number; minute: number } | null {
  // Accepts "HH:MM" or "H:MM AM/PM"
  const match = timeStr.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const period = match[3]?.toUpperCase();
  if (period === 'PM' && hour < 12) hour += 12;
  if (period === 'AM' && hour === 12) hour = 0;
  return { hour, minute };
}

/**
 * Cancel all previously scheduled clock-in/out reminder notifications.
 */
export async function cancelClockReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const reminderIds = scheduled
    .filter((n) => (n.content.data as any)?.type === 'clock_reminder')
    .map((n) => n.identifier);
  await Promise.all(reminderIds.map((id) => Notifications.cancelScheduledNotificationAsync(id)));
}

/**
 * Schedule weekly clock-in and clock-out reminders based on work schedule.
 * Cancels any existing reminders before scheduling new ones.
 */
export async function scheduleClockReminders(
  startTime: string,
  endTime: string,
  workDays: Record<string, string>
): Promise<number> {
  const granted = await requestPermissions();
  if (!granted) {
    console.warn('[notifications] Clock reminders NOT scheduled: notification permission not granted');
    return 0;
  }

  await ensureAndroidChannel();
  await cancelClockReminders();

  const startParsed = parseTime(startTime);
  const endParsed = parseTime(endTime);
  if (!startParsed || !endParsed) {
    console.warn('[notifications] Clock reminders NOT scheduled: could not parse times', { startTime, endTime });
    return 0;
  }

  const activeDays = Object.keys(workDays).filter(
    (day) => workDays[day] && DAY_TO_WEEKDAY[day] !== undefined
  );
  if (activeDays.length === 0) {
    console.warn('[notifications] Clock reminders NOT scheduled: no active work days', { workDays });
    return 0;
  }

  const schedulePromises: Promise<string>[] = [];

  for (const day of activeDays) {
    const weekday = DAY_TO_WEEKDAY[day];

    // Clock-in reminder
    schedulePromises.push(
      Notifications.scheduleNotificationAsync({
        content: {
          title: '⏰ Time to Clock In',
          body: `Your work day starts now. Don't forget to clock in!`,
          data: { type: 'clock_reminder', kind: 'clock_in', day },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour: startParsed.hour,
          minute: startParsed.minute,
          channelId: ANDROID_CHANNEL_ID,
        },
      })
    );

    // Clock-out reminder
    schedulePromises.push(
      Notifications.scheduleNotificationAsync({
        content: {
          title: '🏁 Time to Clock Out',
          body: `Your work day is ending. Don't forget to clock out!`,
          data: { type: 'clock_reminder', kind: 'clock_out', day },
        },
        trigger: {
          type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
          weekday,
          hour: endParsed.hour,
          minute: endParsed.minute,
          channelId: ANDROID_CHANNEL_ID,
        },
      })
    );
  }

  await Promise.all(schedulePromises);
  console.log(`[notifications] Scheduled ${schedulePromises.length} clock reminders across ${activeDays.length} day(s)`);
  return schedulePromises.length;
}
