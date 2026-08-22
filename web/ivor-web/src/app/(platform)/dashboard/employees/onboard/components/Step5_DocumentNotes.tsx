"use client";

import { OnboardDraft } from "./types";
import { FileText, Info } from "lucide-react";

interface Props {
  draft: OnboardDraft;
  onChange: (patch: Partial<OnboardDraft>) => void;
}

const textareaCls = "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500 placeholder:text-gray-400 dark:placeholder:text-gray-600 resize-none";
const labelCls = "block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5";

export default function Step5_DocumentNotes({ draft, onChange }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Documents & Notes</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
          Record what documents are needed. You can upload actual files after the employee accepts their invite.
        </p>
      </div>

      <div className="flex items-start gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl px-4 py-3">
        <Info size={14} className="text-blue-500 shrink-0 mt-0.5" />
        <div className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed">
          <p className="font-semibold mb-0.5">Why notes instead of uploads?</p>
          <p>
            The employee&apos;s document vault is created when they accept the invite and set up their account.
            Once they join, upload their contract, permit scan, and ID directly to their vault from their employee profile.
          </p>
        </div>
      </div>

      <div>
        <label className={labelCls}>
          <span className="flex items-center gap-1.5"><FileText size={12} /> Contract Notes</span>
        </label>
        <textarea
          value={draft.contract_notes}
          onChange={(e) => onChange({ contract_notes: e.target.value })}
          rows={4}
          placeholder="e.g. Fixed-term 12-month contract. Probation period 3 months. Notice period 1 month..."
          className={textareaCls}
        />
      </div>

      <div>
        <label className={labelCls}>Documents to Collect</label>
        <textarea
          value={draft.other_notes}
          onChange={(e) => onChange({ other_notes: e.target.value })}
          rows={4}
          placeholder="e.g. Work permit original, passport copy, emergency contact form, signed NDA..."
          className={textareaCls}
        />
        <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
          This is an internal note for HR. The employee will not see it.
        </p>
      </div>

      <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-4 space-y-2">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Documents to upload after invite accepted</p>
        <ul className="space-y-1.5 text-xs text-gray-600 dark:text-gray-400">
          {[
            "Employment contract (PDF)",
            "Work permit / visa scan",
            "Passport / national ID copy",
            "Job description document",
            "Any signed HR forms",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0" />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
