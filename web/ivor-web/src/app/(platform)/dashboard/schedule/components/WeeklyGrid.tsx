"use client";

import { Shift, LeaveRecord, addDays, toDateStr, fmtTime } from "./types";
import ShiftCard from "./ShiftCard";
import { Plus } from "lucide-react";

interface Props {
  weekOf: Date;
  shifts: Shift[];
  leaves: LeaveRecord[];
  loading: boolean;
  onShiftClick: (shift: Shift) => void;
  onNewShift: (date: string) => void;
  onDrop: (shiftId: number, newDate: string) => void;
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TODAY = toDateStr(new Date());

function SkeletonCard() {
  return <div className="h-16 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse" />;
}

export default function WeeklyGrid({ weekOf, shifts, leaves, loading, onShiftClick, onNewShift, onDrop }: Props) {
  const days = DAYS.map((label, i) => ({
    label,
    date: addDays(weekOf, i),
    dateStr: toDateStr(addDays(weekOf, i)),
  }));

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }

  function handleDrop(e: React.DragEvent, dateStr: string) {
    e.preventDefault();
    const shiftId = parseInt(e.dataTransfer.getData("shiftId"));
    if (!isNaN(shiftId)) onDrop(shiftId, dateStr);
  }

  function handleDragStart(e: React.DragEvent, shift: Shift) {
    e.dataTransfer.setData("shiftId", String(shift.schedule_id));
    e.dataTransfer.effectAllowed = "move";
  }

  return (
    <div className="overflow-x-auto">
      <div className="grid grid-cols-7 gap-2 min-w-[700px]">
        {days.map(({ label, date, dateStr }) => {
          const dayShifts = shifts.filter((s) => s.start_time.startsWith(dateStr));
          const isToday = dateStr === TODAY;
          const isWeekend = label === "Sat" || label === "Sun";

          return (
            <div
              key={dateStr}
              className={`flex flex-col min-h-[240px] rounded-xl border transition-colors ${
                isToday
                  ? "border-blue-300 dark:border-blue-700 bg-blue-50/40 dark:bg-blue-900/10"
                  : isWeekend
                  ? "border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/30"
                  : "border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800/20"
              }`}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, dateStr)}
            >
              {/* Day header */}
              <div className={`flex items-center justify-between px-2.5 py-2 border-b ${
                isToday ? "border-blue-200 dark:border-blue-800" : "border-gray-100 dark:border-gray-700"
              }`}>
                <div>
                  <p className={`text-[11px] font-semibold uppercase tracking-wider ${
                    isWeekend ? "text-gray-400 dark:text-gray-500" : "text-gray-500 dark:text-gray-400"
                  }`}>{label}</p>
                  <p className={`text-sm font-bold ${
                    isToday ? "text-blue-600 dark:text-blue-400" : "text-gray-900 dark:text-gray-100"
                  }`}>
                    {date.getDate()}
                  </p>
                </div>
                <button
                  onClick={() => onNewShift(dateStr)}
                  title="Add shift"
                  className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <Plus size={13} />
                </button>
              </div>

              {/* Shifts */}
              <div className="flex flex-col gap-1.5 p-1.5 flex-1">
                {loading
                  ? [...Array(2)].map((_, i) => <SkeletonCard key={i} />)
                  : dayShifts.map((shift) => (
                      <ShiftCard
                        key={shift.schedule_id}
                        shift={shift}
                        leaves={leaves}
                        onClick={onShiftClick}
                        onDragStart={handleDragStart}
                      />
                    ))}
                {!loading && dayShifts.length === 0 && (
                  <button
                    onClick={() => onNewShift(dateStr)}
                    className="flex-1 flex items-center justify-center text-[11px] text-gray-300 dark:text-gray-600 hover:text-gray-400 dark:hover:text-gray-500 transition-colors py-4"
                  >
                    + Add shift
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
