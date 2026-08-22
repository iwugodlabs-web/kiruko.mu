"use client";
import React, { useEffect, useState } from "react";
import { X } from "lucide-react";

type ModalShellProps = {
  title: string;
  onClose: () => void;
  onSubmit: () => void;
  submitLabel?: string;
  submitting?: boolean;
  children: React.ReactNode;
};

function ModalShell({ title, onClose, onSubmit, submitLabel = "Save", submitting, children }: ModalShellProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-900 p-6 shadow-xl border border-gray-200 dark:border-gray-800">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400">
            <X size={18} />
          </button>
        </div>
        <div className="space-y-3">{children}</div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={submitting}
            className="rounded border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting}
            className="rounded bg-gray-900 dark:bg-gray-100 px-4 py-2 text-sm text-white dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200 disabled:opacity-50"
          >
            {submitting ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 px-3 py-2 text-sm focus:border-gray-900 dark:focus:border-gray-400 focus:outline-none disabled:opacity-60";
const labelCls = "block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400";

// ─── Sector form ──────────────────────────────────────────────────────────
export type SectorFormValues = {
  activity: string;
  description: string;
  country_code: string;
  currency: string;
};

export function SectorFormModal(props: {
  mode: "create" | "edit";
  initial?: Partial<SectorFormValues>;
  countries: { code: string; name: string; currency: string }[];
  onClose: () => void;
  onSubmit: (v: SectorFormValues) => Promise<void>;
}) {
  const [v, setV] = useState<SectorFormValues>({
    activity: props.initial?.activity ?? "",
    description: props.initial?.description ?? "",
    country_code: props.initial?.country_code ?? props.countries[0]?.code ?? "MU",
    currency: props.initial?.currency ?? props.countries[0]?.currency ?? "MUR",
  });
  const [submitting, setSubmitting] = useState(false);

  // On country change, default the currency to that country's currency
  useEffect(() => {
    const c = props.countries.find((x) => x.code === v.country_code);
    if (c && props.mode === "create") setV((s) => ({ ...s, currency: c.currency }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.country_code]);

  return (
    <ModalShell
      title={props.mode === "create" ? "Create Sector" : "Edit Sector"}
      onClose={props.onClose}
      submitting={submitting}
      onSubmit={async () => {
        if (!v.activity.trim()) return;
        setSubmitting(true);
        try {
          await props.onSubmit(v);
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div>
        <label className={labelCls}>Sector name</label>
        <input className={inputCls} value={v.activity} onChange={(e) => setV({ ...v, activity: e.target.value })} />
      </div>
      <div>
        <label className={labelCls}>Description (optional)</label>
        <textarea
          className={inputCls}
          rows={2}
          value={v.description}
          onChange={(e) => setV({ ...v, description: e.target.value })}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelCls}>Country</label>
          <select
            className={inputCls}
            disabled={props.mode === "edit"}
            value={v.country_code}
            onChange={(e) => setV({ ...v, country_code: e.target.value })}
          >
            {props.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>Currency</label>
          <input className={inputCls} value={v.currency} onChange={(e) => setV({ ...v, currency: e.target.value })} />
        </div>
      </div>
    </ModalShell>
  );
}

// ─── Category form ────────────────────────────────────────────────────────
export type CategoryFormValues = { name: string; currency: string };

export function CategoryFormModal(props: {
  mode: "create" | "edit";
  initial?: Partial<CategoryFormValues>;
  parentCurrency: string;
  onClose: () => void;
  onSubmit: (v: CategoryFormValues) => Promise<void>;
}) {
  const [v, setV] = useState<CategoryFormValues>({
    name: props.initial?.name ?? "",
    currency: props.initial?.currency ?? props.parentCurrency,
  });
  const [submitting, setSubmitting] = useState(false);

  return (
    <ModalShell
      title={props.mode === "create" ? "Add Category" : "Edit Category"}
      onClose={props.onClose}
      submitting={submitting}
      onSubmit={async () => {
        if (!v.name.trim()) return;
        setSubmitting(true);
        try {
          await props.onSubmit({ ...v, currency: props.parentCurrency });
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div>
        <label className={labelCls}>Category name</label>
        <input className={inputCls} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
      </div>
      <div>
        <label className={labelCls}>Currency</label>
        <input className={inputCls} value={props.parentCurrency} disabled />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Inherited from parent sector.</p>
      </div>
    </ModalShell>
  );
}

// ─── Grade form ───────────────────────────────────────────────────────────
export function GradeFormModal(props: {
  mode: "create" | "edit";
  initial?: { grade?: string | null };
  onClose: () => void;
  onSubmit: (v: { grade: string | null }) => Promise<void>;
}) {
  const [grade, setGrade] = useState<string>(props.initial?.grade ?? "");
  const [submitting, setSubmitting] = useState(false);
  return (
    <ModalShell
      title={props.mode === "create" ? "Add Grade" : "Edit Grade"}
      onClose={props.onClose}
      submitting={submitting}
      onSubmit={async () => {
        setSubmitting(true);
        try {
          await props.onSubmit({ grade: grade.trim() || null });
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <div>
        <label className={labelCls}>Grade label</label>
        <input
          className={inputCls}
          value={grade}
          onChange={(e) => setGrade(e.target.value)}
          placeholder="e.g. Graduate, Up to 125kg"
        />
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Leave blank for a category with no graded breakdown.</p>
      </div>
    </ModalShell>
  );
}

// ─── Confirm dialog (used by void + delete cascade) ───────────────────────
export function ConfirmDialog(props: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  children?: React.ReactNode; // optional input controls (reason field, etc.)
}) {
  const [submitting, setSubmitting] = useState(false);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 dark:bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-lg bg-white dark:bg-gray-900 p-6 shadow-xl border border-gray-200 dark:border-gray-800">
        <h2 className="mb-3 text-lg font-semibold text-gray-900 dark:text-white">{props.title}</h2>
        <div className="mb-4 text-sm text-gray-700 dark:text-gray-300">{props.message}</div>
        {props.children}
        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={props.onClose}
            disabled={submitting}
            className="rounded border border-gray-300 dark:border-gray-700 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={async () => {
              setSubmitting(true);
              try {
                await props.onConfirm();
              } finally {
                setSubmitting(false);
              }
            }}
            disabled={submitting}
            className={`rounded px-4 py-2 text-sm text-white ${
              props.destructive ? "bg-red-600 hover:bg-red-700" : "bg-gray-900 dark:bg-gray-100 dark:text-gray-900 hover:bg-gray-800 dark:hover:bg-gray-200"
            } disabled:opacity-50`}
          >
            {submitting ? "Working…" : props.confirmLabel ?? "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
