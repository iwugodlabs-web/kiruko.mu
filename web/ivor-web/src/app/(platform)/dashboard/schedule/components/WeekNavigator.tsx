"use client";

import { addDays, toDateStr } from "./types";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";

interface Props {
  weekOf: Date;  // Monday of current week
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function WeekNavigator({ weekOf, onPrev, onNext, onToday }: Props) {
  const end = addDays(weekOf, 6);
  const sameMonth = weekOf.getMonth() === end.getMonth();
  const range = sameMonth
    ? `${MONTHS[weekOf.getMonth()]} ${weekOf.getDate()}–${end.getDate()}, ${weekOf.getFullYear()}`
    : `${MONTHS[weekOf.getMonth()]} ${weekOf.getDate()} – ${MONTHS[end.getMonth()]} ${end.getDate()}, ${weekOf.getFullYear()}`;

  const isCurrentWeek = toDateStr(weekOf) === toDateStr(new Date(
    (() => { const d = new Date(); const day = d.getDay(); d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day)); d.setHours(0,0,0,0); return d; })()
  ));

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1">
        <button
          onClick={onPrev}
          className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronLeft size={15} />
        </button>
        <button
          onClick={onNext}
          className="p-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          <ChevronRight size={15} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <CalendarDays size={15} className="text-gray-400 dark:text-gray-500" />
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{range}</span>
      </div>

      {!isCurrentWeek && (
        <button
          onClick={onToday}
          className="px-3 py-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
        >
          This week
        </button>
      )}
    </div>
  );
}
