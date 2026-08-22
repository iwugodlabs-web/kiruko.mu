"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/services/apiClient";
import { toast } from "sonner";
import { CalendarDays, Clock, UserCheck, ShieldCheck, Scale, Bell } from "lucide-react";

type Pref = { category: string; in_app: boolean; push: boolean };
type PrefMap = Record<string, { in_app: boolean; push: boolean }>;

// Order + labels mirror the backend categories (_category_for_type).
const CATEGORIES = [
  { key: "leave", label: "Leave", description: "Requests and approvals", icon: CalendarDays },
  { key: "overtime", label: "Overtime", description: "Overtime flags and confirmations", icon: Clock },
  { key: "attendance", label: "Attendance", description: "Clock-ins and auto-closed sessions", icon: UserCheck },
  { key: "compliance", label: "Compliance", description: "Concerns and grievance updates", icon: ShieldCheck },
  { key: "disputes", label: "Disputes", description: "Dispute activity", icon: Scale },
  { key: "general", label: "General", description: "Everything else", icon: Bell },
] as const;

// Toggle styled to match the existing Settings toggles (gray-900 / white pill).
function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={on}
      className={`relative w-10 h-6 rounded-full transition-colors border-2 disabled:opacity-50 ${
        on
          ? "bg-gray-900 dark:bg-white border-gray-900 dark:border-white"
          : "bg-gray-200 dark:bg-gray-600 border-gray-200 dark:border-gray-600"
      }`}
    >
      <span
        className={`absolute top-0.5 w-4 h-4 rounded-full shadow-sm transition-all duration-200 ${
          on ? "right-0.5 bg-white dark:bg-gray-900" : "left-0.5 bg-white dark:bg-gray-400"
        }`}
      />
    </button>
  );
}

export default function NotificationPreferencesSection() {
  const [prefs, setPrefs] = useState<PrefMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ preferences: Pref[] }>("/notification/preferences");
      const map: PrefMap = {};
      for (const p of res.data?.preferences ?? []) map[p.category] = { in_app: p.in_app, push: p.push };
      setPrefs(map);
    } catch {
      toast.error("Could not load notification preferences.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(category: string, channel: "in_app" | "push") {
    const cur = prefs[category] ?? { in_app: true, push: true };
    const next: PrefMap = { ...prefs, [category]: { ...cur, [channel]: !cur[channel] } };
    setPrefs(next); // optimistic
    setSaving(true);
    const body = {
      preferences: CATEGORIES.map((c) => ({
        category: c.key,
        in_app: next[c.key]?.in_app ?? true,
        push: next[c.key]?.push ?? true,
      })),
    };
    try {
      await api.put("/notification/preferences", body);
    } catch {
      toast.error("Could not save. Reverting.");
      load();
    }
    setSaving(false);
  }

  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-6 space-y-5">
      <div className="pb-4 border-b border-gray-100 dark:border-gray-800">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white">In-App &amp; Push Alerts</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Choose which notifications you receive in-app and as push alerts. Changes apply to future
          notifications.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-gray-50 dark:bg-gray-800 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Column hints, aligned over the two toggle columns */}
          <div className="flex items-center justify-end gap-6 pr-0.5">
            <span className="w-10 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-400">In-app</span>
            <span className="w-10 text-center text-[10px] font-semibold uppercase tracking-wider text-gray-400">Push</span>
          </div>

          <div className="space-y-3">
            {CATEGORIES.map(({ key, label, description, icon: Icon }) => {
              const p = prefs[key] ?? { in_app: true, push: true };
              return (
                <div
                  key={key}
                  className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg flex items-center justify-center shrink-0">
                      <Icon size={15} className="text-gray-500 dark:text-gray-300" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{label}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-6 shrink-0">
                    <Toggle on={p.in_app} disabled={saving} onClick={() => toggle(key, "in_app")} />
                    <Toggle on={p.push} disabled={saving} onClick={() => toggle(key, "push")} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      <div className="p-4 bg-gray-50 dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-xl flex items-start gap-3">
        <Bell size={15} className="text-gray-400 dark:text-gray-500 shrink-0 mt-0.5" />
        <p className="text-xs text-gray-500 dark:text-gray-400">
          In-app controls the bell and notifications list; push controls mobile push alerts. Turning a
          category off here doesn&apos;t affect anyone else.
        </p>
      </div>
    </div>
  );
}
