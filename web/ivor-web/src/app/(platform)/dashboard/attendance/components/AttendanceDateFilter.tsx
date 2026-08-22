"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { DateRange } from "./types";

type Preset = "today" | "week" | "month" | "custom";

interface Props {
  value: DateRange;
  onChange: (range: DateRange) => void;
}

function toISO(d: Date) {
  return d.toISOString().split("T")[0];
}

function getPresetRange(preset: Preset): DateRange {
  const now = new Date();
  switch (preset) {
    case "today": {
      const t = toISO(now);
      return { start: t, end: t };
    }
    case "week": {
      const day = now.getDay();
      const mon = new Date(now);
      mon.setDate(now.getDate() - ((day + 6) % 7));
      return { start: toISO(mon), end: toISO(now) };
    }
    case "month": {
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start: toISO(first), end: toISO(now) };
    }
    default:
      return { start: toISO(now), end: toISO(now) };
  }
}

export default function AttendanceDateFilter({ value, onChange }: Props) {
  const [preset, setPreset] = useState<Preset>("week");

  function applyPreset(p: Preset) {
    setPreset(p);
    if (p !== "custom") onChange(getPresetRange(p));
  }

  const presets: { id: Preset; label: string }[] = [
    { id: "today", label: "Today" },
    { id: "week", label: "This Week" },
    { id: "month", label: "This Month" },
    { id: "custom", label: "Custom" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <CalendarDays size={16} className="text-gray-400 dark:text-gray-500 shrink-0" />
      <div className="flex gap-1 rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => applyPreset(p.id)}
            className={`px-3 py-1 rounded-md text-sm font-medium transition-colors ${
              preset === p.id
                ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {preset === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={value.start}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
          <span className="text-gray-400 text-sm">to</span>
          <input
            type="date"
            value={value.end}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
            className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>
      )}
    </div>
  );
}
