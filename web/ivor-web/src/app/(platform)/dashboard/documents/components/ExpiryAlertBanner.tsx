"use client";

import { VaultDoc, expiryStatus, daysUntilExpiry } from "./types";
import { AlertTriangle, X } from "lucide-react";
import { useState } from "react";

interface Props {
  docs: VaultDoc[];
}

export default function ExpiryAlertBanner({ docs }: Props) {
  const [dismissed, setDismissed] = useState(false);

  const expiring = docs.filter((d) => {
    const s = expiryStatus(d.expiry_date);
    return s === "expiring" || s === "expired";
  });

  if (dismissed || expiring.length === 0) return null;

  const expired = expiring.filter((d) => expiryStatus(d.expiry_date) === "expired");
  const soonExpiring = expiring.filter((d) => expiryStatus(d.expiry_date) === "expiring");

  return (
    <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
      <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
          Document expiry alert
        </p>
        <ul className="mt-1 space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
          {expired.length > 0 && (
            <li>
              <span className="font-semibold text-red-600 dark:text-red-400">{expired.length} document{expired.length > 1 ? "s" : ""} already expired</span>
              {" — "}{expired.slice(0, 2).map((d) => `${d.employee_name} (${d.name})`).join(", ")}
              {expired.length > 2 && ` +${expired.length - 2} more`}
            </li>
          )}
          {soonExpiring.length > 0 && (
            <li>
              {soonExpiring.length} expiring within 30 days
              {" — "}{soonExpiring.slice(0, 2).map((d) => `${d.employee_name} (${daysUntilExpiry(d.expiry_date)}d)`).join(", ")}
              {soonExpiring.length > 2 && ` +${soonExpiring.length - 2} more`}
            </li>
          )}
        </ul>
      </div>
      <button
        onClick={() => setDismissed(true)}
        className="p-1 rounded-lg text-amber-500 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors shrink-0"
      >
        <X size={14} />
      </button>
    </div>
  );
}
