"use client";

import { useCallback, useEffect, useState } from "react";
import { profileLock, type ProfileLockState } from "@/services/payroll-api";
import { Loader2, Lock, Unlock } from "lucide-react";
import { toast } from "sonner";


function isError<T>(v: T | { error: string; status?: number }): v is { error: string; status?: number } {
  return typeof v === "object" && v !== null && "error" in v;
}


interface Props {
  privateUserId: number;
}


/**
 * Self-contained lock-state pill + toggle button. Reads the current state
 * on mount, then lets the actor lock/unlock with a confirmation prompt.
 *
 * The backend's M13 wiring blocks lockable-field self-edits when locked
 * (first_name, last_name, gender, DOB, passport, etc.). Non-lockable
 * fields like phone stay editable for the locked employee.
 */
export default function ProfileLockButton({ privateUserId }: Props) {
  const [state, setState] = useState<ProfileLockState | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await profileLock.get(privateUserId);
    if (isError(r)) {
      toast.error(r.error);
      setState(null);
    } else {
      setState(r);
    }
    setLoading(false);
  }, [privateUserId]);

  useEffect(() => { refresh(); }, [refresh]);

  async function toggle() {
    if (!state) return;
    if (state.is_locked) {
      if (!confirm("Unlock this profile?\n\nThe employee will be able to edit their identity fields again.")) return;
      setSubmitting(true);
      const r = await profileLock.unlock(privateUserId);
      setSubmitting(false);
      if (isError(r)) {
        toast.error(r.error);
        return;
      }
      toast.success("Profile unlocked");
      setState(r);
    } else {
      const reason = prompt(
        "Lock this profile?\n\nThe employee won't be able to edit identity fields (name, DOB, passport, gender). " +
        "You'll still be able to update them as admin.\n\nOptional reason for the audit log:"
      );
      // prompt returns null on cancel, "" if user clicked OK with empty input — treat both as cancel-on-null.
      if (reason === null) return;
      setSubmitting(true);
      const r = await profileLock.lock(privateUserId, { reason: reason.trim() || undefined });
      setSubmitting(false);
      if (isError(r)) {
        toast.error(r.error);
        return;
      }
      toast.success("Profile locked");
      setState(r);
    }
  }

  if (loading || !state) {
    return (
      <button
        type="button"
        disabled
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white dark:bg-gray-900 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-800 cursor-wait"
      >
        <Loader2 size={16} className="animate-spin" />
        Lock state…
      </button>
    );
  }

  if (state.is_locked) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={submitting}
        title={state.lock_reason ?? undefined}
        className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 hover:bg-amber-100 transition-all border border-amber-200 dark:border-amber-900 shadow-sm disabled:opacity-50"
      >
        {submitting ? <Loader2 size={16} className="animate-spin" /> : <Lock size={16} />}
        Locked
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={submitting}
      className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-white dark:bg-gray-900 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all border border-gray-200 dark:border-gray-800 shadow-sm disabled:opacity-50"
    >
      {submitting ? <Loader2 size={16} className="animate-spin" /> : <Unlock size={16} />}
      Unlocked
    </button>
  );
}
