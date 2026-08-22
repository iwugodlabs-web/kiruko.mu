"use client";

import { ShieldCheck, ShieldAlert, Shield } from "lucide-react";

interface Props {
  score: number;
  loading: boolean;
}

function scoreColor(score: number) {
  if (score >= 80) return { ring: "stroke-green-500", text: "text-green-600 dark:text-green-400", label: "Compliant", icon: ShieldCheck };
  if (score >= 60) return { ring: "stroke-amber-500", text: "text-amber-600 dark:text-amber-400", label: "Needs Attention", icon: Shield };
  return { ring: "stroke-red-500", text: "text-red-600 dark:text-red-400", label: "At Risk", icon: ShieldAlert };
}

export default function ComplianceScoreCard({ score, loading }: Props) {
  const { ring, text, label, icon: Icon } = scoreColor(score);
  const circumference = 2 * Math.PI * 44; // r=44
  const offset = circumference - (score / 100) * circumference;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 flex flex-col items-center gap-4">
      <div className="relative w-32 h-32">
        {loading ? (
          <div className="w-32 h-32 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
        ) : (
          <>
            <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
              <circle cx="50" cy="50" r="44" fill="none" stroke="currentColor" strokeWidth="8"
                className="text-gray-100 dark:text-gray-700" />
              <circle cx="50" cy="50" r="44" fill="none" strokeWidth="8"
                className={ring}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                style={{ transition: "stroke-dashoffset 0.6s ease" }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-3xl font-bold ${text}`}>{score}</span>
              <span className="text-xs text-gray-400 dark:text-gray-500">/ 100</span>
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col items-center gap-1">
        <div className={`flex items-center gap-1.5 font-semibold text-sm ${text}`}>
          <Icon size={15} />
          {label}
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 text-center max-w-[160px]">
          {score >= 80
            ? "Your workforce is largely compliant."
            : score >= 60
            ? "Some employees need attention."
            : "Critical compliance issues detected."}
        </p>
      </div>
    </div>
  );
}
