"use client";

import { Shift, LeaveRecord, STATUS_CONFIG, fmtTime, getLeaveConflicts } from "./types";
import ConflictIndicator from "./ConflictIndicator";
import { MapPin, Users } from "lucide-react";

interface Props {
  shift: Shift;
  leaves: LeaveRecord[];
  onClick: (shift: Shift) => void;
  onDragStart: (e: React.DragEvent, shift: Shift) => void;
}

// Brand-only categorical palette (blue/violet/green/gold/teal/indigo).
const SHIFT_COLORS = [
  "border-l-blue-400",
  "border-l-violet-400",
  "border-l-green-400",
  "border-l-amber-400",
  "border-l-teal-400",
  "border-l-indigo-400",
];

function colorForId(id: number) {
  return SHIFT_COLORS[id % SHIFT_COLORS.length];
}

export default function ShiftCard({ shift, leaves, onClick, onDragStart }: Props) {
  const cfg = STATUS_CONFIG[shift.status] ?? STATUS_CONFIG.pending;
  const conflicts = getLeaveConflicts(shift, leaves);
  const hasConflict = conflicts.length > 0;

  return (
    <div
      draggable
      onDragStart={(e) => onDragStart(e, shift)}
      onClick={() => onClick(shift)}
      className={`group relative bg-white dark:bg-gray-800 rounded-lg border-l-4 ${colorForId(shift.schedule_id)} shadow-sm hover:shadow-md transition-all cursor-pointer p-2.5 select-none ${
        hasConflict ? "ring-1 ring-amber-300 dark:ring-amber-600" : ""
      }`}
    >
      {/* Title */}
      <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate leading-tight">
        {shift.title}
      </p>

      {/* Time */}
      <p className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">
        {fmtTime(shift.start_time)} – {fmtTime(shift.end_time)}
      </p>

      {/* Location */}
      {shift.location && (
        <p className="flex items-center gap-0.5 text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">
          <MapPin size={9} className="shrink-0" />{shift.location}
        </p>
      )}

      {/* Employee avatars */}
      {shift.assigned_employees.length > 0 && (
        <div className="flex items-center gap-1 mt-1.5">
          <Users size={10} className="text-gray-400 dark:text-gray-500 shrink-0" />
          <div className="flex -space-x-1">
            {shift.assigned_employees.slice(0, 4).map((emp) => (
              <div
                key={emp.private_user_id}
                title={`${emp.first_name} ${emp.last_name}`}
                className="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-600 border border-white dark:border-gray-800 flex items-center justify-center text-[8px] font-bold text-gray-600 dark:text-gray-300 uppercase"
              >
                {emp.first_name?.[0]}{emp.last_name?.[0]}
              </div>
            ))}
            {shift.assigned_employees.length > 4 && (
              <div className="w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700 border border-white dark:border-gray-800 flex items-center justify-center text-[8px] text-gray-500">
                +{shift.assigned_employees.length - 4}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Status */}
      <span className={`inline-block mt-1.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${cfg.cls}`}>
        {cfg.label}
      </span>

      {/* Conflict */}
      <ConflictIndicator shift={shift} leaves={leaves} />
    </div>
  );
}
