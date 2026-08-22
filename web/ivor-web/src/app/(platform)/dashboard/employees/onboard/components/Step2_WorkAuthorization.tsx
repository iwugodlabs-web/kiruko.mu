"use client";

import { OnboardDraft, PERMIT_TYPES } from "./types";
import ComplianceCheckBanner from "./ComplianceCheckBanner";
import { Shield } from "lucide-react";

interface Props {
  draft: OnboardDraft;
  onChange: (patch: Partial<OnboardDraft>) => void;
}

const inputCls = "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500 placeholder:text-gray-400 dark:placeholder:text-gray-600";
const labelCls = "block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5";

export default function Step2_WorkAuthorization({ draft, onChange }: Props) {
  const isTourist = draft.permit_type === "tourist_visa";
  const isNone = draft.permit_type === "none";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Work Authorization</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          This is the most important compliance step. Verify legal authorization before hiring.
        </p>
      </div>

      <div>
        <label className={labelCls}>Permit / Authorization Type <span className="text-red-500">*</span></label>
        <select
          value={draft.permit_type}
          onChange={(e) => onChange({ permit_type: e.target.value })}
          className={`${inputCls} ${isTourist ? "border-red-400 dark:border-red-600 ring-1 ring-red-400" : ""}`}
        >
          <option value="">— Select permit type —</option>
          {PERMIT_TYPES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>

      {/* Live compliance banner — updates as user types */}
      {draft.permit_type && (
        <ComplianceCheckBanner draft={draft} />
      )}

      {!isNone && !isTourist && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Permit Number</label>
              <input
                type="text"
                value={draft.permit_number}
                onChange={(e) => onChange({ permit_number: e.target.value })}
                placeholder="WP/2024/00123"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Permit Expiry Date</label>
              <input
                type="date"
                value={draft.permit_expiry}
                onChange={(e) => onChange({ permit_expiry: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>
        </>
      )}

      <div>
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={draft.has_permission_to_work}
            onChange={(e) => onChange({ has_permission_to_work: e.target.checked })}
            className="w-4 h-4 rounded border-gray-300 accent-red-600"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300 font-medium">
            I confirm this employee has legal permission to work
          </span>
        </label>
        <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500 ml-7">
          As the employer, you are legally responsible for verifying work authorization before employment begins.
        </p>
      </div>

      <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl px-4 py-3">
        <Shield size={14} className="text-blue-500 shrink-0 mt-0.5" />
        <p className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed">
          Kiruko will track permit expiry and alert you 30 days before it lapses. This helps prevent overnight compliance exposure.
        </p>
      </div>
    </div>
  );
}
