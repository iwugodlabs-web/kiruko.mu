import { useEffect, useRef } from 'react';
import useAuth from '@/app/hooks/useAuth';
import { getJobById } from '@/services/api';
import { scheduleClockReminders, cancelClockReminders } from '@/services/notifications';

/**
 * Re-registers the weekly clock-in/out reminders on app launch from the
 * server-authoritative Job record.
 *
 * Why this exists: scheduled local notifications are only (re)created when the
 * user saves their profile. They don't survive an app reinstall or a "clear
 * data", and AsyncStorage can't be the source of truth because it's wiped in
 * those same cases. The Job record (auto_clockin_enabled + work_start_time +
 * work_end_time + work_days) lives on the server, so re-reading it once per
 * authenticated session and re-scheduling keeps reminders alive across
 * reinstalls and devices.
 *
 * Idempotent: scheduleClockReminders cancels existing reminders before
 * scheduling, so re-running can't produce duplicates. Best-effort — failures
 * are logged, never thrown (reminders are non-critical).
 */
export default function useRescheduleClockReminders() {
  const { user } = useAuth();
  const privateUserId = user?.private_user?.private_user_id;
  // Guard so we only resync once per logged-in private user, not on every render.
  const syncedForRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!privateUserId) return;
    if (syncedForRef.current === privateUserId) return;
    syncedForRef.current = privateUserId;

    (async () => {
      try {
        const job = await getJobById(privateUserId);
        if (!job || 'error' in job) return;

        if (job.auto_clockin_enabled && job.work_start_time && job.work_end_time) {
          await scheduleClockReminders(
            job.work_start_time,
            job.work_end_time,
            job.work_days ?? {}
          );
        } else {
          // Auto clock-in is off server-side — make sure no stale reminders linger.
          await cancelClockReminders();
        }
      } catch (err) {
        console.warn('[notifications] Launch reschedule of clock reminders failed:', err);
      }
    })();
  }, [privateUserId]);
}
