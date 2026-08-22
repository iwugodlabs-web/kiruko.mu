"use client";

import { STEPS } from "./types";
import { CheckCircle } from "lucide-react";

interface Props {
  currentStep: number; // 0-indexed
}

export default function OnboardingStepper({ currentStep }: Props) {
  return (
    <div className="w-full">
      {/* Mobile: just step count */}
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3 sm:hidden">
        Step {currentStep + 1} of {STEPS.length} — {STEPS[currentStep]}
      </p>

      {/* Desktop: full step bar */}
      <div className="hidden sm:flex items-center gap-0">
        {STEPS.map((label, i) => {
          const done = i < currentStep;
          const active = i === currentStep;
          return (
            <div key={i} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center flex-shrink-0">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                    done
                      ? "bg-green-500 text-white"
                      : active
                      ? "bg-blue-600 text-white"
                      : "bg-gray-200 dark:bg-gray-700 text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {done ? <CheckCircle size={16} /> : i + 1}
                </div>
                <span
                  className={`text-[10px] mt-1 font-medium whitespace-nowrap ${
                    active ? "text-blue-600 dark:text-blue-400" : done ? "text-green-600 dark:text-green-400" : "text-gray-400 dark:text-gray-500"
                  }`}
                >
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`h-0.5 flex-1 mx-1 mb-4 transition-colors ${done ? "bg-green-400" : "bg-gray-200 dark:bg-gray-700"}`} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
