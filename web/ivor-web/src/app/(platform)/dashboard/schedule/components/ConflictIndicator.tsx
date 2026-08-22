"use client";

import { AlertTriangle } from "lucide-react";
import { Shift, LeaveRecord, getLeaveConflicts } from "./types";

interface Props {
  shift: Shift;
  leaves: LeaveRecord[];
}

export default function ConflictIndicator({ shift, leaves }: Props) {
  const conflicts = getLeaveConflicts(shift, leaves);
  if (conflicts.length === 0) return null;

  const names = conflicts.map((c) =>
    [c.first_name, c.last_name].filter(Boolean).join(" ") || `User #${c.private_user_id}`
  );

  return (
    <div
      title={`On approved leave: ${names.join(", ")}`}
      className="flex items-center gap-1 text-amber-600 dark:text-amber-400 mt-1"
    >
      <AlertTriangle size={11} />
      <span className="text-[10px] font-semibold">
        {conflicts.length === 1 ? `${names[0]} on leave` : `${conflicts.length} on leave`}
      </span>
    </div>
  );
}
