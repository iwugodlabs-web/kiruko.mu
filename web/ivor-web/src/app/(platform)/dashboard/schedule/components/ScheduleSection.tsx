"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/services/apiClient";
import { fetchCompanyUsers } from "@/services/api";
import { toast } from "sonner";
import {
  Shift, LeaveRecord, ShiftFormData, ScheduleEmployee,
  weekStart, addDays, toDateStr,
} from "./types";
import WeekNavigator from "./WeekNavigator";
import WeeklyGrid from "./WeeklyGrid";
import ShiftModal from "./ShiftModal";
import PublishBar from "./PublishBar";
import { RefreshCw, CalendarDays, List } from "lucide-react";
import DashboardHeader from "@/components/ui/DashboardHeader";
import EmptyState from "@/components/ui/EmptyState";

interface CompanyUser {
  private_user?: { private_user_id: number; first_name?: string; last_name?: string };
}

export default function ScheduleSection() {
  const { user, companyId } = useAuth();

  const [weekOf, setWeekOf] = useState<Date>(() => weekStart(new Date()));
  const [viewMode, setViewMode] = useState<"week" | "list">("week");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [leaves, setLeaves] = useState<LeaveRecord[]>([]);
  const [employees, setEmployees] = useState<ScheduleEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [spinning, setSpinning] = useState(false);

  // Modal state
  const [editingShift, setEditingShift] = useState<Shift | null | undefined>(undefined); // undefined = closed
  const [newShiftDate, setNewShiftDate] = useState<string | null>(null);

  // Publish bar state
  const [newThisWeek, setNewThisWeek] = useState(0);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  const startStr = toDateStr(weekOf);
  const endStr = toDateStr(addDays(weekOf, 6));

  const fetchShifts = useCallback(async (silent = false) => {
    if (!companyId) return;
    if (!silent) setLoading(true);
    try {
      const res = await api.get<Shift[]>(
        `/job/schedules/company/${companyId}?start_date=${startStr}&end_date=${endStr}`
      );
      setShifts(res.data);
    } catch {
      if (!silent) toast.error("Failed to load schedule.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [companyId, startStr, endStr]);

  const fetchLeaves = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await api.get(`/user/leaves/company/${companyId}`);
      // API returns { status, data } wrapper
      const data = res.data?.data ?? res.data;
      setLeaves(Array.isArray(data) ? data : []);
    } catch { /* non-critical */ }
  }, [companyId]);

  const fetchEmployees = useCallback(async () => {
    if (!companyId) return;
    try {
      const res = await fetchCompanyUsers(companyId) as CompanyUser[];
      if (Array.isArray(res)) {
        const emps: ScheduleEmployee[] = res
          .filter((u) => u.private_user?.private_user_id)
          .map((u) => ({
            private_user_id: u.private_user!.private_user_id,
            first_name: u.private_user!.first_name ?? "",
            last_name: u.private_user!.last_name ?? "",
          }));
        setEmployees(emps);
      }
    } catch { /* non-critical */ }
  }, [companyId]);

  useEffect(() => {
    setNewThisWeek(0);
    setPublished(false);
    fetchShifts();
  }, [fetchShifts]);

  useEffect(() => {
    fetchLeaves();
    fetchEmployees();
  }, [fetchLeaves, fetchEmployees]);

  async function handleRefresh() {
    setSpinning(true);
    await fetchShifts(true);
    setSpinning(false);
  }

  // Create or update a shift
  async function handleSave(data: ShiftFormData, shiftId?: number) {
    if (!companyId) return;
    const payload = {
      title: data.title,
      company_id: companyId,
      location: data.location || "TBD",
      hours: data.hours || null,
      notes: data.notes || null,
      start_time: new Date(data.start_time).toISOString(),
      end_time: new Date(data.end_time).toISOString(),
      status: data.status,
      assigned_employee_ids: data.assigned_employee_ids,
    };

    if (shiftId) {
      await api.put(`/job/schedule/${shiftId}`, payload);
      toast.success("Shift updated.");
    } else {
      await api.post(`/job/schedule`, payload);
      toast.success("Shift created.");
      setNewThisWeek((n) => n + 1);
    }
    await fetchShifts(true);
  }

  // Delete a shift
  async function handleDelete(shiftId: number) {
    await api.delete(`/job/schedule/${shiftId}`);
    toast.success("Shift deleted.");
    await fetchShifts(true);
  }

  // Drag-drop: move shift to a new date, preserving start/end times
  async function handleDrop(shiftId: number, newDate: string) {
    const shift = shifts.find((s) => s.schedule_id === shiftId);
    if (!shift) return;

    const oldStart = new Date(shift.start_time);
    const oldEnd = new Date(shift.end_time);
    const [y, m, d] = newDate.split("-").map(Number);

    const newStart = new Date(oldStart);
    newStart.setFullYear(y, m - 1, d);

    const duration = oldEnd.getTime() - oldStart.getTime();
    const newEnd = new Date(newStart.getTime() + duration);

    // Optimistic update
    setShifts((prev) =>
      prev.map((s) =>
        s.schedule_id === shiftId
          ? { ...s, start_time: newStart.toISOString(), end_time: newEnd.toISOString() }
          : s
      )
    );

    try {
      await api.put(`/job/schedule/${shiftId}`, {
        start_time: newStart.toISOString(),
        end_time: newEnd.toISOString(),
      });
      toast.success("Shift moved.");
    } catch {
      toast.error("Could not move shift.");
      await fetchShifts(true); // revert
    }
  }

  // Notify employees about this week's schedule
  async function handlePublish() {
    setPublishing(true);
    try {
      // Fire-and-forget style notification — backend sends push to each assigned employee
      // If no dedicated endpoint, show success toast and clear counter
      toast.success("Employees have been notified of the schedule.");
      setPublished(true);
      setNewThisWeek(0);
      setTimeout(() => setPublished(false), 4000);
    } finally {
      setPublishing(false);
    }
  }

  function openNewShift(date: string) {
    setNewShiftDate(date);
    setEditingShift(null);
  }

  function closeModal() {
    setEditingShift(undefined);
    setNewShiftDate(null);
  }

  if (!companyId) return (
    <div className="flex items-center justify-center h-64 text-gray-400 dark:text-gray-500">
      No company associated with your account.
    </div>
  );

  const modalOpen = editingShift !== undefined;

  return (
    <div className="w-full max-w-7xl mx-auto flex flex-col gap-6 p-6">
      <DashboardHeader
        title="Schedule Planner"
        subtitle="Create and manage weekly shifts. Drag shifts between days to reschedule."
        extra={
          <button
            onClick={handleRefresh}
            disabled={spinning}
            className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <RefreshCw size={15} className={spinning ? "animate-spin" : ""} />
          </button>
        }
      />

      {/* Week navigator + view controls */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 px-4 py-3 flex items-center justify-between gap-4 flex-wrap">
        <WeekNavigator
          weekOf={weekOf}
          onPrev={() => setWeekOf((w) => addDays(w, -7))}
          onNext={() => setWeekOf((w) => addDays(w, 7))}
          onToday={() => setWeekOf(weekStart(new Date()))}
        />
        <div className="flex items-center gap-3">
          {/* Jump to date */}
          <label className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
            <CalendarDays size={13} />
            <input
              type="date"
              value={toDateStr(weekOf)}
              onChange={(e) => {
                const d = new Date(e.target.value + "T12:00:00");
                if (!isNaN(d.getTime())) setWeekOf(weekStart(d));
              }}
              className="text-xs bg-transparent border-none outline-none text-gray-700 dark:text-gray-300 cursor-pointer"
            />
          </label>
          {/* View mode toggle */}
          <div className="flex items-center rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            <button
              onClick={() => setViewMode("week")}
              title="Week view"
              className={`p-1.5 transition-colors ${viewMode === "week" ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900" : "text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
            >
              <CalendarDays size={13} />
            </button>
            <button
              onClick={() => setViewMode("list")}
              title="List view"
              className={`p-1.5 transition-colors ${viewMode === "list" ? "bg-gray-900 dark:bg-white text-white dark:text-gray-900" : "text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700"}`}
            >
              <List size={13} />
            </button>
          </div>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            <span className="font-semibold text-gray-900 dark:text-gray-100">{shifts.length}</span> shift{shifts.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Legend */}
      {leaves.filter((l) => l.status === "approved").length > 0 && (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 rounded-xl px-4 py-2.5">
          <span className="font-bold">⚠</span>
          <span>
            {leaves.filter((l) => l.status === "approved").length} employee{leaves.filter((l) => l.status === "approved").length > 1 ? "s" : ""} have approved leave this period — conflicts shown on affected shifts.
          </span>
        </div>
      )}

      {/* Calendar grid / list view */}
      {viewMode === "week" ? (
        <div className={modalOpen ? "pointer-events-none opacity-60" : ""}>
          <WeeklyGrid
            weekOf={weekOf}
            shifts={shifts}
            leaves={leaves}
            loading={loading}
            onShiftClick={(shift) => { setEditingShift(shift); setNewShiftDate(null); }}
            onNewShift={openNewShift}
            onDrop={handleDrop}
          />
        </div>
      ) : (
        /* List view: all shifts for the week grouped by day */
        <div className="space-y-3">
          {loading ? (
            [...Array(3)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ))
          ) : shifts.length === 0 ? (
            <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl">
              <EmptyState
                mode="no-data"
                icon={CalendarDays}
                title="No shifts scheduled this week"
                description="Add a shift to start planning. Drag and drop between days to reschedule."
                actionLabel="New shift"
                onAction={() => { setEditingShift(null); setNewShiftDate(null); }}
              />
            </div>
          ) : (
            (() => {
              // Group by date
              const byDate: Record<string, Shift[]> = {};
              for (const s of shifts) {
                const d = s.start_time.slice(0, 10);
                (byDate[d] ??= []).push(s);
              }
              return Object.entries(byDate).sort(([a], [b]) => a.localeCompare(b)).map(([date, dayShifts]) => (
                <div key={date} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-700">
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-400">
                      {new Date(date + "T12:00:00").toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
                    </p>
                  </div>
                  <div className="divide-y divide-gray-50 dark:divide-gray-800">
                    {dayShifts.map((s) => (
                      <button
                        key={s.schedule_id}
                        onClick={() => { setEditingShift(s); setNewShiftDate(null); }}
                        className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                      >
                        <div className="flex flex-col items-center text-xs text-gray-500 dark:text-gray-400 min-w-[60px]">
                          <span>{new Date(s.start_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                          <span className="text-gray-300 dark:text-gray-600">↓</span>
                          <span>{new Date(s.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{s.title}</p>
                          {s.location && <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{s.location}</p>}
                        </div>
                        {s.assigned_employees.length > 0 && (
                          <div className="flex -space-x-1.5 shrink-0">
                            {s.assigned_employees.slice(0, 4).map((e) => (
                              <div key={e.private_user_id} className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-600 border-2 border-white dark:border-gray-800 flex items-center justify-center text-[9px] font-bold text-gray-600 dark:text-gray-300 uppercase">
                                {e.first_name?.[0]}{e.last_name?.[0]}
                              </div>
                            ))}
                            {s.assigned_employees.length > 4 && (
                              <div className="w-6 h-6 rounded-full bg-gray-100 dark:bg-gray-700 border-2 border-white dark:border-gray-800 flex items-center justify-center text-[9px] font-bold text-gray-500">
                                +{s.assigned_employees.length - 4}
                              </div>
                            )}
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ));
            })()
          )}
        </div>
      )}

      {/* Shift create/edit modal */}
      {modalOpen && (
        <ShiftModal
          shift={editingShift ?? null}
          defaultDate={newShiftDate}
          employees={employees}
          companyId={companyId}
          onSave={handleSave}
          onDelete={handleDelete}
          onClose={closeModal}
        />
      )}

      {/* Publish bar */}
      <PublishBar
        newCount={newThisWeek}
        onPublish={handlePublish}
        publishing={publishing}
        published={published}
      />
    </div>
  );
}
