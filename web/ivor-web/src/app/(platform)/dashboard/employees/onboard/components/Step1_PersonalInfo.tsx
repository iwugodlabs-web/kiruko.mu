"use client";

import { OnboardDraft } from "./types";

interface Props {
  draft: OnboardDraft;
  onChange: (patch: Partial<OnboardDraft>) => void;
}

const inputCls = "w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-red-500 placeholder:text-gray-400 dark:placeholder:text-gray-600";
const labelCls = "block text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5";

export default function Step1_PersonalInfo({ draft, onChange }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Personal Information</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Basic identity details for the new employee.</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>First Name <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={draft.first_name}
            onChange={(e) => onChange({ first_name: e.target.value })}
            placeholder="Jean"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Last Name <span className="text-red-500">*</span></label>
          <input
            type="text"
            value={draft.last_name}
            onChange={(e) => onChange({ last_name: e.target.value })}
            placeholder="Dupont"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>Email Address <span className="text-red-500">*</span></label>
        <input
          type="email"
          value={draft.email}
          onChange={(e) => onChange({ email: e.target.value })}
          placeholder="jean.dupont@example.com"
          className={inputCls}
        />
        <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
          The invite will be sent to this address. The employee must accept to activate their account.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>Date of Birth</label>
          <input
            type="date"
            value={draft.dob}
            onChange={(e) => onChange({ dob: e.target.value })}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Nationality</label>
          <input
            type="text"
            value={draft.nationality}
            onChange={(e) => onChange({ nationality: e.target.value })}
            placeholder="Mauritian"
            className={inputCls}
          />
        </div>
      </div>

      <div>
        <label className={labelCls}>Passport / National ID Number</label>
        <input
          type="text"
          value={draft.passport_number}
          onChange={(e) => onChange({ passport_number: e.target.value })}
          placeholder="A12345678"
          className={inputCls}
        />
      </div>

      <div>
        <label className={labelCls}>Role in Company</label>
        <select
          value={draft.role}
          onChange={(e) => onChange({ role: e.target.value })}
          className={inputCls}
        >
          <option value="employee">Employee</option>
          <option value="manager">Manager</option>
          <option value="admin">Admin</option>
        </select>
        <p className="mt-1.5 text-xs text-gray-400 dark:text-gray-500">
          Determines what the employee can see and manage in the dashboard.
        </p>
      </div>
    </div>
  );
}
