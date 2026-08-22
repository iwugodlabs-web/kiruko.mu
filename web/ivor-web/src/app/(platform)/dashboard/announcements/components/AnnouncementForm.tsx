"use client";

/**
 * Shared create + edit form for employer announcements.
 *
 * Mode 'create' → submits POST. Mode 'edit' → submits PATCH and warns when
 * one of the 5 creative fields will trigger a new SponsoredContentVersion
 * snapshot (so admins understand why historical CTR numbers stay attached
 * to the old creative).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Upload, AlertCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type {
    Announcement,
    AnnouncementStatus,
    AnnouncementTargeting,
} from '../../../../../../services/announcements';
import {
    createAnnouncement,
    patchAnnouncement,
    uploadAnnouncementImage,
} from '../../../../../../services/announcements';
import SponsoredCardPreview from './SponsoredCardPreview';
import DepartmentMultiPicker from './DepartmentMultiPicker';

const CREATIVE_FIELDS = ['title', 'body', 'image_url', 'cta_label', 'cta_url'] as const;
type CreativeField = (typeof CREATIVE_FIELDS)[number];

interface FormState {
    title: string;
    body: string;
    image_url: string;
    cta_label: string;
    cta_url: string;
    status: AnnouncementStatus;
    start_at: string;
    end_at: string;
    department_ids: number[];
    job_titles_csv: string;
    variant_group: string;
    variant_label: string;
}

function emptyForm(): FormState {
    return {
        title: '',
        body: '',
        image_url: '',
        cta_label: '',
        cta_url: '',
        // Default 'draft' is intentional — surfaces nothing on mobile until
        // the admin explicitly publishes. The create form exposes this field
        // so an admin can pick 'active' on the same submit if they want
        // one-step publish (saves them landing on detail + finding the
        // status dropdown for a routine HR notice).
        status: 'draft',
        start_at: '',
        end_at: '',
        department_ids: [],
        job_titles_csv: '',
        variant_group: '',
        variant_label: '',
    };
}

/**
 * ISO 8601 (UTC) → `YYYY-MM-DDTHH:MM` (local time) for <input type="datetime-local">.
 *
 * Naively slicing the ISO string (the prior implementation) chopped the
 * timezone off but kept the UTC numbers, then handed that to the picker
 * which interprets the value as local — visible 4h drift in MU.
 * Converting through `Date` and re-formatting in local fields makes the
 * roundtrip lossless: "user picked 14:30 local" → ISO UTC → "14:30 local".
 */
function isoToLocalInput(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
        `T${pad(d.getHours())}:${pad(d.getMinutes())}`
    );
}

function fromAnnouncement(a: Announcement): FormState {
    return {
        title: a.title,
        body: a.body,
        image_url: a.image_url || '',
        cta_label: a.cta_label || '',
        cta_url: a.cta_url || '',
        status: a.status,
        start_at: isoToLocalInput(a.start_at),
        end_at: isoToLocalInput(a.end_at),
        department_ids: a.targeting?.department_ids || [],
        job_titles_csv: (a.targeting?.job_titles || []).join(','),
        variant_group: a.variant_group || '',
        variant_label: a.variant_label || '',
    };
}

function parseCsvStrings(s: string): string[] | undefined {
    const trimmed = s.trim();
    if (!trimmed) return undefined;
    const out = trimmed.split(',').map((x) => x.trim()).filter(Boolean);
    return out.length ? out : undefined;
}

function buildTargeting(state: FormState): AnnouncementTargeting {
    const t: AnnouncementTargeting = {};
    if (state.department_ids.length) t.department_ids = state.department_ids;
    const jobs = parseCsvStrings(state.job_titles_csv);
    if (jobs) t.job_titles = jobs;
    return t;
}

interface Props {
    mode: 'create' | 'edit';
    initial?: Announcement | null;
    fundingCompanyName?: string;
    fundingCompanyId?: number;
    onSaved: (a: Announcement) => void;
    onCancel?: () => void;
}

export default function AnnouncementForm({
    mode,
    initial,
    fundingCompanyName,
    fundingCompanyId,
    onSaved,
    onCancel,
}: Props) {
    const [state, setState] = useState<FormState>(() =>
        initial ? fromAnnouncement(initial) : emptyForm(),
    );
    const [submitting, setSubmitting] = useState(false);
    const [uploading, setUploading] = useState(false);
    const initialRef = useRef<FormState | null>(initial ? fromAnnouncement(initial) : null);

    useEffect(() => {
        if (initial) {
            const next = fromAnnouncement(initial);
            setState(next);
            initialRef.current = next;
        }
    }, [initial]);

    const creativeChanged: CreativeField[] = useMemo(() => {
        if (mode !== 'edit' || !initialRef.current) return [];
        const start = initialRef.current;
        return CREATIVE_FIELDS.filter((f) => state[f] !== start[f]);
    }, [mode, state]);

    function update<K extends keyof FormState>(field: K, v: FormState[K]) {
        setState((s) => ({ ...s, [field]: v }));
    }

    async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) {
            toast.error('Image must be 2 MB or smaller.');
            return;
        }
        setUploading(true);
        try {
            const { url } = await uploadAnnouncementImage(file);
            update('image_url', url);
            toast.success('Image uploaded.');
        } catch (err) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const detail = (err as any)?.response?.data?.detail || 'Upload failed.';
            toast.error(detail);
        } finally {
            setUploading(false);
            // Reset input so re-selecting the same file re-triggers onChange
            e.target.value = '';
        }
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!state.title.trim() || !state.body.trim()) {
            toast.error('Title and body are required.');
            return;
        }
        if (state.cta_url && !state.cta_url.startsWith('https://')) {
            toast.error('CTA URL must start with https://.');
            return;
        }
        // Silent never-serves on a typo'd date range — campaign would be
        // technically "active" but the /serve window query would never match.
        if (state.start_at && state.end_at) {
            const sMs = new Date(state.start_at).getTime();
            const eMs = new Date(state.end_at).getTime();
            if (eMs <= sMs) {
                toast.error('End must be after start.');
                return;
            }
        }

        setSubmitting(true);
        try {
            if (mode === 'create') {
                let created = await createAnnouncement({
                    title: state.title,
                    body: state.body,
                    image_url: state.image_url || null,
                    cta_label: state.cta_label || null,
                    cta_url: state.cta_url || null,
                    targeting: buildTargeting(state),
                    start_at: state.start_at ? new Date(state.start_at).toISOString() : null,
                    end_at: state.end_at ? new Date(state.end_at).toISOString() : null,
                    variant_group: state.variant_group || null,
                    variant_label: state.variant_label || null,
                });
                // Create endpoint always writes status='draft'. If the admin
                // selected something else (typically 'active' for one-step
                // publish), PATCH it through immediately. Status isn't a
                // creative field, so this doesn't trigger a version snapshot.
                if (state.status !== 'draft') {
                    created = await patchAnnouncement(created.sponsored_content_id, {
                        status: state.status,
                    });
                }
                toast.success(
                    state.status === 'active'
                        ? 'Created and published.'
                        : `Created (status: ${state.status}).`,
                );
                onSaved(created);
            } else if (initial) {
                const patched = await patchAnnouncement(initial.sponsored_content_id, {
                    title: state.title,
                    body: state.body,
                    image_url: state.image_url || null,
                    cta_label: state.cta_label || null,
                    cta_url: state.cta_url || null,
                    status: state.status,
                    targeting: buildTargeting(state),
                    start_at: state.start_at ? new Date(state.start_at).toISOString() : null,
                    end_at: state.end_at ? new Date(state.end_at).toISOString() : null,
                    variant_group: state.variant_group || null,
                    variant_label: state.variant_label || null,
                });
                toast.success(
                    creativeChanged.length
                        ? `Saved. New version created (${creativeChanged.join(', ')}).`
                        : 'Saved.',
                );
                onSaved(patched);
            }
        } catch (err) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const detail = (err as any)?.response?.data?.detail || 'Save failed.';
            toast.error(typeof detail === 'string' ? detail : 'Save failed.');
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={handleSubmit} className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            <div className="space-y-4">
                <Field label="Title" required>
                    <input
                        value={state.title}
                        onChange={(e) => update('title', e.target.value)}
                        maxLength={255}
                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-white"
                    />
                </Field>

                <Field label="Body" required>
                    <textarea
                        value={state.body}
                        onChange={(e) => update('body', e.target.value)}
                        rows={4}
                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-white"
                    />
                </Field>

                <Field label="Image">
                    <div className="flex items-center gap-3">
                        <label className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-700">
                            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                            {uploading ? 'Uploading…' : state.image_url ? 'Replace' : 'Upload'}
                            <input
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                className="hidden"
                                onChange={handleImageUpload}
                                disabled={uploading}
                            />
                        </label>
                        {state.image_url && (
                            <>
                                <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-[260px]" title={state.image_url}>
                                    {state.image_url.split('/').pop()}
                                </span>
                                <button
                                    type="button"
                                    onClick={() => update('image_url', '')}
                                    className="text-xs text-red-500 dark:text-red-400 hover:underline"
                                >
                                    remove
                                </button>
                            </>
                        )}
                    </div>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">JPEG/PNG/WebP, ≤ 2 MB, ≤ 2000×2000 px.</p>
                </Field>

                <div className="grid grid-cols-2 gap-3">
                    <Field label="CTA label">
                        <input
                            value={state.cta_label}
                            onChange={(e) => update('cta_label', e.target.value)}
                            maxLength={100}
                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-white"
                        />
                    </Field>
                    <Field label="CTA URL">
                        <input
                            value={state.cta_url}
                            onChange={(e) => update('cta_url', e.target.value)}
                            placeholder="https://…"
                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
                        />
                    </Field>
                </div>

                <Field label="Status">
                    <select
                        value={state.status}
                        onChange={(e) => update('status', e.target.value as AnnouncementStatus)}
                        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 dark:text-white"
                    >
                        <option value="draft">draft — not visible to employees</option>
                        <option value="active">active — visible to employees</option>
                        <option value="paused">paused — keeps stats, hides from employees</option>
                        <option value="ended">ended — soft-deleted</option>
                    </select>
                    {mode === 'create' && state.status === 'active' && (
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                            Will publish immediately on save.
                        </p>
                    )}
                </Field>

                <div className="grid grid-cols-2 gap-3">
                    <Field label="Start at (optional)">
                        <input
                            type="datetime-local"
                            value={state.start_at}
                            onChange={(e) => update('start_at', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-white"
                        />
                    </Field>
                    <Field label="End at (optional)">
                        <input
                            type="datetime-local"
                            value={state.end_at}
                            onChange={(e) => update('end_at', e.target.value)}
                            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-white"
                        />
                    </Field>
                </div>

                <details className="border border-gray-100 dark:border-gray-800 rounded-lg p-3">
                    <summary className="text-xs font-semibold text-gray-600 dark:text-gray-400 cursor-pointer">
                        Advanced — targeting & A/B
                    </summary>
                    <div className="mt-3 space-y-3">
                        <Field label="Departments (empty = all employees)">
                            <DepartmentMultiPicker
                                companyId={fundingCompanyId ?? null}
                                value={state.department_ids}
                                onChange={(ids) => update('department_ids', ids)}
                            />
                        </Field>
                        <Field label="Job titles (comma-separated, empty = all)">
                            <input
                                value={state.job_titles_csv}
                                onChange={(e) => update('job_titles_csv', e.target.value)}
                                placeholder='e.g. Cashier, Driver'
                                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
                            />
                        </Field>
                        <div className="grid grid-cols-2 gap-3">
                            <Field label="Variant group (UUID)">
                                <input
                                    value={state.variant_group}
                                    onChange={(e) => update('variant_group', e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-white"
                                />
                            </Field>
                            <Field label="Variant label">
                                <input
                                    value={state.variant_label}
                                    onChange={(e) => update('variant_label', e.target.value)}
                                    placeholder="A / B"
                                    className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm dark:bg-gray-800 dark:text-white dark:placeholder-gray-500"
                                />
                            </Field>
                        </div>
                    </div>
                </details>

                {creativeChanged.length > 0 && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-amber-900 dark:text-amber-400 text-xs">
                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                        <div>
                            <p className="font-semibold">Saving will create a new version.</p>
                            <p className="mt-0.5">
                                Changed: {creativeChanged.join(', ')}. Past impressions/clicks stay
                                attributed to the previous version.
                            </p>
                        </div>
                    </div>
                )}

                <div className="flex items-center gap-2 pt-2">
                    <button
                        type="submit"
                        disabled={submitting}
                        className="px-4 py-2 text-sm font-semibold text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60"
                    >
                        {submitting ? 'Saving…' : mode === 'create' ? 'Create' : 'Save changes'}
                    </button>
                    {onCancel && (
                        <button
                            type="button"
                            onClick={onCancel}
                            className="px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
                        >
                            Cancel
                        </button>
                    )}
                </div>
            </div>

            {/* Live preview */}
            <div className="xl:sticky xl:top-6 self-start">
                <SponsoredCardPreview
                    kind="employer"
                    fundingCompanyName={fundingCompanyName}
                    title={state.title}
                    body={state.body}
                    imageUrl={state.image_url || null}
                    ctaLabel={state.cta_label || null}
                    ctaUrl={state.cta_url || null}
                />
            </div>
        </form>
    );
}

function Field({
    label,
    required,
    children,
}: {
    label: string;
    required?: boolean;
    children: React.ReactNode;
}) {
    return (
        <label className="block">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1 block">
                {label}
                {required && <span className="text-red-500 dark:text-red-400 ml-0.5">*</span>}
            </span>
            {children}
        </label>
    );
}
